/**
 * The Arena Game % Safety Gate's cut-offs, and the record they're suggested
 * from, the same way Street Intel's analytics suggest its settings from the
 * player's own results.
 *
 * - Cut-offs: a regular opponent is Beatable only when the game's % is at
 *   least `beatableFrom`, and Avoid below `avoidBelow`. The defaults (90 / 60)
 *   come from the 116 regular fights after the 2026-10-30 patch
 *   (docs/proposals/arena-advisor-post-patch-review.md); the player can
 *   change them, or apply a suggestion.
 * - Record: every regular fight's quoted % and result, kept in its own
 *   storage (the request archive only holds ~2 days), filled live, by the
 *   Dashboard's import of archive exports, and de-duplicated by the fight's
 *   capture timestamp.
 * - Suggestions only use fights since `since`, normally the game's last change
 *   to its %, since earlier fights describe a different formula.
 */

export interface ArenaGateConfig {
  beatableFrom: number;
  avoidBelow: number;
  /** Only fights from here on count towards suggestions. */
  since: number;
}

/** The Oct 30 patch: the game's % became a reliable simulation from here. */
export const ARENA_GATE_DEFAULT_SINCE = Date.UTC(2026, 9, 30, 11, 9);

export const DEFAULT_ARENA_GATE_CONFIG: ArenaGateConfig = {
  beatableFrom: 90,
  avoidBelow: 60,
  since: ARENA_GATE_DEFAULT_SINCE,
};

export interface ArenaQuotedFight {
  /** Capture timestamp of the `attack` request (the archive's own value). */
  at: number;
  name: string;
  /** The game's "% CHANCE" on the card before the fight. */
  quoted: number;
  won: boolean;
}

export const ARENA_QUOTE_RECORD_MAX = 3000;

/** Adds fights, skipping any already counted; oldest first, capped. */
export function addQuotedFights(prev: ArenaQuotedFight[], fights: ArenaQuotedFight[]): ArenaQuotedFight[] {
  const byAt = new Map(prev.map((f) => [f.at, f]));
  let changed = false;
  for (const f of fights) {
    if (byAt.has(f.at)) continue;
    byAt.set(f.at, f);
    changed = true;
  }
  if (!changed) return prev;
  return [...byAt.values()].sort((a, b) => a.at - b.at).slice(-ARENA_QUOTE_RECORD_MAX);
}

/** Fights needed in a band before it suggests anything. */
export const ARENA_GATE_MIN_FIGHTS = 20;
/** "Avoid" means rarely won: at most this share of fights below the cut-off. */
export const ARENA_GATE_AVOID_MAX_WIN_SHARE = 0.1;

export interface ArenaGateBand {
  cutoff: number;
  fights: number;
  wins: number;
}

/** An inclusive range of game % with no fights in it. */
export interface ArenaGateGap {
  from: number;
  to: number;
}

export interface ArenaGateSuggestion {
  /** Fights counted (since `config.since`). */
  fights: number;
  /** Lowest game % actually fought at, at or above which every fight was
   *  won, with at least `ARENA_GATE_MIN_FIGHTS` there. Null until there are
   *  enough. */
  beatable: ArenaGateBand | null;
  /** Game % between the highest loss below `beatable` and `beatable` itself
   *  that no fight was quoted at: the data can't place the cut-off there. */
  beatableUntested: ArenaGateGap | null;
  /** Just above the highest game % actually fought at, below which at most
   *  10% were won, with at least `ARENA_GATE_MIN_FIGHTS` there. Null until
   *  there are enough. */
  avoid: ArenaGateBand | null;
  /** Game % from `avoid` up to the next fight above it that no fight was
   *  quoted at. */
  avoidUntested: ArenaGateGap | null;
  /** The record of the current cut-offs, for the player to judge them. */
  current: { beatable: ArenaGateBand; avoid: ArenaGateBand };
  /** Losses at or above the current Beatable cut-off: a sign the game's %
   *  has changed again, so `since` may need moving. */
  lossesAboveBeatable: ArenaQuotedFight[];
}

function band(fights: ArenaQuotedFight[], cutoff: number, above: boolean): ArenaGateBand {
  const xs = fights.filter((f) => (above ? f.quoted >= cutoff : f.quoted < cutoff));
  return { cutoff, fights: xs.length, wins: xs.filter((f) => f.won).length };
}

export function suggestGate(record: ArenaQuotedFight[], config: ArenaGateConfig): ArenaGateSuggestion {
  const fights = record.filter((f) => f.at >= config.since);
  // Every cut-off between two neighbouring fights splits them the same way,
  // so the search alone can't tell 85% from 89% when no fight sat between.
  // Each suggestion is snapped to the side with fights: Beatable to the
  // lowest % actually won at, Avoid to just above the highest % it covers.
  // The empty range is reported instead of guessed.
  let beatable: ArenaGateBand | null = null;
  let beatableUntested: ArenaGateGap | null = null;
  for (let c = 1; c <= 100; c++) {
    const b = band(fights, c, true);
    if (b.fights >= ARENA_GATE_MIN_FIGHTS && b.wins === b.fights) {
      const lowestWon = Math.min(...fights.filter((f) => f.quoted >= c).map((f) => f.quoted));
      beatable = band(fights, lowestWon, true);
      if (lowestWon > c) beatableUntested = { from: c, to: lowestWon - 1 };
      break;
    }
  }
  let avoid: ArenaGateBand | null = null;
  let avoidUntested: ArenaGateGap | null = null;
  for (let c = 100; c >= 1; c--) {
    const b = band(fights, c, false);
    if (b.fights >= ARENA_GATE_MIN_FIGHTS && b.wins <= b.fights * ARENA_GATE_AVOID_MAX_WIN_SHARE) {
      const highestCovered = Math.max(...fights.filter((f) => f.quoted < c).map((f) => f.quoted));
      avoid = band(fights, highestCovered + 1, false);
      if (highestCovered + 1 < c) avoidUntested = { from: highestCovered + 1, to: c - 1 };
      break;
    }
  }
  // Never suggest an Avoid cut-off above the Beatable one.
  if (beatable && avoid && avoid.cutoff > beatable.cutoff) {
    avoid = null;
    avoidUntested = null;
  }
  return {
    fights: fights.length,
    beatable,
    beatableUntested,
    avoid,
    avoidUntested,
    current: { beatable: band(fights, config.beatableFrom, true), avoid: band(fights, config.avoidBelow, false) },
    lossesAboveBeatable: fights.filter((f) => !f.won && f.quoted >= config.beatableFrom),
  };
}
