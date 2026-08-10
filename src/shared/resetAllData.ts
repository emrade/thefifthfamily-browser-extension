import { clearAllData } from './db';
import { storage } from './storage';
import { ALARM_NAMES } from './constants';

/**
 * Resets the player-facing data — the derived Dexie tables, every
 * chrome.storage.local key, and both named alarms (a stale travel-arrival or
 * market-poll alarm referencing now-deleted state could otherwise misfire).
 * Callable directly from the popup: Dexie, chrome.storage, and chrome.alarms are
 * all available in any extension page, not just the background worker, so no
 * message round-trip is needed for this.
 *
 * Scoped to what the player actually sees. The HTTP archive is a separate concern
 * with its own retention, its own exports, and its own clear control, so it is not
 * touched here — see `clearRequestLog()`. Its size counters are left alone for the
 * same reason: they must stay consistent with the tables they describe, and those
 * tables survive this call.
 */
export async function resetAllData(): Promise<void> {
  await Promise.all([
    clearAllData(),
    storage.clearAll(),
    chrome.alarms.clear(ALARM_NAMES.TRAVEL_ARRIVAL),
    chrome.alarms.clear(ALARM_NAMES.MARKET_POLL),
  ]);
}
