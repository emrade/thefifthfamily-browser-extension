/**
 * What the player has learned about each regular Arena opponent from their
 * own fights: the record against them, and the numbers the combat log shows
 * that the card doesn't. Above all, the opponent's real armour.
 *
 * Why it matters (docs/proposals/arena-advisor-post-patch-review.md):
 * - Real armour runs 0.90–1.67× card DEF, because gear adds armour the card
 *   doesn't show.
 * - An opponent's armour is fixed fight to fight. It moved only at the Oct 30
 *   patch or when they changed gear, across 26 opponents met more than once.
 * - 60% of post-patch fights were rematches.
 * - NehNehPok (card DEF 930, real armour 1,088) was rated Beatable three
 *   times and won all three; from the second fight on, this memory has the
 *   real number.
 *
 * Kept in `chrome.storage.local`. Updated from every regular `attack`
 * response, whether or not the page setting that shows it is on (recording
 * is data only, like the advisor's own profile), and seeded once from the
 * request archive (background/features/arena/opponentMemoryBackfill.ts).
 */

export interface ArenaOpponentRecord {
  name: string;
  fights: number;
  wins: number;
  lastAt: number;
  lastWon: boolean;
  /** Median `reduction` on the player's hits in the latest fight: the
   *  opponent's real armour. */
  armour: number | null;
  /** `def_max_hp` from the latest fight. */
  maxHp: number | null;
  /** HP left on the losing side of the latest fight: theirs when the player
   *  lost, the player's when the player won. */
  lastHpLeft: number | null;
  lastRounds: number;
}

export type ArenaOpponentMemory = Record<string, ArenaOpponentRecord>;

/** Opponents kept, most recently fought first. */
export const ARENA_OPPONENT_MEMORY_MAX = 400;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Folds one `attack` response into the memory. Returns the same object when
 * the response isn't a regular fight (bosses, `ok:false`, malformed), so
 * callers can skip the write.
 */
export function rememberFight(prev: ArenaOpponentMemory, resp: unknown, at: number): ArenaOpponentMemory {
  const r = resp as {
    ok?: unknown;
    won?: unknown;
    defender?: unknown;
    def_max_hp?: unknown;
    attacker_hp_left?: unknown;
    defender_hp_left?: unknown;
    rounds?: unknown;
  };
  if (r?.ok !== true || typeof r.won !== 'boolean' || typeof r.defender !== 'string' || !Array.isArray(r.rounds)) return prev;
  const reductions: number[] = [];
  for (const round of r.rounds as Record<string, unknown>[]) {
    const a = round?.attacker as { reduction?: unknown } | undefined;
    if (a && typeof a.reduction === 'number' && a.reduction > 0) reductions.push(a.reduction);
  }
  const old = prev[r.defender];
  // The same response seen twice (two tabs, or the backfill overlapping a
  // live capture) must not count twice.
  if (old && old.lastAt === at) return prev;
  if (old && old.lastAt > at) return prev;
  const record: ArenaOpponentRecord = {
    name: r.defender,
    fights: (old?.fights ?? 0) + 1,
    wins: (old?.wins ?? 0) + (r.won ? 1 : 0),
    lastAt: at,
    lastWon: r.won,
    armour: median(reductions) ?? old?.armour ?? null,
    maxHp: typeof r.def_max_hp === 'number' ? r.def_max_hp : old?.maxHp ?? null,
    lastHpLeft: r.won
      ? typeof r.attacker_hp_left === 'number' ? r.attacker_hp_left : null
      : typeof r.defender_hp_left === 'number' ? r.defender_hp_left : null,
    lastRounds: r.rounds.length,
  };
  const next = { ...prev, [r.defender]: record };
  const names = Object.keys(next);
  if (names.length <= ARENA_OPPONENT_MEMORY_MAX) return next;
  const keep = names.sort((a, b) => next[b].lastAt - next[a].lastAt).slice(0, ARENA_OPPONENT_MEMORY_MAX);
  return Object.fromEntries(keep.map((n) => [n, next[n]]));
}

/** "Lost 0–3 · last: they finished on 117 HP". */
export function memoryText(rec: ArenaOpponentRecord): string {
  const losses = rec.fights - rec.wins;
  const record = rec.fights === 1 ? (rec.lastWon ? 'Won last time' : 'Lost last time') : `${rec.wins}–${losses} vs them`;
  if (rec.lastHpLeft === null) return record;
  return rec.lastWon ? `${record} · you finished on ${rec.lastHpLeft} HP` : `${record} · they finished on ${rec.lastHpLeft} HP`;
}
