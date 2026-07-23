import { clearAllData } from './db';
import { storage } from './storage';
import { ALARM_NAMES } from './constants';

/**
 * Full reset — every Dexie table, every chrome.storage.local key, and both named
 * alarms (a stale travel-arrival or market-poll alarm referencing now-deleted state
 * could otherwise misfire). Callable directly from the popup: Dexie, chrome.storage,
 * and chrome.alarms are all available in any extension page, not just the background
 * worker, so no message round-trip is needed for this.
 */
export async function resetAllData(): Promise<void> {
  await Promise.all([
    clearAllData(),
    storage.clearAll(),
    chrome.alarms.clear(ALARM_NAMES.TRAVEL_ARRIVAL),
    chrome.alarms.clear(ALARM_NAMES.MARKET_POLL),
  ]);
}
