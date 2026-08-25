import { LOG_PREFIX } from './log';

/**
 * Tracks whether each feature's adapters are still successfully parsing.
 *
 * This is a direct signal where the shape index is an inferred one. The shape
 * index reasons about response structure and decides whether a change looks
 * meaningful — useful, but it has produced two false positives on live data, and
 * it can only ever say "this looks different". A parse failure is not a heuristic:
 * the adapter ran, the response did not fit, and the feature is not recording.
 *
 * Written for a specific event. The game ships a large upgrade on 2026-08-11, and
 * the failure mode without this is silent: adapters stop matching, Trade Assistant
 * quietly stops recording trades, the popup keeps showing yesterday's numbers, and
 * the only evidence is a console message nobody is watching.
 */
export const FEATURE_LABELS: Record<string, string> = {
  tradeAssistant: 'Trade Assistant',
  playerStats: 'Player Stats',
  streetIntel: 'Street Intel',
  fightClub: 'Fight Club',
  careerAuto: 'Career Auto',
};

export interface FeatureHealth {
  lastSuccess: number | null;
  lastFailure: number | null;
  /** Reset to 0 by any success. High values mean the feature is broken now, as
   *  opposed to having hit one odd response weeks ago. */
  consecutiveFailures: number;
  totalFailures: number;
}

export type FeatureHealthMap = Record<string, FeatureHealth>;

const STORAGE_KEY = 'ff_feature_health';

const EMPTY: FeatureHealth = { lastSuccess: null, lastFailure: null, consecutiveFailures: 0, totalFailures: 0 };

export async function readFeatureHealth(): Promise<FeatureHealthMap> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as FeatureHealthMap | undefined) ?? {};
}

/**
 * Successes are persisted at most once a minute per feature.
 *
 * `stats.php` alone parses several times a second, and writing storage on every
 * one would put thousands of pointless writes a day on the capture path. A
 * minute's resolution is far finer than the question this answers ("is it still
 * working, and when did it last work"). Failures are always written immediately —
 * they are rare, and they are the entire point.
 */
const SUCCESS_WRITE_INTERVAL_MS = 60_000;
const lastPersistedSuccess = new Map<string, number>();

/**
 * Every update is chained onto one queue, because each is a read-then-write of a
 * single storage key.
 *
 * Without this, calls that arrive close together all read the same state before
 * any of them writes, and every update but the last is lost — three consecutive
 * failures recorded as two. That is not a corner case here: the moment this is
 * built for is a game upgrade, when failures arrive in bursts as every in-flight
 * request stops parsing at once. Undercounting exactly then would keep the
 * feature below its "broken" threshold and suppress the alert.
 *
 * Same class of race, and the same fix, as the background worker's message queue.
 */
let writeQueue: Promise<void> = Promise.resolve();

function enqueue(update: () => Promise<void>): void {
  writeQueue = writeQueue.then(update).catch((err) => console.error(LOG_PREFIX, 'feature health write failed', err));
}

export function recordParseSuccess(feature: string): void {
  const now = Date.now();
  const last = lastPersistedSuccess.get(feature) ?? 0;

  enqueue(async () => {
    const health = await readFeatureHealth();
    const current = health[feature] ?? EMPTY;

    // Always write through when clearing a failure streak, however recently a
    // success was persisted — "it recovered" must never wait out the throttle.
    if (now - last < SUCCESS_WRITE_INTERVAL_MS && current.consecutiveFailures === 0) return;

    lastPersistedSuccess.set(feature, now);
    health[feature] = { ...current, lastSuccess: now, consecutiveFailures: 0 };
    await chrome.storage.local.set({ [STORAGE_KEY]: health });
  });
}

export function recordParseFailure(feature: string): void {
  enqueue(async () => {
    const health = await readFeatureHealth();
    const current = health[feature] ?? EMPTY;
    health[feature] = {
      ...current,
      lastFailure: Date.now(),
      consecutiveFailures: current.consecutiveFailures + 1,
      totalFailures: current.totalFailures + 1,
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: health });
  });
}

/**
 * A feature counts as broken after a few consecutive failures rather than one.
 * A single unparseable response is routine — a maintenance page, a truncated
 * body, an error shape the adapter was never meant to handle. A run of them
 * without a success in between is not.
 */
export const BROKEN_AFTER_CONSECUTIVE_FAILURES = 3;

export function isBroken(health: FeatureHealth): boolean {
  return health.consecutiveFailures >= BROKEN_AFTER_CONSECUTIVE_FAILURES;
}

export async function clearFeatureHealth(): Promise<void> {
  lastPersistedSuccess.clear();
  await chrome.storage.local.remove(STORAGE_KEY);
}

/** Lets a caller wait for queued writes to land — used by tests, and by anything
 *  that needs to read back its own update rather than a stale value. */
export function flushFeatureHealth(): Promise<void> {
  return writeQueue;
}
