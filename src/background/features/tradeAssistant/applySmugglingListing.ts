import { db } from '@/shared/db';
import { storage } from '@/shared/storage';
import { reconcileHeldCargo } from './cargoReconciler';
import type { SmugglingListing } from '@/shared/types';

// Two calls within this window with identical content are treated as the same real
// observation, not two distinct market shifts — wide enough to catch both a stacked
// duplicate hook (same physical request re-posted, near-identical timestamps) and two
// genuinely separate tabs each independently capturing the same real panel view a
// moment apart (different real Date.now() readings, but still the same underlying
// state) — the market doesn't shift on a cadence anywhere near this fast.
const DUPLICATE_CAPTURE_WINDOW_MS = 5_000;

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
  const previousContext = await storage.getSmugglingContext();

  for (const entry of result.entries) {
    const type = entry.isLocal ? 'buy' : 'sell';
    const duplicate = await db.priceSnapshots
      .where('item')
      .equals(entry.item)
      .filter(
        (r) =>
          r.district === result.district &&
          r.type === type &&
          r.price === entry.price &&
          Math.abs(r.timestamp - timestamp) < DUPLICATE_CAPTURE_WINDOW_MS,
      )
      .first();

    if (!duplicate) {
      await db.priceSnapshots.add({
        timestamp,
        district: result.district,
        item: entry.item,
        price: entry.price,
        type,
        trendPct: entry.trendPct,
      });
    }

    if (entry.isLocal) {
      const district = await db.districts.where('name').equals(result.district).first();
      if (district && !district.nativeItem) {
        await db.districts.update(district.id, { nativeItem: entry.item });
      }
    }
  }

  const held = result.entries.find((e) => e.stash > 0);
  const marketShiftAt = result.marketShiftSeconds !== null ? timestamp + result.marketShiftSeconds * 1000 : null;

  await reconcileHeldCargo(previousContext, held, result.district, timestamp);

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
    const fullnessPct = (result.hiddenCargo.current / result.hiddenCargo.max) * 100;
    const duplicateObservation = await db.riskObservations
      .where('timestamp')
      .between(timestamp - DUPLICATE_CAPTURE_WINDOW_MS, timestamp + DUPLICATE_CAPTURE_WINDOW_MS, true, true)
      .filter((r) => r.fullnessPct === fullnessPct && r.riskPct === result.borderSeizureRisk)
      .first();

    if (!duplicateObservation) {
      await db.riskObservations.add({ timestamp, fullnessPct, riskPct: result.borderSeizureRisk });
    }
  }

  return marketShiftAt;
}
