import { storage } from '@/shared/storage';
import { notify } from '@/shared/notify';
import { findOpenTrade } from './tradeMatcher';
import type { SmugglingListing } from '@/shared/types';

/**
 * Checked after every background market poll (marketPoller.ts) — tells the player
 * when cargo they're holding has become profitable to sell at the current district's
 * price, since they may have landed somewhere the price wasn't worth selling at yet
 * and are waiting for the next market shift.
 *
 * The held item and its current price both come straight from the listing we just
 * fetched, not from any separately-tracked context — `entries.find(stash > 0)` *is*
 * the held item, confirmed fresh at this exact poll.
 *
 * Tracks the profitable/not-profitable *transition*, not just "have we ever notified
 * for this item" — price can dip back below cost and later recover while the same
 * cargo is still held (it shifts every cycle, it doesn't just climb monotonically),
 * and each new rise above cost is worth a fresh notification, not just the first one
 * ever seen for this holding period.
 */
export async function checkSellOpportunity(result: SmugglingListing, district: string): Promise<void> {
  const held = result.entries.find((e) => e.stash > 0);

  if (!held) {
    // Not holding anything (sold, lost, or never bought) — clear the tracked state so
    // the next time something is held, it starts fresh.
    await storage.clearSellAlertState();
    return;
  }

  const openTrade = await findOpenTrade(held.item);
  if (!openTrade) return; // no cost basis on record — nothing to compare against

  const estimatedProfit = held.price * held.stash - openTrade.buyPrice;
  const isProfitable = estimatedProfit > 0;

  const previous = await storage.getSellAlertState();
  // A different item than last checked means a new holding period started (sold,
  // then bought something else) — treat it as never having been profitable before.
  const wasProfitable = previous?.item === held.item && previous.wasProfitable;

  if (isProfitable && !wasProfitable) {
    await notify('sellOpportunity', {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'Sell opportunity',
      message: `${held.item} is now worth selling in ${district} — an estimated $${estimatedProfit.toLocaleString()} profit.`,
    });
  }

  await storage.setSellAlertState({ item: held.item, wasProfitable: isProfitable });
}
