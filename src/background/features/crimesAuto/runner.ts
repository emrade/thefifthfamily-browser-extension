import { ALARM_NAMES, CRIMES_AUTO_FALLBACK_INTERVAL_MS, CRIMES_AUTO_IMMEDIATE_CHECK_DELAY_MS, CRIMES_AUTO_RETRY_DELAY_MS, GAME_ORIGIN } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { notify } from '@/shared/notify';
import { storage } from '@/shared/storage';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import { SystemicActionError, fetchLiveStatus, postAction, statusReleaseAt, type LiveStatus } from '../../gameAction';
import { parseCrimesCatalog } from './crimesPanelParser';
import type { CrimeAttemptResult, CrimesAutoConfig, CrimesAutoStatus } from '@/shared/types';

const FEATURE_KEY = 'crimesAuto';

const DEFAULT_STATUS: CrimesAutoStatus = {
  lastAttempt: null,
  attempts: 0,
  successes: 0,
  busts: 0,
  cashEarned: 0,
  xpEarned: 0,
  bailsPaid: 0,
  bailCashSpent: 0,
  bribesPaid: 0,
  bribeCashSpent: 0,
  districtMasteredAt: null,
  pausedReason: null,
  pausedMessage: null,
  pausedAt: null,
};

async function getStatus(): Promise<CrimesAutoStatus> {
  return (await storage.getCrimesAutoStatus()) ?? DEFAULT_STATUS;
}

function scheduleAt(whenMs: number): void {
  chrome.alarms.create(ALARM_NAMES.CRIMES_AUTO, { when: whenMs });
}

function scheduleFallback(): void {
  scheduleAt(Date.now() + CRIMES_AUTO_FALLBACK_INTERVAL_MS);
}

function scheduleRetry(): void {
  scheduleAt(Date.now() + CRIMES_AUTO_RETRY_DELAY_MS);
}

/**
 * Exact moment Nerve should reach `needed`, computed from `stats.php`'s own
 * `timers.nerve` (seconds to the *next* point) and `regen_rates.nerve`
 * (seconds per point thereafter) — same "align to a real timer instead of
 * blind-polling for it" preference as `statusReleaseAt` for
 * jail/hospital/travel. A 2s buffer covers the same clock-skew margin those
 * other schedule points already add. Falls back to the plain poll interval
 * if the account's own regen fields ever come back as 0 (unexpected, but
 * dividing by a real 0 would be worse than just polling).
 */
function nerveReadyAt(status: Pick<LiveStatus, 'nerve' | 'nerveTimerSeconds' | 'nerveRegenSeconds'>, needed: number): number {
  const pointsNeeded = needed - status.nerve;
  if (pointsNeeded <= 0) return Date.now();
  if (status.nerveTimerSeconds <= 0 || status.nerveRegenSeconds <= 0) return Date.now() + CRIMES_AUTO_FALLBACK_INTERVAL_MS;

  const seconds = status.nerveTimerSeconds + (pointsNeeded - 1) * status.nerveRegenSeconds;
  return Date.now() + (seconds + 2) * 1000;
}

/**
 * Reacts to the popup flipping `enabled` — same "chrome.storage.onChanged,
 * registered once at module load" pattern as `careerAuto/index.ts`'s
 * `onConfigChanged`. There's no job/district picker here to react to (see
 * `CrimesAutoConfig`'s own doc — the runner always targets whatever the live
 * panel shows), so the toggle is the only thing this needs to watch.
 */
export function onConfigChanged(config: CrimesAutoConfig): void {
  if (!config.enabled) {
    chrome.alarms.clear(ALARM_NAMES.CRIMES_AUTO);
    return;
  }
  scheduleAt(Date.now() + CRIMES_AUTO_IMMEDIATE_CHECK_DELAY_MS);
}

/** Disables automation and tells the player — reserved for a genuine
 *  unrecognized response (shape/auth, or a plain rejection this runner
 *  doesn't know how to react to), never for an ordinary "not ready yet"
 *  condition. Mirrors `careerAuto/runner.ts`'s own `pause`. */
async function pause(message: string): Promise<void> {
  const config = await storage.getCrimesAutoConfig();
  await storage.setCrimesAutoConfig({ ...config, enabled: false });

  const status = await getStatus();
  await storage.setCrimesAutoStatus({ ...status, pausedReason: 'error', pausedMessage: message, pausedAt: Date.now() });

  chrome.alarms.clear(ALARM_NAMES.CRIMES_AUTO);

  await notify('crimesAutoStopped', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'Crimes auto-runner stopped',
    message,
  });
}

type MoneyActionResult = { kind: 'ok'; spent: number } | { kind: 'rejected'; message: string } | { kind: 'blocked' } | { kind: 'error'; message: string };

/** `cashBefore` comes from whichever live read is freshest at the call site
 *  (a pre-flight `fetchLiveStatus`, or a commit response's own `stats.cash`)
 *  — the bail/bribe response only reports the *resulting* balance, not what
 *  it actually cost, so the spend is derived by diffing the two rather than
 *  parsed from anywhere the game exposes directly. */
async function payBail(cashBefore: number): Promise<MoneyActionResult> {
  try {
    const resp = await postAction('/api/emergency.php', { action: 'bail' });
    if (resp?.ok === true) {
      return { kind: 'ok', spent: Math.max(0, cashBefore - (Number(resp.stats?.cash) || cashBefore)) };
    }
    return { kind: 'rejected', message: typeof resp?.error === 'string' ? resp.error : 'Bail request was rejected.' };
  } catch (err) {
    if (err instanceof SystemicActionError && err.kind === 'status-blocked') return { kind: 'blocked' };
    return { kind: 'error', message: err instanceof SystemicActionError ? err.message : String(err) };
  }
}

/** Same shape as `payBail` — see its doc comment. No `quote=1` preview call
 *  first: a real capture confirmed that's purely informational for the
 *  page's own UI, not a precondition the actual `action=bribe` call needs. */
async function payBribe(cashBefore: number): Promise<MoneyActionResult> {
  try {
    const resp = await postAction('/api/crimes.php', { action: 'bribe' });
    if (resp?.ok === true) {
      return { kind: 'ok', spent: Math.max(0, cashBefore - (Number(resp.stats?.cash) || cashBefore)) };
    }
    return { kind: 'rejected', message: typeof resp?.error === 'string' ? resp.error : 'Bribe request was rejected.' };
  } catch (err) {
    if (err instanceof SystemicActionError && err.kind === 'status-blocked') return { kind: 'blocked' };
    return { kind: 'error', message: err instanceof SystemicActionError ? err.message : String(err) };
  }
}

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.CRIMES_AUTO) return;
  await runIfEligible();
}

// Same MV3 double-fire guard as careerAuto/runner.ts and
// courierWatch.ts — a service worker woken from dormancy has been confirmed
// to occasionally deliver one scheduled alarm twice.
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
  const config = await storage.getCrimesAutoConfig();
  if (!config.enabled) return; // toggled off since the alarm was scheduled — nothing to do, and nothing to reschedule

  const liveStatus = await fetchLiveStatus();
  if (!liveStatus) {
    scheduleFallback(); // couldn't read live state — try again on the fallback cadence rather than going dormant
    return;
  }

  // Hospitalized/travelling aren't things this feature can do anything
  // about — same three-gate shape careerAuto/courier use, minus jailed,
  // which gets an active response (bail) below instead of a passive wait.
  if (liveStatus.hospitalized || liveStatus.travelling) {
    scheduleAt(statusReleaseAt(liveStatus));
    return;
  }

  if (liveStatus.jailed) {
    const result = await payBail(liveStatus.cash);
    if (result.kind === 'ok') {
      const status = await getStatus();
      await storage.setCrimesAutoStatus({ ...status, bailsPaid: status.bailsPaid + 1, bailCashSpent: status.bailCashSpent + result.spent });
      scheduleRetry();
      return;
    }
    if (result.kind === 'blocked') {
      scheduleFallback(); // transient — something else blocked the bail call itself; try again later
      return;
    }
    await pause(`Could not pay bail while jailed: ${result.message}`);
    return;
  }

  let panelHtml: string;
  try {
    const panelRes = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?type=crimes&_t=${Date.now()}`, { credentials: 'include' });
    panelHtml = await panelRes.text();
  } catch (err) {
    console.error(LOG_PREFIX, 'crimes auto-runner panel fetch failed', err);
    scheduleFallback(); // a failed fetch is transient, not systemic — same treatment as everywhere else in this codebase
    return;
  }

  const entries = parseCrimesCatalog(panelHtml);
  if (entries.length === 0) {
    recordParseFailure(FEATURE_KEY);
    await pause('The Crime Alley panel parsed empty — the page markup may have changed.');
    return;
  }
  recordParseSuccess(FEATURE_KEY);

  const remaining = entries.filter((e) => !e.maxed);
  if (remaining.length === 0) {
    // Every crime on the page is Mastered — nothing left to do until the
    // player beats this district's boss and the next district's crimes
    // appear, which is a manual step this feature deliberately leaves alone.
    await storage.setCrimesAutoConfig({ ...config, enabled: false });
    const status = await getStatus();
    await storage.setCrimesAutoStatus({ ...status, districtMasteredAt: Date.now(), pausedReason: null, pausedMessage: null, pausedAt: null });
    chrome.alarms.clear(ALARM_NAMES.CRIMES_AUTO);
    await notify('crimesAutoDistrictMastered', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'Crime Alley — district mastered!',
      message: 'Every crime here is Mastered. Automation stopped — go challenge the boss.',
    });
    return;
  }

  // Always the first not-yet-Mastered card, in the page's own order — see
  // `CrimeCatalogEntry`'s doc comment for why there's no separate priority
  // to compute here.
  const target = remaining[0];

  // Pre-flight Nerve check, same "read the real balance before spending it"
  // gate `careerAuto/runner.ts` does for energy — skips the doomed commit
  // call entirely rather than firing it and letting the game reject it with
  // "Not enough Nerve.", and schedules the next check for the moment Nerve
  // should actually be there instead of a blind fallback-interval guess.
  if (liveStatus.nerve < target.nerveCost) {
    scheduleAt(nerveReadyAt(liveStatus, target.nerveCost));
    return;
  }

  let resp: any;
  try {
    resp = await postAction('/api/crimes.php', { action: 'commit', crime_id: target.crimeId });
  } catch (err) {
    if (err instanceof SystemicActionError && err.kind === 'status-blocked') {
      // A race between the pre-flight gate above and this call — e.g.
      // hospitalized mid-cycle by something unrelated. Re-read live state
      // rather than guess which status it was.
      const freshStatus = await fetchLiveStatus();
      if (freshStatus?.jailed) {
        const result = await payBail(freshStatus.cash);
        if (result.kind === 'ok') {
          const status = await getStatus();
          await storage.setCrimesAutoStatus({ ...status, bailsPaid: status.bailsPaid + 1, bailCashSpent: status.bailCashSpent + result.spent });
        }
      }
      scheduleAt(freshStatus ? statusReleaseAt(freshStatus) : Date.now() + CRIMES_AUTO_FALLBACK_INTERVAL_MS);
      return;
    }
    recordParseFailure(FEATURE_KEY);
    await pause(err instanceof SystemicActionError ? err.message : String(err));
    return;
  }

  if (resp?.ok === false) {
    if (typeof resp.error === 'string' && /heat is too high/i.test(resp.error)) {
      const result = await payBribe(liveStatus.cash);
      if (result.kind === 'ok') {
        const status = await getStatus();
        await storage.setCrimesAutoStatus({ ...status, bribesPaid: status.bribesPaid + 1, bribeCashSpent: status.bribeCashSpent + result.spent });
        scheduleRetry();
        return;
      }
      if (result.kind === 'blocked') {
        scheduleFallback();
        return;
      }
      await pause(`Heat capped and could not bribe: ${result.message}`);
      return;
    }

    if (typeof resp.error === 'string' && /not enough nerve/i.test(resp.error)) {
      scheduleFallback(); // Nerve regenerates on its own with no exact timer — same as careerAuto's energy gate
      return;
    }

    recordParseFailure(FEATURE_KEY);
    await pause(`Unexpected rejection committing a crime${resp?.error ? `: ${resp.error}` : ''} — the game may have changed something.`);
    return;
  }

  if (typeof resp?.result !== 'string') {
    recordParseFailure(FEATURE_KEY);
    await pause('Unexpected response shape from a crime commit — the game may have changed this action\'s format.');
    return;
  }
  recordParseSuccess(FEATURE_KEY);

  const status = await getStatus();

  if (resp.result === 'busted') {
    const avoidedJail = resp.avoidedJail === true;
    let bailsPaid = status.bailsPaid;
    let bailCashSpent = status.bailCashSpent;

    if (!avoidedJail) {
      const cashNow = Number(resp.stats?.cash) || liveStatus.cash;
      const result = await payBail(cashNow);
      if (result.kind === 'ok') {
        bailsPaid += 1;
        bailCashSpent += result.spent;
      } else if (result.kind === 'blocked') {
        scheduleFallback();
        return;
      } else {
        await pause(`Busted and could not pay bail: ${result.message}`);
        return;
      }
    }

    const lastAttempt: CrimeAttemptResult = {
      timestamp: Date.now(),
      crimeId: target.crimeId,
      crimeName: target.name,
      outcome: avoidedJail ? 'busted-clean' : 'busted-bailed',
      cashGained: 0,
      xpGained: 0,
    };
    await storage.setCrimesAutoStatus({
      ...status,
      attempts: status.attempts + 1,
      busts: status.busts + 1,
      bailsPaid,
      bailCashSpent,
      lastAttempt,
    });
    scheduleRetry();
    return;
  }

  // 'success'
  const cashGained = Number(resp.cashGained) || 0;
  const xpGained = Number(resp.xpGained) || 0;
  const lastAttempt: CrimeAttemptResult = {
    timestamp: Date.now(),
    crimeId: target.crimeId,
    crimeName: target.name,
    outcome: 'success',
    cashGained,
    xpGained,
  };
  await storage.setCrimesAutoStatus({
    ...status,
    attempts: status.attempts + 1,
    successes: status.successes + 1,
    cashEarned: status.cashEarned + cashGained,
    xpEarned: status.xpEarned + xpGained,
    lastAttempt,
  });
  scheduleRetry();
}
