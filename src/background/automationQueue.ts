import { STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { AutomationQueueFeature, AutomationQueueLogEntry } from '@/shared/types';

/**
 * One-at-a-time queue across the background automations, so two of them never
 * act on the game at the same moment — something a single player in one tab
 * can't do. Design, measurements and the player's decisions:
 * docs/proposals/automation-clash-queue.md.
 *
 * **Off by default, and off means today's behaviour exactly.** `runQueued`
 * calls straight through to the feature's own run, with no waiting, no gap
 * and no log. Turning the setting off mid-wait lets every waiter go at once.
 *
 * When on:
 * - Strict arrival order, no priorities. Each automation holds the queue
 *   for its whole cycle (wrapped *inside* its existing `cycleInFlight` /
 *   `activeRun` guard, so a duplicate trigger is still skipped by that guard
 *   and never queues twice).
 * - After a release, a different automation waits a random 3–8 s, as if the
 *   player switched pages. The same automation going again needs no gap.
 * - Player-started jobs arrive as a series of separate messages (Garage,
 *   Inventory, achievement claims), so those pass `linger`: the queue stays
 *   theirs for 15 s after each step, letting the next step straight in.
 * - Waiters wait in memory (polling), never longer than while another
 *   automation is actively running plus ≤ 15 s. Each poll touches
 *   `storage.session`, so Firefox doesn't count the script as idle (it unloads
 *   it after ~30 s idle, which would lose the waiter's turn).
 * - Backstops: a holder older than 15 min is treated as gone, and a waiter
 *   that has waited 15 min goes ahead anyway (that is today's behaviour, so it
 *   is the safe fallback). Both are logged.
 *
 * This only spaces automations out: it never changes what they send.
 */

const GAP_MIN_MS = 3_000;
const GAP_MAX_MS = 8_000;
const LINGER_MS = 15_000;
const MAX_HOLD_MS = 15 * 60_000;
const MAX_WAIT_MS = 15 * 60_000;
const POLL_MS = 500;
const LOG_LIMIT = 300;
const KEEPALIVE_KEY = 'ff_automation_queue_keepalive';

let enabledCache: boolean | null = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(STORAGE_KEYS.AUTOMATION_QUEUE_CONFIG in changes)) return;
  enabledCache = Boolean((changes[STORAGE_KEYS.AUTOMATION_QUEUE_CONFIG].newValue as { enabled?: boolean } | undefined)?.enabled);
});

async function isEnabled(): Promise<boolean> {
  if (enabledCache === null) enabledCache = (await storage.getAutomationQueueConfig()).enabled;
  return enabledCache;
}

interface Holder {
  id: number;
  feature: AutomationQueueFeature;
  startedAt: number;
}

interface Waiter {
  id: number;
  feature: AutomationQueueFeature;
}

let nextId = 1;
let holder: Holder | null = null;
/** The last feature to release, and when a *different* feature may start. */
let lastFeature: AutomationQueueFeature | null = null;
let freeAt = 0;
const waiters: Waiter[] = [];

function randomGap(): number {
  return GAP_MIN_MS + Math.round(Math.random() * (GAP_MAX_MS - GAP_MIN_MS));
}

function canTake(w: Waiter, now: number): boolean {
  if (holder) return false;
  // The feature that just finished goes again without a gap (and, while
  // lingering, ahead of anyone already waiting): it's the same "page".
  if (w.feature === lastFeature && now < freeAt) return true;
  return now >= freeAt && waiters[0] === w;
}

function removeWaiter(w: Waiter): void {
  const i = waiters.indexOf(w);
  if (i !== -1) waiters.splice(i, 1);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Acquired {
  /** Null when the run goes ahead without holding the queue (turned off
   *  while waiting, or waited the maximum). */
  id: number | null;
  forced: boolean;
  tookOverStale?: AutomationQueueFeature;
}

async function acquire(feature: AutomationQueueFeature, queuedAt: number): Promise<Acquired> {
  const w: Waiter = { id: nextId++, feature };
  waiters.push(w);
  let tookOverStale: AutomationQueueFeature | undefined;
  try {
    for (;;) {
      if (!(await isEnabled())) return { id: null, forced: false };
      const now = Date.now();
      if (holder && now - holder.startedAt > MAX_HOLD_MS) {
        console.warn(LOG_PREFIX, `automation queue: ${holder.feature} held the queue over ${MAX_HOLD_MS / 60_000} min, treating it as finished`);
        tookOverStale = holder.feature;
        holder = null;
      }
      if (canTake(w, now)) {
        holder = { id: w.id, feature, startedAt: now };
        return { id: w.id, forced: false, tookOverStale };
      }
      if (now - queuedAt >= MAX_WAIT_MS) {
        console.warn(LOG_PREFIX, `automation queue: ${feature} waited ${MAX_WAIT_MS / 60_000} min, going ahead anyway`);
        return { id: null, forced: true, tookOverStale };
      }
      await sleep(POLL_MS);
      await chrome.storage.session.get(KEEPALIVE_KEY);
    }
  } finally {
    removeWaiter(w);
  }
}

function release(id: number, feature: AutomationQueueFeature, linger: boolean): void {
  // A holder that was taken over as stale must not free the newer one.
  if (!holder || holder.id !== id) return;
  holder = null;
  lastFeature = feature;
  freeAt = Date.now() + (linger ? LINGER_MS : randomGap());
}

/** Which automations are mid-run right now, queue on or off — read-only
 *  bookkeeping for the dashboard and the "Up next" chip. It never delays or
 *  changes a run. */
const running = new Map<AutomationQueueFeature, number>();

async function tracked<T>(feature: AutomationQueueFeature, fn: () => Promise<T>): Promise<T> {
  running.set(feature, (running.get(feature) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const n = (running.get(feature) ?? 1) - 1;
    if (n > 0) running.set(feature, n);
    else running.delete(feature);
  }
}

export interface AutomationQueueState {
  enabled: boolean;
  holder: { feature: AutomationQueueFeature; startedAt: number } | null;
  waiting: AutomationQueueFeature[];
  running: AutomationQueueFeature[];
}

export async function getQueueState(): Promise<AutomationQueueState> {
  return {
    enabled: await isEnabled(),
    holder: holder ? { feature: holder.feature, startedAt: holder.startedAt } : null,
    waiting: waiters.map((w) => w.feature),
    running: [...running.keys()],
  };
}

let logWrite: Promise<void> = Promise.resolve();

function appendLog(entry: AutomationQueueLogEntry): void {
  logWrite = logWrite
    .then(async () => {
      const log = await storage.getAutomationQueueLog();
      log.push(entry);
      await storage.setAutomationQueueLog(log.slice(-LOG_LIMIT));
    })
    .catch((err) => console.error(LOG_PREFIX, 'automation queue log write failed', err));
}

/**
 * Runs `fn` as `feature`'s turn in the queue. With the queue off this is just
 * `fn()`. `linger`: keep the queue for this feature for 15 s afterwards, for
 * player-started jobs sent one step per message.
 */
export async function runQueued<T>(feature: AutomationQueueFeature, fn: () => Promise<T>, options: { linger?: boolean } = {}): Promise<T> {
  if (enabledCache === false || !(await isEnabled())) return tracked(feature, fn);

  const queuedAt = Date.now();
  const got = await acquire(feature, queuedAt);
  if (got.id === null && !got.forced) return tracked(feature, fn); // switched off while waiting

  const startedAt = Date.now();
  let outcome: AutomationQueueLogEntry['outcome'] = got.forced ? 'forced-wait' : 'ok';
  try {
    return await tracked(feature, fn);
  } catch (err) {
    if (!got.forced) outcome = 'error';
    throw err;
  } finally {
    if (got.id !== null) release(got.id, feature, options.linger === true);
    appendLog({
      feature,
      queuedAt,
      startedAt,
      endedAt: Date.now(),
      waitedMs: startedAt - queuedAt,
      outcome,
      ...(got.tookOverStale ? { tookOverStale: got.tookOverStale } : {}),
    });
  }
}

/**
 * For a run that would rather skip than wait (the scheduled stock price
 * check: the next one comes anyway). True when the queue is on and another
 * feature holds it, is waiting, or is still within its gap/linger. Logs the
 * skip.
 */
export async function skipIfQueueBusy(feature: AutomationQueueFeature): Promise<boolean> {
  if (enabledCache === false || !(await isEnabled())) return false;
  const now = Date.now();
  const busy = (holder !== null && now - holder.startedAt <= MAX_HOLD_MS) || waiters.length > 0 || (now < freeAt && lastFeature !== feature);
  if (busy) appendLog({ feature, queuedAt: now, startedAt: null, endedAt: now, waitedMs: 0, outcome: 'skipped' });
  return busy;
}
