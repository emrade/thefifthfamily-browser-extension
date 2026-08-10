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

/** Per-token bookkeeping inside an endpoint's vocabulary. `count` against the
 *  profile's own `count` is what separates a structural token (present every
 *  time) from an optional one (present sometimes). */
export interface TokenStat {
  firstSeen: number;
  count: number;
}

export interface PendingRemoval {
  tokens: string[];
  /** When the vocabulary first went missing. */
  since: number;
  /** Observations seen since, none of which brought the tokens back. */
  observationsSince: number;
}

export type StructuralEventKind =
  /** A token appeared that this endpoint had never produced before. Informational:
   *  after warmup it usually means a genuinely new field, but a rare variant seen
   *  for the first time looks identical at the moment it happens. */
  | 'new-tokens'
  /** A token that had appeared in *every* prior observation stopped appearing.
   *  This is the one worth acting on — it is what silently breaks an adapter. */
  | 'removed-universal'
  /** Most of an endpoint's vocabulary disappeared and did not come back.
   *
   *  Distinguished from `removed-universal` because the evidence is different in
   *  kind. A wholesale disappearance is normally a *variant* — a raid screen
   *  replacing a market listing shares almost no markup with it — so it is held
   *  provisionally and only reported once the old vocabulary has failed to
   *  reappear across many further observations. A variant recurs within minutes;
   *  a rewritten endpoint never does. */
  | 'endpoint-rewritten';

export interface StructuralEvent {
  at: number;
  kind: StructuralEventKind;
  tokens: string[];
  /** Endpoint observation count when this fired, so a reader can judge how well
   *  sampled the endpoint was at the time. */
  observations: number;
}

/**
 * One row per endpoint, holding the cumulative vocabulary of structural tokens it
 * has ever produced.
 *
 * This replaces an earlier design that stored one row per distinct *token set*
 * and treated "more than one set" as evidence the game had changed. Measured
 * against a real capture that was wrong in the most basic way: a single endpoint
 * routinely returns several unrelated structures, and optional elements fork the
 * set every time they toggle. The result was a handful of endpoints reporting
 * four to six "shapes" apiece, oscillating between the same two token sets, and
 * an alert that fired on all of them within an hour of first use with nothing
 * actually wrong.
 *
 * A vocabulary cannot be fooled that way. A blinking cooldown timer contributes
 * its classes once and is thereafter part of what the endpoint is known to emit;
 * only a token nobody has seen before, or the disappearance of one that used to
 * be universal, is worth reporting.
 */
export interface EndpointProfile {
  id?: number;
  endpoint: string;
  firstSeen: number;
  lastSeen: number;
  /** Total responses observed for this endpoint. */
  count: number;
  /** The vocabulary: every token ever produced, with its own stats. */
  tokens: Record<string, TokenStat>;
  /** Structural events, newest last, capped at SHAPE_MAX_EVENTS. */
  events: StructuralEvent[];
  /** A mass disappearance being watched to see whether it recurs. Cleared the
   *  moment the missing vocabulary comes back. */
  pendingRemoval?: PendingRemoval | null;
  /** A short verbatim excerpt of the most recent response, for context when a
   *  token list alone is ambiguous. */
  sample: string;
}
