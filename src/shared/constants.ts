import type { District } from './types';

export const GAME_ORIGIN = 'https://www.thefifthfamily.com';

export const STORAGE_KEYS = {
  LATEST_STATS: 'ff_latest_stats',
  PENDING_TRAVEL: 'ff_pending_travel',
  LAST_SMUGGLING_CONTEXT: 'ff_last_smuggling_context',
  PENDING_CUSTOMS: 'ff_pending_customs',
} as const;

export const ALARM_NAMES = {
  TRAVEL_ARRIVAL: 'ff-travel-arrival',
} as const;

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
