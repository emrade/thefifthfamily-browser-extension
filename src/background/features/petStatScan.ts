import { GAME_ORIGIN } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { isNetworkFailure, loggedFetch } from '@/shared/requestLog/loggedFetch';
import { STAT_KEYS, panelHtml, parseActivePet, type PetSnapshot, type StatKey } from '@/shared/statBreakdown';
import { parsePetRoster } from '@/shared/statAdvisorSources';
import type { PetScanState, PetSpendPlanEntry } from '@/shared/types';
import { SystemicActionError, postAction } from '../gameAction';
import { getCsrfToken } from '../csrfToken';
import { runQueued } from '../automationQueue';
import { setSwitchingPets } from '../petSwitchLock';
import { getActiveCourierRun } from './smuggling/petCourier';

/**
 * Dashboard → Combat Stats → Advisor → Pet: two player-started runs that need each
 * pet to be the active one for a moment (the game only shows, and only lets
 * you spend on, the active pet):
 *
 * - **Read** ("Read all pets' stats"): sets each pet active, reads its Care
 *   tab and remembers its real stats (storage.rememberActivePet). Spends
 *   nothing.
 * - **Spend** (the points planner): for each pet in the player's plan, sets it
 *   active and spends its points as planned. Permanent; only ever from the
 *   planner's confirm button. Spent points count toward the pet's courier
 *   milestones whatever the stat (docs/pet-training.md), and toward combat if
 *   it's the active pet.
 *
 * Both put the player's original pet back at the end, including on Stop or an
 * error. Nothing schedules either.
 *
 * Request shapes, from the player's own clicks in the archive:
 * - `set_active`: `action`, `pet_id`, `_csrf` (86 calls, 2026-08-12..10-19).
 *   Reply `{"ok":true,"message":"Active pet updated."}`.
 * - `allocate_points`: `action`, `pet_id`, `stat` (str/def/agi/dex), `amount`,
 *   `_csrf` (196 calls). Reply `"+4 STR (−20 points)"`; refusal
 *   `"Need 15 pet points, have 4."`. Amounts seen: 1-6, so larger spends are
 *   sent as chunks of at most 6. The player always set the pet active first.
 * The game reloads the Care tab after each, as here. Pace: a random 4-7 s
 * between pets and 2-3 s between spends, like the player's 2026-10-19 run.
 *
 * While running, Pet Couriers skip their turn (petSwitchLock.ts): the active
 * pet can't do courier runs. A pet the game refuses to switch to (e.g. out on
 * a courier run) is skipped and listed; anything unrecognised stops the run.
 */

const PACE_PET_MIN_MS = 4_000;
const PACE_PET_MAX_MS = 7_000;
const PACE_SPEND_MIN_MS = 2_000;
const PACE_SPEND_MAX_MS = 3_000;
const MAX_PER_SPEND = 6;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pacePet = () => sleep(PACE_PET_MIN_MS + Math.random() * (PACE_PET_MAX_MS - PACE_PET_MIN_MS));
const paceSpend = () => sleep(PACE_SPEND_MIN_MS + Math.random() * (PACE_SPEND_MAX_MS - PACE_SPEND_MIN_MS));

const IDLE: PetScanState = {
  mode: 'read', running: false, startedAt: null, finishedAt: null, total: 0, done: 0, current: null,
  read: [], spent: [], skipped: [], error: null, restored: null, stopRequested: false,
};

let activeRun: Promise<void> | null = null;
let stopRequested = false;

async function update(patch: Partial<PetScanState>): Promise<void> {
  await storage.setPetScanState({ ...IDLE, ...(await storage.getPetScanState()), ...patch });
}

async function readCare(): Promise<string> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?type=menagerie&men_tab=care`, { credentials: 'include' });
  if (!res.ok) throw new Error(`the Menagerie answered ${res.status}`);
  const html = panelHtml(await res.text());
  if (html === null) throw new Error('the Menagerie page came back in an unexpected format');
  return html;
}

/** Reads the Care tab and stores the active pet, as the page capture would. */
async function readActive(): Promise<PetSnapshot> {
  const html = await readCare();
  const pet = parseActivePet(html, Date.now());
  if (!pet) throw new Error("couldn't find the active pet on the Care tab");
  pet.roster = parsePetRoster(html);
  await storage.setStatSourcePet(pet);
  await storage.rememberActivePet(pet);
  return pet;
}

const refusal = (resp: any): string => (typeof resp?.error === 'string' ? resp.error : typeof resp?.message === 'string' ? resp.message : 'refused');

async function setActive(petId: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const resp = await postAction('/actions/menagerie.php', { action: 'set_active', pet_id: petId });
  return resp?.ok === true ? { ok: true } : { ok: false, reason: refusal(resp) };
}

function describe(err: unknown): string {
  if (err instanceof SystemicActionError) return err.message;
  if (isNetworkFailure(err)) return 'no answer from the game (connection lost or timed out)';
  return err instanceof Error ? err.message : String(err);
}

const STAT_LABEL: Record<StatKey, string> = { str: 'STR', def: 'DEF', agi: 'AGI', dex: 'DEX' };

/** Switches to `target` (unless it's already active) and checks the Care tab
 *  agrees. Returns the pet as now shown, or a skip reason. */
async function switchTo(target: { id: number; name: string }, current: PetSnapshot): Promise<PetSnapshot | { skip: string }> {
  if (current.name.toLowerCase() === target.name.toLowerCase()) return current;
  const set = await setActive(target.id);
  if (!set.ok) return { skip: set.reason };
  const pet = await readActive();
  // The page must now show the pet just set active; anything else means the
  // game did something this run doesn't understand.
  if (pet.name.toLowerCase() !== target.name.toLowerCase()) throw new Error(`set ${target.name} active but the Care tab shows ${pet.name}`);
  return pet;
}

/** Spends `alloc` on the active pet, in chunks the game has been sent before.
 *  Stops early (returning what was spent) if the game refuses. */
async function spend(petId: number, alloc: Record<StatKey, number>): Promise<{ spent: Record<StatKey, number>; refused: string | null }> {
  const spent: Record<StatKey, number> = { str: 0, def: 0, agi: 0, dex: 0 };
  for (const k of STAT_KEYS) {
    let left = Math.max(0, Math.floor(alloc[k]));
    while (left > 0) {
      if (stopRequested) return { spent, refused: null };
      const amount = Math.min(MAX_PER_SPEND, left);
      await paceSpend();
      const resp = await postAction('/actions/menagerie.php', { action: 'allocate_points', pet_id: petId, stat: k, amount });
      if (resp?.ok !== true) return { spent, refused: refusal(resp) };
      spent[k] += amount;
      left -= amount;
      await readCare(); // the game reloads the Care tab after each spend
    }
  }
  return { spent, refused: null };
}

type Job = { mode: 'read' } | { mode: 'spend'; plan: PetSpendPlanEntry[] };

async function run(job: Job): Promise<void> {
  stopRequested = false;
  setSwitchingPets(true);
  await storage.setPetScanState({ ...IDLE, mode: job.mode, running: true, startedAt: Date.now() });
  let original: { id: number; name: string } | null = null;
  try {
    if (!(await getCsrfToken())) throw new Error('needs a game action first: do anything that changes something in the game, then try again');
    let current = await readActive();
    const roster = current.roster!;
    if (typeof roster.activeId !== 'number') throw new Error("couldn't find your active pet's id on the Care tab");
    original = { id: roster.activeId, name: current.name };

    const targets: { id: number; name: string; alloc?: Record<StatKey, number> }[] =
      job.mode === 'read'
        ? roster.others.filter((o) => typeof o.id === 'number').map((o) => ({ id: o.id as number, name: o.name }))
        : // The active pet first, so its spend needs no switch.
          [...job.plan].sort((a, b) => Number(b.petId === original!.id) - Number(a.petId === original!.id)).map((p) => ({ id: p.petId, name: p.name, alloc: p.alloc }));
    await update({ total: targets.length, read: job.mode === 'read' ? [current.name] : [] });

    for (const [i, t] of targets.entries()) {
      if (stopRequested) break;
      await update({ current: t.name, done: i });
      if (current.name.toLowerCase() !== t.name.toLowerCase()) await pacePet();
      if (stopRequested) break;
      const now = await switchTo(t, current);
      if ('skip' in now) {
        const s = await storage.getPetScanState();
        await update({ skipped: [...s.skipped, { name: t.name, reason: now.skip }] });
        continue;
      }
      current = now;
      if (job.mode === 'read') {
        const s = await storage.getPetScanState();
        await update({ read: [...s.read, current.name], done: i + 1 });
        continue;
      }
      // Spend: never more than the pet has ready right now.
      let ready = current.roster?.activeStatPointsReady ?? 0;
      const alloc = { str: 0, def: 0, agi: 0, dex: 0 };
      for (const k of STAT_KEYS) {
        const n = Math.min(Math.floor(t.alloc![k]), ready);
        alloc[k] = n;
        ready -= n;
      }
      const result = await spend(t.id, alloc);
      current = await readActive(); // remember the pet's new stats
      const text = STAT_KEYS.filter((k) => result.spent[k] > 0).map((k) => `+${result.spent[k]} ${STAT_LABEL[k]}`).join(', ');
      const s = await storage.getPetScanState();
      await update({
        spent: text ? [...s.spent, { name: t.name, text }] : s.spent,
        skipped: result.refused ? [...s.skipped, { name: t.name, reason: result.refused }] : s.skipped,
        done: i + 1,
      });
    }
  } catch (err) {
    console.error(LOG_PREFIX, 'pet run stopped', err);
    await update({ error: describe(err) });
  } finally {
    // Always put the player's own pet back.
    let restored: string | null = null;
    if (original) {
      try {
        const now = await readActive();
        if (now.name.toLowerCase() !== original.name.toLowerCase()) {
          await pacePet();
          const set = await setActive(original.id);
          if (!set.ok) throw new Error(set.reason);
          const back = await readActive();
          if (back.name.toLowerCase() !== original.name.toLowerCase()) throw new Error(`the Care tab shows ${back.name}`);
        }
        restored = original.name;
      } catch (err) {
        console.error(LOG_PREFIX, 'pet run could not restore the active pet', err);
        const s = await storage.getPetScanState();
        await update({ error: `${s.error ? `${s.error}. ` : ''}Couldn't put ${original.name} back as your active pet (${describe(err)}): set it active on the Care tab.` });
      }
    }
    setSwitchingPets(false);
    await update({ running: false, current: null, finishedAt: Date.now(), restored, stopRequested: false });
  }
}

function start(job: Job): { started: boolean; reason?: string } {
  if (activeRun) return { started: false, reason: 'A pet run is already going.' };
  if (getActiveCourierRun()) return { started: false, reason: 'A Pet Courier run is in progress. Try again in a moment.' };
  activeRun = runQueued('pet-scan', () => run(job)).finally(() => {
    activeRun = null;
  });
  return { started: true };
}

/** Starts a read of every pet. Resolves at once; progress is in storage
 *  (PetScanState), so the Dashboard can close and reopen. */
export async function startPetStatScan(): Promise<{ started: boolean; reason?: string }> {
  return start({ mode: 'read' });
}

/** Spends points per the player's confirmed plan. */
export async function startPetSpend(plan: PetSpendPlanEntry[]): Promise<{ started: boolean; reason?: string }> {
  const clean = plan.filter((p) => Number.isInteger(p.petId) && STAT_KEYS.some((k) => p.alloc[k] > 0));
  if (clean.length === 0) return { started: false, reason: 'Nothing to spend.' };
  return start({ mode: 'spend', plan: clean });
}

export async function stopPetStatScan(): Promise<void> {
  if (!activeRun) return;
  stopRequested = true;
  await update({ stopRequested: true });
}

/** On background start-up: a run marked running can't still be going (its
 *  promise died with the previous script), so say it was interrupted. */
export async function initPetStatScan(): Promise<void> {
  const s = await storage.getPetScanState();
  if (s.running && !activeRun) {
    await storage.setPetScanState({
      ...IDLE,
      ...s,
      running: false,
      current: null,
      finishedAt: Date.now(),
      error: 'The run was interrupted (the browser closed or the extension restarted). Check which pet is active on the Care tab.',
    });
  }
}
