/**
 * Strips credential-shaped values out of URLs and request bodies before anything
 * is written to the archive.
 *
 * This matters more here than in a normal log. The archive exists specifically to
 * be exported and handed to an AI agent, so every byte it holds should be assumed
 * to leave the machine. The MAIN-world hook never sees headers or cookies, so the
 * session cookie itself is already out of reach — but the game posts CSRF tokens
 * in form bodies, and those are worth keeping out of a file destined for a chat
 * window.
 *
 * Redaction is by key name, not by value shape: guessing "this looks like a
 * token" from entropy alone both misses short tokens and mangles ordinary game
 * data (item names, district slugs). Matching the key is precise and predictable.
 */
const SENSITIVE_KEY = /(^|[_-])(csrf|xsrf|token|auth|session|sid|secret|password|passwd|pwd|api[_-]?key|signature|sig|nonce)([_-]|$)/i;

const REDACTED = '[redacted]';

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/**
 * Redacts sensitive query-string values while leaving the rest of the URL — path,
 * ordering, and all non-sensitive params — byte-identical, since those are what
 * make one request distinguishable from another when reading the archive back.
 */
export function redactUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (isSensitiveKey(key)) {
      url.searchParams.set(key, REDACTED);
      changed = true;
    }
  }
  return changed ? url.toString() : rawUrl;
}

/**
 * Redacts a request body. Handles the two shapes the game actually sends —
 * form-urlencoded (every `actions/*.php` POST) and JSON — and leaves anything
 * else untouched rather than risking corruption of a format we don't understand.
 */
export function redactBody(body: string | null): string | null {
  if (body == null || body === '') return body;

  const trimmed = body.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const redactedJson = redactJsonBody(body);
    if (redactedJson !== null) return redactedJson;
  }

  return redactFormBody(body);
}

function redactJsonBody(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  return JSON.stringify(redactValue(parsed));
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(inner);
    }
    return out;
  }
  return value;
}

/**
 * Rebuilt by hand rather than through URLSearchParams, which would re-encode every
 * untouched pair and so change bytes we specifically want preserved verbatim.
 * Pairs without `=` are passed through as-is for the same reason.
 */
function redactFormBody(body: string): string {
  return body
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      return isSensitiveKey(decodeURIComponent(key)) ? `${key}=${REDACTED}` : pair;
    })
    .join('&');
}
