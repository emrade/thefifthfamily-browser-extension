import { db } from '@/shared/db';
import { storage } from '@/shared/storage';
import { ALARM_NAMES, ARRIVAL_CONFIRM_RETRIES, ARRIVAL_CONFIRM_RETRY_DELAY_MS, GAME_ORIGIN } from '@/shared/constants';
import type { ExtensionMessage } from '@/shared/messaging';
import type { RawStatsPayload } from '@/shared/types';

export async function scheduleArrival(msg: Extract<ExtensionMessage, { type: 'travel-started' }>) {
  const district = await db.districts.get(msg.destinationCityId);
  const destinationName = district?.name ?? `City #${msg.destinationCityId}`;
  const arrivesAt = msg.timestamp + msg.travelTimeSeconds * 1000;

  await storage.setPendingTravel({
    destinationCityId: msg.destinationCityId,
    destinationName,
    method: msg.method,
    startedAt: msg.timestamp,
    arrivesAt,
  });

  // Fixed alarm name — a new trip (or cancel + re-travel) naturally overwrites any
  // previously pending alarm rather than stacking notifications.
  chrome.alarms.create(ALARM_NAMES.TRAVEL_ARRIVAL, { when: arrivesAt });

  const cost = msg.method === 'taxi' ? (district?.travelCostTaxi ?? 0) : 0;
  await db.travelLegs.add({ timestamp: msg.timestamp, destinationCityId: msg.destinationCityId, method: msg.method, cost });
}

export async function cancelPending() {
  await chrome.alarms.clear(ALARM_NAMES.TRAVEL_ARRIVAL);
  await storage.clearPendingTravel();
}

export async function handleAlarm(alarm: chrome.alarms.Alarm) {
  if (alarm.name !== ALARM_NAMES.TRAVEL_ARRIVAL) return;
  await confirmArrival();
}

// Not a blind timer: confirm against the server before notifying, retrying a couple
// of times in case of client/server clock drift. The retries use setTimeout rather
// than another alarm — a pragmatic v1 choice, since MV3 service workers can be killed
// between timeouts; if that happens the very next stats.php poll (checkImmediateArrival,
// triggered by ordinary gameplay) still catches the arrival, just slightly late.
async function confirmArrival(retriesLeft = ARRIVAL_CONFIRM_RETRIES) {
  const pending = await storage.getPendingTravel();
  if (!pending) return;

  try {
    const res = await fetch(`${GAME_ORIGIN}/api/stats.php`, { credentials: 'include' });
    const json = await res.json();
    if (json?.ok && Number(json.stats?.current_city) === pending.destinationCityId && !json.status?.travelling) {
      notifyArrived(pending.destinationName);
      await storage.clearPendingTravel();
      return;
    }
  } catch {
    // Network hiccup — fall through to retry below.
  }

  if (retriesLeft > 0) {
    setTimeout(() => confirmArrival(retriesLeft - 1), ARRIVAL_CONFIRM_RETRY_DELAY_MS);
  }
}

function notifyArrived(destinationName: string) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'You have arrived',
    message: `Touched down in ${destinationName}.`,
  });
}

/** Opportunistic early check — if a stats.php poll we were already processing shows
 * arrival, notify immediately instead of waiting for the scheduled alarm. */
export async function checkImmediateArrival(snapshot: RawStatsPayload) {
  const pending = await storage.getPendingTravel();
  if (!pending) return;
  if (snapshot.travelling || snapshot.currentCityId !== pending.destinationCityId) return;

  notifyArrived(pending.destinationName);
  await cancelPending();
}
