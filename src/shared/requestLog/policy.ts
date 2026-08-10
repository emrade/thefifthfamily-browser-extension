/**
 * What the archive keeps, and how often.
 *
 * Sized against a real measurement rather than an estimate. A 1.77-hour capture
 * recorded 1,605 responses — **21,726/day**, fourteen times the 1,500/day this
 * feature was originally built around. Left alone, the archive turns over in days
 * and the retention setting means nothing.
 *
 * The traffic splits cleanly once you look at payloads rather than counts:
 *
 * | Endpoint                     | /day  | Payload                                    |
 * |------------------------------|-------|--------------------------------------------|
 * | `stats.php`                  | 9,502 | Full player state — the most valuable thing |
 * | `chat.php`                   | 6,078 | `{messages:[], online:120}` — a poll        |
 * | `get_announcements.php`      | 2,775 | `{announcements:[]}` — always empty         |
 * | `feed.php`                   | 1,069 | Other players' activity — social, not rules |
 * | `milestones_check.php`       |   596 | `{has_unclaimed:false, count:0}` — a badge  |
 *
 * So: drop the pure polls, and thin the valuable one rather than losing it.
 */

/**
 * Never archived. Each is a client-side poll whose response carries no game rule —
 * between them, 48% of all requests for 8% of the bytes.
 *
 * Note these are still *captured* by the network hook and still reach the feature
 * adapters; this only controls what gets written to the archive. Excluding an
 * endpoint here can't break a feature.
 */
const EXCLUDED_PATHS = [
  /\/api\/chat\.php$/,
  /\/api\/get_announcements\.php$/,
  /\/api\/feed\.php$/,
  /\/actions\/milestones_check\.php$/,
];

/**
 * Minimum gap between archived responses for an endpoint, in ms.
 *
 * `stats.php` is polled several times a second but describes state that drifts
 * slowly — energy ticks, cash moves when you act. One sample a minute preserves
 * every trend worth analysing while cutting 9,502 rows/day to 1,440. Responses
 * that are kept are kept *whole*; this thins the sampling rate, it never edits a
 * body.
 */
const THROTTLED_PATHS: { pattern: RegExp; minIntervalMs: number }[] = [
  { pattern: /\/api\/stats\.php$/, minIntervalMs: 60_000 },
];

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** True when this URL should never be written to the archive. */
export function isExcluded(url: string): boolean {
  const path = pathOf(url);
  if (path == null) return false;
  return EXCLUDED_PATHS.some((pattern) => pattern.test(path));
}

/** Minimum ms between archived responses for this URL, or null for "keep every one". */
export function throttleIntervalFor(url: string): number | null {
  const path = pathOf(url);
  if (path == null) return null;
  return THROTTLED_PATHS.find(({ pattern }) => pattern.test(path))?.minIntervalMs ?? null;
}

/** Exposed so the retention sweep can drop rows for endpoints excluded after they
 *  were archived — otherwise a policy change would take a full retention window to
 *  take effect. */
export function isExcludedEndpointKey(endpoint: string): boolean {
  // Endpoint keys look like `GET /api/chat.php` or `GET /api/feed.php?after=*`.
  const withoutMethod = endpoint.replace(/^[A-Z]+\s+/, '');
  const path = withoutMethod.split('?')[0];
  return EXCLUDED_PATHS.some((pattern) => pattern.test(path));
}
