import { ALARM_NAMES, GAME_ORIGIN, GOLD_RUN_ATTACK_TO_LIST_MS, GOLD_RUN_LIST_STALE_MS, GOLD_RUN_LIST_TO_RECON_MS, GOLD_RUN_MANUAL_RESERVE_MS, GOLD_RUN_MAX_LIST_PAGES, GOLD_RUN_MAX_REJECT_STREAK, GOLD_RUN_MAX_SKIP_STREAK, GOLD_RUN_PAGE_GAP_MS, GOLD_RUN_PAGE_SIZE, GOLD_RUN_PAUSE_TTL_MS, GOLD_RUN_RECON_TO_ATTACK_MS, GOLD_RUN_SKIP_TO_RECON_MS, GOLD_RUN_STAMINA_PER_FIGHT } from '@/shared/constants';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import { parseRecon } from '@/shared/fightClubRecon';
import {
  classifyAttackRejection,
  emptyGoldRunState,
  hubQueryForPage,
  holdsStamina,
  mergeFirstPage,
  nextCandidate,
  normaliseHubQuery,
  parseFightResult,
  parseHubTargets,
  rememberOdds,
  withCurrentDay,
  withoutReconSkips,
} from '@/shared/goldRun';
import { LOG_PREFIX } from '@/shared/log';
import type { ExtensionMessage } from '@/shared/messaging';
import { notify } from '@/shared/notify';
import { isRequestTimeout, loggedFetch } from '@/shared/requestLog/loggedFetch';
import { storage } from '@/shared/storage';
import type { GoldRunConfig, GoldRunFightResult, GoldRunLogEntry, GoldRunPauseKind, GoldRunState, GoldRunTarget } from '@/shared/types';
import { runQueued } from '../../automationQueue';
import { SystemicActionError, fetchLiveStatus, postAction, sleep } from '../../gameAction';

/**
 * Reaching the daily gold cap from Fight Club, either one tap at a time from
 * the in-page panel or with Run to Cap. Both go through `fightStep`, so they
 * behave the same. Design, evidence and decisions: docs/gold-run-plan.md.
 *
 * It never uses items or travels: the player does that, and a run pauses and
 * says what it needs. Anything it doesn't recognise also pauses, and nothing
 * retries on its own (see the feedback_pause_on_unexpected memory).
 *
 * This module is the only writer of `GOLD_RUN_STATE`. Every write goes through
 * `update`, because a capture of a fight the player made in-game can arrive
 * during a step, and both are read-then-write.
 */

const FEATURE_KEY = 'fightClub';

type StepOutcome =
  | { kind: 'fought' }
  | { kind: 'skipped' }
  | { kind: 'cap' }
  | { kind: 'stop'; pause: GoldRunPauseKind; message: string };

let writes: Promise<unknown> = Promise.resolve();

function update(change: (state: GoldRunState) => GoldRunState): Promise<GoldRunState> {
  const next = writes.then(async () => {
    const now = Date.now();
    const stored = await storage.getGoldRunState();
    const changed = change(stored ? withCurrentDay(stored, now) : emptyGoldRunState(now));
    // A plain read returns what it was given, so it doesn't wake the panel's
    // storage listener for nothing.
    if (changed !== stored) await storage.setGoldRunState(changed);
    return changed;
  });
  writes = next.catch((err) => console.error(LOG_PREFIX, 'gold run state write failed', err));
  return next;
}

const read = () => update((state) => state);

function randomBetween([min, max]: [number, number]): number {
  return min + Math.random() * (max - min);
}

function appendLog(log: GoldRunLogEntry[], entry: GoldRunLogEntry): GoldRunLogEntry[] {
  return [entry, ...log].slice(0, 8);
}

function markSkipped(targets: GoldRunTarget[], id: number, skipped: string, chance: number | null): GoldRunTarget[] {
  return targets.map((t) => (t.id === id ? { ...t, skipped, chance: chance ?? t.chance } : t));
}

/** Serialised with `update`: a captured recon from the game page can arrive
 *  during a step. */
function saveOdds(targetId: number, chance: number): Promise<void> {
  const next = writes.then(async () => {
    await storage.setGoldRunOdds(rememberOdds(await storage.getGoldRunOdds(), targetId, chance, Date.now()));
  });
  writes = next.catch((err) => console.error(LOG_PREFIX, 'gold run odds write failed', err));
  return next;
}

/** Applies one fight, from this feature or captured from the game page. Only a
 *  win's gold numbers are trusted: a loss reports `gold_today: 0`,
 *  `gold_cap: 200`. */
function applyFight(state: GoldRunState, result: GoldRunFightResult, targetId: number, chance: number | null): GoldRunState {
  return {
    ...state,
    goldToday: result.won ? result.goldToday : state.goldToday,
    goldCap: result.won ? result.goldCap : state.goldCap,
    fightsToday: state.fightsToday + 1,
    goldEarnedToday: state.goldEarnedToday + result.goldGained,
    attackedIds: state.attackedIds.includes(targetId) ? state.attackedIds : [...state.attackedIds, targetId],
    targets: state.targets.filter((t) => t.id !== targetId),
    myLevel: result.attackerLevel || state.myLevel,
    stamina: result.stamina,
    maxStamina: result.maxStamina,
    hp: result.hp,
    maxHp: result.maxHp,
    log: appendLog(state.log, {
      at: Date.now(),
      name: result.defender,
      level: result.defenderLevel,
      outcome: result.won ? 'won' : 'lost',
      chance,
      gold: result.goldGained,
      detail: result.won ? `+${result.goldGained} gold, HP ${result.hp}/${result.maxHp}` : `Lost, HP ${result.hp}/${result.maxHp}`,
    }),
  };
}

async function fetchHubPage(query: string, page: number): Promise<GoldRunTarget[]> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?${hubQueryForPage(query, page, Date.now())}`, { credentials: 'include' });
  const json = await res.json();
  const targets = typeof json?.html === 'string' ? parseHubTargets(json.html) : null;
  if (!targets) {
    recordParseFailure(FEATURE_KEY);
    throw new Error('The Fight Club list came back in a form this feature doesn’t recognise.');
  }
  recordParseSuccess(FEATURE_KEY);
  return targets;
}

/** Reads every page of this district's list, keeping what's known about anyone
 *  still on it. `clearSkips` is the player asking for another look. */
async function refreshAllTargets(clearSkips: boolean): Promise<GoldRunState> {
  const { hubQuery } = await read();
  if (!hubQuery) throw new Error('Open the Fight Club target list once so this can read it the way the game does.');

  const found: GoldRunTarget[] = [];
  for (let page = 1; page <= GOLD_RUN_MAX_LIST_PAGES; page++) {
    if (page > 1) await sleep(randomBetween(GOLD_RUN_PAGE_GAP_MS));
    const cards = await fetchHubPage(hubQuery, page);
    found.push(...cards);
    if (cards.length < GOLD_RUN_PAGE_SIZE) break;
  }

  const [config, odds] = await Promise.all([storage.getGoldRunConfig(), storage.getGoldRunOdds()]);
  return update((state) => {
    const previous = new Map(state.targets.map((t) => [t.id, t]));
    const targets = found
      .filter((t) => !state.attackedIds.includes(t.id))
      .map((t) => {
        const old = previous.get(t.id);
        return old && !clearSkips ? { ...t, chance: old.chance, skipped: old.skipped } : t;
      })
      .sort((a, b) => b.level - a.level);
    return { ...state, targets: withoutReconSkips(targets, state.myLevel, odds, config.minChancePct, Date.now()), targetsAt: Date.now() };
  });
}

/** The reload the game does after every fight. A failure here costs nothing, so
 *  it doesn't stop anything: the next step works from the list it has. */
async function refreshFirstPage(): Promise<void> {
  const { hubQuery } = await read();
  if (!hubQuery) return;
  await sleep(randomBetween(GOLD_RUN_ATTACK_TO_LIST_MS));
  try {
    const page = await fetchHubPage(hubQuery, 1);
    const sortedByLevel = new URLSearchParams(hubQuery).get('fc_sort') === 'level_desc';
    const [config, odds] = await Promise.all([storage.getGoldRunConfig(), storage.getGoldRunOdds()]);
    await update((state) => ({
      ...state,
      targets: withoutReconSkips(mergeFirstPage(state.targets, page, state.attackedIds, sortedByLevel), state.myLevel, odds, config.minChancePct, Date.now()),
      targetsAt: Date.now(),
    }));
  } catch (err) {
    console.error(LOG_PREFIX, 'gold run list reload failed', err);
  }
}

function stopForResources(state: GoldRunState, config: GoldRunConfig): StepOutcome | null {
  if (state.stamina !== null && state.stamina < GOLD_RUN_STAMINA_PER_FIGHT) {
    return { kind: 'stop', pause: 'stamina', message: 'Out of Stamina. Top up, then continue.' };
  }
  if (state.hp !== null && state.maxHp) {
    const floor = Math.ceil((state.maxHp * config.healFloorPct) / 100);
    if (state.hp < floor) return { kind: 'stop', pause: 'heal', message: `HP is ${state.hp}, below your ${config.healFloorPct}% floor (${floor}). Heal, then continue.` };
  }
  return null;
}

/**
 * One target: recon, wait, attack or skip, then the list reload. `targetId`
 * picks a specific one from the panel; otherwise it's the best candidate.
 */
async function fightStep(config: GoldRunConfig, targetId?: number): Promise<StepOutcome> {
  let state = await read();
  if (state.goldToday >= state.goldCap) return { kind: 'cap' };

  const lacking = stopForResources(state, config);
  if (lacking) return lacking;

  let target = targetId !== undefined ? state.targets.find((t) => t.id === targetId) ?? null : nextCandidate(state.targets);
  if (!target && targetId === undefined) {
    state = await refreshAllTargets(false);
    target = nextCandidate(state.targets);
    if (target) await sleep(randomBetween(GOLD_RUN_LIST_TO_RECON_MS));
  }
  if (!target) return { kind: 'stop', pause: 'no-targets', message: 'No targets left here at your cutoff. Travel, then continue.' };

  const res = await loggedFetch(`${GAME_ORIGIN}/actions/attack.php?type=recon&target_id=${target.id}`, { credentials: 'include' });
  const text = await res.text();
  const recon = parseRecon(text, Date.now());
  if (!recon) {
    recordParseFailure(FEATURE_KEY);
    return { kind: 'stop', pause: 'unexpected', message: `Recon on ${target.name} came back in an unexpected form: ${text.slice(0, 120)}` };
  }
  recordParseSuccess(FEATURE_KEY);
  await saveOdds(target.id, recon.successChance);

  const skipReason =
    recon.hospitalized ? 'In hospital'
    : recon.jailed ? 'In jail'
    : recon.online ? 'Online'
    : recon.dailyLimit > 0 && recon.dailyAttacks >= recon.dailyLimit ? 'Already hit today'
    : recon.successChance < config.minChancePct ? `${recon.successChance}%, below ${config.minChancePct}%`
    : null;
  if (skipReason) {
    const id = target.id;
    const name = target.name;
    const level = target.level;
    const after = await update((s) => ({
      ...s,
      skipStreak: s.skipStreak + 1,
      targets: markSkipped(s.targets, id, skipReason, recon.successChance),
      notice: `Skipped ${name}: ${skipReason}.`,
      log: appendLog(s.log, { at: Date.now(), name, level, outcome: 'skipped', chance: recon.successChance, gold: 0, detail: skipReason }),
    }));
    if (after.skipStreak >= GOLD_RUN_MAX_SKIP_STREAK) {
      return { kind: 'stop', pause: 'skips', message: `${after.skipStreak} targets in a row were skipped without a fight. Travel, or press Resume to keep going here.` };
    }
    return { kind: 'skipped' };
  }

  if (recon.staminaCost > 0 && recon.myStamina < recon.staminaCost) {
    await update((s) => ({ ...s, stamina: recon.myStamina }));
    return { kind: 'stop', pause: 'stamina', message: 'Out of Stamina. Top up, then continue.' };
  }

  await sleep(randomBetween(GOLD_RUN_RECON_TO_ATTACK_MS));

  // `noPacing`: the wait above already is the pause before this call.
  const json = await postAction('/actions/attack.php', { target_id: target.id }, { noPacing: true, rejectionScope: 'gold-run' });

  if (json.ok === false) {
    const message = String(json.error ?? json.msg ?? 'unknown rejection');
    const rejection = classifyAttackRejection(message);
    if (rejection === 'no-stamina') return { kind: 'stop', pause: 'stamina', message: 'Out of Stamina. Top up, then continue.' };
    if (rejection === 'self-hospitalized') return { kind: 'stop', pause: 'blocked', message: 'You’re in hospital. Heal, then continue.' };
    if (rejection === 'unknown') return { kind: 'stop', pause: 'unexpected', message: `The game refused the attack on ${target.name}: "${message}"` };

    const id = target.id;
    const after = await update((s) => ({ ...s, targets: markSkipped(s.targets, id, message, recon.successChance), rejectStreak: s.rejectStreak + 1, notice: `Skipped ${target?.name}: ${message}` }));
    if (after.rejectStreak >= GOLD_RUN_MAX_REJECT_STREAK) {
      return { kind: 'stop', pause: 'rejections', message: `${after.rejectStreak} targets in a row couldn’t be attacked. Last: "${message}"` };
    }
    return { kind: 'skipped' };
  }

  const result = parseFightResult(json);
  if (!result) {
    recordParseFailure(FEATURE_KEY);
    return { kind: 'stop', pause: 'unexpected', message: `The attack on ${target.name} returned something unexpected. Check the Combat Log.` };
  }
  recordParseSuccess(FEATURE_KEY);

  const id = target.id;
  const name = target.name;
  const chance = recon.successChance;
  const after = await update((s) => ({
    ...applyFight(s, result, id, chance),
    rejectStreak: 0,
    skipStreak: 0,
    runFights: s.run === 'running' ? s.runFights + 1 : s.runFights,
    runGold: s.run === 'running' ? s.runGold + result.goldGained : s.runGold,
    notice: result.won ? `Beat ${name}: +${result.goldGained} gold.` : `Lost to ${name} at ${chance}%.`,
  }));

  if (!result.won) return { kind: 'stop', pause: 'lost', message: `Lost to ${name} at ${chance}% (HP ${result.hp}). Heal, then continue.` };
  if (after.goldToday >= after.goldCap) return { kind: 'cap' };
  // A win below the cap has always paid: a change here would burn Stamina for nothing.
  if (result.goldGained <= 0) return { kind: 'stop', pause: 'unexpected', message: `Beat ${name} but got no gold, with ${after.goldToday}/${after.goldCap} today.` };

  await refreshFirstPage();
  return { kind: 'fought' };
}

/** Turns anything thrown during a step into a stop with a readable reason. */
async function guardedStep(config: GoldRunConfig, targetId?: number): Promise<StepOutcome> {
  try {
    return await runQueued('gold-run', () => fightStep(config, targetId), { linger: true });
  } catch (err) {
    if (err instanceof SystemicActionError && err.kind === 'status-blocked') {
      return { kind: 'stop', pause: 'blocked', message: 'You’re jailed, in hospital or travelling. Sort that out, then continue.' };
    }
    if (isRequestTimeout(err)) return { kind: 'stop', pause: 'unexpected', message: 'The game didn’t reply in time. Check the Combat Log before continuing, as the fight may have happened.' };
    console.error(LOG_PREFIX, 'gold run step failed', err);
    return { kind: 'stop', pause: 'unexpected', message: err instanceof Error ? err.message : String(err) };
  }
}

/** Reads the live bar before a fight the player has just asked for: they may
 *  have eaten or healed in the game since the last response. */
async function refreshVitals(): Promise<StepOutcome | null> {
  const status = await fetchLiveStatus();
  if (!status) return { kind: 'stop', pause: 'unexpected', message: 'Couldn’t read your stats from the game. Check the game tab is logged in.' };
  await update((s) => ({ ...s, myLevel: status.level || s.myLevel, stamina: status.stamina, maxStamina: status.maxStamina, hp: status.vitality, maxHp: status.maxVitality }));
  if (status.jailed) return { kind: 'stop', pause: 'blocked', message: 'You’re in jail. Sort that out, then continue.' };
  if (status.hospitalized) return { kind: 'stop', pause: 'blocked', message: 'You’re in hospital. Heal, then continue.' };
  if (status.travelling) return { kind: 'stop', pause: 'blocked', message: 'You’re travelling. Continue once you land.' };
  return null;
}

/** Re-entrancy guard for every by-hand action and the loop's start. */
let actionInFlight = false;
let loopActive = false;

async function pauseRun(kind: GoldRunPauseKind, message: string): Promise<void> {
  const now = Date.now();
  await update((s) => ({ ...s, run: 'paused', pauseKind: kind, pausedAt: now, notice: message, busy: false }));
  chrome.alarms.create(ALARM_NAMES.GOLD_RUN_PAUSE_EXPIRY, { when: now + GOLD_RUN_PAUSE_TTL_MS });
  if (kind !== 'player') await tellPlayer('Gold Run paused', message);
}

async function tellPlayer(title: string, message: string): Promise<void> {
  await notify('goldRunStopped', { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon-128.png'), title, message });
}

async function finishRun(notice: string): Promise<void> {
  await chrome.alarms.clear(ALARM_NAMES.GOLD_RUN_PAUSE_EXPIRY);
  await update((s) => ({ ...s, run: 'idle', pauseKind: null, pausedAt: null, notice, busy: false }));
}

async function runLoop(): Promise<void> {
  if (loopActive) return;
  loopActive = true;
  const startedDay = (await read()).dayKey;
  try {
    for (;;) {
      const state = await read();
      if (state.run !== 'running') return;
      // The player topped up for one day's cap. Don't quietly spend more on the next.
      if (state.dayKey !== startedDay) {
        const message = 'A new game day started, so the run ended. Start again for today’s gold.';
        await finishRun(message);
        await tellPlayer('Gold Run finished', message);
        return;
      }
      const config = await storage.getGoldRunConfig();
      if (!config.automationEnabled) {
        await finishRun('Run to Cap was switched off, so the run ended.');
        return;
      }

      const outcome = await guardedStep(config);

      // Pressed Pause or Stop during that step: the fight's done, and that wins.
      if ((await read()).run !== 'running') return;

      if (outcome.kind === 'cap') {
        const done = await read();
        const summary = `Reached ${done.goldToday}/${done.goldCap} gold. This run: ${done.runFights} fights, ${done.runGold} gold.`;
        await finishRun(summary);
        await tellPlayer('Gold Run finished', summary);
        return;
      }
      if (outcome.kind === 'stop') {
        await pauseRun(outcome.pause, outcome.message);
        return;
      }
      await sleep(randomBetween(outcome.kind === 'skipped' ? GOLD_RUN_SKIP_TO_RECON_MS : GOLD_RUN_LIST_TO_RECON_MS));
    }
  } catch (err) {
    console.error(LOG_PREFIX, 'gold run loop failed', err);
    await pauseRun('unexpected', err instanceof Error ? err.message : String(err));
  } finally {
    loopActive = false;
  }
}

/** Shared start of Start and Resume: live stats, then a fresh list, because the
 *  player may have travelled during a pause. */
async function beginRunning(isResume: boolean): Promise<GoldRunState> {
  if (loopActive) return update((s) => ({ ...s, notice: 'Finishing the current fight. Press again in a moment.' }));
  if (actionInFlight) return read();
  const config = await storage.getGoldRunConfig();
  if (!config.automationEnabled) return update((s) => ({ ...s, notice: 'Turn on Run to Cap first.' }));

  actionInFlight = true;
  try {
    await chrome.alarms.clear(ALARM_NAMES.GOLD_RUN_PAUSE_EXPIRY);
    await update((s) => ({
      ...s,
      run: 'running',
      pauseKind: null,
      pausedAt: null,
      notice: isResume ? 'Resumed.' : 'Run started.',
      runFights: isResume ? s.runFights : 0,
      runGold: isResume ? s.runGold : 0,
      rejectStreak: 0,
      skipStreak: 0,
    }));
    const blocked = await refreshVitals();
    if (blocked?.kind === 'stop') {
      await pauseRun(blocked.pause, blocked.message);
      return read();
    }
    await refreshAllTargets(false);
    // The game leaves a gap between loading its list and opening a target.
    await sleep(randomBetween(GOLD_RUN_LIST_TO_RECON_MS));
  } catch (err) {
    await pauseRun('unexpected', err instanceof Error ? err.message : String(err));
    return read();
  } finally {
    actionInFlight = false;
  }
  void runLoop();
  return read();
}

export const startRun = () => beginRunning(false);
export const resumeRun = () => beginRunning(true);

export async function pauseRunByPlayer(): Promise<GoldRunState> {
  if ((await read()).run === 'running') await pauseRun('player', 'Paused. Press Resume to continue.');
  return read();
}

export async function stopRun(): Promise<GoldRunState> {
  const state = await read();
  if (state.run !== 'idle') await finishRun(`Run ended: ${state.runFights} fights, ${state.runGold} gold.`);
  return read();
}

/** One by-hand tap: "Fight next", or Fight on a chosen row. Holds the Stamina
 *  reserve for a few minutes, as the player is clearly mid-session. */
export async function fightOnce(targetId?: number): Promise<GoldRunState> {
  const state = await read();
  if (actionInFlight || loopActive || state.run === 'running') return state;

  actionInFlight = true;
  await update((s) => ({ ...s, busy: true, reserveUntil: Date.now() + GOLD_RUN_MANUAL_RESERVE_MS }));
  try {
    const config = await storage.getGoldRunConfig();
    const blocked = await refreshVitals();
    const outcome = blocked ?? (await guardedStep(config, targetId));
    await update((s) => ({
      ...s,
      notice:
        outcome.kind === 'stop' ? outcome.message
        : outcome.kind === 'cap' ? `Reached ${s.goldToday}/${s.goldCap} gold. Done for today.`
        : s.notice,
      reserveUntil: Date.now() + GOLD_RUN_MANUAL_RESERVE_MS,
    }));
  } finally {
    actionInFlight = false;
    await update((s) => ({ ...s, busy: false }));
  }
  return read();
}

/** The panel's Refresh: live stats and the whole list, with skips forgotten. */
export async function refreshByPlayer(): Promise<GoldRunState> {
  const state = await read();
  if (actionInFlight || loopActive || state.run === 'running') return state;
  actionInFlight = true;
  await update((s) => ({ ...s, busy: true }));
  try {
    const blocked = await refreshVitals();
    if (blocked?.kind === 'stop') await update((s) => ({ ...s, notice: blocked.message }));
    await refreshAllTargets(true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await update((s) => ({ ...s, notice: message }));
  } finally {
    actionInFlight = false;
    await update((s) => ({ ...s, busy: false }));
  }
  return read();
}

/** The panel being opened: reads only what's missing or old, so that leaving it
 *  closed sends the game nothing at all. */
export async function panelOpened(): Promise<GoldRunState> {
  const state = await read();
  if (state.run === 'running' || actionInFlight || loopActive) return state;
  if (state.stamina !== null && state.targets.length > 0 && Date.now() - state.targetsAt < GOLD_RUN_LIST_STALE_MS) return state;
  actionInFlight = true;
  await update((s) => ({ ...s, busy: true }));
  try {
    const blocked = await refreshVitals();
    if (blocked?.kind === 'stop') await update((s) => ({ ...s, notice: blocked.message }));
    if (state.hubQuery) await refreshAllTargets(false);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await update((s) => ({ ...s, notice: message }));
  } finally {
    actionInFlight = false;
    await update((s) => ({ ...s, busy: false }));
  }
  return read();
}

/** Whether Street Intel Auto should leave Stamina alone right now. */
export async function goldRunHoldsStamina(): Promise<boolean> {
  return holdsStamina(await storage.getGoldRunState(), Date.now());
}

/** Captures from the game page: a fight the player made there, the query its
 *  own list uses, and travel, which makes the current list wrong. */
export async function handleMessage(msg: ExtensionMessage): Promise<void> {
  if (msg.type === 'gold-run-hub-observed') {
    const hubQuery = normaliseHubQuery(msg.url);
    if (hubQuery && (await read()).hubQuery !== hubQuery) await update((s) => ({ ...s, hubQuery }));
    return;
  }
  if (msg.type === 'gold-run-recon-observed') {
    await saveOdds(msg.targetId, msg.chance);
    return;
  }
  if (msg.type === 'gold-run-attack-observed') {
    await update((s) => ({ ...applyFight(s, msg.result, msg.targetId, null), skipStreak: 0 }));
    return;
  }
  if (msg.type === 'travel-started') {
    const state = await read();
    if (!state.targets.length && state.run !== 'running') return;
    await update((s) => ({ ...s, targets: [], targetsAt: 0 }));
    if (state.run === 'running') await pauseRun('blocked', 'You started travelling. Press Resume once you land.');
  }
}

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.GOLD_RUN_PAUSE_EXPIRY) return;
  const state = await read();
  if (state.run === 'paused') await finishRun('The paused run ended after 30 minutes, so Street Intel Auto can use Stamina again.');
}

/**
 * Runs each time the background wakes. A run still marked running can't be: the
 * loop lives in memory, so the background was unloaded mid-run. It's shown as
 * paused and never continued on its own. `busy` is reset for the same reason.
 */
export async function init(): Promise<void> {
  const state = await storage.getGoldRunState();
  if (!state) return;
  if (state.run === 'running') await pauseRun('restart', 'The extension restarted during the run. Press Resume to continue.');
  else if (state.busy) await update((s) => ({ ...s, busy: false }));
  if (state.run === 'paused' && state.pausedAt !== null && Date.now() - state.pausedAt >= GOLD_RUN_PAUSE_TTL_MS) {
    await finishRun('The paused run ended after 30 minutes, so Street Intel Auto can use Stamina again.');
  }
}
