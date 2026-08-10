import { db } from '@/shared/db';
import { decompressText } from './compress';
import { readStats } from './stats';
import type { EndpointProfile, StructuralEvent } from './types';

/** Rows pulled per page while streaming. Small enough that only one page of
 *  inflated bodies is ever resident, which is what keeps a multi-GB logical
 *  export inside a fixed memory ceiling. */
const PAGE_SIZE = 200;

export interface ArchiveFilter {
  /** Endpoint keys to include, as produced by `endpointKey()`. Empty or omitted
   *  means every endpoint. */
  endpoints?: string[];
  /** Only include requests at or after this epoch ms. */
  sinceMs?: number;
}

export interface EndpointSummary {
  endpoint: string;
  rows: number;
  lastSeen: number;
}

/**
 * Lists every endpoint with a row count, to populate the export picker.
 *
 * Counts come from `db.requestLog.where('endpoint').count()`, which IndexedDB
 * answers from the index without deserializing a single row — so this stays cheap
 * even against a full archive, where loading rows to count them would mean
 * inflating every gzipped body.
 *
 * The endpoint list itself comes from `endpointShapes` rather than from a scan of
 * the archive, since that table already holds exactly one entry per distinct
 * endpoint. It also outlives retention, so an endpoint whose rows have all aged
 * out still appears — correctly showing 0 rows rather than vanishing silently.
 */
export async function listEndpoints(): Promise<EndpointSummary[]> {
  const profiles = await db.endpointProfiles.toArray();

  const summaries = await Promise.all(
    profiles.map(async (profile) => ({
      endpoint: profile.endpoint,
      lastSeen: profile.lastSeen,
      rows: await db.requestLog.where('endpoint').equals(profile.endpoint).count(),
    })),
  );

  return summaries.sort((a, b) => b.rows - a.rows);
}

/**
 * Resolves a filter to the exact primary keys to export, or null for "everything"
 * (which streams by keyset instead, avoiding a pointless full key list).
 *
 * Keys are fetched with `.primaryKeys()` on the `[endpoint+timestamp]` compound
 * index, so the range scan touches only the index — no row bodies are loaded to
 * decide what qualifies. That is the whole reason that index exists.
 */
async function resolveKeys(filter: ArchiveFilter): Promise<number[] | null> {
  const endpoints = filter.endpoints?.filter(Boolean) ?? [];
  if (!endpoints.length) return null;

  const since = filter.sinceMs ?? 0;
  const perEndpoint = await Promise.all(
    endpoints.map((endpoint) =>
      db.requestLog
        .where('[endpoint+timestamp]')
        .between([endpoint, since], [endpoint, Infinity], true, true)
        .primaryKeys(),
    ),
  );

  // Flattened and sorted so the export comes out in insertion order across
  // endpoints rather than grouped by endpoint — chronological is what makes a
  // multi-endpoint export readable as a sequence of events.
  return (perEndpoint.flat() as number[]).sort((a, b) => a - b);
}

/**
 * Streams the whole archive out as gzipped NDJSON — one JSON object per line.
 *
 * NDJSON rather than one big JSON array, for two reasons that both matter at this
 * size. It can be produced incrementally, so the export never holds the full
 * decompressed archive in memory (a 30-day window inflates to hundreds of MB).
 * And it can be *consumed* incrementally: an agent, or a plain `zcat | head`, can
 * read the first thousand records without parsing the file, which is not true of
 * a single top-level array.
 *
 * Rows are paged by primary key rather than by `offset`, which would re-scan from
 * the start on every page and turn the export into quadratic work.
 */
export function streamArchiveNdjson(filter: ArchiveFilter = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const since = filter.sinceMs ?? 0;
  let lastId = 0;
  let headerSent = false;

  // Populated on the first pull when an endpoint filter is in play; stays null for
  // a full export, which pages by keyset instead.
  let keys: number[] | null = null;
  let keyCursor = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        keys = await resolveKeys(filter);
        const stats = await readStats();
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              kind: 'ff-request-archive',
              version: 1,
              exportedAt: new Date().toISOString(),
              note: 'One JSON object per line. The first line is this header; every subsequent line is one captured request/response.',
              filter: {
                endpoints: filter.endpoints?.length ? filter.endpoints : 'all',
                since: since ? new Date(since).toISOString() : 'all time',
              },
              // Describes the archive as a whole, not this export's subset — a
              // filtered export should still say what it was drawn from.
              archiveStats: stats,
            }) + '\n',
          ),
        );
        return;
      }

      let page;
      if (keys) {
        if (keyCursor >= keys.length) {
          controller.close();
          return;
        }
        const slice = keys.slice(keyCursor, keyCursor + PAGE_SIZE);
        keyCursor += slice.length;
        // bulkGet returns undefined for keys deleted between planning and reading —
        // a retention sweep can land mid-export — so the gaps are filtered out.
        page = (await db.requestLog.bulkGet(slice)).filter((row) => row != null);
      } else {
        page = await db.requestLog.where(':id').above(lastId).limit(PAGE_SIZE).toArray();
        if (!page.length) {
          controller.close();
          return;
        }
        lastId = page[page.length - 1].id ?? lastId;
      }

      let chunk = '';
      for (const row of page) {
        if (row.timestamp < since) continue;
        const [responseText, requestBody] = await Promise.all([
          decompressText(row.responseBody, row.encoding),
          row.requestBody ? decompressText(row.requestBody, row.encoding) : Promise.resolve(null),
        ]);
        chunk += JSON.stringify({
          timestamp: row.timestamp,
          isoTime: new Date(row.timestamp).toISOString(),
          endpoint: row.endpoint,
          method: row.method,
          url: row.url,
          status: row.status,
          durationMs: row.durationMs,
          origin: row.origin,
          shapeHash: row.shapeHash,
          truncated: row.truncated,
          requestBody,
          responseBody: responseText,
        }) + '\n';
      }

      if (chunk) controller.enqueue(encoder.encode(chunk));
    },
  });
}

/** Wraps the NDJSON stream in gzip and materializes it as a Blob for download. */
export async function buildArchiveBlob(filter: ArchiveFilter = {}): Promise<Blob> {
  const stream = streamArchiveNdjson(filter);
  // Cast around the DOM lib's CompressionStream typing, which declares `writable`
  // as WritableStream<BufferSource> and so refuses a ReadableStream<Uint8Array>
  // that it accepts perfectly well at runtime.
  const compressed =
    typeof CompressionStream === 'function'
      ? stream.pipeThrough(new CompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
      : stream;
  return new Response(compressed as unknown as BodyInit).blob();
}

/**
 * The small export — the one actually meant to be pasted to an agent.
 *
 * Where the archive answers "what were the exact bytes", this answers "what does
 * this endpoint normally emit, and has anything structurally notable happened".
 * It stays in the low KB over months because it holds one entry per endpoint plus
 * a bounded event list, rather than anything that grows with traffic.
 */
export async function buildShapeDigest(): Promise<string> {
  const profiles = await db.endpointProfiles.toArray();

  const endpoints = profiles
    .map((profile) => {
      const vocabulary = Object.entries(profile.tokens);

      // Split by how reliably each token shows up. An adapter should only ever key
      // off the "always" set; anything in "sometimes" is state-dependent and will
      // be absent on some perfectly normal response.
      const always: string[] = [];
      const sometimes: { token: string; seenPct: number }[] = [];
      for (const [token, stat] of vocabulary) {
        if (stat.count === profile.count) always.push(token);
        else sometimes.push({ token, seenPct: Math.round((stat.count / profile.count) * 100) });
      }

      return {
        endpoint: profile.endpoint,
        observations: profile.count,
        firstSeen: new Date(profile.firstSeen).toISOString(),
        lastSeen: new Date(profile.lastSeen).toISOString(),
        alwaysPresent: always.sort(),
        sometimesPresent: sometimes.sort((a, b) => b.seenPct - a.seenPct),
        events: profile.events.map((event: StructuralEvent) => ({
          at: new Date(event.at).toISOString(),
          kind: event.kind,
          tokens: event.tokens,
          observationsAtTheTime: event.observations,
        })),
        sample: profile.sample,
      };
    })
    // Endpoints with something to report sort first, then by recency: when this is
    // read at all, it is nearly always to answer "what just broke".
    .sort((a, b) => b.events.length - a.events.length || (a.lastSeen < b.lastSeen ? 1 : -1));

  return JSON.stringify(
    {
      kind: 'ff-endpoint-shape-digest',
      version: 2,
      exportedAt: new Date().toISOString(),
      note:
        'Structural profile of every observed game endpoint. "alwaysPresent" tokens (CSS classes, JSON key paths, form field names) appeared in every single response and are safe for an adapter to key off; "sometimesPresent" are state-dependent, with the percentage of responses containing them. "events" lists structural changes detected after the endpoint was well sampled: kind "removed-universal" means a token that had always been present stopped appearing, which is what silently breaks a parser; kind "new-tokens" means something never seen before showed up; kind "endpoint-rewritten" means most of the vocabulary for that endpoint disappeared and stayed gone across many later responses, which is what a rewritten endpoint looks like as opposed to a passing variant. An endpoint with no events has been structurally stable.',
      endpoints,
    },
    null,
    2,
  );
}
