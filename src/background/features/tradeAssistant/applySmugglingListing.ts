import { db } from '@/shared/db';
import { storage } from '@/shared/storage';
import type { SmugglingListing } from '@/shared/types';

/**
 * The actual persistence logic for a parsed smuggling-panel listing — shared between
 * a manually-captured view (handlePriceSnapshot, triggered by the player actually
 * opening the panel) and the background market poller (marketPoller.ts, triggered by
 * an alarm with no player action at all). Both produce the same SmugglingListing
 * shape from their respective parsers (DOM-based vs regex-based), so there's exactly
 * one place that writes it to Dexie/storage.
 *
 * Returns the resolved `marketShiftAt` (absolute epoch ms), so the caller can decide
 * when to schedule the next background poll.
 */
export async function applySmugglingListing(result: SmugglingListing, timestamp: number): Promise<number | null> {
  for (const entry of result.entries) {
    await db.priceSnapshots.add({
      timestamp,
      district: result.district,
      item: entry.item,
      price: entry.price,
      type: entry.isLocal ? 'buy' : 'sell',
      trendPct: entry.trendPct,
    });

    if (entry.isLocal) {
      const district = await db.districts.where('name').equals(result.district).first();
      if (district && !district.nativeItem) {
        await db.districts.update(district.id, { nativeItem: entry.item });
      }
    }
  }

  const held = result.entries.find((e) => e.stash > 0);
  const marketShiftAt = result.marketShiftSeconds !== null ? timestamp + result.marketShiftSeconds * 1000 : null;

  await storage.setSmugglingContext({
    district: result.district,
    borderSeizureRisk: result.borderSeizureRisk,
    heldItem: held?.item ?? null,
    heldQuantity: held?.stash ?? 0,
    cargoCapacity: result.hiddenCargo.max,
    marketShiftAt,
    timestamp,
  });

  if (result.hiddenCargo.max > 0) {
    await db.riskObservations.add({
      timestamp,
      fullnessPct: (result.hiddenCargo.current / result.hiddenCargo.max) * 100,
      riskPct: result.borderSeizureRisk,
    });
  }

  return marketShiftAt;
}
