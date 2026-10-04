/**
 * The game's exact server formula for Street Intel's `estimate_pct` —
 * reverse-engineered and verified to 100.0000% against 3,984 real historical
 * scout estimates (see docs/street-intel-estimate-calculation.md). Shared
 * between the content script (`pageHighlights.ts`, cosmetic "~NN% estimated"
 * labels for a human looking at the page) and the background auto-runner
 * (`actionRunner.ts`, the "computed" odds mode — see
 * docs/street-intel-partial-reveal.md) so both use the identical, already-
 * verified logic instead of two copies drifting apart.
 */

/** Sums every modifier that's shared across every approach on the same card
 *  at scouting time — excludes `stat` and `approach` (which vary per
 *  approach) and `env_stat` (which is stat-specific: it applies to whichever
 *  stat the *seed* approach used, not necessarily the hidden approach being
 *  estimated, and confirmed unrecoverable from `modifier_intel` text alone —
 *  see docs/street-intel-estimate-calculation.md's "Independent
 *  Verification" section). Left out entirely (equivalent to assuming 0)
 *  rather than guessed. */
export function sumSharedModifiers(modifiers: Record<string, number>): number {
  let sum = 0;
  for (const [key, value] of Object.entries(modifiers)) {
    if (key === 'stat' || key === 'approach' || key === 'env_stat') continue;
    sum += value;
  }
  return sum;
}

export interface HiddenApproachEstimateInput {
  bonus: number;
  autofail: boolean;
}

/** `env_stat` defaulted to 0 (see `sumSharedModifiers`) is this function's
 *  only source of error against the real server value — worst case ~3
 *  points, 90.8% exact on real historical data. */
export function computeEstimate(basePct: number, sharedMods: number, hidden: HiddenApproachEstimateInput, rawStat: number): number {
  if (hidden.autofail) return 0;
  const raw = basePct * (1 + (sharedMods + rawStat / 5) / 100) + hidden.bonus;
  return Math.max(0, Math.min(95, Math.round(raw)));
}

/** Highest `base_pct` ever seen per risk tier, across every scout in every
 *  archive through 2026-10-04 (~12.6k scouts; legendary extreme reached 23,
 *  the only tier where legendary exceeded the non-legendary max). */
const BASE_PCT_MAX: Record<'low' | 'medium' | 'high' | 'extreme', number> = { low: 61, medium: 46, high: 33, extreme: 23 };

/** Highest value ever seen for the two shared modifiers that vary from card
 *  to card rather than per player — `upperBoundSharedMods` swaps these in. */
const RANK_MAX = 12;
const ENV_GLOBAL_MAX = 8;
const ENV_STAT_MAX = 5;

/** Fallback shared-modifier ceiling before any scout this cycle has revealed
 *  real modifiers: rank 12 + prestige 10 + mastery 12 + collection 4.5 +
 *  recon 19.5 + env_global 8 — every one the max ever observed for this
 *  account. `temporary` (a buff, up to +30) is deliberately not in here;
 *  `upperBoundSharedMods` picks it up from a real scout once one exists. */
export const DEFAULT_SHARED_MODS_UPPER_BOUND = RANK_MAX + 10 + 12 + 4.5 + 19.5 + ENV_GLOBAL_MAX;

/** Turns one real scout's modifiers into a shared-modifier ceiling valid for
 *  *any* card this cycle: keeps the player-level ones as they really are
 *  (prestige, mastery, collection, recon, any active `temporary` buff) and
 *  replaces the card-specific ones (`rank`, `env_global`) with their maxima. */
export function upperBoundSharedMods(modifiers: Record<string, number>): number {
  let sum = 0;
  for (const [key, value] of Object.entries(modifiers)) {
    if (key === 'stat' || key === 'approach' || key === 'env_stat' || key === 'rank' || key === 'env_global') continue;
    sum += value;
  }
  return sum + RANK_MAX + ENV_GLOBAL_MAX;
}

/**
 * Best odds a card could *possibly* show once scouted, computed before
 * scouting it — everything in `computeEstimate` is known pre-scout except
 * `base_pct` (bounded by risk tier) and the card-specific modifiers (bounded
 * by `sharedModsUpperBound`). Only 7 of 7,645 real cards ever scouted above
 * this bound; being wrong only ever costs a missed opportunity (smart
 * scouting stops a little early), never a bad attempt.
 */
export function upperBoundEstimate(
  riskTier: 'low' | 'medium' | 'high' | 'extreme',
  approaches: { stat: string; bonus: number; autofail: boolean }[],
  rawStats: Record<string, number>,
  sharedModsUpperBound: number,
): number {
  let best = 0;
  for (const a of approaches) {
    if (a.autofail) continue;
    const raw = BASE_PCT_MAX[riskTier] * (1 + (sharedModsUpperBound + (rawStats[a.stat] ?? 0) / 5 + ENV_STAT_MAX) / 100) + a.bonus;
    best = Math.max(best, Math.min(95, Math.round(raw)));
  }
  return best;
}
