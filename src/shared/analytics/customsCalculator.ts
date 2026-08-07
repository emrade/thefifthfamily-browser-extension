import { db } from '@/shared/db';
import { storage } from '@/shared/storage';
import { estimateRiskForFullness, type RiskSource } from './riskModel';
import { bribeRateFrom, type BribeRateSource } from './bribeModel';

export interface CustomsCalculatorResult {
  quantity: number;
  cargoValue: number;
  riskPct: number;
  riskSource: RiskSource;
  /** Tracked separately from `riskSource`: the two are measured from different tables
   * and one can be a real observation while the other is still a default. */
  bribeSource: BribeRateSource;
  expectedProfit: number;
  expectedBribe: number;
  expectedEV: number;
}

/**
 * Merges the PRD's "Bribe Predictor" and "Customs Calculator" into one tool — both
 * take an item + quantity and both output numbers about the same hypothetical
 * customs stop, so showing risk/profit/EV/bribe together avoids two near-duplicate
 * sliders asking for the same input.
 */
export async function computeCustomsCalculator(item: string, quantity: number): Promise<CustomsCalculatorResult | null> {
  const [priceSnapshots, customsEvents, ctx] = await Promise.all([
    db.priceSnapshots.where('item').equals(item).toArray(),
    db.customsEvents.toArray(),
    storage.getSmugglingContext(),
  ]);
  if (priceSnapshots.length === 0) return null;

  const latestOfType = (type: 'buy' | 'sell') =>
    priceSnapshots.filter((p) => p.type === type).sort((a, b) => b.timestamp - a.timestamp)[0];
  const buyEntry = latestOfType('buy');
  const sellEntry = latestOfType('sell');

  const unitValue = buyEntry?.price ?? sellEntry?.price ?? 0;
  const cargoValue = unitValue * quantity;

  const cargoCapacity = ctx?.cargoCapacity && ctx.cargoCapacity > 0 ? ctx.cargoCapacity : 20;
  const fullnessPct = Math.min(100, (quantity / cargoCapacity) * 100);
  const { riskPct, source } = await estimateRiskForFullness(fullnessPct);

  const buyUnit = buyEntry?.price ?? unitValue;
  const sellUnit = sellEntry?.price ?? unitValue;
  const expectedProfit = (sellUnit - buyUnit) * quantity;

  const { rate: bribeRate, source: bribeSource } = bribeRateFrom(customsEvents);
  const expectedBribe = bribeRate * cargoValue;

  const expectedEV = expectedProfit - (riskPct / 100) * expectedBribe;

  return { quantity, cargoValue, riskPct, riskSource: source, bribeSource, expectedProfit, expectedBribe, expectedEV };
}
