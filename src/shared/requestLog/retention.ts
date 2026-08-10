import { db } from '@/shared/db';
import { LOG_PREFIX } from '@/shared/log';
import { ALARM_NAMES, REQUEST_LOG_MAX_BYTES, REQUEST_LOG_SWEEP_INTERVAL_MINUTES } from '@/shared/constants';
import { isExcludedEndpointKey } from './policy';
import { readStats } from './stats';
import { storage } from '@/shared/storage';
import { subtractFromStats } from './stats';
import type { RequestLogEntry } from './types';

/** Rows are deleted in batches so a large one-off trim (retention shortened from
 *  90 days to 7, say) never holds a single transaction open across 100k rows. */
const BATCH_SIZE = 500;

export interface SweepResult {
  deletedByAge: number;
  deletedByBudget: number;
  deletedByPolicy: number;
}

/**
 * Trims the archive on two independent rules.
 *
 * Age is the rule the player actually chose. The row cap behind it exists because
 * age alone quietly assumes traffic stays near the rate the budget was sized
 * against — a runaway retry loop or a much heavier session could blow past the
 * disk budget well inside the retention window, and "you picked 30 days" is no
 * comfort when the profile has filled up.
 *
 * `endpointShapes` is deliberately *not* swept. It is the change history, it is a
 * few KB, and it is most valuable precisely when it outlives the bodies that
 * produced it — being able to see that an endpoint changed shape two months ago
 * costs nothing and is exactly the question the index is for.
 */
export async function sweepRequestLog(): Promise<SweepResult> {
  const { retentionDays } = await storage.getRequestLogPreferences();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const deletedByAge = await deleteWhere(() =>
    db.requestLog.where('timestamp').below(cutoff).limit(BATCH_SIZE).toArray(),
  );

  // Rows for endpoints that have since been excluded from capture. Without this a
  // policy change would take a whole retention window to show up, leaving the
  // archive full of traffic nobody wants for another 30 days.
  let deletedByPolicy = 0;
  const endpoints = await db.requestLog.orderBy('endpoint').uniqueKeys();
  for (const endpoint of endpoints as string[]) {
    if (!isExcludedEndpointKey(endpoint)) continue;
    deletedByPolicy += await deleteWhere(() =>
      db.requestLog.where('endpoint').equals(endpoint).limit(BATCH_SIZE).toArray(),
    );
  }

  // Byte budget. Evicts oldest-first until the archive is back under, reading the
  // running total rather than measuring the table — summing a size column would
  // mean inflating every gzipped body just to read the integer beside it.
  let deletedByBudget = 0;
  let stored = (await readStats()).storedBytes;
  while (stored > REQUEST_LOG_MAX_BYTES) {
    const batch = await db.requestLog.orderBy('timestamp').limit(BATCH_SIZE).toArray();
    if (!batch.length) break;

    let rawBytes = 0;
    let storedBytes = 0;
    const ids: number[] = [];
    for (const row of batch) {
      rawBytes += row.rawSize;
      storedBytes += row.storedSize;
      if (row.id != null) ids.push(row.id);
    }

    await db.requestLog.bulkDelete(ids);
    await subtractFromStats(ids.length, rawBytes, storedBytes, null);
    deletedByBudget += ids.length;
    stored -= storedBytes;
  }

  if (deletedByAge || deletedByBudget || deletedByPolicy) {
    const oldest = await db.requestLog.orderBy('timestamp').first();
    await refreshOldest(oldest?.timestamp ?? null);
    console.info(
      LOG_PREFIX,
      `request log swept: ${deletedByAge} expired, ${deletedByPolicy} excluded by policy, ${deletedByBudget} over budget`,
    );
  }

  return { deletedByAge, deletedByBudget, deletedByPolicy };
}

/**
 * Sizes are summed from the rows being removed rather than estimated, so the
 * running totals stay exact. This is why rows are loaded before deletion instead
 * of using a bare range-delete: the byte counts live only on the rows themselves.
 */
async function deleteWhere(nextBatch: () => Promise<RequestLogEntry[]>): Promise<number> {
  let deleted = 0;

  for (;;) {
    const batch = await nextBatch();
    if (!batch.length) break;

    let rawBytes = 0;
    let storedBytes = 0;
    const ids: number[] = [];
    for (const row of batch) {
      rawBytes += row.rawSize;
      storedBytes += row.storedSize;
      if (row.id != null) ids.push(row.id);
    }

    await db.requestLog.bulkDelete(ids);
    await subtractFromStats(ids.length, rawBytes, storedBytes, null);
    deleted += ids.length;

    if (batch.length < BATCH_SIZE) break;
  }

  return deleted;
}

/** The batch loop passes `null` for the oldest timestamp because it can't know it
 *  mid-sweep; this sets the real value once, after all deletion has finished. */
async function refreshOldest(oldest: number | null): Promise<void> {
  await subtractFromStats(0, 0, 0, oldest);
}

/**
 * Registered with `{ periodInMinutes }` so it survives the service worker being
 * killed for idling — an interval timer would not. Created only if absent, so a
 * worker restart doesn't reset the schedule and postpone the sweep indefinitely.
 */
export async function ensureSweepAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ALARM_NAMES.REQUEST_LOG_SWEEP);
  if (existing) return;
  chrome.alarms.create(ALARM_NAMES.REQUEST_LOG_SWEEP, {
    periodInMinutes: REQUEST_LOG_SWEEP_INTERVAL_MINUTES,
    delayInMinutes: 1,
  });
}

export async function handleSweepAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.REQUEST_LOG_SWEEP) return;
  await sweepRequestLog();
}
