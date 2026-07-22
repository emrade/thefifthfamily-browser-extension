import { db } from '@/shared/db';
import { storage } from '@/shared/storage';
import type { PriceSnapshot } from '@/shared/types';

export interface BestTradeRecommendation {
  item: string;
  buyDistrict: string;
  sellDistrict: string;
  buyPrice: number;
  sellPrice: number;
  quantity: number;
  expectedProfit: number;
  expectedRiskPct: number;
  expectedEV: number;
  /** 'observed' once we have enough of the player's own customs history for this
   * item (5+ encounters) to trust over the game's displayed gauge; 'displayed'
   * otherwise — mirrors the PRD's "actual catch rate vs. displayed risk" framing. */
  riskSource: 'observed' | 'displayed';
}

const MIN_OBSERVATIONS_FOR_TRUSTED_RISK = 5;
const FALLBACK_BRIBE_RATE = 0.15; // used only until the player has any bribe history at all

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
 * Recommends the single best known buy/sell pair from prices we've actually observed.
 * Assumes the player would bribe through any customs stop (matches what they've said
 * they actually do) — so the risk-adjustment cost is "average bribe paid so far",
 * not "lose the whole shipment", which would be true only for a run/surrender
 * strategy. EV = expected gross profit minus (catch rate × average bribe cost).
 */
export async function computeBestTrade(): Promise<BestTradeRecommendation | null> {
  const [districts, priceSnapshots, customsEvents, ctx] = await Promise.all([
    db.districts.toArray(),
    db.priceSnapshots.toArray(),
    db.customsEvents.toArray(),
    storage.getSmugglingContext(),
  ]);

  if (priceSnapshots.length === 0) return null;

  const latest = latestByKey(priceSnapshots);
  const items = Array.from(new Set(priceSnapshots.map((p) => p.item)));
  const quantity = ctx?.cargoCapacity && ctx.cargoCapacity > 0 ? ctx.cargoCapacity : 20;

  const bribed = customsEvents.filter((c) => c.resolution === 'bribe');
  const avgBribeObserved = bribed.length > 0 ? bribed.reduce((sum, c) => sum + c.bribe, 0) / bribed.length : null;

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

    const buyTotal = buyEntry.price * quantity;
    const sellTotal = bestSell.price * quantity;
    const expectedProfit = sellTotal - buyTotal;

    const itemCustoms = customsEvents.filter((c) => c.item === item);
    const observedRisk = itemCustoms.length >= MIN_OBSERVATIONS_FOR_TRUSTED_RISK
      ? (itemCustoms.filter((c) => c.caught).length / itemCustoms.length) * 100
      : null;
    const riskPct = observedRisk ?? ctx?.borderSeizureRisk ?? 50;

    const avgBribe = avgBribeObserved ?? buyTotal * FALLBACK_BRIBE_RATE;
    const expectedEV = expectedProfit - (riskPct / 100) * avgBribe;

    if (!best || expectedEV > best.expectedEV) {
      best = {
        item,
        buyDistrict: originDistrict.name,
        sellDistrict: bestSell.district,
        buyPrice: buyEntry.price,
        sellPrice: bestSell.price,
        quantity,
        expectedProfit,
        expectedRiskPct: riskPct,
        expectedEV,
        riskSource: observedRisk !== null ? 'observed' : 'displayed',
      };
    }
  }

  return best;
}
