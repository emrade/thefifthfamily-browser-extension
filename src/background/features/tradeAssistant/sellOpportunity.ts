import { notify } from '@/shared/notify';
import { LOG_PREFIX } from '@/shared/log';
import { findOpenTrade, tripCostsSince } from './tradeMatcher';
import type { SmugglingListing } from '@/shared/types';

/**
 * Checked after every background market poll (marketPoller.ts) — tells the player
 * when cargo they're holding is currently profitable to sell at the current
 * district's price, since they may have landed somewhere the price wasn't worth
 * selling at yet and are waiting for the next market shift.
 *
 * The held item, its current price, and the quantity in the hold all come straight
 * from the listing we just fetched, not from any separately-tracked context —
 * `entries.find(stash > 0)` *is* the held item, confirmed fresh at this exact poll.
 *
 * Fires every cycle it's profitable, not just once per holding period — a shift from
 * 3% to 19% profit is worth knowing about even though both are "profitable," and the
 * player can just disable this notification in Settings if it turns out too chatty
 * rather than the extension guessing at a magnitude threshold on their behalf.
 */
export async function checkSellOpportunity(result: SmugglingListing, district: string): Promise<void> {
  const held = result.entries.find((e) => e.stash > 0);
  if (!held) return;

  const openTrade = await findOpenTrade(held.item);
  // Without a recorded cost basis there is no profit to speak of — a trade whose buy
  // price never resolved (buyPrice 0) would otherwise report the entire sale value as
  // pure profit, which is worse than staying quiet.
  if (!openTrade || openTrade.buyPrice <= 0 || openTrade.quantity <= 0) return;

  // Price the units actually sitting in the hold *right now*, rather than trusting the
  // quantity frozen on the trade record. The two should agree; when they didn't, the
  // old arithmetic (`revenue - openTrade.buyPrice`) divided revenue for every held unit
  // by the cost of only some of them and reported the shortfall as profit — a 31-unit
  // hold recorded as 20 announced +80% on a real +16% position, and announced a profit
  // at all at prices where the player was genuinely underwater.
  const unitCost = openTrade.buyPrice / openTrade.quantity;
  if (held.stash !== openTrade.quantity) {
    console.error(
      LOG_PREFIX,
      `held stash (${held.stash}) disagrees with recorded quantity (${openTrade.quantity}) for ${held.item} — ` +
        `estimating against ${held.stash} units at the recorded $${Math.round(unitCost).toLocaleString()}/unit`,
    );
  }

  // Real costs already sunk into this trip. The recorded ROI at close-out subtracts
  // these (see closeTrade), so an estimate that ignored them was structurally rosier
  // than the number the same trade would eventually be logged with.
  const { travelCost, bribeTotal } = await tripCostsSince(openTrade.buyTime, Date.now());
  const costBasis = unitCost * held.stash + travelCost + bribeTotal;

  const estimatedProfit = held.price * held.stash - costBasis;
  if (estimatedProfit <= 0) return;

  const roiPct = costBasis > 0 ? (estimatedProfit / costBasis) * 100 : null;
  const roiSuffix = roiPct !== null ? ` (${roiPct.toFixed(0)}%)` : '';

  await notify('sellOpportunity', {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'Sell opportunity',
    message: `${held.item} is now worth selling in ${district} — an estimated $${Math.round(estimatedProfit).toLocaleString()}${roiSuffix} profit.`,
  });
}
