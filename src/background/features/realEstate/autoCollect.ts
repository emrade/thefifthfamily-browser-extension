import {
  ALARM_NAMES,
  REAL_ESTATE_AUTO_HISTORY_MAX,
  REAL_ESTATE_AUTO_IMMEDIATE_CHECK_DELAY_MS,
  REAL_ESTATE_AUTO_JITTER_MS,
  REAL_ESTATE_AUTO_RETRY_MS,
  STORAGE_KEYS,
} from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { notify } from '@/shared/notify';
import { storage } from '@/shared/storage';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import { hoursSinceCollected } from '@/shared/realEstateVaults';
import { SystemicActionError, depositCashOnHand, fetchLiveStatus, postAction, statusReleaseAt } from '../../gameAction';
import { handleMessage as handleVaultMessage, readLiveVaults } from './vaultReminder';
import type { RealEstateAutoConfig, RealEstateAutoRun, RealEstateAutoStatus, RealEstateAutoTally, RealEstateVaultState } from '@/shared/types';

/**
 * Real Estate Auto-Collect: a safety net for the days the player doesn't get
 * to the Properties page. Once `intervalHours` have passed since the last
 * collection (theirs included), it presses Collect All and banks the cash.
 * On a day they collect by hand it never runs. Off by default.
 *
 * Request shape, from all 144 `collect_all` calls in the archive
 * (2026-09-20 → 10-15, every one the real client) and the panel's own
 * `Rev2._send`: `action=collect_all&idempotency_key=colall-<uuid>&_csrf=…`,
 * nothing else. The key is per attempt and survives a network error (the
 * page reuses it on the retry so the server pays once), so this does the
 * same with `pendingKey`. Responses: `{ok, message, count, total,
 * devotion_skim?}`; the one rejection seen is "You can't do that while in
 * jail!".
 *
 * Due-ness is read from the live Properties panel, not from the collections
 * this extension happened to see: a vault holds whole hours of income since
 * its last collection, so a collection on another device or a single-card
 * Collect moves the clock too.
 */

const FEATURE_KEY = 'realEstateAuto';
const COLLECT_PATH = '/actions/properties_v2.php';

const EMPTY_TALLY: RealEstateAutoTally = { runs: 0, collected: 0, banked: 0 };

/** The game day starts at 23:00 UTC (the daily reset). */
function gameDayKey(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}

function jitter(): number {
  const [lo, hi] = REAL_ESTATE_AUTO_JITTER_MS;
  return lo + Math.random() * (hi - lo);
}

function emptyStatus(): RealEstateAutoStatus {
  return {
    history: [],
    todayKey: gameDayKey(),
    today: { ...EMPTY_TALLY },
    lifetime: { ...EMPTY_TALLY },
    nextCheckAt: null,
    lastCheckAt: null,
    lastCollectionAt: null,
    note: null,
    blockedSince: null,
    pendingKey: null,
    pausedMessage: null,
    pausedAt: null,
  };
}

async function loadStatus(): Promise<RealEstateAutoStatus> {
  const base = { ...emptyStatus(), ...((await storage.getRealEstateAutoStatus()) ?? {}) };
  const today = gameDayKey();
  return base.todayKey === today ? base : { ...base, todayKey: today, today: { ...EMPTY_TALLY } };
}

function scheduleAt(status: RealEstateAutoStatus, when: number): void {
  const at = Math.max(when, Date.now() + 1_000);
  chrome.alarms.create(ALARM_NAMES.REAL_ESTATE_AUTO, { when: at });
  status.nextCheckAt = at;
}

/** When a collection is due, from vaults read at their own `at`. */
function dueAt(vaults: RealEstateVaultState['vaults'], intervalHours: number): number | null {
  const now = Date.now();
  const since = hoursSinceCollected(vaults, now);
  return since === null ? null : now + Math.max(0, intervalHours - since) * 3_600_000;
}

class UnexpectedResponse extends Error {}

async function pause(status: RealEstateAutoStatus, message: string): Promise<void> {
  const config = await storage.getRealEstateAutoConfig();
  await storage.setRealEstateAutoConfig({ ...config, enabled: false });
  chrome.alarms.clear(ALARM_NAMES.REAL_ESTATE_AUTO);
  await storage.setRealEstateAutoStatus({ ...status, nextCheckAt: null, pausedMessage: message, pausedAt: Date.now() });
  await notify('realEstateAutoStopped', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'Real Estate Auto-Collect stopped',
    message: `${message} Collect by hand, then turn it back on in the popup.`,
  });
}

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.REAL_ESTATE_AUTO) return;
  await runCycle();
}

// Alarm, Check Now and a config change all come through here, so two can't
// both read the vaults as due and collect twice.
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

/** A deposit is best-effort: the collection already happened. Returns what
 *  it banked, or `null` with the reason in `status.note`. Only the same
 *  rejection over and over (`repeated-rejection`) is thrown on to pause. */
async function bankIt(status: RealEstateAutoStatus): Promise<number | null> {
  let resp: any;
  try {
    resp = await depositCashOnHand('real-estate-auto');
  } catch (err) {
    if (err instanceof SystemicActionError && (err.kind === 'repeated-rejection' || err.kind === 'shape')) throw err;
    status.note = `Collected, but the deposit failed (${err instanceof Error ? err.message : String(err)}). The cash is on hand.`;
    return null;
  }
  if (resp?.ok === true) {
    const m = typeof resp.message === 'string' ? /deposited\s+\$([\d,]+)/i.exec(resp.message) : null;
    if (!m) throw new UnexpectedResponse(`Unexpected deposit response: ${JSON.stringify(resp).slice(0, 160)}`);
    return Number(m[1].replace(/,/g, ''));
  }
  const error = typeof resp?.error === 'string' ? resp.error : 'unknown error';
  // "Invalid amount" is what the bank says with nothing on hand: something
  // else (another feature's deposit) already banked it.
  status.note = /invalid amount/i.test(error)
    ? 'Collected; another feature had already banked the cash.'
    : `Collected, but the bank refused the deposit: "${error}". The cash is on hand.`;
  return null;
}

async function runCycleOnce(): Promise<void> {
  const config = await storage.getRealEstateAutoConfig();
  if (!config.enabled) return;

  const status = await loadStatus();
  status.note = null;
  status.pausedMessage = null;
  status.pausedAt = null;
  status.lastCheckAt = Date.now();
  const persist = () => storage.setRealEstateAutoStatus({ ...status });
  const blocked = (note: string, retryAt: number) => {
    status.note = note;
    status.blockedSince ??= Date.now();
    scheduleAt(status, retryAt);
  };

  try {
    const live = await fetchLiveStatus();
    if (!live) {
      blocked("Couldn't read your stats (logged out or offline). Trying again shortly.", Date.now() + REAL_ESTATE_AUTO_RETRY_MS);
      await persist();
      return;
    }
    if (live.jailed || live.hospitalized) {
      blocked(live.jailed ? 'In jail. Waiting to be released.' : 'In hospital. Waiting to be released.', statusReleaseAt(live) + jitter());
      await persist();
      return;
    }

    const vaults = await readLiveVaults();
    if (!vaults) {
      blocked("Couldn't read the Properties page. Trying again shortly.", Date.now() + REAL_ESTATE_AUTO_RETRY_MS);
      await persist();
      return;
    }
    const since = hoursSinceCollected(vaults);
    if (since === null) {
      status.blockedSince = null;
      status.note = 'No owned properties found.';
      scheduleAt(status, Date.now() + config.intervalHours * 3_600_000);
      await persist();
      return;
    }
    status.lastCollectionAt = Date.now() - since * 3_600_000;

    if (since < config.intervalHours) {
      status.blockedSince = null;
      scheduleAt(status, Date.now() + (config.intervalHours - since) * 3_600_000 + jitter());
      await persist();
      return;
    }

    const key = status.pendingKey ?? `colall-${crypto.randomUUID()}`;
    status.pendingKey = key;
    await persist();
    let resp: any;
    try {
      resp = await postAction(COLLECT_PATH, { action: 'collect_all', idempotency_key: key });
    } catch (err) {
      // Any answer from the server is definitive; only a request that never
      // got one keeps its key for the retry.
      if (err instanceof SystemicActionError) status.pendingKey = null;
      throw err;
    }
    status.pendingKey = null;

    if (resp?.ok !== true) {
      throw new UnexpectedResponse(`Collect All was refused: "${resp?.error ?? 'no reason given'}".`);
    }
    if (typeof resp.total !== 'number' || typeof resp.count !== 'number') {
      throw new UnexpectedResponse('Unexpected Collect All response. The game may have changed something.');
    }
    recordParseSuccess(FEATURE_KEY);
    const at = Date.now();
    // Same record a Collect All on the page makes: resets the vault
    // reminder and feeds the advisor's measured figures.
    await handleVaultMessage({ type: 'real-estate-collected', at, propertyKey: null });

    const banked = await bankIt(status);
    const run: RealEstateAutoRun = {
      at,
      collected: resp.total,
      devotion: typeof resp.devotion_skim === 'number' ? resp.devotion_skim : 0,
      properties: resp.count,
      banked,
      afterHours: since,
    };
    status.history = [run, ...status.history].slice(0, REAL_ESTATE_AUTO_HISTORY_MAX);
    for (const tally of [status.today, status.lifetime]) {
      tally.runs++;
      tally.collected += run.collected;
      tally.banked += banked ?? 0;
    }
    status.lastCollectionAt = at;
    status.blockedSince = null;
    scheduleAt(status, at + config.intervalHours * 3_600_000 + jitter());
    await persist();
  } catch (err) {
    if (err instanceof SystemicActionError && err.kind === 'status-blocked') {
      const fresh = await fetchLiveStatus().catch(() => null);
      blocked('Blocked by jail, hospital or travel. Waiting.', (fresh ? statusReleaseAt(fresh) : Date.now() + REAL_ESTATE_AUTO_RETRY_MS) + jitter());
      await persist();
      return;
    }
    // No session yet (the game hasn't been opened since the browser started)
    // or a dropped connection: ordinary, not a sign anything changed.
    if ((err instanceof SystemicActionError && err.kind === 'auth') || err instanceof TypeError) {
      const why = err instanceof SystemicActionError ? 'No game session yet: open the game once.' : 'Network error.';
      blocked(`${why} Trying again shortly.`, Date.now() + REAL_ESTATE_AUTO_RETRY_MS);
      await persist();
      return;
    }
    if (err instanceof UnexpectedResponse || (err instanceof SystemicActionError && err.kind === 'shape')) recordParseFailure(FEATURE_KEY);
    console.error(LOG_PREFIX, 'real estate auto-collect failed', err);
    await pause(status, err instanceof Error ? err.message : String(err));
  }
}

/** Off clears the alarm; on, or a new interval, checks again in a moment. */
async function onConfigChanged(config: RealEstateAutoConfig): Promise<void> {
  if (!config.enabled) {
    chrome.alarms.clear(ALARM_NAMES.REAL_ESTATE_AUTO);
    const status = await storage.getRealEstateAutoStatus();
    if (status?.nextCheckAt) await storage.setRealEstateAutoStatus({ ...status, nextCheckAt: null });
    return;
  }
  chrome.alarms.create(ALARM_NAMES.REAL_ESTATE_AUTO, { when: Date.now() + REAL_ESTATE_AUTO_IMMEDIATE_CHECK_DELAY_MS });
}

/** A collection seen on the page pushes the next check back to a full
 *  interval after it, instead of waking early only to find it not due. */
async function onVaultsChanged(state: RealEstateVaultState | undefined): Promise<void> {
  if (!state || cycleInFlight) return;
  const config = await storage.getRealEstateAutoConfig();
  if (!config.enabled) return;
  const due = dueAt(state.vaults, config.intervalHours);
  if (due === null) return;
  const status = await loadStatus();
  if (status.nextCheckAt !== null && due <= status.nextCheckAt) return;
  scheduleAt(status, due + jitter());
  await storage.setRealEstateAutoStatus(status);
}

export async function runCheckNow(): Promise<RealEstateAutoStatus | null> {
  await runCycle();
  return storage.getRealEstateAutoStatus();
}

/** Alarms don't survive a browser restart: re-arm from the stored next check,
 *  or check shortly if that has passed. */
async function ensureScheduled(): Promise<void> {
  const config = await storage.getRealEstateAutoConfig();
  if (!config.enabled) return;
  if (await chrome.alarms.get(ALARM_NAMES.REAL_ESTATE_AUTO)) return;
  const status = await storage.getRealEstateAutoStatus();
  const when = status?.nextCheckAt && status.nextCheckAt > Date.now() ? status.nextCheckAt : Date.now() + 30_000;
  chrome.alarms.create(ALARM_NAMES.REAL_ESTATE_AUTO, { when });
}

export function init(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (STORAGE_KEYS.REAL_ESTATE_AUTO_CONFIG in changes) {
      const next = changes[STORAGE_KEYS.REAL_ESTATE_AUTO_CONFIG].newValue as RealEstateAutoConfig | undefined;
      const prev = changes[STORAGE_KEYS.REAL_ESTATE_AUTO_CONFIG].oldValue as RealEstateAutoConfig | undefined;
      // The runner's own pause writes `enabled:false` and already cleared the alarm.
      if (next && !(prev && prev.enabled === next.enabled && prev.intervalHours === next.intervalHours)) {
        onConfigChanged(next).catch((err) => console.error(LOG_PREFIX, 'real estate auto onConfigChanged failed', err));
      }
    }
    if (STORAGE_KEYS.REAL_ESTATE_VAULTS in changes) {
      onVaultsChanged(changes[STORAGE_KEYS.REAL_ESTATE_VAULTS].newValue).catch((err) =>
        console.error(LOG_PREFIX, 'real estate auto onVaultsChanged failed', err),
      );
    }
  });
  ensureScheduled().catch((err) => console.error(LOG_PREFIX, 'real estate auto ensureScheduled failed', err));
}
