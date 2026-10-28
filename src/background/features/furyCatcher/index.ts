import { ALARM_NAMES, STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { FuryCatcherConfig, FuryCatcherStatus } from '@/shared/types';
import { onConfigChanged, runCycle } from './runner';

export { handleAlarm } from './runner';

/** "Check Now" from the popup or the in-page overlay — runs a cycle through
 *  the same guard as the alarm (even while switched off), then returns the
 *  fresh status. */
export async function runCheckNow(): Promise<FuryCatcherStatus | null> {
  await runCycle(true);
  return storage.getFuryCatcherStatus();
}

/** Reacts live to the popup/overlay writing a new config — same pattern as
 *  crimesAuto/index.ts. */
function watchConfigChanges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEYS.FURY_CATCHER_CONFIG in changes)) return;
    const next = changes[STORAGE_KEYS.FURY_CATCHER_CONFIG].newValue as FuryCatcherConfig | undefined;
    const prev = changes[STORAGE_KEYS.FURY_CATCHER_CONFIG].oldValue as FuryCatcherConfig | undefined;
    if (!next) return;
    // The runner's own pause writes `enabled:false` too — nothing to react to
    // beyond clearing the alarm, which it already did.
    if (prev && prev.enabled === next.enabled && prev.energyFloor === next.energyFloor && prev.dailyDrinkCap === next.dailyDrinkCap) return;
    onConfigChanged(next).catch((err) => console.error(LOG_PREFIX, 'furyCatcher onConfigChanged failed', err));
  });
}

/** Alarms don't survive a background restart — re-arm from the stored next
 *  check, or check now if that's already passed. */
async function ensureScheduled(): Promise<void> {
  const config = await storage.getFuryCatcherConfig();
  if (!config.enabled) return;
  const status = await storage.getFuryCatcherStatus();
  const alarm = await chrome.alarms.get(ALARM_NAMES.FURY_CATCHER);
  if (alarm) return;
  if (status?.nextCheckAt && status.nextCheckAt > Date.now()) {
    chrome.alarms.create(ALARM_NAMES.FURY_CATCHER, { when: status.nextCheckAt });
    return;
  }
  await runCycle();
}

export function init(): void {
  watchConfigChanges();
  ensureScheduled().catch((err) => console.error(LOG_PREFIX, 'furyCatcher ensureScheduled failed', err));
}
