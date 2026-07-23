import { db } from '@/shared/db';

export interface HeatmapEntry {
  district: string;
  price: number;
  isOrigin: boolean;
  /** 0–1, normalized within the observed sell-price range for this item. Origin
   * tiles aren't part of the red↔green scale (they're the reference/buy price, not
   * a sell option), so their intensity is unused. */
  intensity: number;
}

export async function listKnownItems(): Promise<string[]> {
  const rows = await db.priceSnapshots.toArray();
  return Array.from(new Set(rows.map((r) => r.item))).sort();
}

export async function computeHeatmap(item: string): Promise<HeatmapEntry[]> {
  const [districts, priceSnapshots] = await Promise.all([
    db.districts.toArray(),
    db.priceSnapshots.where('item').equals(item).toArray(),
  ]);

  const origin = districts.find((d) => d.nativeItem === item);
  const entries: HeatmapEntry[] = [];

  if (origin) {
    const originBuy = priceSnapshots
      .filter((p) => p.district === origin.name && p.type === 'buy')
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (originBuy) entries.push({ district: origin.name, price: originBuy.price, isOrigin: true, intensity: 0 });
  }

  const latestSellSnapshots = new Map<string, { price: number; timestamp: number }>();
  for (const p of priceSnapshots) {
    if (p.type !== 'sell') continue;
    const existing = latestSellSnapshots.get(p.district);
    if (!existing || p.timestamp > existing.timestamp) {
      latestSellSnapshots.set(p.district, { price: p.price, timestamp: p.timestamp });
    }
  }

  const sellPrices = Array.from(latestSellSnapshots.values()).map((v) => v.price);
  const min = Math.min(...sellPrices);
  const max = Math.max(...sellPrices);

  for (const [district, { price }] of latestSellSnapshots) {
    const intensity = max > min ? (price - min) / (max - min) : 0.5;
    entries.push({ district, price, isOrigin: false, intensity });
  }

  return entries;
}
