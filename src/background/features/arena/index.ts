import { ALARM_NAMES, ARENA_WATCH_BOOTSTRAP_DELAY_MS, LEGACY_ARENA_AUTO_ALARM, LEGACY_ARENA_AUTO_STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { ArenaWatchStatus } from '@/shared/types';
import type { ExtensionMessage } from '@/shared/messaging';
import { handleNotificationClick, scheduleNextCheck } from './watcher';

export { handleAlarm } from './watcher';

/**
 * One-time cleanup of the removed Arena Auto-Attack's storage and alarm.
 * Returns whether the account had used Arena before (an Auto-era status
 * record existed), so the reminder can carry on without waiting for a fresh
 * Arena page view.
 */
async function removeLegacyArenaAuto(): Promise<boolean> {
  const legacy = await chrome.storage.local.get([...LEGACY_ARENA_AUTO_STORAGE_KEYS]);
  const hadStatus = legacy[LEGACY_ARENA_AUTO_STORAGE_KEYS[1]] != null;
  if (Object.keys(legacy).length > 0) await chrome.storage.local.remove([...LEGACY_ARENA_AUTO_STORAGE_KEYS]);
  await chrome.alarms.clear(LEGACY_ARENA_AUTO_ALARM);
  return hadStatus;
}

/**
 * Re-arms the reminder's alarm on service-worker startup (alarms don't
 * survive a restart the way `chrome.storage` does). Gated on the player
 * having been seen on Arena at all (a status record exists); otherwise
 * `handleMessage` below arms it on the first Arena page view.
 */
export async function ensureScheduled(): Promise<void> {
  const usedArenaBefore = await removeLegacyArenaAuto();
  const status = await storage.getArenaWatchStatus();
  if (status === null && !usedArenaBefore) return;
  const existing = await chrome.alarms.get(ALARM_NAMES.ARENA_WATCH);
  if (existing) return;
  if (status?.state === 'waiting' && status.nextUnlockAt !== null && status.nextUnlockAt > Date.now()) {
    scheduleNextCheck(status.nextUnlockAt);
    return;
  }
  // Anything else (a page needing the player, or unknown) is looked at
  // right away rather than a full reminder interval after a restart.
  chrome.alarms.create(ALARM_NAMES.ARENA_WATCH, { when: Date.now() + ARENA_WATCH_BOOTSTRAP_DELAY_MS });
}

export function init(): void {
  // Registered synchronously at startup so a click can wake the worker.
  chrome.notifications.onClicked.addListener((id) => {
    handleNotificationClick(id).catch((err) => console.error(LOG_PREFIX, 'arena reminder click failed', err));
  });
  ensureScheduled().catch((err) => console.error(LOG_PREFIX, 'arena ensureScheduled failed', err));
}

/** Arms the reminder the first time the player is seen on Arena, rather
 *  than running it from install for an account that never touches the
 *  page. An existing alarm is left alone so a later visit doesn't push an
 *  already-scheduled check back. */
export async function handleMessage(msg: ExtensionMessage): Promise<void> {
  if (msg.type !== 'arena-viewed') return;
  const existing = await chrome.alarms.get(ALARM_NAMES.ARENA_WATCH);
  if (existing) return;
  chrome.alarms.create(ALARM_NAMES.ARENA_WATCH, { when: Date.now() + ARENA_WATCH_BOOTSTRAP_DELAY_MS });
}

export async function getStatus(): Promise<ArenaWatchStatus | null> {
  return storage.getArenaWatchStatus();
}
