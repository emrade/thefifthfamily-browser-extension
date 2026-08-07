import { db } from '@/shared/db';
import { storage } from '@/shared/storage';
import { loadRiskCurve, type RiskCurve } from './riskModel';
import { bribeRateFrom } from './bribeModel';
import type { PriceSnapshot } from '@/shared/types';

export interface BestTradeRecommendation {
  item: string;
  buyDistrict: string;
  sellDistrict: string;
  buyPrice: number;
  sellPrice: number;
  /** The EV-maximising load, which is not always a full hold — see pickBestQuantity. */
  quantity: number;
  /** Cargo capacity `quantity` was chosen against, so the UI can say "20 of 31" and
   * explain itself when it recommends travelling light. */
  capacity: number;
  expectedProfit: number;
  expectedRiskPct: number;
  expectedEV: number;
}

/**
 * Picks the load that maximises expected value, which is *not* simply "fill the hold".
 * Every extra unit earns one more margin, but it also raises the seizure risk applied
 * to the entire load — so past a point the added risk on everything already aboard
 * outweighs the margin on the one unit added.
 *
 * With the observed rules this gives a clean threshold: a full hold wins whenever the
 * markup clears roughly 20%, and below that a partial load is genuinely worth more.
 * Every quantity is scanned rather than solving for the maximum in closed form, so this
 * stays correct if the fitted risk curve ever stops being linear — and a hold is only
 * ever a few dozen units.
 */
function pickBestQuantity(margin: number, unitCost: number, capacity: number, risk: RiskCurve, bribeRate: number) {
  let best = { quantity: 1, expectedProfit: 0, expectedRiskPct: 0, expectedEV: -Infinity };

  for (let q = 1; q <= capacity; q++) {
    const riskPct = risk.at((q / capacity) * 100);
    const expectedProfit = margin * q;
    // Travel is deliberately not subtracted: it's a cost of the trip rather than of
    // the goods, and being near-constant it shifts every candidate equally anyway.
    const expectedEV = expectedProfit - (riskPct / 100) * bribeRate * unitCost * q;
    if (expectedEV > best.expectedEV) best = { quantity: q, expectedProfit, expectedRiskPct: riskPct, expectedEV };
  }

  return best;
}

function latestByKey(snapshots: PriceSnapshot[]): Map<string, PriceSnapshot> {
  const latest = new Map<string, PriceSnapshot>();
  for (const s of snapshots) {
    const key = `${s.item}|${s.district}|${s.type}`;
    const existing = latest.get(key);
    if (!existing || s.timestamp > existing.timestamp) latest.set(key, s);
  }
  return latest;
}

/**
 * Recommends the single best known buy/sell pair from prices we've actually observed,
 * along with how much of it to carry. Assumes the player bribes through any customs
 * stop (matches what they actually do) — so a stop costs BRIBE_RATE of the cargo's
 * value, not the whole shipment, which would only be true of a run/surrender strategy.
 *
 * EV = expected gross profit − (seizure risk × bribe cost).
 *
 * Risk comes from the shared fullness curve (riskModel.ts) rather than from customs
 * history. The history was previously consulted as "what fraction of my customs events
 * ended in `caught`" — but a player who bribes every time is never `caught`, so that
 * ratio sits at 0% forever and silently cancelled the entire risk term. Being *stopped*
 * is what costs money here, and its probability is what the fullness curve models.
 */
export async function computeBestTrade(): Promise<BestTradeRecommendation | null> {
  const [districts, priceSnapshots, customsEvents, ctx, risk] = await Promise.all([
    db.districts.toArray(),
    db.priceSnapshots.toArray(),
    db.customsEvents.toArray(),
    storage.getSmugglingContext(),
    loadRiskCurve(),
  ]);

  if (priceSnapshots.length === 0) return null;

  const latest = latestByKey(priceSnapshots);
  const items = Array.from(new Set(priceSnapshots.map((p) => p.item)));
  const capacity = ctx?.cargoCapacity && ctx.cargoCapacity > 0 ? ctx.cargoCapacity : 20;
  const { rate: bribeRate } = bribeRateFrom(customsEvents);

  let best: BestTradeRecommendation | null = null;

  for (const item of items) {
    const originDistrict = districts.find((d) => d.nativeItem === item);
    if (!originDistrict) continue;

    const buyEntry = latest.get(`${item}|${originDistrict.name}|buy`);
    if (!buyEntry) continue;

    let bestSell: { district: string; price: number } | null = null;
    for (const d of districts) {
      if (d.name === originDistrict.name) continue;
      const sellEntry = latest.get(`${item}|${d.name}|sell`);
      if (sellEntry && (!bestSell || sellEntry.price > bestSell.price)) {
        bestSell = { district: d.name, price: sellEntry.price };
      }
    }
    if (!bestSell) continue;

    // A load that loses money per unit can never be worth carrying, and skipping it
    // here keeps pickBestQuantity from having to return a "carry nothing" answer.
    const margin = bestSell.price - buyEntry.price;
    if (margin <= 0) continue;

    const load = pickBestQuantity(margin, buyEntry.price, capacity, risk, bribeRate);

    if (!best || load.expectedEV > best.expectedEV) {
      best = {
        item,
        buyDistrict: originDistrict.name,
        sellDistrict: bestSell.district,
        buyPrice: buyEntry.price,
        sellPrice: bestSell.price,
        capacity,
        ...load,
      };
    }
  }

  return best;
}
