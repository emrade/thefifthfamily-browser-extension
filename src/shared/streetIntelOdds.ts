/**
 * The game's odds for one Street Intel approach: base odds scaled by the
 * shared bonus (rank, prestige, collection, recon, mastery and the card's
 * global condition), the stat (÷ 5) and the condition's effect on that stat,
 * plus the approach's own bonus; whole percent, 0–95. An always-fails
 * approach is 0.
 *
 * Kept in its own file with no imports: `predictCard` uses it, and TFF
 * Consigliere's rules are compiled from it (scripts/consigliere/build_rules.mjs),
 * so this is the one copy of the formula.
 */
export function approachOdds(base: number, shared: number, stat: number, statCondition: number, bonus: number, autofail: boolean): number {
  if (autofail) return 0;
  const raw = base * (1 + (shared + stat / 5 + statCondition) / 100) + bonus;
  return Math.max(0, Math.min(95, Math.round(raw)));
}
