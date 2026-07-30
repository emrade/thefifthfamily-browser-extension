import { db } from '@/shared/db';
import { storage } from '@/shared/storage';
import type { ExtensionMessage } from '@/shared/messaging';
import type { PlayerStatsSnapshot, RawStatsPayload } from '@/shared/types';

/**
 * Maintains the player's current stats/location — read by the always-visible
 * LiveStats popup view, so this lives outside tradeAssistant even though the
 * district catalog it resolves names from is populated by that feature's travel
 * capture. tradeAssistant still reacts to the same 'player-stats' message on its own
 * (see its handleMessage) purely to check whether it confirms an awaited travel
 * arrival — that side effect is trade-loop business, this one isn't.
 */
export async function handleMessage(msg: ExtensionMessage) {
  if (msg.type !== 'player-stats') return;
  await handlePlayerStats(msg.snapshot);
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
}
