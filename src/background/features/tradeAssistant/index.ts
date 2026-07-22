import { db } from '@/shared/db';
import { storage } from '@/shared/storage';
import { SEED_DISTRICTS } from '@/shared/constants';
import type { ExtensionMessage } from '@/shared/messaging';
import type { District, PlayerStatsSnapshot, RawStatsPayload } from '@/shared/types';
import * as tradeMatcher from './tradeMatcher';
import * as riskEngine from './riskEngine';
import * as travelNotifier from './travelNotifier';

export { handleAlarm } from './travelNotifier';

export async function ensureSeedData() {
  const count = await db.districts.count();
  if (count === 0) {
    await db.districts.bulkAdd(SEED_DISTRICTS);
  }
}

export async function handleMessage(msg: ExtensionMessage) {
  switch (msg.type) {
    case 'player-stats':
      return handlePlayerStats(msg.snapshot);
    case 'district-catalog':
      return upsertDistricts(msg.districts);
    case 'price-snapshot':
      return handlePriceSnapshot(msg);
    case 'trade-buy':
      return tradeMatcher.openTrade(msg.item, msg.quantity, msg.timestamp);
    case 'trade-sell':
      return tradeMatcher.closeTrade(msg.item, msg.quantity, msg.sellTotal, msg.grossProfit, msg.timestamp);
    case 'customs-raid-detected':
      return riskEngine.detectRaid(msg.district, msg.bribe, msg.timestamp);
    case 'customs-resolved':
      return riskEngine.resolveCustoms(msg);
    case 'travel-started':
      return travelNotifier.scheduleArrival(msg);
    case 'travel-cancelled':
      return travelNotifier.cancelPending();
  }
}

async function upsertDistricts(incoming: District[]) {
  for (const d of incoming) {
    const existing = await db.districts.get(d.id);
    await db.districts.put({ ...d, nativeItem: d.nativeItem ?? existing?.nativeItem ?? null });
  }
}

async function handlePriceSnapshot(msg: Extract<ExtensionMessage, { type: 'price-snapshot' }>) {
  for (const entry of msg.entries) {
    await db.priceSnapshots.add({
      timestamp: msg.timestamp,
      district: msg.district,
      item: entry.item,
      price: entry.price,
      type: entry.type,
      trendPct: entry.trendPct,
    });

    if (entry.type === 'buy') {
      const district = await db.districts.where('name').equals(msg.district).first();
      if (district && !district.nativeItem) {
        await db.districts.update(district.id, { nativeItem: entry.item });
      }
    }
  }

  const held = msg.entries.find((e) => e.stash > 0);
  await storage.setSmugglingContext({
    district: msg.district,
    borderSeizureRisk: msg.borderSeizureRisk,
    heldItem: held?.item ?? null,
    heldQuantity: held?.stash ?? 0,
    cargoCapacity: msg.hiddenCargo.max,
    timestamp: msg.timestamp,
  });
}

async function handlePlayerStats(snapshot: RawStatsPayload) {
  const district = await db.districts.get(snapshot.currentCityId);
  const currentDistrict = district?.name ?? `City #${snapshot.currentCityId}`;
  const destDistrict = snapshot.travelDestinationId ? await db.districts.get(snapshot.travelDestinationId) : null;

  const previous = await storage.getLatestStats();

  const enriched: PlayerStatsSnapshot = {
    ...snapshot,
    currentDistrict,
    travelDestination: destDistrict?.name ?? null,
  };

  await storage.setLatestStats(enriched);

  if (!previous || previous.currentCityId !== snapshot.currentCityId) {
    await db.districtVisits.add({ cityId: snapshot.currentCityId, district: currentDistrict, timestamp: snapshot.timestamp });
  }

  await travelNotifier.checkImmediateArrival(snapshot);
}
