import type { StreetIntelAutoConfig } from './types';

type RiskTier = 'low' | 'medium' | 'high' | 'extreme';

/** The minimum card value in force for a card of this risk: `minCardValue`,
 *  raised to `extremeMinValue` for extreme cards while that rule is on.
 *  Shared by the auto-runner and the Analytics tab's supply numbers, so the
 *  board supply it reports is exactly what the runner would take. */
export function cardMinimumFor(riskTier: RiskTier, config: Pick<StreetIntelAutoConfig, 'minCardValue' | 'extremeMinEnabled' | 'extremeMinValue'>): number {
  if (riskTier === 'extreme' && config.extremeMinEnabled) return Math.max(config.minCardValue, config.extremeMinValue);
  return config.minCardValue;
}

/** Whether either rule can hold a card back at all. */
export function hasCardMinimum(config: Pick<StreetIntelAutoConfig, 'minCardValue' | 'extremeMinEnabled'>): boolean {
  return config.minCardValue > 0 || config.extremeMinEnabled;
}
