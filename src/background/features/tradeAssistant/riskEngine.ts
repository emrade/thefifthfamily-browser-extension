import { db } from '@/shared/db';
import { storage } from '@/shared/storage';
import type { ExtensionMessage } from '@/shared/messaging';
import * as tradeMatcher from './tradeMatcher';

async function estimateCargoValue(item: string, quantity: number, atOrBefore: number): Promise<number | null> {
  const rows = await db.priceSnapshots.where('item').equals(item).toArray();
  if (rows.length === 0) return null;

  const before = rows.filter((r) => r.timestamp <= atOrBefore).sort((a, b) => b.timestamp - a.timestamp)[0];
  const fallback = rows.sort((a, b) => b.timestamp - a.timestamp)[0];
  return (before ?? fallback).price * quantity;
}

export async function detectRaid(district: string, bribe: number, timestamp: number) {
  const ctx = await storage.getSmugglingContext();
  const cargoValue = ctx?.heldItem ? await estimateCargoValue(ctx.heldItem, ctx.heldQuantity, timestamp) : null;

  await storage.setPendingCustoms({
    district,
    bribe,
    displayedRisk: ctx?.borderSeizureRisk ?? 0,
    item: ctx?.heldItem ?? null,
    quantity: ctx?.heldItem ? ctx.heldQuantity : null,
    cargoValue,
    timestamp,
  });
}

export async function resolveCustoms(msg: Extract<ExtensionMessage, { type: 'customs-resolved' }>) {
  const pending = await storage.getPendingCustoms();
  if (!pending) return; // a resolution with no detected raid on record — nothing to complete

  await db.customsEvents.add({
    timestamp: msg.timestamp,
    item: pending.item,
    quantity: pending.quantity,
    cargoValue: pending.cargoValue,
    // Prefer the amount confirmed in the bribe action's own response — it's the actual
    // paid amount, unlike `pending.bribe` (the raid screen's earlier-offered amount,
    // which can go stale if a second raid overwrites the single pending-customs slot
    // before this one resolves). Fall back to it only if the response couldn't be parsed.
    bribe: msg.resolution === 'bribe' ? (msg.bribeAmount ?? pending.bribe) : 0,
    displayedRisk: pending.displayedRisk,
    district: pending.district,
    resolution: msg.resolution,
    caught: msg.caught,
    cargoLost: msg.cargoLost,
    jailSeconds: msg.jailSeconds,
  });

  await storage.clearPendingCustoms();

  if (msg.cargoLost && pending.item) {
    await tradeMatcher.closeTradeAsLoss(pending.item, msg.timestamp);
  }
}
