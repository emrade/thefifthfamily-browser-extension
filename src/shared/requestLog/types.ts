/**
 * Types for the raw HTTP request/response archive.
 *
 * Two tables work together, and the split is the whole point of the feature:
 *
 * - `requestLog` is the deep archive — every game-origin request, body included,
 *   gzipped. It answers "what exactly did the server send at 14:32 last Tuesday",
 *   which is what you need to re-derive a mechanic (the way every formula in
 *   docs/game-mechanics.md was recovered).
 *
 * - `endpointShapes` is the change index — one row per *structural change* to an
 *   endpoint's response, not per request. It answers "what did the game change,
 *   and when", and it stays small enough (a handful of KB over months) to hand to
 *   an AI agent directly, where the archive never would be.
 */

/** Which side of the extension issued the request. */
export type RequestLogOrigin =
  /** The game's own page code, seen by the MAIN-world fetch/XHR hook. */
  | 'page'
  /** One of the background pollers, which never touch the page and so are
   *  invisible to the page hook — see requestLog/loggedFetch.ts. */
  | 'background';

/**
 * `identity` is a fallback, not a choice: it is only used if `CompressionStream`
 * is somehow unavailable, so a missing platform API degrades to a larger archive
 * rather than to no archive at all.
 */
export type BodyEncoding = 'gzip' | 'identity';

export interface RequestLogEntry {
  id?: number;
  timestamp: number;
  /**
   * Stable identity for "the same call", used to group the archive and to key the
   * shape index — e.g. `GET /api/panel.php?type=smuggling`. Cache-busting params
   * are stripped and the rest are sorted, so the same logical endpoint always
   * produces the same key. Built by `endpointKey()` in fingerprint.ts.
   */
  endpoint: string;
  method: string;
  /** Full URL, with sensitive query values redacted. */
  url: string;
  status: number | null;
  durationMs: number | null;
  origin: RequestLogOrigin;
  encoding: BodyEncoding;
  /** Redacted request body, gzipped. Null for bodyless requests. */
  requestBody: Uint8Array | null;
  /** Response body, gzipped. */
  responseBody: Uint8Array;
  /** Byte length of the response body *before* compression — kept so the popup can
   *  report real archive savings without decompressing every row. */
  rawSize: number;
  /** Byte length actually stored, so a storage total is a sum over an existing
   *  column rather than a decompress-everything pass. */
  storedSize: number;
  /** True when the body exceeded REQUEST_LOG_MAX_BODY_BYTES and was cut short. */
  truncated: boolean;
  /** Structural fingerprint of the response — the join key to `endpointShapes`. */
  shapeHash: string;
}

export interface EndpointShape {
  id?: number;
  endpoint: string;
  shapeHash: string;
  /** When this shape was first observed. */
  firstSeen: number;
  /** When it was last observed — bumped in place, so an unchanged endpoint costs
   *  one row forever rather than one row per sighting. */
  lastSeen: number;
  /** How many responses have matched this shape. A shape that appears once and
   *  vanishes reads very differently from one that is the steady state. */
  count: number;
  /**
   * The structural tokens themselves (CSS classes, JSON key paths, form field
   * names). Diffing two of these is what turns "something changed" into "they
   * added `sgl-c-tariff` and dropped `sgl-c-origin`".
   */
  tokens: string[];
  /** A short verbatim excerpt of the first response with this shape, for context
   *  when a token diff alone is ambiguous. */
  sample: string;
}
