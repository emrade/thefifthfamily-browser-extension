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

// ---------------------------------------------------------------------------
// Measured: what each property actually netted, from real collections
// ---------------------------------------------------------------------------

/** One successful collection: every property (`key: null`, Collect All) or
 *  one (`key` = the game's property id). */
export interface CollectionEvent {
  at: number;
  key: string | null;
}

export const MEASURE_WINDOW_DAYS = 7;
/** Less than this many hours between a window's first and last collection
 *  says too little about the player's habit to report. */
const MIN_MEASURED_SPAN_HOURS = 24;

export interface MeasuredProperty {
  /** Collected per day over the measured span (vault caps applied). */
  netDaily: number;
  /** Income that overflowed a full vault, per day. */
  lostDaily: number;
}

export interface MeasuredPortfolio {
  byKey: Map<string, MeasuredProperty>;
  spanHours: number;
  collections: number;
  /** The longest gap between collections that 3 days in 4 stay within
   *  (upper quartile of each day's longest), i.e. what a vault has to hold.
   *  The middle day would undersize it: this account's daily longest gaps,
   *  2026-10-02 → 10-14, were mostly 9–12h with a night of 14–21h every few
   *  days (median 11.2h, upper quartile 14.0h). */
  usualLongestGapHours: number;
}

/**
 * Replays the collections in the last `MEASURE_WINDOW_DAYS` against each
 * property's current hourly income and vault cap: between two collections a
 * vault collects `min(hourly × hours, cap)` and the rest is lost. Uses
 * continuous hours: the game pays whole hours at a collection but carries
 * the part-hour into the next one (2026-10-02 → 10-05, 21 Collect Alls), so
 * over a day nothing is lost to frequent collecting.
 *
 * Today's rates over the whole window, so an upgrade or a bonus change
 * mid-window is spread over all of it. Collections the extension didn't see
 * (another device) look like one long gap, overstating the loss.
 */
export function measureFromCollections(
  properties: { key: string; hourly: number; cap: number }[],
  events: CollectionEvent[],
  now = Date.now(),
): MeasuredPortfolio | null {
  const recent = events.filter((e) => e.at >= now - MEASURE_WINDOW_DAYS * 86_400_000 && e.at <= now).sort((a, b) => a.at - b.at);
  const all = recent.filter((e) => e.key === null);
  if (all.length < 2) return null;
  const spanHours = (all[all.length - 1].at - all[0].at) / 3_600_000;
  if (spanHours < MIN_MEASURED_SPAN_HOURS) return null;

  const byKey = new Map<string, MeasuredProperty>();
  for (const p of properties) {
    const resets = recent.filter((e) => e.key === null || e.key === p.key).map((e) => e.at);
    let net = 0;
    let lost = 0;
    for (let i = 1; i < resets.length; i++) {
      const earned = (p.hourly * (resets[i] - resets[i - 1])) / 3_600_000;
      net += Math.min(earned, p.cap);
      lost += Math.max(0, earned - p.cap);
    }
    const hours = (resets[resets.length - 1] - resets[0]) / 3_600_000;
    if (hours > 0) byKey.set(p.key, { netDaily: (net / hours) * 24, lostDaily: (lost / hours) * 24 });
  }

  // Each local day's longest gap (by when the gap ended), then the upper
  // quartile.
  const longestByDay = new Map<string, number>();
  for (let i = 1; i < all.length; i++) {
    const gap = (all[i].at - all[i - 1].at) / 3_600_000;
    const day = new Date(all[i].at).toDateString();
    longestByDay.set(day, Math.max(longestByDay.get(day) ?? 0, gap));
  }
  const longest = [...longestByDay.values()].sort((a, b) => a - b);
  const usualLongestGapHours = longest[Math.min(longest.length - 1, Math.floor(longest.length * 0.75))];

  return { byKey, spanHours, collections: all.length, usualLongestGapHours };
}

// ---------------------------------------------------------------------------
// Plan: what buying and upgrading a property you don't own yet would take
// ---------------------------------------------------------------------------

/** The first upgrade of each track costs the property's price divided by
 *  these, and every level after costs one more of that step (`k × n`, as
 *  above). Exact for all six properties upgraded so far (Industrial Machine
 *  Shop, Foundry Logistics Yard, Arms Pawn Broker, Arms Black Market,
 *  Underground Fight Club and Speakeasy, 2026-08-29 → 09-20): e.g. Fight
 *  Club, $78.75M, first Revenue step $1,636,364, first Vault step
 *  $1,022,727. So maxing Revenue costs 55/48.125 ≈ 114% of the price, and
 *  maxing Vault 55/77 ≈ 71%. */
export const REVENUE_STEP_DIVISOR = 48.125;
export const VAULT_STEP_DIVISOR = 77;

export interface PropertyPlan {
  price: number;
  /** Revenue L1 → L11. */
  revenueCost: number;
  /** Lowest Vault level that holds `cadenceHours` at max Revenue. */
  vaultLevel: number;
  vaultCost: number;
  total: number;
  /** Hourly income at max Revenue, with the player's income bonus. */
  hourly: number;
  daily: number;
  /** How long the chosen vault holds at that income. */
  vaultHours: number;
  paybackDays: number;
}

/** `baseHourly` / `baseVault` are the level-1 values an unowned card shows;
 *  `bonusPct` the player's income bonus (the "+19.75%" on owned cards). */
export function planProperty(price: number, baseHourly: number, baseVault: number, bonusPct: number, cadenceHours: number): PropertyPlan {
  const revenueCost = costBetweenLevels(price / REVENUE_STEP_DIVISOR, 1, MAX_LEVEL);
  const hourly = valueAtLevel(baseHourly, MAX_LEVEL) * (1 + bonusPct / 100);
  let vaultLevel = 1;
  while (vaultLevel < MAX_LEVEL && valueAtLevel(baseVault, vaultLevel) < hourly * cadenceHours) vaultLevel += 1;
  const vaultCost = costBetweenLevels(price / VAULT_STEP_DIVISOR, 1, vaultLevel);
  const total = price + revenueCost + vaultCost;
  const vaultHours = valueAtLevel(baseVault, vaultLevel) / hourly;
  // A vault that can't hold a full cadence earns only what it holds.
  const daily = Math.min(hourly * cadenceHours, valueAtLevel(baseVault, vaultLevel)) * (24 / cadenceHours);
  return { price, revenueCost, vaultLevel, vaultCost, total, hourly, daily, vaultHours, paybackDays: total / daily };
}
