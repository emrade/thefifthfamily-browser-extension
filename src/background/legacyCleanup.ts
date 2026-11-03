import { LEGACY_FURY_CATCHER_ALARM, LEGACY_FURY_CATCHER_PREF_KEYS, LEGACY_FURY_CATCHER_STORAGE_KEYS, STORAGE_KEYS } from '@/shared/constants';

const FEATURE_HEALTH_KEY = 'ff_feature_health';

/** Removes one key from a stored object, writing only if it was there. */
async function dropKey(storageKey: string, field: string): Promise<void> {
  const stored = (await chrome.storage.local.get(storageKey))[storageKey] as Record<string, unknown> | undefined;
  if (!stored || !(field in stored)) return;
  const { [field]: _removed, ...rest } = stored;
  await chrome.storage.local.set({ [storageKey]: rest });
}

/**
 * One-time cleanup after the Halloween Fury Catcher was removed (2026-11-03):
 * its config/status, its alarm, its page-panel and notification toggles, and
 * its feature-health record. Each step is a no-op once done, so running it on
 * every background startup is harmless.
 */
export async function removeLegacyFuryCatcher(): Promise<void> {
  await chrome.alarms.clear(LEGACY_FURY_CATCHER_ALARM);
  const legacy = await chrome.storage.local.get([...LEGACY_FURY_CATCHER_STORAGE_KEYS]);
  if (Object.keys(legacy).length > 0) await chrome.storage.local.remove([...LEGACY_FURY_CATCHER_STORAGE_KEYS]);
  await dropKey(STORAGE_KEYS.PAGE_FEATURE_PREFERENCES, LEGACY_FURY_CATCHER_PREF_KEYS.page);
  await dropKey(STORAGE_KEYS.NOTIFICATION_PREFERENCES, LEGACY_FURY_CATCHER_PREF_KEYS.notification);
  await dropKey(FEATURE_HEALTH_KEY, LEGACY_FURY_CATCHER_PREF_KEYS.health);
}
