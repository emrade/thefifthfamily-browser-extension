import { db } from '@/shared/db';
import { decompressText } from './compress';
import { fingerprintResponse } from './fingerprint';
import { foldObservation } from './profile';
import type { EndpointProfile } from './types';

/** Rows inflated per batch. Only one batch of decompressed bodies is resident at
 *  a time, which is what keeps a rebuild over a full archive bounded. */
const BATCH_SIZE = 200;

export interface RebuildResult {
  responses: number;
  endpoints: number;
}

/**
 * Rebuilds the structural index from scratch by replaying the stored archive.
 *
 * Worth having for two reasons. The shape model changed once already, and a
 * stored index built under the old rules can't be trusted after that — replaying
 * is the only way to get an index that matches the current classifier without
 * throwing away history. And more usefully: profiles built from live traffic
 * alone have to serve out a fresh warmup on every endpoint, so a brand-new index
 * stays deliberately silent for hours even when the archive already holds weeks
 * of evidence. Replaying skips that wait entirely.
 *
 * Deliberately manual rather than automatic on migration. Every body has to be
 * decompressed and re-tokenized, which is cheap for a few thousand rows and
 * distinctly not for a full 30-day archive — that is a cost the user should choose
 * to pay, not one silently attached to an extension update.
 *
 * Rows are replayed in timestamp order because the classifier is order-dependent:
 * warmup, "was this token present every previous time", and the event timeline all
 * read differently if history arrives shuffled.
 */
export async function rebuildProfiles(onProgress?: (done: number, total: number) => void): Promise<RebuildResult> {
  // Keys only — ordering the whole table by timestamp without inflating a single
  // body, which is the difference between a rebuild that fits in memory and one
  // that doesn't.
  const keys = (await db.requestLog.orderBy('timestamp').primaryKeys()) as number[];

  // Accumulated in memory and written once at the end. Folding through the
  // database instead would mean two round-trips per archived response.
  const profiles = new Map<string, EndpointProfile>();

  for (let offset = 0; offset < keys.length; offset += BATCH_SIZE) {
    const batch = await db.requestLog.bulkGet(keys.slice(offset, offset + BATCH_SIZE));

    for (const row of batch) {
      if (!row) continue;
      let responseText: string;
      try {
        responseText = await decompressText(row.responseBody, row.encoding);
      } catch {
        // A body that won't inflate is skipped rather than aborting the rebuild —
        // one unreadable row shouldn't cost the whole index.
        continue;
      }

      const { tokens } = fingerprintResponse(responseText);
      const { profile } = foldObservation(
        profiles.get(row.endpoint) ?? null,
        row.endpoint,
        tokens,
        responseText,
        row.timestamp,
      );
      profiles.set(row.endpoint, profile);
    }

    onProgress?.(Math.min(offset + BATCH_SIZE, keys.length), keys.length);
  }

  await db.transaction('rw', db.endpointProfiles, async () => {
    await db.endpointProfiles.clear();
    await db.endpointProfiles.bulkAdd([...profiles.values()]);
  });

  return { responses: keys.length, endpoints: profiles.size };
}
