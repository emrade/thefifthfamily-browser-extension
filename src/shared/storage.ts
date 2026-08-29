import type {
  CareerAutoConfig,
  CareerAutoStatus,
  CourierAutoConfig,
  CourierRunSummary,
  CourierWatchState,
  FightClubFilterPrefs,
  FightClubHeroStats,
  LastSmugglingContext,
  PendingCourierReturn,
  PendingCustoms,
  PendingTravel,
  PlayerStatsSnapshot,
  RealEstateAdvisorPreferences,
  StockMarketPollStatus,
  StreetIntelAutoConfig,
  StreetIntelAutoStatus,
} from './types';
import { CAREER_AUTO_DEFAULT_ACCURACY_WEIGHTS, STORAGE_KEYS, STREET_INTEL_AUTO_DEFAULT_MIN_SUCCESS_PCT } from './constants';
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

const DEFAULT_STREET_INTEL_AUTO_CONFIG: StreetIntelAutoConfig = {
  enabled: false,
  minSuccessPct: STREET_INTEL_AUTO_DEFAULT_MIN_SUCCESS_PCT,
};

// Auto-dispatch defaults on — the player explicitly asked for "auto-dispatch,
// then notify" as the primary behavior, with the ability to turn just the
// dispatch part off and fall back to notify-only.
const DEFAULT_COURIER_AUTO_CONFIG: CourierAutoConfig = {
  autoDispatchEnabled: true,
};

// 24h matches this account's own observed collection habit (see the Real
// Estate advisor's derivation) — a reasonable default for any install,
// adjustable live from the overlay's own cadence chips.
const DEFAULT_REAL_ESTATE_ADVISOR_PREFERENCES: RealEstateAdvisorPreferences = {
  cadenceHours: 24,
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

  // Same merge-with-defaults/simple-nullable split as the Career Auto pair above.
  getStreetIntelAutoConfig: async (): Promise<StreetIntelAutoConfig> => {
    const stored = await get<Partial<StreetIntelAutoConfig>>(STORAGE_KEYS.STREET_INTEL_AUTO_CONFIG, {});
    return { ...DEFAULT_STREET_INTEL_AUTO_CONFIG, ...stored };
  },
  setStreetIntelAutoConfig: (v: StreetIntelAutoConfig) => set(STORAGE_KEYS.STREET_INTEL_AUTO_CONFIG, v),

  getStreetIntelAutoStatus: () => get<StreetIntelAutoStatus | null>(STORAGE_KEYS.STREET_INTEL_AUTO_STATUS, null),
  setStreetIntelAutoStatus: (v: StreetIntelAutoStatus) => set(STORAGE_KEYS.STREET_INTEL_AUTO_STATUS, v),

  // Same merge-with-defaults reasoning as the prefs above.
  getRealEstateAdvisorPreferences: async (): Promise<RealEstateAdvisorPreferences> => {
    const stored = await get<Partial<RealEstateAdvisorPreferences>>(STORAGE_KEYS.REAL_ESTATE_ADVISOR_PREFERENCES, {});
    return { ...DEFAULT_REAL_ESTATE_ADVISOR_PREFERENCES, ...stored };
  },
  setRealEstateAdvisorPreferences: (v: RealEstateAdvisorPreferences) => set(STORAGE_KEYS.REAL_ESTATE_ADVISOR_PREFERENCES, v),

  // Plain boolean, not merged with a default object like the prefs above —
  // there's no "default" backfill state to fall back to, just done or not.
  getStockMarketBackfillDone: () => get<boolean>(STORAGE_KEYS.STOCK_MARKET_BACKFILL_DONE, false),
  setStockMarketBackfillDone: (v: boolean) => set(STORAGE_KEYS.STOCK_MARKET_BACKFILL_DONE, v),

  // Same simple-nullable shape as Career Auto's status pair — no default
  // worth merging in for "has this ever run".
  getStockMarketPollStatus: () => get<StockMarketPollStatus>(STORAGE_KEYS.STOCK_MARKET_POLL_STATUS, { lastPollAt: null, lastError: null, paused: false }),
  setStockMarketPollStatus: (v: StockMarketPollStatus) => set(STORAGE_KEYS.STOCK_MARKET_POLL_STATUS, v),

  // Merge-with-defaults, same reasoning as Career/Street Intel Auto's config —
  // a field added later should still resolve for an existing install.
  getCourierAutoConfig: async (): Promise<CourierAutoConfig> => {
    const stored = await get<Partial<CourierAutoConfig>>(STORAGE_KEYS.COURIER_AUTO_CONFIG, {});
    return { ...DEFAULT_COURIER_AUTO_CONFIG, ...stored };
  },
  setCourierAutoConfig: (v: CourierAutoConfig) => set(STORAGE_KEYS.COURIER_AUTO_CONFIG, v),

  // Background-owned runtime state — simple nullable-default, no "default open
  // state" to merge in beyond "nothing checked yet".
  getCourierWatchState: () => get<CourierWatchState>(STORAGE_KEYS.COURIER_WATCH_STATE, { destinationOpenUntil: null, lastCheckedAt: 0 }),
  setCourierWatchState: (v: CourierWatchState) => set(STORAGE_KEYS.COURIER_WATCH_STATE, v),

  // Empty array default — no pets in flight yet.
  getPendingCourierReturns: () => get<PendingCourierReturn[]>(STORAGE_KEYS.PENDING_COURIER_RETURNS, []),
  setPendingCourierReturns: (v: PendingCourierReturn[]) => set(STORAGE_KEYS.PENDING_COURIER_RETURNS, v),

  clearAll: () => chrome.storage.local.remove(Object.values(STORAGE_KEYS)),
};
