import { db } from '@/shared/db';
import { SEED_DISTRICTS } from '@/shared/constants';
import type { ExtensionMessage } from '@/shared/messaging';
import type { District } from '@/shared/types';
import * as travelNotifier from './travelNotifier';

export { handleAlarm as handleTravelAlarm } from './travelNotifier';

export async function ensureSeedData() {
  const count = await db.districts.count();
  if (count === 0) {
    await db.districts.bulkAdd(SEED_DISTRICTS);
  }
}

export async function handleMessage(msg: ExtensionMessage) {
  switch (msg.type) {
    case 'player-stats':
      return travelNotifier.checkImmediateArrival(msg.snapshot);
    case 'district-catalog':
      return upsertDistricts(msg.districts);
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
