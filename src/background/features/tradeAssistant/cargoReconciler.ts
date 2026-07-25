import { db } from '@/shared/db';
import { findOpenTrade, latestPrice } from './tradeMatcher';
import type { LastSmugglingContext, SmugglingListing } from '@/shared/types';

/**
 * Reconciles held-cargo state across whatever the player did *outside* this
 * extension's view — most commonly the game's mobile app, which the extension has
 * no way to observe (a browser extension can only see network traffic in its own
 * tab). Rather than leaving a trade dangling open forever when its cargo vanishes
 * with no captured sell/customs event, or silently missing a trade entirely when new
 * cargo appears with no captured buy, this notices the *mismatch* — using data this
 * extension already captured on web — and closes/opens the trade with a best-effort
 * estimate from our own price history, honestly flagged via `reconciled: true` rather
 * than presented as a precisely captured figure. Real per-trip costs we have no
 * signal for at all (travel cost, customs bribes paid on the other client) are left
 * at 0/unknown rather than guessed.
 *
 * Called from applySmugglingListing.ts — the single choke point every fresh listing
 * (manual view or background poll) already flows through, so any web-side glance at
 * the panel is a chance to notice cargo changed hands elsewhere.
 */
export async function reconcileHeldCargo(
  previous: LastSmugglingContext | null,
  held: SmugglingListing['entries'][number] | undefined,
  district: string,
  timestamp: number,
): Promise<void> {
  const previousItem = previous?.heldItem ?? null;
  const currentItem = held?.item ?? null;

  if (previousItem === currentItem) return; // nothing changed — no mismatch to reconcile

  if (previousItem) {
    await closeVanishedCargo(previousItem, district, timestamp);
  }

  if (currentItem && held) {
    await openUnseenCargo(currentItem, held.stash, district, timestamp);
  }
}

async function closeVanishedCargo(item: string, district: string, timestamp: number): Promise<void> {
  const open = await findOpenTrade(item);
  if (!open?.id) return; // already reconciled, or was never tracked to begin with

  const unitPrice = await latestPrice(item, timestamp, district, 'sell');
  const sellTotal = unitPrice !== null ? unitPrice * open.quantity : null;
  const grossProfit = sellTotal !== null ? sellTotal - open.buyPrice : null;
  const roi = grossProfit !== null && open.buyPrice > 0 ? grossProfit / open.buyPrice : null;

  await db.trades.update(open.id, {
    sellDistrict: district,
    sellPrice: sellTotal,
    sellTime: timestamp,
    grossProfit,
    profit: grossProfit, // travel cost/bribes on the other client are unknowable, not fabricated as 0
    roi,
    caught: null,
    status: 'closed',
    reconciled: true,
  });
}

async function openUnseenCargo(item: string, quantity: number, district: string, timestamp: number): Promise<void> {
  const alreadyOpen = await findOpenTrade(item);
  if (alreadyOpen) return; // a buy was actually captured for this — nothing to reconcile

  const unitPrice = await latestPrice(item, timestamp, district, 'buy');

  await db.trades.add({
    item,
    quantity,
    buyDistrict: district,
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
    bribeCount: 0,
    status: 'open',
    reconciled: true,
  });
}
