import type { FightClubFilterPrefs, FightClubHeroStats, LastSmugglingContext, PendingCustoms, PendingTravel, PlayerStatsSnapshot } from './types';
import { STORAGE_KEYS } from './constants';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from './notifications';

async function get<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T) ?? fallback;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

async function remove(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

export const storage = {
  getLatestStats: () => get<PlayerStatsSnapshot | null>(STORAGE_KEYS.LATEST_STATS, null),
  setLatestStats: (v: PlayerStatsSnapshot) => set(STORAGE_KEYS.LATEST_STATS, v),

  getPendingTravel: () => get<PendingTravel | null>(STORAGE_KEYS.PENDING_TRAVEL, null),
  setPendingTravel: (v: PendingTravel) => set(STORAGE_KEYS.PENDING_TRAVEL, v),
  clearPendingTravel: () => remove(STORAGE_KEYS.PENDING_TRAVEL),

  getSmugglingContext: () => get<LastSmugglingContext | null>(STORAGE_KEYS.LAST_SMUGGLING_CONTEXT, null),
  setSmugglingContext: (v: LastSmugglingContext) => set(STORAGE_KEYS.LAST_SMUGGLING_CONTEXT, v),

  getPendingCustoms: () => get<PendingCustoms | null>(STORAGE_KEYS.PENDING_CUSTOMS, null),
  setPendingCustoms: (v: PendingCustoms) => set(STORAGE_KEYS.PENDING_CUSTOMS, v),
  clearPendingCustoms: () => remove(STORAGE_KEYS.PENDING_CUSTOMS),

  getFightClubStats: () => get<(FightClubHeroStats & { timestamp: number }) | null>(STORAGE_KEYS.FIGHT_CLUB_STATS, null),
  setFightClubStats: (v: FightClubHeroStats & { timestamp: number }) => set(STORAGE_KEYS.FIGHT_CLUB_STATS, v),

  getFightClubFilter: () => get<FightClubFilterPrefs | null>(STORAGE_KEYS.FIGHT_CLUB_FILTER, null),
  setFightClubFilter: (v: FightClubFilterPrefs) => set(STORAGE_KEYS.FIGHT_CLUB_FILTER, v),

  // Merged with the defaults rather than returned as-is: a notification type added
  // in a later version won't exist yet in an existing install's stored object, and
  // should still come back enabled (the "default enabled" rule applies to new
  // notification types too, not just what existed when the player first set prefs).
  getNotificationPreferences: async (): Promise<NotificationPreferences> => {
    const stored = await get<Partial<NotificationPreferences>>(STORAGE_KEYS.NOTIFICATION_PREFERENCES, {});
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...stored };
  },
  setNotificationPreferences: (v: NotificationPreferences) => set(STORAGE_KEYS.NOTIFICATION_PREFERENCES, v),

  clearAll: () => chrome.storage.local.remove(Object.values(STORAGE_KEYS)),
};
