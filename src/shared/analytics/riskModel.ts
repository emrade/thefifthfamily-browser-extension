import { db } from '@/shared/db';

export type RiskSource = 'observed-curve' | 'single-reading' | 'fallback';

export interface RiskEstimate {
  riskPct: number;
  source: RiskSource;
}

const MIN_OBSERVATIONS_FOR_CURVE = 3;
const NEIGHBORS_FOR_CURVE = 5;

/**
 * Estimates the game's displayed "Border Seizure Risk" for a given cargo fullness %,
 * from this account's own observed (fullness, risk) readings — every smuggling panel
 * view is one data point, regardless of whether anything was held at the time. This
 * is deliberately not the community-sourced formula from the plan doc, which didn't
 * match our own first captured data point; an account-specific curve built from real
 * readings is more trustworthy than a third party's reverse-engineering.
 */
export async function estimateRiskForFullness(fullnessPct: number): Promise<RiskEstimate> {
  const observations = await db.riskObservations.toArray();

  if (observations.length === 0) {
    return { riskPct: 50, source: 'fallback' };
  }

  if (observations.length < MIN_OBSERVATIONS_FOR_CURVE) {
    const latest = observations.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
    return { riskPct: latest.riskPct, source: 'single-reading' };
  }

  const k = Math.min(NEIGHBORS_FOR_CURVE, observations.length);
  const nearest = [...observations]
    .sort((a, b) => Math.abs(a.fullnessPct - fullnessPct) - Math.abs(b.fullnessPct - fullnessPct))
    .slice(0, k);
  const riskPct = nearest.reduce((sum, o) => sum + o.riskPct, 0) / nearest.length;

  return { riskPct, source: 'observed-curve' };
}
