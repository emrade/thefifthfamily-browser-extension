import { db } from '@/shared/db';
import { storage } from '@/shared/storage';
import { estimateRiskForFullness, type RiskSource } from './riskModel';

export interface CustomsCalculatorResult {
  quantity: number;
  cargoValue: number;
  riskPct: number;
  riskSource: RiskSource;
  expectedProfit: number;
  expectedBribe: number;
  expectedEV: number;
}

// Only one bribe/cargo-value pair has ever been captured (44,000 on ~176,000 cargo,
// i.e. 25%) — used only until the account has its own bribe history to average.
const FALLBACK_BRIBE_RATIO = 0.25;

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

  const bribed = customsEvents.filter((c) => c.resolution === 'bribe' && c.cargoValue && c.cargoValue > 0);
  const bribeRatio = bribed.length > 0
    ? bribed.reduce((sum, c) => sum + c.bribe / (c.cargoValue as number), 0) / bribed.length
    : FALLBACK_BRIBE_RATIO;
  const expectedBribe = bribeRatio * cargoValue;

  const expectedEV = expectedProfit - (riskPct / 100) * expectedBribe;

  return { quantity, cargoValue, riskPct, riskSource: source, expectedProfit, expectedBribe, expectedEV };
}
