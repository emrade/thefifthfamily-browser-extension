import { ALARM_NAMES, CAREER_AUTO_BUFFER_MS, CAREER_AUTO_FALLBACK_INTERVAL_MS, CAREER_AUTO_IMMEDIATE_CHECK_DELAY_MS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { notify } from '@/shared/notify';
import { storage } from '@/shared/storage';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import { SystemicActionError, fetchLiveStatus, postAction } from '../../gameAction';
import type { CareerAccuracyWeight, CareerAutoConfig } from '@/shared/types';

const FEATURE_KEY = 'careerAuto';

/**
 * Schedules the next eligibility check. Given a known cooldown expiry, aligns to
 * it plus a small buffer — same pattern as `marketPoller.scheduleNextPoll`
 * aligning to `marketShiftAt`. Given `null` (not enough energy yet, or
 * travelling/jailed/hospitalized), falls back to a plain re-poll interval, since
 * none of those resolve on their own schedule the way a cooldown timer does.
 * Not used for "config just changed" — see `onConfigChanged`, which schedules
 * its own much shorter delay instead of this one's multi-minute fallback.
 */
export function scheduleNextCheck(nextEligibleAt: number | null): void {
  const when = nextEligibleAt !== null ? nextEligibleAt + CAREER_AUTO_BUFFER_MS : Date.now() + CAREER_AUTO_FALLBACK_INTERVAL_MS;
  chrome.alarms.create(ALARM_NAMES.CAREER_AUTO, { when });
}

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.CAREER_AUTO) return;
  await runIfEligible();
}

/**
 * Reacts to the popup flipping `enabled`/switching jobs — called from
 * background/index.ts's `chrome.storage.onChanged` listener. Toggling off
 * clears the alarm immediately, so nothing fires after the switch is off, no
 * matter where in its own cycle a stale alarm might already be. Toggling on (or
 * changing the selected job — the picker is never locked while a cooldown is
 * counting down, since switching jobs at any time is exactly the "grind this
 * one to max rank, then move to the next" use case this feature is for)
 * schedules a near-immediate eligibility check under the new config, deliberately
 * *not* going through `scheduleNextCheck(null)` — that one's `null` branch is the
 * multi-minute "not ready yet, try later" fallback, which would make flipping
 * the toggle on take up to that long to do anything, and would leave whatever
 * job was previously selected's tracked cooldown displayed as if it still
 * applied to the new one.
 */
export function onConfigChanged(config: CareerAutoConfig): void {
  if (!config.enabled || config.careerId == null) {
    chrome.alarms.clear(ALARM_NAMES.CAREER_AUTO);
    return;
  }
  chrome.alarms.create(ALARM_NAMES.CAREER_AUTO, { when: Date.now() + CAREER_AUTO_IMMEDIATE_CHECK_DELAY_MS });
}

/** Weighted pick over the small set of discrete accuracy values the account has
 *  real history for — see `CAREER_AUTO_DEFAULT_ACCURACY_WEIGHTS`'s comment for
 *  why this isn't a smooth random range. Falls back to the first entry's value
 *  if the weight list is ever empty (shouldn't happen — the default always has
 *  entries — but a config field is user-editable storage, not a type-checked
 *  literal, so this doesn't assume it stayed well-formed). */
function pickAccuracy(weights: CareerAccuracyWeight[]): number {
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  if (total <= 0) return weights[0]?.value ?? 95;

  let roll = Math.random() * total;
  for (const w of weights) {
    roll -= w.weight;
    if (roll <= 0) return w.value;
  }
  return weights[weights.length - 1].value;
}

/** Local calendar-day key (not UTC) — resets `shiftsToday` at the player's own
 *  midnight, not an arbitrary one. Same shape as analytics/timeSeries.ts's own
 *  private `dayKey`, kept separately rather than shared — a two-line date key
 *  isn't worth a cross-feature import for. */
function localDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

async function pause(reason: 'fired' | 'error', message: string): Promise<void> {
  const config = await storage.getCareerAutoConfig();
  await storage.setCareerAutoConfig({ ...config, enabled: false });

  const status = await storage.getCareerAutoStatus();
  await storage.setCareerAutoStatus({
    lastShift: status?.lastShift ?? null,
    nextEligibleAt: null,
    pausedReason: reason,
    pausedMessage: message,
    pausedAt: Date.now(),
    shiftsToday: status?.shiftsToday ?? 0,
    shiftsTodayDate: status?.shiftsTodayDate ?? localDateKey(),
  });

  chrome.alarms.clear(ALARM_NAMES.CAREER_AUTO);

  await notify('careerAutoStopped', {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'Career auto-runner stopped',
    message,
  });
}

// `chrome.alarms` is confirmed to occasionally fire an alarm twice for a
// single scheduled time after the service worker's been dormant (a known
// MV3 platform quirk — see the identical guard and its doc comment in
// streetIntel/actionRunner.ts, where this was first caught and fixed).
// Real capture here too, 2026-08-26: two `career.php` shift attempts fired
// 210ms apart off a single shared energy reading — the first spent the
// energy, the second came back a legitimate `ok:false` ("Not enough
// energy!") and, since this runner treats any non-`ok:true` shift response
// as a systemic failure, paused the whole automation over what was really
// just a duplicate firing.
let cycleInFlight = false;

export async function runIfEligible(): Promise<void> {
  if (cycleInFlight) return;
  cycleInFlight = true;
  try {
    await runIfEligibleOnce();
  } finally {
    cycleInFlight = false;
  }
}

async function runIfEligibleOnce(): Promise<void> {
  const config = await storage.getCareerAutoConfig();
  if (!config.enabled || config.careerId == null) return; // toggled off since the alarm was scheduled — nothing to do, and nothing to reschedule

  const status = await fetchLiveStatus();
  if (!status) {
    scheduleNextCheck(null); // couldn't read live state — try again on the fallback cadence rather than going dormant
    return;
  }

  // Same three gates `marketPoller.isSafeToPoll` uses, for the identical reason
  // — the action is likely to fail or be meaningless in any of these states.
  if (status.travelling || status.jailed || status.hospitalized) {
    scheduleNextCheck(null);
    return;
  }

  const overtime = config.otAvailable && config.otEnergyCost != null && status.energy >= config.otEnergyCost;
  const canRunNormal = status.energy >= config.energyCost;
  if (!overtime && !canRunNormal) {
    scheduleNextCheck(null); // not enough energy yet — energy regenerates on its own, so just check again later
    return;
  }

  const accuracy = pickAccuracy(config.accuracyWeights);

  let resp: any;
  try {
    resp = await postAction('/actions/career.php', {
      career_id: config.careerId,
      accuracy,
      overtime: overtime ? 1 : 0,
    });
  } catch (err) {
    recordParseFailure(FEATURE_KEY);
    const message = err instanceof SystemicActionError ? err.message : String(err);
    console.error(LOG_PREFIX, 'career auto-runner action failed', err);
    await pause('error', message);
    return;
  }

  // No confirmed example of a real rejection exists for this endpoint (every
  // captured call so far has been ok:true) — anything other than a clean
  // ok:true response is unrecognized shape, treated the same conservative way
  // `SystemicActionError`'s 'shape' kind is treated elsewhere: stop and tell the
  // player, rather than guess at what changed.
  if (resp?.ok !== true || typeof resp.cooldown_seconds !== 'number') {
    recordParseFailure(FEATURE_KEY);
    await pause('error', `Unexpected response from a career shift${resp?.error ? `: ${resp.error}` : ''} — the game may have changed something.`);
    return;
  }

  recordParseSuccess(FEATURE_KEY);

  if (resp.fired === true) {
    await pause('fired', `Got fired from ${config.careerName} after a fumbled shift. Automation stopped — check the job in-game before re-enabling.`);
    return;
  }

  const nextEligibleAt = Date.now() + resp.cooldown_seconds * 1000;
  const today = localDateKey();
  const previousStatus = await storage.getCareerAutoStatus();
  const shiftsToday = previousStatus?.shiftsTodayDate === today ? previousStatus.shiftsToday + 1 : 1;

  await storage.setCareerAutoStatus({
    lastShift: {
      timestamp: Date.now(),
      careerId: config.careerId,
      careerName: config.careerName,
      overtime,
      accuracy,
      tier: String(resp.tier ?? ''),
      tierLabel: String(resp.tierLabel ?? ''),
      cash: Number(resp.cash) || 0,
      xp: Number(resp.xp) || 0,
      promoted: Boolean(resp.promoted),
      leveledUp: Boolean(resp.leveled_up),
      rankName: String(resp.rank_name ?? ''),
    },
    nextEligibleAt,
    pausedReason: null,
    pausedMessage: null,
    pausedAt: null,
    shiftsToday,
    shiftsTodayDate: today,
  });

  scheduleNextCheck(nextEligibleAt);
}
