import { db } from '@/shared/db';
import { LOG_PREFIX } from '@/shared/log';
import { REQUEST_LOG_MAX_BODY_BYTES } from '@/shared/constants';
import { byteLength, compressText, BODY_ENCODING } from './compress';
import { endpointKey, fingerprintResponse } from './fingerprint';
import { redactBody, redactUrl } from './redact';
import { addToStats } from './stats';
import type { RequestLogOrigin } from './types';

export interface RecordRequestInput {
  method: string;
  url: string;
  requestBody: string | null;
  responseText: string;
  status: number | null;
  durationMs: number | null;
  origin: RequestLogOrigin;
  timestamp: number;
  /** Set by the page hook when it already capped the body. Background fetches pass
   *  false and are capped here instead. */
  truncatedUpstream?: boolean;
}

/** How much of a response is kept verbatim on a shape row, purely as human
 *  context next to a token diff. Small on purpose — the full body is one lookup
 *  away in `requestLog`, and this field is repeated per shape. */
const SAMPLE_CHARS = 2_000;

/**
 * Writes one request/response pair into the archive and updates the shape index.
 *
 * Callable only from the background worker. That isn't a style preference: a
 * content script's IndexedDB belongs to the *page's* origin, not the extension's,
 * so a write issued from the content script would land in the game's database and
 * be invisible to the popup. This is the same reason every existing feature routes
 * its parsed events through chrome.runtime.sendMessage rather than writing directly.
 *
 * Callers must serialize calls to this function. The shape index does a
 * read-then-write (look up `[endpoint+shapeHash]`, then bump or insert), and two
 * concurrent responses carrying a brand-new shape would otherwise both read
 * "absent" and both insert it — the same class of race that the background message
 * queue already exists to prevent for trades and bribes.
 */
export async function recordRequest(input: RecordRequestInput): Promise<void> {
  const rawSize = byteLength(input.responseText);
  // OR-ed with the upstream flag rather than derived from length alone. The page
  // hook caps bodies before they cross the message boundary, so a body it already
  // cut arrives under the limit and would otherwise be recorded as complete —
  // making a truncated capture indistinguishable from a genuinely short response.
  const truncated = input.truncatedUpstream === true || rawSize > REQUEST_LOG_MAX_BODY_BYTES;
  const responseText =
    rawSize > REQUEST_LOG_MAX_BODY_BYTES ? input.responseText.slice(0, REQUEST_LOG_MAX_BODY_BYTES) : input.responseText;

  const endpoint = endpointKey(input.method, input.url);

  // Fingerprinted before truncation is applied to the *stored* copy but from the
  // truncated text, so the hash always describes exactly the bytes kept alongside
  // it. A truncated body yields a partial token set, which is honest: it is better
  // for an oversized response to register as its own shape than for it to be
  // silently indistinguishable from the complete one.
  const { hash, tokens } = fingerprintResponse(responseText);

  const redactedRequestBody = redactBody(input.requestBody);
  const [responseBody, requestBody] = await Promise.all([
    compressText(responseText),
    redactedRequestBody == null ? Promise.resolve(null) : compressText(redactedRequestBody),
  ]);

  const storedSize = responseBody.byteLength + (requestBody?.byteLength ?? 0);

  await db.requestLog.add({
    timestamp: input.timestamp,
    endpoint,
    method: input.method.toUpperCase(),
    url: redactUrl(input.url),
    status: input.status,
    durationMs: input.durationMs,
    origin: input.origin,
    encoding: BODY_ENCODING,
    requestBody,
    responseBody,
    rawSize,
    storedSize,
    truncated,
    shapeHash: hash,
  });

  await addToStats(rawSize, storedSize, input.timestamp);
  await upsertShape(endpoint, hash, tokens, responseText, input.timestamp);
}

async function upsertShape(
  endpoint: string,
  shapeHash: string,
  tokens: string[],
  responseText: string,
  timestamp: number,
): Promise<void> {
  const existing = await db.endpointShapes.where('[endpoint+shapeHash]').equals([endpoint, shapeHash]).first();

  if (existing?.id != null) {
    // Bumped in place rather than appended. An endpoint that never changes must
    // cost one row for all time — if steady-state responses accumulated rows, the
    // shape index would grow at the same rate as the archive and lose the property
    // that makes it worth exporting separately.
    await db.endpointShapes.update(existing.id, {
      lastSeen: Math.max(existing.lastSeen, timestamp),
      count: existing.count + 1,
    });
    return;
  }

  await db.endpointShapes.add({
    endpoint,
    shapeHash,
    firstSeen: timestamp,
    lastSeen: timestamp,
    count: 1,
    tokens,
    sample: responseText.slice(0, SAMPLE_CHARS),
  });

  const seenBefore = await db.endpointShapes.where('endpoint').equals(endpoint).count();
  if (seenBefore > 1) {
    // Not an error — this is the feature firing. Surfacing it in the console gives
    // an immediate, live signal that the game changed, without waiting for anyone
    // to open the popup or export anything.
    console.warn(LOG_PREFIX, `response shape changed for ${endpoint} (now ${seenBefore} distinct shapes, new hash ${shapeHash})`);
  }
}
