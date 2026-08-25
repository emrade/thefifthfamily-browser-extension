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
  LAST_COURIER_RUN: 'ff_last_courier_run',
  CAREER_AUTO_CONFIG: 'ff_career_auto_config',
  CAREER_AUTO_STATUS: 'ff_career_auto_status',
} as const;

export const ALARM_NAMES = {
  TRAVEL_ARRIVAL: 'ff-travel-arrival',
  MARKET_POLL: 'ff-market-poll',
  STREET_INTEL_POLL: 'ff-street-intel-poll',
  REQUEST_LOG_SWEEP: 'ff-request-log-sweep',
  CAREER_AUTO: 'ff-career-auto',
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

// Secondary constraint, independent of age: a size budget. Bytes are the resource
// that actually runs out, and the row cap this replaces was a proxy calibrated
// against a request rate that turned out to be wrong by 14x — measured traffic is
// ~21,700 requests/day, not the 1,500 assumed, so a 120,000-row cap evicted after
// 5.5 days and made the retention setting meaningless.
//
// 100 MB is sized from that measurement rather than picked for headroom. With the
// capture policy applied (see requestLog/policy.ts) the archive takes ~3,150
// rows/day, so 30 days is ~94,000 rows; those average about 1 KB stored once
// gzipped — a stats response compresses to roughly 400 bytes, a panel to a few KB,
// and stats dominate by count. That lands near 92 MB for a full window.
//
// The archive page reports usage against this, so if real traffic drifts the
// number to change is visible rather than inferred.
export const REQUEST_LOG_MAX_BYTES = 100 * 1024 * 1024;

// Bodies above this are stored truncated (with `truncated: true` on the row) so a
// single unexpectedly huge response can't exhaust memory in the page hook or blow
// the structured-clone budget on the way to the background worker. Comfortably
// above any observed panel response, which run tens of KB.
export const REQUEST_LOG_MAX_BODY_BYTES = 512 * 1024;

// Hourly. The sweep is a cheap indexed range-delete, and running it well more
// often than the retention window means a browser left closed for days still
// trims promptly on the next wake rather than in one large burst.
export const REQUEST_LOG_SWEEP_INTERVAL_MINUTES = 60;

// --- Structural change detection --------------------------------------------
//
// An endpoint is only judged against once enough of its normal behaviour has been
// observed. Measured against a real capture, one endpoint routinely returns
// several unrelated structures — `panel.php?type=smuggling` returns a market
// listing or a customs raid screen, `travel.php` returns a city list, a travel
// confirmation, or an error — and a cooldown timer blinks whole clusters of
// classes in and out between consecutive polls. Every one of those is normal, so
// anything seen during warmup is absorbed into the endpoint's vocabulary rather
// than reported.
export const SHAPE_WARMUP_OBSERVATIONS = 25;
export const SHAPE_WARMUP_MS = 6 * 60 * 60 * 1000;

// A token has to have appeared in *every* observation of an endpoint before its
// disappearance counts as a removal, and the endpoint must have been sampled at
// least this many times before that claim is trusted at all.
//
// The floor was 25 and that was far too low — it produced a false alarm on live
// data within hours. "Present in all N so far" is weak evidence when N is small:
// a token that genuinely appears with probability p looks universal with
// probability p^N.
//
//        p |        N=25       N=200       N=400
//     -----|------------------------------------
//     0.91 |    9.5e-02    6.4e-09    4.1e-17
//     0.95 |    2.8e-01    3.5e-05    1.2e-09
//     0.99 |    7.8e-01    1.3e-01    1.8e-02
//
// Street Intel's `.si-card-modifier` sits at 91%. At N=25 it had roughly a 1-in-10
// chance of looking universal on its own, and that endpoint carries about seven
// such optional decorations — so a false positive was close to certain. It fired
// at exactly 25 observations, and the token was back to 91% presence by the next
// export.
//
// 400 also covers the harder case of a token present 99% of the time, which 200
// would still misjudge 13% of the time. The cost is detection latency on quiet
// endpoints, which is the right trade: this answers "what changed recently",
// not "page me now", and a false alarm costs more than a slow true one. The real
// detection to date — stats.php dropping the whole `battle_pass` object when the
// pass expired — fired at 1,038 observations and is unaffected.
export const SHAPE_UNIVERSAL_MIN_OBSERVATIONS = 400;

// Guards against a variant switch reading as a mass removal. When a raid screen
// replaces a market listing, every listing token legitimately vanishes at once —
// so a removal is only reported when it is *targeted*, i.e. a small slice of the
// vocabulary. A real field being dropped moves a handful of tokens; a different
// page moves nearly all of them.
export const SHAPE_REMOVAL_MAX_FRACTION = 0.3;

// How many further observations a mass disappearance must survive before it is
// reported as a rewrite rather than dismissed as a variant.
//
// This exists because the variant guard above, left alone, is blind to exactly
// the event most worth catching. A rewritten endpoint drops most of its
// vocabulary at once, which is indistinguishable *at that instant* from a raid
// screen replacing a market listing — so the guard suppresses it and nothing is
// reported. What separates them is what happens next: a variant resolves back
// within minutes, a rewrite never does. 40 observations is comfortably longer
// than any variant seen in real data, and short enough to notice within a day.
export const SHAPE_REWRITE_CONFIRM_OBSERVATIONS = 40;

// Structural events kept per endpoint. Bounded so a pathological endpoint can't
// grow its profile row without limit; the newest are kept.
export const SHAPE_MAX_EVENTS = 50;

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

// --- Career auto-runner -------------------------------------------------------
//
// How long to wait before re-checking eligibility when the last check found the
// account simply not ready yet — not enough energy, or travelling/jailed/
// hospitalized — none of which resolve on a fixed schedule the way a market
// shift or a cooldown timer does, so this is a plain re-poll interval rather
// than something derived from a server-provided countdown.
export const CAREER_AUTO_FALLBACK_INTERVAL_MS = 2 * 60_000;

// Small buffer added after a tracked cooldown's expiry before the next
// attempt fires, same reasoning as MARKET_POLL_BUFFER_MS — guards against
// firing a few hundred ms early on clock skew and getting an ordinary
// rejection back for it.
export const CAREER_AUTO_BUFFER_MS = 5_000;

// Derived from this account's real `career.php` history (see
// docs/career-auto-plan.md): every accuracy value it has ever submitted was
// one of exactly three numbers — 95 (76 times, "perfect"), 70 (16 times,
// "good"), 35 (once, "miss") — never anything in between. The mini-game
// appears to snap to discrete zones, not continuous 0-100 precision, so a
// smoothly-randomized value would look less natural than picking from the
// same small set the account already has genuine history for. 35 ("miss") is
// left out on purpose — there's no reason to deliberately replicate a bad
// outcome — leaving a weighted pick between the other two, matching their
// real ~82/17 split.
export const CAREER_AUTO_DEFAULT_ACCURACY_WEIGHTS = [
  { value: 95, weight: 85 },
  { value: 70, weight: 15 },
];
