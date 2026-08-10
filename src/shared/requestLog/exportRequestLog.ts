import { db } from '@/shared/db';
import { decompressText } from './compress';
import { readStats } from './stats';
import type { EndpointShape } from './types';

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
  const shapes = await db.endpointShapes.toArray();

  const seen = new Map<string, number>();
  for (const shape of shapes) {
    seen.set(shape.endpoint, Math.max(seen.get(shape.endpoint) ?? 0, shape.lastSeen));
  }

  const summaries = await Promise.all(
    [...seen.entries()].map(async ([endpoint, lastSeen]) => ({
      endpoint,
      lastSeen,
      rows: await db.requestLog.where('endpoint').equals(endpoint).count(),
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

export interface ShapeChange {
  at: string;
  shapeHash: string;
  count: number;
  /** Tokens present in this shape but not the endpoint's previous one. */
  added: string[];
  /** Tokens the previous shape had and this one dropped. */
  removed: string[];
}

/**
 * The small export — the one actually meant to be pasted to an agent.
 *
 * Where the archive answers "what were the exact bytes", this answers "what
 * changed, and when", and it stays in the low KB over months because it holds one
 * entry per *structural change* rather than per request. Consecutive shapes of an
 * endpoint are diffed here rather than at write time so that the diff always
 * reflects the full recorded history, including shapes that predate a later one.
 */
export async function buildShapeDigest(): Promise<string> {
  const shapes = await db.endpointShapes.toArray();

  const byEndpoint = new Map<string, EndpointShape[]>();
  for (const shape of shapes) {
    const list = byEndpoint.get(shape.endpoint) ?? [];
    list.push(shape);
    byEndpoint.set(shape.endpoint, list);
  }

  const endpoints = [...byEndpoint.entries()]
    .map(([endpoint, list]) => {
      const ordered = [...list].sort((a, b) => a.firstSeen - b.firstSeen);

      const changes: ShapeChange[] = ordered.map((shape, index) => {
        const previous = index > 0 ? new Set(ordered[index - 1].tokens) : null;
        const current = new Set(shape.tokens);
        return {
          at: new Date(shape.firstSeen).toISOString(),
          shapeHash: shape.shapeHash,
          count: shape.count,
          added: previous ? shape.tokens.filter((t) => !previous.has(t)) : [],
          removed: previous ? ordered[index - 1].tokens.filter((t) => !current.has(t)) : [],
        };
      });

      const latest = ordered[ordered.length - 1];
      return {
        endpoint,
        distinctShapes: ordered.length,
        totalResponses: ordered.reduce((sum, s) => sum + s.count, 0),
        firstSeen: new Date(ordered[0].firstSeen).toISOString(),
        lastSeen: new Date(Math.max(...ordered.map((s) => s.lastSeen))).toISOString(),
        currentTokens: latest.tokens,
        currentSample: latest.sample,
        changes,
      };
    })
    // Endpoints that have changed most recently sort first: when this is read at
    // all, it is nearly always to answer "what just broke", not to browse.
    .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));

  return JSON.stringify(
    {
      kind: 'ff-endpoint-shape-digest',
      version: 1,
      exportedAt: new Date().toISOString(),
      note:
        'Structural fingerprints of every observed game endpoint. Each entry under "changes" is a point where the response structure changed; "added"/"removed" list the CSS classes, JSON key paths, and form field names that appeared or disappeared. An endpoint with distinctShapes > 1 has changed since it was first seen.',
      endpoints,
    },
    null,
    2,
  );
}
