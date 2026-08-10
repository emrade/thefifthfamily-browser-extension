import { db } from '@/shared/db';
import { LOG_PREFIX } from '@/shared/log';
import { REQUEST_LOG_MAX_BODY_BYTES } from '@/shared/constants';
import { byteLength, compressText, BODY_ENCODING } from './compress';
import { endpointKey, fingerprintResponse } from './fingerprint';
import { isExcluded, throttleIntervalFor } from './policy';
import { redactBody, redactUrl } from './redact';
import { addToStats } from './stats';
import { foldObservation } from './profile';
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
  // Applied here rather than only at the capture site so background poller fetches
  // are governed by the same policy as page traffic.
  if (isExcluded(input.url)) return;

  const endpoint = endpointKey(input.method, input.url);

  const minInterval = throttleIntervalFor(input.url);
  if (minInterval != null) {
    // Checked against the database rather than an in-memory timestamp: an MV3
    // service worker is killed whenever it idles, so a cached "last archived at"
    // would reset constantly and let a throttled endpoint through far more often
    // than intended. This is one indexed seek on [endpoint+timestamp].
    const since = input.timestamp - minInterval;
    const recent = await db.requestLog
      .where('[endpoint+timestamp]')
      .between([endpoint, since], [endpoint, Infinity], false, true)
      .count();
    if (recent > 0) return;
  }

  const rawSize = byteLength(input.responseText);
  // OR-ed with the upstream flag rather than derived from length alone. The page
  // hook caps bodies before they cross the message boundary, so a body it already
  // cut arrives under the limit and would otherwise be recorded as complete —
  // making a truncated capture indistinguishable from a genuinely short response.
  const truncated = input.truncatedUpstream === true || rawSize > REQUEST_LOG_MAX_BODY_BYTES;
  const responseText =
    rawSize > REQUEST_LOG_MAX_BODY_BYTES ? input.responseText.slice(0, REQUEST_LOG_MAX_BODY_BYTES) : input.responseText;

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
  await updateProfile(endpoint, tokens, responseText, input.timestamp);
}

/**
 * Reads the endpoint's profile, folds this observation in, and writes it back.
 *
 * The classification itself lives in `foldObservation` so that the offline
 * rebuild over an existing archive produces a byte-identical index to the live
 * path — an index that disagreed with itself depending on when it was built would
 * be worse than no index.
 */
async function updateProfile(
  endpoint: string,
  tokens: string[],
  responseText: string,
  timestamp: number,
): Promise<void> {
  const existing = (await db.endpointProfiles.where('endpoint').equals(endpoint).first()) ?? null;
  const { profile, newEvents } = foldObservation(existing, endpoint, tokens, responseText, timestamp);

  for (const event of newEvents) {
    if (event.kind === 'removed-universal') {
      console.warn(
        LOG_PREFIX,
        `${endpoint} stopped returning ${event.tokens.join(', ')} — an adapter reading these may now be broken`,
      );
    } else {
      console.info(LOG_PREFIX, `new structure on ${endpoint}: ${event.tokens.slice(0, 6).join(', ')}`);
    }
  }

  // `put` rather than `update` — the fold returns a whole replacement profile, and
  // Dexie's UpdateSpec types a partial with dotted key paths, which a full object
  // doesn't satisfy. Carrying the existing id through makes this an overwrite.
  await db.endpointProfiles.put(existing?.id != null ? { ...profile, id: existing.id } : profile);
}
