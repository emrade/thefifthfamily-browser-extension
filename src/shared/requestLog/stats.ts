import { db } from '@/shared/db';

const STATS_KEY = 'ff_request_log_stats';

export interface RequestLogStats {
  rows: number;
  /** Bytes actually on disk, i.e. post-gzip. */
  storedBytes: number;
  /** Bytes the same content would have taken uncompressed — kept so the popup can
   *  show what compression is buying, which is the whole reason 30 days fits. */
  rawBytes: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
}

const EMPTY: RequestLogStats = { rows: 0, storedBytes: 0, rawBytes: 0, oldestTimestamp: null, newestTimestamp: null };

/**
 * Totals are maintained incrementally rather than computed on demand, because
 * there is no cheap way to compute them from the table.
 *
 * IndexedDB has no column projection — Dexie's `each`/`toArray` deserialize whole
 * records, so summing a size column over a six-figure table would mean inflating
 * every gzipped body in memory just to read the integer sitting next to it. That
 * would make simply opening the popup an expensive operation. Counters cost one
 * small write per logged request instead.
 *
 * `recomputeStats()` exists as the escape hatch if the counters ever drift (a
 * write that lands while the worker is being killed, say); the popup exposes it.
 */
export async function readStats(): Promise<RequestLogStats> {
  const result = await chrome.storage.local.get(STATS_KEY);
  return { ...EMPTY, ...(result[STATS_KEY] as Partial<RequestLogStats> | undefined) };
}

async function writeStats(stats: RequestLogStats): Promise<void> {
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}

export async function addToStats(rawBytes: number, storedBytes: number, timestamp: number): Promise<void> {
  const stats = await readStats();
  await writeStats({
    rows: stats.rows + 1,
    storedBytes: stats.storedBytes + storedBytes,
    rawBytes: stats.rawBytes + rawBytes,
    oldestTimestamp: stats.oldestTimestamp == null ? timestamp : Math.min(stats.oldestTimestamp, timestamp),
    newestTimestamp: stats.newestTimestamp == null ? timestamp : Math.max(stats.newestTimestamp, timestamp),
  });
}

export async function subtractFromStats(rows: number, rawBytes: number, storedBytes: number, oldestRemaining: number | null): Promise<void> {
  const stats = await readStats();
  await writeStats({
    // Floored at zero rather than trusted: if the counters ever drift, a negative
    // total would render as nonsense in the popup and be harder to notice than a
    // slightly-off positive one. `recomputeStats()` is the real fix.
    rows: Math.max(0, stats.rows - rows),
    storedBytes: Math.max(0, stats.storedBytes - storedBytes),
    rawBytes: Math.max(0, stats.rawBytes - rawBytes),
    oldestTimestamp: oldestRemaining,
    newestTimestamp: stats.newestTimestamp,
  });
}

export async function resetStats(): Promise<void> {
  await writeStats(EMPTY);
}

/** Full pass over the table to rebuild the counters from scratch. Expensive by
 *  nature — it decompresses nothing, but it does load every row — so it is only
 *  ever run when explicitly asked for. */
export async function recomputeStats(): Promise<RequestLogStats> {
  let rows = 0;
  let storedBytes = 0;
  let rawBytes = 0;
  let oldest: number | null = null;
  let newest: number | null = null;

  await db.requestLog.each((entry) => {
    rows += 1;
    storedBytes += entry.storedSize;
    rawBytes += entry.rawSize;
    oldest = oldest == null ? entry.timestamp : Math.min(oldest, entry.timestamp);
    newest = newest == null ? entry.timestamp : Math.max(newest, entry.timestamp);
  });

  const stats: RequestLogStats = { rows, storedBytes, rawBytes, oldestTimestamp: oldest, newestTimestamp: newest };
  await writeStats(stats);
  return stats;
}
