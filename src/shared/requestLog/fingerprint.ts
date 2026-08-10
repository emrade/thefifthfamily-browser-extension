import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';

/**
 * Turns a response into a small set of *structural* tokens, so that two responses
 * from the same endpoint hash identically whenever they differ only in data
 * (prices, timers, cargo counts) and differently the moment the game changes the
 * shape of what it sends.
 *
 * This is what makes "spot changes as they happen" cheap. Detecting a game-side
 * change by diffing stored bodies would mean re-reading an enormous archive and
 * wading through 10-minute price churn; comparing a hash per response reduces it
 * to an equality check, and the stored token list turns a hit into a readable
 * "added X, removed Y".
 *
 * Everything here is deliberately regex-based and DOM-free. Fingerprinting runs in
 * the background service worker on the write path, and MV3 workers don't reliably
 * have DOMParser — the same constraint that already forced marketPoller.ts to
 * carry a regex twin of the content script's DOM parser.
 */

/** Cache-busting params observed on real calls (`?_t=` on both pollers). Stripping
 *  them is what keeps every poll from minting a distinct endpoint key. */
const VOLATILE_PARAMS = new Set(['_t', '_', 'cb', 'ts', 'rand']);

/** Values kept verbatim in the endpoint key: short, enum-like, and stable — the
 *  `type=smuggling` case, which genuinely selects a different response. Anything
 *  else (ids, counts, free text) collapses to `*` so that `id=12345` and
 *  `id=12346` don't split one endpoint into thousands. */
const ENUM_VALUE = /^[a-z][a-z0-9_]{0,31}$/i;

/**
 * Stable identity for "the same call" — `GET /api/panel.php?type=smuggling`.
 * Params are sorted so that argument order never forks the key.
 */
export function endpointKey(method: string, rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return `${method.toUpperCase()} ${rawUrl}`;
  }

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !VOLATILE_PARAMS.has(key))
    .map(([key, value]): [string, string] => [key, ENUM_VALUE.test(value) ? value : '*'])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`);

  const query = params.length ? `?${params.join('&')}` : '';
  return `${method.toUpperCase()} ${url.pathname}${query}`;
}

export interface Fingerprint {
  hash: string;
  tokens: string[];
}

/**
 * Routes a response to the right tokenizer. The panel envelope is unwrapped first
 * — every `panel.php` response is `{ok,title,html}`, so fingerprinting the JSON
 * alone would report the same three keys for every panel in the game and detect
 * nothing. The tokens that matter are inside `html`.
 */
export function fingerprintResponse(responseText: string): Fingerprint {
  const envelope = unwrapPanelEnvelope(responseText);
  if (envelope) return finalize(['env:panel', ...htmlTokens(envelope.html)]);

  const trimmed = responseText.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const tokens = jsonTokens(responseText);
    if (tokens) return finalize(['env:json', ...tokens]);
  }

  return finalize(['env:html', ...htmlTokens(responseText)]);
}

function finalize(tokens: string[]): Fingerprint {
  const unique = [...new Set(tokens)].sort();
  return { hash: hashTokens(unique), tokens: unique };
}

/**
 * Structure of a JSON response as sorted key paths. Array indices collapse to
 * `[]` so a list of three items and a list of thirty produce one token, not
 * thirty — length is data, not shape.
 */
function jsonTokens(responseText: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return null;
  }

  const out: string[] = [];
  walk(parsed, '', out, 0);
  return out;
}

/** Depth-limited so a pathological or recursive payload can't stall the write
 *  path; nothing the game sends comes close to this nesting. */
const MAX_DEPTH = 12;

function walk(value: unknown, path: string, out: string[], depth: number): void {
  if (depth > MAX_DEPTH) return;

  if (Array.isArray(value)) {
    out.push(`${path}[]`);
    // Only the first element is walked: elements of one array are homogeneous in
    // every payload the game sends, so walking all of them would multiply work
    // across long market listings while producing identical tokens.
    if (value.length) walk(value[0], `${path}[]`, out, depth + 1);
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      const next = path ? `${path}.${key}` : key;
      out.push(next);
      walk(inner, next, out, depth + 1);
    }
    return;
  }

  // Leaf: record the type, not the value. `price:number` staying `price:number`
  // is a non-event; it turning into `price:string` is exactly the kind of
  // game-side change worth surfacing.
  out.push(`${path}:${value === null ? 'null' : typeof value}`);
}

const CLASS_ATTR = /class="([^"]*)"/g;
const ID_ATTR = /\bid="([^"]*)"/g;
const FIELD_NAME = /<(?:input|select|textarea|button)\b[^>]*\bname="([^"]*)"/gi;
const DATA_ATTR = /\b(data-[a-z0-9-]+)=/gi;
const TAG_NAME = /<([a-z][a-z0-9]*)\b/gi;

/**
 * Structure of an HTML fragment as the set of CSS classes, element ids, form
 * field names, data-* attribute names, and tag names it contains.
 *
 * Classes carry most of the signal, because this game's markup is class-driven
 * and every existing adapter keys off them — `sgl-c-price`, `sgl-raid-screen`,
 * `sgl-monitor`. A class disappearing from a response is precisely the event that
 * silently breaks an adapter today, and it is what this index is built to catch.
 *
 * Ids are filtered for digits: `#smug-price-timer` is structure and worth a token,
 * while `#target-48213` is a row identity that would otherwise mint a fresh shape
 * on every single response and bury real changes in noise.
 */
function htmlTokens(html: string): string[] {
  const out: string[] = [];

  for (const [, value] of html.matchAll(CLASS_ATTR)) {
    for (const cls of value.split(/\s+/)) {
      if (cls) out.push(`.${cls}`);
    }
  }

  for (const [, value] of html.matchAll(ID_ATTR)) {
    if (value && !/\d/.test(value)) out.push(`#${value}`);
  }

  for (const [, value] of html.matchAll(FIELD_NAME)) {
    if (value) out.push(`field:${value}`);
  }

  for (const [, value] of html.matchAll(DATA_ATTR)) {
    out.push(`attr:${value.toLowerCase()}`);
  }

  for (const [, value] of html.matchAll(TAG_NAME)) {
    out.push(`tag:${value.toLowerCase()}`);
  }

  return out;
}

/**
 * FNV-1a, run twice with different offset bases and concatenated to 64 bits.
 *
 * Deliberately not crypto.subtle: this is a change detector, not a security
 * boundary, and subtle.digest is async — which would push an await into the
 * middle of the write path for no benefit. 64 bits is far more than enough to
 * distinguish the handful of shapes one endpoint takes, and the token list is
 * stored alongside anyway, so a collision would be visible rather than silent.
 */
function hashTokens(tokens: string[]): string {
  const joined = tokens.join('\n');
  return (fnv1a(joined, 0x811c9dc5) >>> 0).toString(16).padStart(8, '0')
    + (fnv1a(joined, 0x01000193) >>> 0).toString(16).padStart(8, '0');
}

function fnv1a(text: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash;
}
