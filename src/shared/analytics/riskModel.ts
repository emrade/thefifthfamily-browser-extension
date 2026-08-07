import { db } from '@/shared/db';
import type { RiskObservation } from '@/shared/types';

export type RiskSource = 'observed-curve' | 'single-reading' | 'fallback';

export interface RiskEstimate {
  riskPct: number;
  source: RiskSource;
}

/**
 * A reusable estimator, so a caller sweeping many hypothetical loads (see
 * bestTrade.ts, which prices every quantity from 1 to capacity) pays for one read of
 * the observation table rather than one per candidate.
 */
export interface RiskCurve {
  source: RiskSource;
  /** Displayed "Border Seizure Risk" % for a given cargo fullness % (0–100). */
  at(fullnessPct: number): number;
}

const MIN_OBSERVATIONS_FOR_CURVE = 3;
const FALLBACK_RISK_PCT = 50;

/**
 * Fits risk as a straight line in cargo fullness by least squares.
 *
 * This replaced averaging the k nearest observations, which was fine for looking up a
 * single load but wrong for comparing many: it returns a piecewise-constant step
 * function, so a sweep across quantities produced a lumpy expected-value curve whose
 * maximum could land on an artefact of the steps rather than the real optimum. It also
 * could not extrapolate — every estimate was pinned inside the range of fullness levels
 * already seen.
 *
 * A line is the right shape for this data rather than a convenient approximation: over
 * 1,427 real readings the fit lands on `4.97 + 0.4475 × fullness` with R² = 0.9998,
 * the residuals being only the game flooring what it displays (83.3% full shows "42%",
 * not 42.5%). Still derived rather than hard-coded, so a game-side change to the rule
 * corrects itself here instead of silently disagreeing with a frozen constant.
 */
function fitCurve(observations: RiskObservation[]): { slope: number; intercept: number } | null {
  const n = observations.length;
  if (n < MIN_OBSERVATIONS_FOR_CURVE) return null;

  const meanX = observations.reduce((sum, o) => sum + o.fullnessPct, 0) / n;
  const meanY = observations.reduce((sum, o) => sum + o.riskPct, 0) / n;

  // Zero spread in fullness means every reading was taken at the same load — there's
  // no slope to recover from it, however many readings there are.
  const varianceX = observations.reduce((sum, o) => sum + (o.fullnessPct - meanX) ** 2, 0);
  if (varianceX === 0) return null;

  const covariance = observations.reduce((sum, o) => sum + (o.fullnessPct - meanX) * (o.riskPct - meanY), 0);
  const slope = covariance / varianceX;

  return { slope, intercept: meanY - slope * meanX };
}

/**
 * Builds a risk estimator from this account's own (fullness, risk) readings — every
 * smuggling panel view is one data point, whether or not anything was held at the time.
 * Deliberately not the community-sourced formula from the plan doc, which didn't match
 * our own first captured reading.
 */
export async function loadRiskCurve(): Promise<RiskCurve> {
  const observations = await db.riskObservations.toArray();

  const fit = fitCurve(observations);
  if (fit) {
    return {
      source: 'observed-curve',
      at: (fullnessPct) => clampPct(fit.intercept + fit.slope * fullnessPct),
    };
  }

  if (observations.length > 0) {
    // Not enough spread to fit anything — the most recent reading is still a better
    // guess than a blind default, even though it can't respond to fullness.
    const latest = observations.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
    return { source: 'single-reading', at: () => clampPct(latest.riskPct) };
  }

  return { source: 'fallback', at: () => FALLBACK_RISK_PCT };
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export async function estimateRiskForFullness(fullnessPct: number): Promise<RiskEstimate> {
  const curve = await loadRiskCurve();
  return { riskPct: curve.at(fullnessPct), source: curve.source };
}
