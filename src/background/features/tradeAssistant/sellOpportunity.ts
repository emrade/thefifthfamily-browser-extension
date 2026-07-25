import { notify } from '@/shared/notify';
import { findOpenTrade } from './tradeMatcher';
import type { SmugglingListing } from '@/shared/types';

/**
 * Checked after every background market poll (marketPoller.ts) — tells the player
 * when cargo they're holding is currently profitable to sell at the current
 * district's price, since they may have landed somewhere the price wasn't worth
 * selling at yet and are waiting for the next market shift.
 *
 * The held item and its current price both come straight from the listing we just
 * fetched, not from any separately-tracked context — `entries.find(stash > 0)` *is*
 * the held item, confirmed fresh at this exact poll.
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
  if (!openTrade) return; // no cost basis on record — nothing to compare against

  const estimatedProfit = held.price * held.stash - openTrade.buyPrice;
  if (estimatedProfit <= 0) return;

  const roiPct = openTrade.buyPrice > 0 ? (estimatedProfit / openTrade.buyPrice) * 100 : null;
  const roiSuffix = roiPct !== null ? ` (${roiPct.toFixed(0)}%)` : '';

  await notify('sellOpportunity', {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'Sell opportunity',
    message: `${held.item} is now worth selling in ${district} — an estimated $${estimatedProfit.toLocaleString()}${roiSuffix} profit.`,
  });
}
