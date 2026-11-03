/**
 * When the current Arena season started, from the game's own season list.
 *
 * The Arena page's season selector lists every finished season with its
 * dates in game time ("Season 27 · Oct 21 – Oct 27"); the current season
 * starts the day after the newest one ends, at game midnight, i.e. 23:00
 * UTC on the listed end date. Checked 2026-11-03: the player's loadout (max
 * HP) changed between Oct 27 15:04 and 23:05 UTC, across that boundary.
 *
 * Read from the list rather than assumed weekly: the schedule isn't
 * perfectly regular (there's no Season 20; Season 19 ends Sep 6 and
 * Season 21 starts Sep 9). Max HP isn't used either: it only changes when
 * the player's stats do, so two seasons at the same HP would merge.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * The current season's start from the season list's option labels, given
 * when the page was seen (for the year, which the labels leave out). Null
 * when no label can be read.
 */
export function seasonStartFromLabels(labels: string[], seenAt: number): number | null {
  let best: { n: number; end: { m: number; d: number } } | null = null;
  for (const label of labels) {
    const m = label.match(/Season\s+(\d+)\s*·\s*[A-Za-z]+\s+\d+\s*[–-]\s*([A-Za-z]+)\s+(\d+)/);
    if (!m) continue;
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (month === -1) continue;
    const n = Number(m[1]);
    if (!best || n > best.n) best = { n, end: { m: month, d: Number(m[3]) } };
  }
  if (!best) return null;
  const year = new Date(seenAt).getUTCFullYear();
  let start = Date.UTC(year, best.end.m, best.end.d, 23, 0);
  // A season that ended in December, seen in January.
  if (start > seenAt + DAY_MS) start = Date.UTC(year - 1, best.end.m, best.end.d, 23, 0);
  return start;
}

/**
 * The current season's start: the stored one (from the last Arena page
 * seen), stepped forward a week at a time if the page hasn't been seen since
 * a new season began. Null when no season start has been seen yet.
 */
export function currentSeasonStart(stored: number | null, now = Date.now()): number | null {
  if (stored === null) return null;
  if (now < stored) return stored;
  return stored + Math.floor((now - stored) / WEEK_MS) * WEEK_MS;
}
