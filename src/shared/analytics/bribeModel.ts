import type { CustomsEvent } from '@/shared/types';

export type BribeRateSource = 'observed' | 'fallback';

export interface BribeRate {
  /** Fraction of cargo purchase value a customs stop costs, e.g. 0.25. */
  rate: number;
  source: BribeRateSource;
}

/**
 * What a fresh install assumes until it has seen a stop of its own.
 *
 * 0.25 is not a guess: every bribe on record has come to exactly 25% of the cargo's
 * purchase value — 67 of 67 events at 0.250, minimum and maximum identical, across
 * cargo values from $60,000 to $176,000. It is kept as a starting value rather than a
 * hard-coded rule so a game-side change to the rate corrects itself from real events
 * instead of being frozen here.
 */
export const FALLBACK_BRIBE_RATE = 0.25;

/**
 * Measures the bribe rate from events that actually recorded both a payment and the
 * cargo value it was charged against.
 *
 * The rate matters rather than the average payment: a bribe is a proportion of what's
 * in the hold, so averaging past *amounts* charges the same flat toll to a cheap load
 * and an expensive one — which flattered expensive cargo by tens of thousands, exactly
 * where an expected-value model should be most cautious.
 */
export function bribeRateFrom(events: CustomsEvent[]): BribeRate {
  const usable = events.filter(
    (c): c is CustomsEvent & { cargoValue: number } =>
      c.resolution === 'bribe' && typeof c.cargoValue === 'number' && c.cargoValue > 0,
  );

  if (usable.length === 0) return { rate: FALLBACK_BRIBE_RATE, source: 'fallback' };

  const rate = usable.reduce((sum, c) => sum + c.bribe / c.cargoValue, 0) / usable.length;
  return { rate, source: 'observed' };
}
