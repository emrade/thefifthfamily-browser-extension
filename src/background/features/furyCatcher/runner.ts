import {
  ALARM_NAMES,
  FURY_CATCHER_FALLBACK_INTERVAL_MS,
  FURY_CATCHER_IMMEDIATE_CHECK_DELAY_MS,
  FURY_CHASE_ENERGY,
  FURY_CHASE_GAP_MS,
  FURY_DRINK_GAP_MS,
  FURY_DRINK_ITEM_NAME,
  FURY_WAKE_JITTER_MS,
} from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { notify } from '@/shared/notify';
import { storage } from '@/shared/storage';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import { SystemicActionError, fetchLiveStatus, postAction, sleep, statusReleaseAt, type LiveStatus } from '../../gameAction';
import type { FuryCatcherConfig, FuryCatcherStatus, FuryCatcherTally } from '@/shared/types';

/**
 * Halloween boss Fury Catcher: chases every ready Fury with Energy, topping
 * Energy up with Energy Drinks (within a daily cap) when it runs short, and
 * leaves the caught Fury banked for the player to fire by hand.
 *
 * Request shapes, from every capture in the 2026-10-09 → 10-11 archives
 * (5,317 `halloween.php` calls, all the real client) and the event panel's
 * own script (`bossReq` always sends `since`):
 *
 * - `action=boss_state&since=N` → `{ok, state, bars}`. `state.boss.status` is
 *   `active` (waves 1–4, with 4/3/2/1 Furies) or `dead` (no Furies,
 *   `respawn_at` ~1h out). `state.fury[].wait` is this player's own cooldown
 *   on that Fury, in seconds as of `state.now`. `since` is the highest
 *   `state.log[].id` seen; the page sends 0 when it opens the boss tab.
 * - `action=boss_chase&fury_id=N&since=N` (202 seen) → `{ok:true, fury_won,
 *   treat_id, treat_name, message, state, bars}`. Costs 5 Energy caught or
 *   not, ~39% caught, and sets that Fury's `wait` to 120. Rejections seen:
 *   "Chasing a Fury costs 5 Energy." (31), "That Fury has vanished." with
 *   `refresh:true` (3, the wave moved on), "You are in hospital." (1).
 *   Chasing while travelling works (10 captured mid-travel).
 * - `inventory.php action=quick_list&stat=energy` → `{ok, items:[{inv_id,
 *   qty, name, short, …}]}`, then `action=use&inv_id=N` → `{ok, message:
 *   "Restored 10 Energy!"}` — the player's own manual refill, every time.
 *
 * `my_fury` (the bank) carries over between bosses, with no cap seen (29 max).
 */

const FEATURE_KEY = 'furyCatcher';
const EVENT_PATH = '/actions/halloween.php';
const INVENTORY_PATH = '/actions/inventory.php';

/** Hard stop on chase/drink/refresh steps in one cycle. A full wave is 4
 *  chases plus a couple of drinks; anything past this is a loop. */
const MAX_STEPS_PER_CYCLE = 14;

interface Fury {
  id: number;
  slot: number;
  wait: number;
}

interface BossState {
  bossNumber: number;
  status: 'active' | 'dead';
  hp: number;
  maxHp: number;
  wave: number;
  respawnAt: number | null;
  fury: Fury[];
  maxLogId: number;
  myFury: number;
  now: number;
  departAt: number | null;
  /** Local `Date.now()` when this state arrived, to age `wait`/`respawn_at`
   *  against the local clock instead of the server's. */
  receivedAt: number;
}

const EMPTY_TALLY: FuryCatcherTally = { chases: 0, caught: 0, drinksUsed: 0, treats: 0 };

/** The game day starts at 23:00 UTC (the daily reset), so shift by an hour
 *  before taking the UTC date. */
function gameDayKey(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}

function randomBetween([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

async function loadStatus(): Promise<FuryCatcherStatus> {
  const stored = await storage.getFuryCatcherStatus();
  const today = gameDayKey();
  const base: FuryCatcherStatus = stored ?? {
    lastChase: null,
    bank: null,
    bankAt: null,
    boss: null,
    todayKey: today,
    today: { ...EMPTY_TALLY },
    lifetime: { ...EMPTY_TALLY },
    nextCheckAt: null,
    note: null,
    pausedReason: null,
    pausedMessage: null,
    pausedAt: null,
  };
  if (base.todayKey !== today) return { ...base, todayKey: today, today: { ...EMPTY_TALLY } };
  return base;
}

function parseState(json: any): BossState | null {
  const st = json?.state;
  const b = st?.boss;
  if (!st || !b || !Array.isArray(st.fury) || typeof st.now !== 'number') return null;
  if (b.status !== 'active' && b.status !== 'dead') return null;
  const fury: Fury[] = [];
  for (const f of st.fury) {
    if (typeof f?.id !== 'number' || typeof f?.wait !== 'number') return null;
    fury.push({ id: f.id, slot: Number(f.slot) || 0, wait: f.wait });
  }
  const logIds = Array.isArray(st.log) ? st.log.map((l: any) => Number(l?.id) || 0) : [];
  return {
    bossNumber: Number(b.number) || 0,
    status: b.status,
    hp: Number(b.hp) || 0,
    maxHp: Number(b.max_hp) || 0,
    wave: Number(b.wave) || 0,
    respawnAt: typeof b.respawn_at === 'number' ? b.respawn_at : null,
    fury,
    maxLogId: logIds.length ? Math.max(...logIds) : 0,
    myFury: Number(st.my_fury) || 0,
    now: st.now,
    departAt: typeof st.depart_at === 'number' ? st.depart_at : null,
    receivedAt: Date.now(),
  };
}

function readEnergy(json: any): number | null {
  return typeof json?.bars?.energy === 'number' ? json.bars.energy : null;
}

/** Seconds left on a Fury's cooldown right now, aged from when its state arrived. */
function furyWaitLeft(state: BossState, fury: Fury): number {
  return fury.wait - (Date.now() - state.receivedAt) / 1000;
}

function respawnAtLocal(state: BossState): number | null {
  return state.respawnAt === null ? null : state.receivedAt + (state.respawnAt - state.now) * 1000;
}

function applyState(status: FuryCatcherStatus, state: BossState): void {
  status.bank = state.myFury;
  status.bankAt = Date.now();
  status.boss = {
    number: state.bossNumber,
    status: state.status,
    hp: state.hp,
    maxHp: state.maxHp,
    wave: state.wave,
    furyCount: state.fury.length,
    respawnAt: respawnAtLocal(state),
  };
}

/** When Energy should reach `needed`, from `stats.php`'s own regen timers —
 *  same calculation as crimesAuto's `nerveReadyAt`. */
function energyReadyAt(live: Pick<LiveStatus, 'energyTimerSeconds' | 'energyRegenSeconds'>, current: number, needed: number): number {
  const points = needed - current;
  if (points <= 0) return Date.now();
  if (live.energyTimerSeconds <= 0 || live.energyRegenSeconds <= 0) return Date.now() + FURY_CATCHER_FALLBACK_INTERVAL_MS;
  return Date.now() + (live.energyTimerSeconds + (points - 1) * live.energyRegenSeconds + 2) * 1000;
}

function scheduleAt(status: FuryCatcherStatus, when: number): void {
  const at = Math.max(when, Date.now() + 1_000);
  chrome.alarms.create(ALARM_NAMES.FURY_CATCHER, { when: at });
  status.nextCheckAt = at;
}

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.FURY_CATCHER) return;
  await runCycle();
}

/** Toggling off clears the alarm right away; toggling on, or changing the
 *  floor/cap while on, checks again in a few seconds under the new config. */
export async function onConfigChanged(config: FuryCatcherConfig): Promise<void> {
  if (!config.enabled) {
    chrome.alarms.clear(ALARM_NAMES.FURY_CATCHER);
    const status = await storage.getFuryCatcherStatus();
    if (status?.nextCheckAt) await storage.setFuryCatcherStatus({ ...status, nextCheckAt: null });
    return;
  }
  chrome.alarms.create(ALARM_NAMES.FURY_CATCHER, { when: Date.now() + FURY_CATCHER_IMMEDIATE_CHECK_DELAY_MS });
}

async function pause(status: FuryCatcherStatus, reason: 'error' | 'event-over', message: string): Promise<void> {
  const config = await storage.getFuryCatcherConfig();
  await storage.setFuryCatcherConfig({ ...config, enabled: false });
  chrome.alarms.clear(ALARM_NAMES.FURY_CATCHER);
  await storage.setFuryCatcherStatus({ ...status, nextCheckAt: null, pausedReason: reason, pausedMessage: message, pausedAt: Date.now() });

  await notify('furyCatcherStopped', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: reason === 'event-over' ? 'Fury Catcher finished' : 'Fury Catcher stopped',
    message,
  });
}

/** Thrown inside a cycle for anything this feature doesn't recognize — the
 *  cycle's catch turns it into a pause. */
class UnexpectedResponse extends Error {}

async function readBossState(since: number): Promise<{ json: any; state: BossState }> {
  const json = await postAction(EVENT_PATH, { action: 'boss_state', since });
  const state = json?.ok === true ? parseState(json) : null;
  if (!state) throw new UnexpectedResponse(`Unexpected boss_state response${json?.error ? `: ${json.error}` : ''} — the game may have changed something.`);
  return { json, state };
}

/** One Energy Drink: `quick_list` then `use`, the same pair the page sends.
 *  Returns the Energy it restored, or `null` when none are left. */
async function drinkOne(): Promise<number | null> {
  const list = await postAction(INVENTORY_PATH, { action: 'quick_list', stat: 'energy' });
  if (list?.ok !== true || !Array.isArray(list.items)) throw new UnexpectedResponse('Unexpected response listing Energy items — the game may have changed something.');

  const wanted = FURY_DRINK_ITEM_NAME.toLowerCase();
  const item = list.items.find((i: any) => String(i?.name ?? '').toLowerCase() === wanted && Number(i?.qty) > 0);
  if (!item || typeof item.inv_id !== 'number') return null;

  await sleep(randomBetween(FURY_DRINK_GAP_MS));
  const used = await postAction(INVENTORY_PATH, { action: 'use', inv_id: item.inv_id });
  const restored = used?.ok === true && typeof used.message === 'string' ? /restored\s+(\d+)\s+energy/i.exec(used.message) : null;
  if (!restored) throw new UnexpectedResponse(`Unexpected response using an ${FURY_DRINK_ITEM_NAME}${used?.error ? `: ${used.error}` : ''}.`);
  return Number(restored[1]);
}

// Guards every entry point (alarm, Check Now from popup or overlay, config
// change) so two triggers can't both chase off the same energy reading.
let cycleInFlight = false;

export async function runCycle(): Promise<void> {
  if (cycleInFlight) return;
  cycleInFlight = true;
  try {
    await runCycleOnce();
  } finally {
    cycleInFlight = false;
  }
}

async function runCycleOnce(): Promise<void> {
  const config = await storage.getFuryCatcherConfig();
  if (!config.enabled) return;

  const status = await loadStatus();
  status.note = null;
  status.pausedReason = null;
  status.pausedMessage = null;
  status.pausedAt = null;
  const persist = () => storage.setFuryCatcherStatus({ ...status });

  try {
    const live = await fetchLiveStatus();
    if (!live) {
      status.note = "Couldn't read your stats — trying again shortly.";
      scheduleAt(status, Date.now() + FURY_CATCHER_FALLBACK_INTERVAL_MS);
      await persist();
      return;
    }
    // Travelling is fine (chases captured mid-travel); hospital is a confirmed
    // block, and jail is assumed to be one.
    if (live.hospitalized || live.jailed) {
      status.note = live.hospitalized ? 'In hospital — waiting to be released.' : 'In jail — waiting to be released.';
      scheduleAt(status, statusReleaseAt(live));
      await persist();
      return;
    }

    let { json, state } = await readBossState(0);
    let energy = readEnergy(json);
    applyState(status, state);
    recordParseSuccess(FEATURE_KEY);

    if (state.departAt !== null && state.now >= state.departAt) {
      await pause(status, 'event-over', 'The Halloween event is over — the Fury Catcher turned itself off.');
      return;
    }

    const floor = Math.max(0, config.energyFloor);
    const needed = floor + FURY_CHASE_ENERGY;
    const chased = new Set<number>();
    let energyShortSince: number | null = null;
    let noDrinksLeft = false;

    for (let step = 0; step < MAX_STEPS_PER_CYCLE; step++) {
      if (state.status !== 'active') break;
      const ready = state.fury.filter((f) => furyWaitLeft(state, f) <= 0 && !chased.has(f.id)).sort((a, b) => a.slot - b.slot);
      if (ready.length === 0) break;
      const fury = ready[0];

      if (energy === null) throw new UnexpectedResponse('The boss response had no Energy reading — the game may have changed something.');

      if (energy < needed) {
        const capLeft = config.dailyDrinkCap - status.today.drinksUsed;
        if (capLeft <= 0 || noDrinksLeft) {
          energyShortSince = energy;
          break;
        }
        const restored = await drinkOne();
        if (restored === null) {
          noDrinksLeft = true;
          energyShortSince = energy;
          break;
        }
        energy += restored;
        status.today.drinksUsed++;
        status.lifetime.drinksUsed++;
        await persist();
        await sleep(randomBetween(FURY_DRINK_GAP_MS));
        continue;
      }

      if (chased.size > 0) await sleep(randomBetween(FURY_CHASE_GAP_MS));
      const resp = await postAction(EVENT_PATH, { action: 'boss_chase', fury_id: fury.id, since: state.maxLogId });
      const next = parseState(resp);
      if (next) {
        next.maxLogId = Math.max(next.maxLogId, state.maxLogId);
        state = next;
        applyState(status, state);
      }
      energy = readEnergy(resp) ?? energy;

      if (resp?.ok === true) {
        if (typeof resp.fury_won !== 'boolean' || !next) throw new UnexpectedResponse('Unexpected chase response — the game may have changed something.');
        chased.add(fury.id);
        const treatName = typeof resp.treat_name === 'string' && resp.treat_name ? resp.treat_name : null;
        status.lastChase = { timestamp: Date.now(), furyId: fury.id, won: resp.fury_won, treatName };
        for (const tally of [status.today, status.lifetime]) {
          tally.chases++;
          if (resp.fury_won) tally.caught++;
          if (treatName) tally.treats++;
        }
        await persist();
        continue;
      }

      const error = typeof resp?.error === 'string' ? resp.error : '';
      if (/has vanished/i.test(error)) {
        // The wave moved on between the read and the chase — re-read, like the page does on `refresh`.
        ({ json, state } = await readBossState(state.maxLogId));
        energy = readEnergy(json) ?? energy;
        applyState(status, state);
        continue;
      }
      if (/costs\s+\d+\s+energy/i.test(error)) {
        // Energy was spent elsewhere since it was read; the next step re-checks it.
        if (energy >= needed) energy = 0;
        continue;
      }
      if (/in hospital/i.test(error)) {
        const fresh = await fetchLiveStatus();
        status.note = 'In hospital — waiting to be released.';
        scheduleAt(status, fresh ? statusReleaseAt(fresh) : Date.now() + FURY_CATCHER_FALLBACK_INTERVAL_MS);
        await persist();
        return;
      }
      throw new UnexpectedResponse(`Unexpected chase rejection${error ? `: "${error}"` : ''}.`);
    }

    // Schedule: the boss's respawn, else the next Fury's cooldown, but no
    // sooner than Energy allows when it ran short with no drink to cover it.
    let when: number;
    if (state.status === 'dead') {
      const respawn = respawnAtLocal(state);
      when = (respawn ?? Date.now() + FURY_CATCHER_FALLBACK_INTERVAL_MS) + randomBetween(FURY_WAKE_JITTER_MS);
      status.note = null;
    } else {
      const waits = state.fury.map((f) => furyWaitLeft(state, f)).filter((w) => w > 0);
      when = waits.length ? Date.now() + Math.min(...waits) * 1000 + randomBetween(FURY_WAKE_JITTER_MS) : Date.now() + FURY_CATCHER_FALLBACK_INTERVAL_MS;
      if (energyShortSince !== null) {
        when = Math.max(when, energyReadyAt(live, energyShortSince, needed) + randomBetween(FURY_WAKE_JITTER_MS));
        status.note = noDrinksLeft
          ? `Out of ${FURY_DRINK_ITEM_NAME}s — catching on natural Energy only.`
          : config.dailyDrinkCap > 0
            ? `Daily ${FURY_DRINK_ITEM_NAME} cap reached — catching on natural Energy until 23:00 UTC.`
            : `Waiting for Energy above your floor of ${floor}.`;
      }
    }
    scheduleAt(status, when);
    await persist();
  } catch (err) {
    if (err instanceof SystemicActionError && err.kind === 'status-blocked') {
      const fresh = await fetchLiveStatus();
      status.note = 'Blocked by jail/hospital/travel — waiting.';
      scheduleAt(status, fresh ? statusReleaseAt(fresh) : Date.now() + FURY_CATCHER_FALLBACK_INTERVAL_MS);
      await persist();
      return;
    }
    if (err instanceof UnexpectedResponse || (err instanceof SystemicActionError && err.kind === 'shape')) recordParseFailure(FEATURE_KEY);
    console.error(LOG_PREFIX, 'fury catcher cycle failed', err);
    await pause(status, 'error', err instanceof Error ? err.message : String(err));
  }
}
