import type { District } from './types';

export const GAME_ORIGIN = 'https://www.thefifthfamily.com';

export const STORAGE_KEYS = {
  LATEST_STATS: 'ff_latest_stats',
  PENDING_TRAVEL: 'ff_pending_travel',
  LAST_SMUGGLING_CONTEXT: 'ff_last_smuggling_context',
  PENDING_CUSTOMS: 'ff_pending_customs',
  NOTIFICATION_PREFERENCES: 'ff_notification_preferences',
  FIGHT_CLUB_STATS: 'ff_fight_club_stats',
  FIGHT_CLUB_FILTER: 'ff_fight_club_filter',
  PAGE_FEATURE_PREFERENCES: 'ff_page_feature_preferences',
  REQUEST_LOG_PREFERENCES: 'ff_request_log_preferences',
} as const;

export const ALARM_NAMES = {
  TRAVEL_ARRIVAL: 'ff-travel-arrival',
  MARKET_POLL: 'ff-market-poll',
  STREET_INTEL_POLL: 'ff-street-intel-poll',
  REQUEST_LOG_SWEEP: 'ff-request-log-sweep',
} as const;

// --- Request log retention ---------------------------------------------------
//
// Sizing is grounded in this account's own measured traffic rather than a guess:
// the 2026-07-22 → 2026-08-08 export holds 9,135 price snapshots over 17 days
// (~537 `panel.php` views/day), and the two background pollers add a further
// 144/day (market, 10-min) + 288/day (street intel, 5-min). With player-driven
// actions that lands around 1,500 requests/day.
//
// Bodies are gzipped before they are stored (see requestLog/compress.ts). Panel
// responses are HTML fragments carrying a large inlined <style> block that is
// byte-identical on every response, so they compress by roughly 10× — which is
// what makes a 30-day window affordable (~75 MB) where storing raw text would not
// have been (~750 MB). Shorten this if you would rather trade history for space.
export const REQUEST_LOG_RETENTION_DAYS = 30;

// Secondary safety valve, independent of age. Age-based retention alone assumes
// traffic stays near the measured rate; a runaway loop or a much heavier play
// session could blow past the storage budget well inside the 30-day window. When
// the table exceeds this, the oldest rows are dropped until it is back under,
// regardless of how recent they are.
export const REQUEST_LOG_MAX_ROWS = 120_000;

// Bodies above this are stored truncated (with `truncated: true` on the row) so a
// single unexpectedly huge response can't exhaust memory in the page hook or blow
// the structured-clone budget on the way to the background worker. Comfortably
// above any observed panel response, which run tens of KB.
export const REQUEST_LOG_MAX_BODY_BYTES = 512 * 1024;

// Hourly. The sweep is a cheap indexed range-delete, and running it well more
// often than the retention window means a browser left closed for days still
// trims promptly on the next wake rather than in one large burst.
export const REQUEST_LOG_SWEEP_INTERVAL_MINUTES = 60;

// Opportunities rotate on their own per-card expiry timers (independent of the
// player's own action cooldown), so catching a new medium-risk-or-better one needs
// recurring polling, not a single check timed off one cooldown. 5 minutes comfortably
// catches opportunities against the shortest observed expiries (~80s–1100s) without
// polling so often it's chatty.
export const STREET_INTEL_POLL_INTERVAL_MS = 5 * 60_000;

// Used to schedule the next background market poll when we don't have a precise
// market-shift countdown to align to (e.g. the very first poll before any panel view
// has told us the real cadence) — matches the community guide's observed ~10-minute
// rotation, though we never assume this once a real countdown is available.
export const MARKET_POLL_FALLBACK_INTERVAL_MS = 10 * 60_000;
// Small buffer after the market-shift deadline, so the server has actually rotated
// prices by the time we poll rather than catching the tail end of the old cycle.
export const MARKET_POLL_BUFFER_MS = 5_000;

// Seed data confirmed from a real `POST /api/travel.php action=get_cities` capture —
// used to bootstrap the District table before the player has ever opened Travel in a
// given install. Overwritten by the live payload the first time it's observed, so this
// only matters for the very first few minutes of use.
export const SEED_DISTRICTS: District[] = [
  { id: 1, name: 'Downtown', slug: 'downtown', nativeItem: 'Counterfeit Passports', smugglingBonus: 0, bossLocked: false, levelRequired: 0, travelTimeWalk: 660, travelTimeTaxi: 330, travelCostTaxi: 4000 },
  { id: 2, name: 'The Docks', slug: 'docks', nativeItem: 'Uncut Diamonds', smugglingBonus: 0, bossLocked: true, levelRequired: 25, travelTimeWalk: 1200, travelTimeTaxi: 600, travelCostTaxi: 7750 },
  { id: 3, name: 'The Underground', slug: 'underground', nativeItem: 'Black-Market Steroids', smugglingBonus: 0, bossLocked: true, levelRequired: 50, travelTimeWalk: 2100, travelTimeTaxi: 990, travelCostTaxi: 18750 },
  { id: 4, name: 'The Strip', slug: 'strip', nativeItem: 'Stolen Artwork', smugglingBonus: 0, bossLocked: false, levelRequired: 10, travelTimeWalk: 900, travelTimeTaxi: 480, travelCostTaxi: 5500 },
  { id: 5, name: 'Arms District', slug: 'arms', nativeItem: 'Military Munitions', smugglingBonus: 0, bossLocked: true, levelRequired: 35, travelTimeWalk: 1650, travelTimeTaxi: 780, travelCostTaxi: 11750 },
  { id: 6, name: 'The Penthouse', slug: 'penthouse', nativeItem: 'Forged Bonds', smugglingBonus: 0, bossLocked: true, levelRequired: 75, travelTimeWalk: 2700, travelTimeTaxi: 1200, travelCostTaxi: 27750 },
  { id: 7, name: 'The Waterfront', slug: 'waterfront', nativeItem: 'Rare Antiquities', smugglingBonus: 2.5, bossLocked: true, levelRequired: 90, travelTimeWalk: 3150, travelTimeTaxi: 1440, travelCostTaxi: 35250 },
  { id: 8, name: 'The Syndicate', slug: 'syndicate', nativeItem: null, smugglingBonus: 0, bossLocked: true, levelRequired: 110, travelTimeWalk: 3600, travelTimeTaxi: 1590, travelCostTaxi: 42750 },
];

// Arrival confirmation retry policy for the Travel Arrival Notification —
// see docs/trade-assistant-plan.md "Travel Arrival Notification".
export const ARRIVAL_CONFIRM_RETRIES = 3;
export const ARRIVAL_CONFIRM_RETRY_DELAY_MS = 5_000;
