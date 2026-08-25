import type {
  CareerAutoConfig,
  CareerAutoStatus,
  CourierRunSummary,
  FightClubFilterPrefs,
  FightClubHeroStats,
  LastSmugglingContext,
  PendingCustoms,
  PendingTravel,
  PlayerStatsSnapshot,
} from './types';
import { CAREER_AUTO_DEFAULT_ACCURACY_WEIGHTS, STORAGE_KEYS } from './constants';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from './notifications';
import { DEFAULT_PAGE_FEATURE_PREFERENCES, type PageFeaturePreferences } from './pageFeatures';
import { DEFAULT_REQUEST_LOG_PREFERENCES, type RequestLogPreferences } from './requestLog/preferences';

// No job selected yet — the popup's job picker is what actually populates
// careerId/careerName/energyCost/otEnergyCost/otAvailable, from a live
// CareerCatalogEntry, the first time the player picks one.
const DEFAULT_CAREER_AUTO_CONFIG: CareerAutoConfig = {
  enabled: false,
  careerId: null,
  careerName: '',
  energyCost: 0,
  otEnergyCost: null,
  otAvailable: false,
  accuracyWeights: CAREER_AUTO_DEFAULT_ACCURACY_WEIGHTS,
};

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

  // Same "merge with defaults" reasoning as notification prefs — a page feature
  // added in a later version should come back enabled for an existing install too.
  getPageFeaturePreferences: async (): Promise<PageFeaturePreferences> => {
    const stored = await get<Partial<PageFeaturePreferences>>(STORAGE_KEYS.PAGE_FEATURE_PREFERENCES, {});
    return { ...DEFAULT_PAGE_FEATURE_PREFERENCES, ...stored };
  },
  setPageFeaturePreferences: (v: PageFeaturePreferences) => set(STORAGE_KEYS.PAGE_FEATURE_PREFERENCES, v),

  // Same merge-with-defaults treatment as the two above, so a preference added in
  // a later version resolves rather than coming back undefined — which for
  // `retentionDays` would mean a NaN cutoff and a sweep that deletes everything.
  getRequestLogPreferences: async (): Promise<RequestLogPreferences> => {
    const stored = await get<Partial<RequestLogPreferences>>(STORAGE_KEYS.REQUEST_LOG_PREFERENCES, {});
    return { ...DEFAULT_REQUEST_LOG_PREFERENCES, ...stored };
  },
  setRequestLogPreferences: (v: RequestLogPreferences) => set(STORAGE_KEYS.REQUEST_LOG_PREFERENCES, v),

  getLastCourierRun: () => get<CourierRunSummary | null>(STORAGE_KEYS.LAST_COURIER_RUN, null),
  setLastCourierRun: (v: CourierRunSummary) => set(STORAGE_KEYS.LAST_COURIER_RUN, v),

  // Merge-with-defaults, same reasoning as notification/page-feature prefs — a
  // config field added in a later version (e.g. a new accuracy weight) should
  // still resolve for an existing install rather than coming back undefined.
  getCareerAutoConfig: async (): Promise<CareerAutoConfig> => {
    const stored = await get<Partial<CareerAutoConfig>>(STORAGE_KEYS.CAREER_AUTO_CONFIG, {});
    return { ...DEFAULT_CAREER_AUTO_CONFIG, ...stored };
  },
  setCareerAutoConfig: (v: CareerAutoConfig) => set(STORAGE_KEYS.CAREER_AUTO_CONFIG, v),

  // Background-owned runtime state (last shift, tracked cooldown, pause reason)
  // — simple nullable, same as `getLastCourierRun`, not merged with defaults
  // since there's no "default" shift result to fall back to.
  getCareerAutoStatus: () => get<CareerAutoStatus | null>(STORAGE_KEYS.CAREER_AUTO_STATUS, null),
  setCareerAutoStatus: (v: CareerAutoStatus) => set(STORAGE_KEYS.CAREER_AUTO_STATUS, v),

  clearAll: () => chrome.storage.local.remove(Object.values(STORAGE_KEYS)),
};
