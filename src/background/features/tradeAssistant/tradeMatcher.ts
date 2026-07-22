import { db } from '@/shared/db';
import { storage } from '@/shared/storage';

async function latestPrice(item: string, atOrBefore: number, district?: string, type?: 'buy' | 'sell'): Promise<number | null> {
  const rows = await db.priceSnapshots
    .where('item')
    .equals(item)
    .filter((r) => (district ? r.district === district : true) && (type ? r.type === type : true))
    .toArray();
  if (rows.length === 0) return null;

  const before = rows.filter((r) => r.timestamp <= atOrBefore).sort((a, b) => b.timestamp - a.timestamp)[0];
  const fallback = rows.sort((a, b) => b.timestamp - a.timestamp)[0];
  return (before ?? fallback).price;
}

export async function openTrade(item: string, quantity: number, timestamp: number) {
  const stats = await storage.getLatestStats();
  const buyDistrict = stats?.currentDistrict ?? 'Unknown';
  const unitPrice = await latestPrice(item, timestamp, buyDistrict, 'buy');

  await db.trades.add({
    item,
    quantity,
    buyDistrict,
    sellDistrict: null,
    buyPrice: (unitPrice ?? 0) * quantity,
    sellPrice: null,
    buyTime: timestamp,
    sellTime: null,
    travelCost: 0,
    grossProfit: null,
    profit: null,
    roi: null,
    caught: null,
    bribe: 0,
    status: 'open',
  });
}

export async function closeTrade(item: string, quantity: number, sellTotal: number, grossProfit: number, timestamp: number) {
  const stats = await storage.getLatestStats();
  const sellDistrict = stats?.currentDistrict ?? 'Unknown';

  // `.last()` orders by the auto-increment primary key, which tracks insertion order —
  // a reasonable proxy for "most recently opened" since only one item can be held at
  // a time, so there should only ever be one open trade for a given item anyway.
  const open = await db.trades
    .where('item')
    .equals(item)
    .filter((t) => t.status === 'open')
    .last();

  if (!open?.id) {
    // No matching buy on record (e.g. the extension was installed mid-session) —
    // still worth recording as a standalone closed trade rather than dropping it.
    await db.trades.add({
      item,
      quantity,
      buyDistrict: 'Unknown',
      sellDistrict,
      buyPrice: sellTotal - grossProfit,
      sellPrice: sellTotal,
      buyTime: timestamp,
      sellTime: timestamp,
      travelCost: 0,
      grossProfit,
      profit: grossProfit,
      roi: null,
      caught: null,
      bribe: 0,
      status: 'closed',
    });
    return;
  }

  const legs = await db.travelLegs.where('timestamp').between(open.buyTime, timestamp, true, true).toArray();
  const travelCost = legs.reduce((sum, leg) => sum + (leg.method === 'taxi' ? leg.cost : 0), 0);

  const customsInWindow = await db.customsEvents.where('timestamp').between(open.buyTime, timestamp, true, true).toArray();
  const bribeTotal = customsInWindow.filter((c) => c.resolution === 'bribe').reduce((sum, c) => sum + c.bribe, 0);

  const profit = grossProfit - travelCost - bribeTotal;
  const costBasis = open.buyPrice + travelCost + bribeTotal;
  const roi = costBasis > 0 ? profit / costBasis : null;

  await db.trades.update(open.id, {
    sellDistrict,
    sellPrice: sellTotal,
    sellTime: timestamp,
    travelCost,
    bribe: bribeTotal,
    grossProfit,
    profit,
    roi,
    status: 'closed',
  });
}
