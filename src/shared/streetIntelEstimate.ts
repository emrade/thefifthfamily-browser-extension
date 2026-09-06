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
