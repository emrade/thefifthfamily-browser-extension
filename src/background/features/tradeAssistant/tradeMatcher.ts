import { db } from '@/shared/db';
import { storage } from '@/shared/storage';
import { LOG_PREFIX } from '@/shared/log';

export async function latestPrice(item: string, atOrBefore: number, district?: string, type?: 'buy' | 'sell'): Promise<number | null> {
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

/** Ordered by primary key (insertion order) — a reasonable proxy for "most recently
 * opened" since only one item can be held at a time, so there should only ever be
 * one open trade for a given item anyway. */
export async function findOpenTrade(item: string) {
  return db.trades
    .where('item')
    .equals(item)
    .filter((t) => t.status === 'open')
    .last();
}

/**
 * A stacked network hook re-posts the *same* physical request once per stacked layer,
 * all within the same event-loop cascade once the response resolves (see
 * mainWorldHook.ts's install guard — a single bribe was once recorded 6 times this
 * way). A genuine second purchase needs a fresh click plus a full server round trip,
 * so it cannot land anywhere near this fast.
 *
 * Deliberately tight. Mistaking a real buy for a duplicate undercounts the cost basis
 * and *overstates* profit — the exact failure this whole path exists to prevent —
 * whereas the opposite error merely understates it. When in doubt, count it.
 */
const DUPLICATE_BUY_WINDOW_MS = 1_000;

/**
 * Sums the real per-trip costs incurred between a trade's buy and some later moment.
 * Shared by trade close-out and the sell-opportunity estimate so a "profit" figure
 * means the same thing everywhere — an estimate that ignored these while the recorded
 * ROI subtracted them made the two disagree on the same trade by design.
 */
export async function tripCostsSince(buyTime: number, timestamp: number) {
  const legs = await db.travelLegs.where('timestamp').between(buyTime, timestamp, true, true).toArray();
  const travelCost = legs.reduce((sum, leg) => sum + (leg.method === 'taxi' ? leg.cost : 0), 0);

  const customsInWindow = await db.customsEvents.where('timestamp').between(buyTime, timestamp, true, true).toArray();
  const bribeEvents = customsInWindow.filter((c) => c.resolution === 'bribe');
  const bribeTotal = bribeEvents.reduce((sum, c) => sum + c.bribe, 0);

  return { travelCost, bribeTotal, bribeCount: bribeEvents.length };
}

export async function openTrade(item: string, quantity: number, timestamp: number) {
  const stats = await storage.getLatestStats();
  const buyDistrict = stats?.currentDistrict ?? 'Unknown';
  const unitPrice = await latestPrice(item, timestamp, buyDistrict, 'buy');
  const legCost = (unitPrice ?? 0) * quantity;

  // A second captured buy for an item that already has an open trade must never create
  // a second concurrent one — under normal play there's only ever one trade in flight
  // per item, and a phantom second trade could later be mistaken for the real one,
  // fabricating a bogus completed trade from an already-accounted-for buy.
  const existing = await findOpenTrade(item);
  if (existing?.id) {
    const isRepost =
      existing.lastBuyTime !== undefined &&
      existing.lastBuyQuantity === quantity &&
      timestamp - existing.lastBuyTime < DUPLICATE_BUY_WINDOW_MS;

    if (isRepost) {
      console.error(LOG_PREFIX, `duplicate trade-buy captured for ${item} — ignoring`);
      return;
    }

    // Not a repost: a real top-up filling the rest of the hold. Dropping these (as
    // this branch used to, unconditionally) left `quantity`/`buyPrice` covering only
    // the first leg while the panel's stash counted every unit — so revenue for the
    // whole hold got divided by the cost of part of it and the shortfall was reported
    // as profit. A 31-unit hold priced as 20 read as +80% on a real +16% position.
    await db.trades.update(existing.id, {
      quantity: existing.quantity + quantity,
      buyPrice: existing.buyPrice + legCost,
      lastBuyTime: timestamp,
      lastBuyQuantity: quantity,
    });
    return;
  }

  await db.trades.add({
    item,
    quantity,
    buyDistrict,
    sellDistrict: null,
    buyPrice: legCost,
    sellPrice: null,
    buyTime: timestamp,
    lastBuyTime: timestamp,
    lastBuyQuantity: quantity,
    sellTime: null,
    travelCost: 0,
    grossProfit: null,
    profit: null,
    roi: null,
    caught: null,
    bribe: 0,
    bribeCount: 0,
    status: 'open',
    reconciled: false,
  });
}

export async function closeTrade(item: string, quantity: number, sellTotal: number, grossProfit: number, timestamp: number) {
  const stats = await storage.getLatestStats();
  const sellDistrict = stats?.currentDistrict ?? 'Unknown';

  const open = await findOpenTrade(item);

  if (!open?.id) {
    // A duplicate delivery of the same real trade-sell message would land here too —
    // the first delivery already closed the matching open trade, so a second one
    // finds nothing 'open' and would otherwise fall into this same fallback and
    // double the trade. An identical standalone closed trade (same item/sellTime/
    // sellTotal) already existing means that's exactly what's happening — skip it
    // rather than recording the same real sell twice.
    const duplicate = await db.trades
      .where('item')
      .equals(item)
      .filter((t) => t.status === 'closed' && t.sellTime === timestamp && t.sellPrice === sellTotal)
      .first();
    if (duplicate) {
      console.error(LOG_PREFIX, `duplicate trade-sell captured for ${item} — ignoring`);
      return;
    }

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
      bribeCount: 0,
      status: 'closed',
      reconciled: false,
    });
    return;
  }

  const { travelCost, bribeTotal, bribeCount } = await tripCostsSince(open.buyTime, timestamp);

  const profit = grossProfit - travelCost - bribeTotal;
  const costBasis = open.buyPrice + travelCost + bribeTotal;
  const roi = costBasis > 0 ? profit / costBasis : null;

  await db.trades.update(open.id, {
    sellDistrict,
    sellPrice: sellTotal,
    sellTime: timestamp,
    travelCost,
    bribe: bribeTotal,
    bribeCount,
    grossProfit,
    profit,
    roi,
    caught: false,
    status: 'closed',
  });
}

/**
 * Closes the open trade for `item` as a total loss — called when customs seizes the
 * cargo (a bribed stop keeps the goods and the trade stays open; a surrender or a
 * failed run does not). Without this, a lost-cargo trip would just sit `status: 'open'`
 * forever: no sell action ever fires for goods that no longer exist, so it would
 * silently vanish from Trips/profit history instead of counting as the loss it was.
 */
export async function closeTradeAsLoss(item: string, timestamp: number) {
  const open = await findOpenTrade(item);
  if (!open?.id) return;

  // A trade that ultimately ends in a loss may still have paid one or more bribes
  // earlier in its life (survived a stop, kept the cargo, then got caught/surrendered
  // later) — those were real costs of this same trip and should still count against
  // it. The resolution that caused *this* loss itself carries bribe: 0 (surrender and
  // a failed run never pay a bribe), so including it in the sum is harmless.
  const { travelCost, bribeTotal, bribeCount } = await tripCostsSince(open.buyTime, timestamp);

  const grossProfit = -open.buyPrice;
  const profit = grossProfit - travelCost - bribeTotal;
  const costBasis = open.buyPrice + travelCost + bribeTotal;

  await db.trades.update(open.id, {
    sellDistrict: null,
    sellPrice: 0,
    sellTime: timestamp,
    travelCost,
    bribe: bribeTotal,
    bribeCount,
    grossProfit,
    profit,
    roi: costBasis > 0 ? profit / costBasis : null,
    caught: true,
    status: 'closed',
  });
}
