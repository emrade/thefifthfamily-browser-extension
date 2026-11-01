/**
 * Forge costs (see docs/forge-mechanics.md).
 *
 * A failed attempt charges the full cash and leaves the item at its rank
 * (measured: 14 of 46 attempts on 2026-09-18 failed and were charged in full;
 * the game's own page says "You lose the cash. Your item stays safe."), and
 * gold is charged on success only. So landing a rank costs, on average,
 * `cost / chance` cash: 1/chance tries.
 *
 * Each rank's cash cost is a fixed multiple of the item's rank-1 cost.
 * Ranks 1–6 are measured to the dollar on four items (forge_v2 buttons,
 * 2026-09-18); the game's wiki states the same ladder as a share of the
 * item's base value (10/15/20/30/50/75%) and continues it for 7–10
 * (100/150/200/300%), which no capture has confirmed yet — the wiki's odds
 * for +9 and +10 (15%, 10%) already disagree with the game's own page (12%,
 * 5%), so odds are always read from the page, never from here.
 */

/** Rank → cash cost as a multiple of the rank-1 cost. */
export const FORGE_COST_MULTIPLIER: Record<number, number> = { 1: 1, 2: 1.5, 3: 2, 4: 3, 5: 5, 6: 7.5, 7: 10, 8: 15, 9: 20, 10: 30 };

/** Highest rank whose cost multiplier has been seen in the game itself. */
export const FORGE_MEASURED_MAX_RANK = 6;

export const FORGE_MAX_RANK = 10;

/** Expected cash to go from `fromRank` to `toRank`, given the cost of the
 *  next rank (`nextCost`, as the card shows it) and each rank's chance (0–1).
 *  Null when a chance is missing. */
export function expectedForgeCost(
  fromRank: number,
  toRank: number,
  nextCost: number,
  chanceByRank: Record<number, number>,
): { cash: number; tries: number; usesUnmeasured: boolean } | null {
  const rankOneCost = nextCost / FORGE_COST_MULTIPLIER[fromRank + 1];
  let cash = 0;
  let tries = 0;
  let usesUnmeasured = false;
  for (let rank = fromRank + 1; rank <= toRank; rank++) {
    const chance = chanceByRank[rank];
    if (!chance || chance <= 0) return null;
    cash += (rankOneCost * FORGE_COST_MULTIPLIER[rank]) / chance;
    tries += 1 / chance;
    if (rank > FORGE_MEASURED_MAX_RANK && rank > fromRank + 1) usesUnmeasured = true;
  }
  return { cash, tries, usesUnmeasured };
}
