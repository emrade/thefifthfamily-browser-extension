/**
 * Pure math behind the Real Estate advisor — no DOM, no chrome.* APIs, so it can
 * be unit tested and reused by both the in-page overlay
 * (content/features/realEstate) and, if it's ever wanted there too, the popup.
 *
 * A property earns Hourly Income into a Vault with a fixed capacity; once the
 * vault is full, further income is simply lost until the next collection. The
 * two upgrade tracks (Revenue, Vault) are bought independently, so a property
 * whose Revenue was leveled up without a matching Vault increase overflows —
 * this module figures out, for a given property, whether that's happening, how
 * much it costs per day, and the cheapest Vault level that stops it.
 *
 * The model is reverse-engineered from this account's actual upgrade
 * transactions (see docs/real-estate-advisor-plan.md for the derivation)
 * rather than from any public source — Fifth Family exposes no formula or
 * preview for what a Real Estate upgrade will do before you buy it. Two
 * regularities held exactly across every property observed, at every level:
 *
 * 1. Both Hourly Income and Max Vault grow *linearly* with level: value(L) =
 *    base * (1 + 0.2*(L-1)), where `base` is the level-1 value. Level 11 (the
 *    observed cap for every property) lands at exactly 3x base.
 *
 * 2. The cost to go from level n to n+1 is `k * n` for a per-property,
 *    per-track constant k (arithmetic growth, not geometric) — confirmed
 *    against the full upgrade log for six properties, including two that
 *    upgraded from a level other than 1. This lets `k` be recovered directly
 *    from whatever the game is currently showing as the next Vault upgrade's
 *    price, with no purchase history required — which is what lets the same
 *    math cover a newly-unlocked property the moment its card first renders.
 */

export const MAX_LEVEL = 11;
export const GROWTH_PER_LEVEL = 0.2; // value(L) = base * (1 + GROWTH_PER_LEVEL * (L - 1))

/** value at `level`, given the level-1 base. */
export function valueAtLevel(base: number, level: number): number {
  return base * (1 + GROWTH_PER_LEVEL * (level - 1));
}

/** Recovers the level-1 base from a value observed at any level. */
export function baseFromValueAtLevel(value: number, level: number): number {
  return value / (1 + GROWTH_PER_LEVEL * (level - 1));
}

/** The per-property, per-track cost constant `k`, recovered from the price the
 *  game is currently showing to go from `currentLevel` to `currentLevel + 1`. */
export function deriveUpgradeConstant(nextUpgradeCost: number, currentLevel: number): number {
  return nextUpgradeCost / currentLevel;
}

/** Total cost to go from `fromLevel` to `toLevel` (`toLevel` > `fromLevel`),
 *  i.e. the sum of k*n for n = fromLevel .. toLevel-1, closed-form. */
export function costBetweenLevels(k: number, fromLevel: number, toLevel: number): number {
  const steps = toLevel - fromLevel;
  if (steps <= 0) return 0;
  const sumOfLevels = (fromLevel + toLevel - 1) * steps / 2;
  return k * sumOfLevels;
}

/** Total cost to fully max a single track (Revenue or Vault — same formula
 *  shape for both) from its current level to MAX_LEVEL. Zero if already
 *  maxed. Independent of cadence/overflow status — this is "what would it
 *  cost to finish this track", not "what do you need right now". */
export function costToMaxLevel(currentLevel: number, nextUpgradeCost: number | null): number {
  if (currentLevel >= MAX_LEVEL || nextUpgradeCost === null) return 0;
  const k = deriveUpgradeConstant(nextUpgradeCost, currentLevel);
  return costBetweenLevels(k, currentLevel, MAX_LEVEL);
}

export interface PropertyAdvice {
  /** Hours until the vault fills at the current hourly rate — how often this
   *  property actually needs collecting to never overflow. */
  fillHours: number;
  /** What this property would earn in 24h if the vault were never a limit. */
  theoreticalDaily: number;
  /** What it actually earns in 24h, given the vault cap and how often the
   *  player collects (`cadenceHours`), scaled to a 24h figure for comparability
   *  across different cadence choices. */
  effectiveDaily: number;
  /** theoreticalDaily - effectiveDaily. Zero when the vault comfortably
   *  outlasts one full cadence cycle. */
  lossDaily: number;
  isOverflowing: boolean;
  /** Lowest vault level that stops the leak at the chosen cadence, or null if
   *  no upgrade is needed (not overflowing) or none is possible (already at
   *  MAX_LEVEL with no further upgrade on offer). */
  targetLevel: number | null;
  targetCap: number | null;
  /** Total cost of every step from the current level up to `targetLevel`. */
  costToTarget: number | null;
  /** True when even a maxed-out vault (level 11) can't hold a full cadence
   *  cycle — the property's revenue has simply outgrown what its vault can
   *  ever hold, and collecting more often is the only real fix. */
  structurallyCapped: boolean;
  /** Daily loss that would remain even after reaching `targetLevel` — zero
   *  unless `structurallyCapped`, in which case `targetLevel` is the best
   *  achievable (MAX_LEVEL) and this is what still leaks at that ceiling. */
  residualLossAtTarget: number;
  /** Cost to take Vault alone from its current level to MAX_LEVEL. Zero if
   *  already maxed. Independent of cadence — "what finishing this track
   *  costs", not "what's needed right now" (that's `costToTarget`). */
  costToMaxVault: number;
  /** Same, for Revenue. Most useful on a property whose Revenue isn't maxed
   *  yet — e.g. a newly-unlocked one — where `hourly` reflects today's level,
   *  not what it'll be once Revenue is finished. */
  costToMaxRevenue: number;
  /** costToMaxVault + costToMaxRevenue — the total to fully finish this
   *  property, both tracks, from wherever it stands today. */
  costToMaxBoth: number;
}

export interface PropertyAdviceInput {
  hourly: number;
  vaultCap: number;
  vaultLevel: number;
  /** Price shown for the next Vault upgrade, or null if Vault is already at
   *  MAX_LEVEL ("Maxed", no button). */
  nextVaultUpgradeCost: number | null;
  revenueLevel: number;
  /** Same as `nextVaultUpgradeCost`, for Revenue. */
  nextRevenueUpgradeCost: number | null;
}

export function analyzeProperty(input: PropertyAdviceInput, cadenceHours: number): PropertyAdvice {
  const { hourly, vaultCap, vaultLevel, nextVaultUpgradeCost, revenueLevel, nextRevenueUpgradeCost } = input;
  const neededCap = hourly * cadenceHours;
  const theoreticalDaily = hourly * 24;
  const scaleToDaily = 24 / cadenceHours;

  const costToMaxVault = costToMaxLevel(vaultLevel, nextVaultUpgradeCost);
  const costToMaxRevenue = costToMaxLevel(revenueLevel, nextRevenueUpgradeCost);
  const costToMaxBoth = costToMaxVault + costToMaxRevenue;

  const effectivePerCycle = Math.min(vaultCap, neededCap);
  const effectiveDaily = effectivePerCycle * scaleToDaily;
  const lossDaily = theoreticalDaily - effectiveDaily;
  const isOverflowing = lossDaily > 0.01;
  const fillHours = vaultCap / hourly;

  if (!isOverflowing) {
    return {
      fillHours, theoreticalDaily, effectiveDaily, lossDaily, isOverflowing,
      targetLevel: null, targetCap: null, costToTarget: null,
      structurallyCapped: false, residualLossAtTarget: 0,
      costToMaxVault, costToMaxRevenue, costToMaxBoth,
    };
  }

  if (vaultLevel >= MAX_LEVEL || nextVaultUpgradeCost === null) {
    // Nothing left to buy — the leak is real but a vault upgrade can't touch it.
    return {
      fillHours, theoreticalDaily, effectiveDaily, lossDaily, isOverflowing,
      targetLevel: null, targetCap: null, costToTarget: null,
      structurallyCapped: true, residualLossAtTarget: lossDaily,
      costToMaxVault, costToMaxRevenue, costToMaxBoth,
    };
  }

  const k = deriveUpgradeConstant(nextVaultUpgradeCost, vaultLevel);
  const base = baseFromValueAtLevel(vaultCap, vaultLevel);
  const maxCap = valueAtLevel(base, MAX_LEVEL);

  if (maxCap < neededCap) {
    // Even a fully maxed vault can't hold one full cadence cycle — report the
    // best achievable level and what still leaks there.
    const residual = (neededCap - maxCap) * scaleToDaily;
    return {
      fillHours, theoreticalDaily, effectiveDaily, lossDaily, isOverflowing,
      targetLevel: MAX_LEVEL, targetCap: maxCap, costToTarget: costToMaxVault,
      structurallyCapped: true, residualLossAtTarget: residual,
      costToMaxVault, costToMaxRevenue, costToMaxBoth,
    };
  }

  let targetLevel = vaultLevel + 1;
  while (targetLevel < MAX_LEVEL && valueAtLevel(base, targetLevel) < neededCap) {
    targetLevel += 1;
  }
  const targetCap = valueAtLevel(base, targetLevel);
  const costToTarget = costBetweenLevels(k, vaultLevel, targetLevel);

  return {
    fillHours, theoreticalDaily, effectiveDaily, lossDaily, isOverflowing,
    targetLevel, targetCap, costToTarget,
    structurallyCapped: false, residualLossAtTarget: 0,
    costToMaxVault, costToMaxRevenue, costToMaxBoth,
  };
}
