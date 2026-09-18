export interface District {
  id: number;
  name: string;
  slug: string;
  nativeItem: string | null;
  smugglingBonus: number;
  bossLocked: boolean;
  levelRequired: number;
  travelTimeWalk: number;
  travelTimeTaxi: number;
  travelCostTaxi: number;
}

export interface PlayerStatsSnapshot {
  timestamp: number;
  cash: number;
  bank: number;
  energy: number;
  maxEnergy: number;
  stamina: number;
  maxStamina: number;
  nerve: number;
  maxNerve: number;
  vitality: number;
  maxVitality: number;
  strength: number;
  defence: number;
  agility: number;
  dexterity: number;
  level: number;
  xp: number;
  xpToNext: number;
  heat: number;
  currentCityId: number;
  currentDistrict: string;
  travelling: boolean;
  travelDestinationId: number | null;
  travelDestination: string | null;
  travelSecondsRemaining: number;
  jailed: boolean;
  hospitalized: boolean;
}

/**
 * Wire format for a stats.php poll, as parsed by the content script. Carries only
 * the numeric city id — resolving it to a district name is background's job, since
 * background owns the District table and content scripts intentionally know nothing
 * about persisted state (keeps parsing pure and race-free across multiple open tabs).
 */
export interface RawStatsPayload {
  timestamp: number;
  cash: number;
  bank: number;
  energy: number;
  maxEnergy: number;
  stamina: number;
  maxStamina: number;
  nerve: number;
  maxNerve: number;
  vitality: number;
  maxVitality: number;
  strength: number;
  defence: number;
  agility: number;
  dexterity: number;
  level: number;
  xp: number;
  xpToNext: number;
  heat: number;
  currentCityId: number;
  travelling: boolean;
  travelDestinationId: number | null;
  travelSecondsRemaining: number;
  jailed: boolean;
  hospitalized: boolean;
}

export interface PendingTravel {
  destinationCityId: number;
  destinationName: string;
  method: 'walk' | 'taxi';
  startedAt: number;
  arrivesAt: number;
}

export interface DistrictVisit {
  id?: number;
  cityId: number;
  district: string;
  timestamp: number;
}

/**
 * The player's own Fight Club standing — the hero scoreboard at the top of the
 * panel, plus their Hall of Fame rank when present. Confirmed the attack_hub
 * response ships markup for all three tabs (Targets, Combat Log, Top Fighters) in
 * one payload regardless of which is active client-side, so the rank is free to
 * read here alongside the hero stats.
 */
export interface FightClubHeroStats {
  rating: number;
  hitsLanded: number;
  hitsFailed: number;
  lethalityPct: number;
  hallOfFameRank: number | null;
}

/** The in-page Fight Club target-list toolbar's sort/filter choice — persisted so
 * the player doesn't have to re-enter a max-rating cutoff on every visit. */
export interface FightClubFilterPrefs {
  sort: 'default' | 'rating_asc' | 'respect_asc';
  maxRating: number | null;
}

/** The Item Market sell grid's toolbar choices — persisted so they don't need
 *  re-enabling every visit, same as Fight Club's toolbar sort/filter.
 *  `hideConsumables` exists because consumables (Nerve Tonic, Energy Drink,
 *  etc.) trade in the thousands/week and otherwise bury every piece of gear
 *  at the top of a "sort by weekly sales" view. */
export interface ItemMarketSortPrefs {
  sortByVolume: boolean;
  hideConsumables: boolean;
}

/**
 * `GET /actions/attack.php?type=recon&target_id=X` — the game's own pre-attack
 * scouting read. Confirmed real (captured 2026-09): the server already computes
 * a win-probability estimate, a categorical threat/steal read, and a same-day
 * attack cap, all before a single attack is thrown. `successChance`/
 * `threatLevel`/`stealEstimate` already factor in things the response doesn't
 * otherwise expose (e.g. the target's current HP) — a target sitting near-dead
 * shows up as a high `successChance`/"Easy Pickings" `threatLevel` despite a
 * respectable `combatRating`, with no HP field anywhere in this payload. This
 * is deliberately *not* run through gameAction.ts's `postAction` — it's a GET,
 * carries no `_csrf`, and every capture seen so far comes back `ok:true` with
 * no rejection shape observed yet to build a `status-blocked`/`auth` split
 * against.
 */
export interface FightClubRecon {
  targetId: number;
  username: string;
  level: number;
  respect: number;
  combatRating: number;
  family: string;
  online: boolean;
  jailed: boolean;
  hospitalized: boolean;
  targetWeapon: string;
  targetArmor: string;
  myWeapon: string;
  myArmor: string;
  /** 0-100. The server's own win-probability estimate for this matchup. */
  successChance: number;
  /** Free-text bucket the game itself uses — seen so far: "Easy Pickings",
   *  "Favorable", "Even Match", "Dangerous". Not a closed enum: rendered as
   *  a plain label (with a neutral fallback color) for anything unrecognized,
   *  since the game could add a bucket at any point without warning. */
  threatLevel: string;
  /** Free-text bucket — seen so far: "Low-Medium", "Medium-High", "Unknown". */
  stealEstimate: string;
  dailyAttacks: number;
  dailyLimit: number;
  staminaCost: number;
  myStamina: number;
  /** When this scout was fetched — not from the response (it carries no
   *  timestamp), so callers know how stale a cached card badge is. */
  timestamp: number;
}

/** How often the player actually collects Real Estate properties — the Real
 *  Estate advisor overlay (content/features/realEstate) needs this to know how
 *  much vault capacity a property actually needs, since a longer gap between
 *  collections needs a bigger vault to avoid overflow. Player-adjustable via
 *  the overlay's own cadence chips, not a Settings toggle — it's read far more
 *  often than it's changed and belongs next to the numbers it drives. */
export interface RealEstateAdvisorPreferences {
  cadenceHours: number;
}

/**
 * A pet's own `user_pet_id` plus its capacity/speed stats — see
 * docs/smuggling-v2-plan.md's "Pet roster discovery" note. Only learnable from a
 * `smug_tab=proto` response when the account has zero active shipments; persisted
 * once learned so the courier automation doesn't need that rare state on every run.
 *
 * The `milestone*` fields come from the same card's training-progress block — see
 * docs/pet-training.md for the two-step mechanic (Feed/Train earn spendable Pet
 * Points on the Menagerie page; only *allocating* those points into STR/DEF/AGI/DEX
 * advances this milestone). `null` here means the block wasn't present on the card
 * (observed only when a pet has crossed all the way to its final milestone — never
 * seen on this account, so unconfirmed) rather than "not yet parsed."
 */
export interface PetRosterEntry {
  userPetId: number;
  name: string;
  tier: string;
  capacity: number;
  travelPenaltyPct: number;
  /** "Training X / Y" — X milestones already crossed, out of Y total for this pet. */
  milestoneCurrent: number | null;
  milestoneMax: number | null;
  /** How many more allocated STR/DEF/AGI/DEX points (any mix) cross the next
   *  milestone — the same number the panel's "+N more" note shows. */
  pointsNeededForNextMilestone: number | null;
  /** What capacity/travel penalty become once that next milestone is crossed —
   *  equal to the pet's *current* capacity/travel when a milestone only improves
   *  travel time and leaves capacity unchanged (confirmed happens: see
   *  docs/pet-training.md's Fox/Pigeon/Raccoon data). */
  nextMilestoneCapacity: number | null;
  nextMilestoneTravelPenaltyPct: number | null;
  /**
   * Why the "Send <Pet>" button is missing from this card, verbatim from the
   * game's own `.sv2-cc-block` text — null when the pet is normally
   * draftable. Confirmed reason so far: `"Deployed as your combat pet"`
   * (equipping a pet for Fight Club blocks it from smuggling duty until
   * unequipped) — surfaced as free text rather than an enum since the card
   * copy is exactly as reliable a source for a reason the game adds later as
   * for this one. `petCourier.ts` excludes any pet with this set from the
   * idle-pet pool, since `v2_draft` rejects it outright (confirmed: `{"ok":
   * false,"error":"Pigeon is deployed as your combat pet. Unequip it
   * first."}`) — before this field existed, a pet in this state still
   * *looked* idle (just absent from the active fleet) to that check, so the
   * automation kept re-attempting the same doomed draft every run.
   */
  draftBlockedReason: string | null;
  lastSeen: number;
}

/** One entry in the fleet strip — a pet with an *active* shipment, whatever state
 *  it's in. Doesn't carry capacity/tier; that only shows on the assigned-courier
 *  banner (`SmugglingV2Snapshot.assignedCourier`) once that shipment is focused. */
export interface FleetEntry {
  shipmentId: number;
  petName: string;
  status: 'drafting' | 'moving' | 'ready-to-offload';
  etaSeconds: number | null;
}

/** One card in the Black Market Inventory grid — present for all 30 catalog items
 *  regardless of district, `buyableHere` reflecting only whether the player is
 *  currently standing in that item's origin district. */
export interface BlackMarketItem {
  itemId: number;
  name: string;
  family: string;
  originDistrict: string;
  price: number;
  buyableHere: boolean;
  stash: number;
}

/** One of the (always exactly two) open destination cells shown once a shipment
 *  draft exists. `stateBadge` is the unexplained `+N` — see the "narrowed, not
 *  solved" gap in docs/smuggling-v2-plan.md. */
export interface DestinationOption {
  district: string;
  locked: boolean;
  baseMinutes: number;
  courierMinutes: number;
  saleRateMult: number;
  stateBadge: string | null;
}

/** The currently-open shipment's assigned pet, when a draft exists — capacity/speed
 *  here are that specific pet's stats, confirming (and feeding) the persisted
 *  PetRosterEntry for whichever pet this is. */
export interface AssignedCourier {
  shipmentId: number;
  petName: string;
  capacity: number;
  travelPenaltyPct: number;
  manifestCount: number;
}

/** Everything `smugglingPanelAdapter.ts` can pull from one `smug_tab=proto`
 *  response. `roster` and `destinations` are frequently empty — see each field's
 *  own doc comment for when they're populated. */
export interface SmugglingV2Snapshot {
  fleet: FleetEntry[];
  roster: PetRosterEntry[];
  blackMarket: BlackMarketItem[];
  destinations: DestinationOption[];
  assignedCourier: AssignedCourier | null;
  dailyProfitCapRemaining: number | null;
  /**
   * "Hidden Cargo" — total unspent stash across every item, shared by the whole
   * account, distinct from any one pet's own carry capacity (`PetRosterEntry.capacity`).
   * Scales with player level (confirmed: "20 base at level 63... = 21" in one real
   * capture) — a `buy` fills this before a `v2_load` moves units from here onto a
   * pet's manifest, freeing the room back up. A pet whose own capacity exceeds this
   * max (common — George's 30 vs. a 21-slot stash) can only ever be loaded by
   * cycling buy→load→buy→load, never in one purchase. Null if the monitor board
   * itself isn't present.
   */
  hiddenCargo: { current: number; max: number } | null;
}

/** What one click of "Run" actually did — shown in the in-page floating panel and
 *  kept as "last run" even after the panel closes and reopens. */
export interface CourierRunSummary {
  timestamp: number;
  offloaded: { petName: string; profit: number }[];
  // `items` rather than a single item/qty — a shipment can (and often does, once
  // pre-existing stash gets drained into it) carry a mix, not just what was
  // freshly bought this run.
  sent: { petName: string; items: { item: string; qty: number }[]; destination: string }[];
  skipped: { petName: string; reason: string }[];
  cashWithdrawn: number;
  /** Whatever cash-on-hand got swept into the bank at the end of this run, so it's
   *  not sitting exposed (the player's own worry: "so i don't get mugged and loose
   *  money"). Attempted regardless of what else the run did — even a run that only
   *  offloaded, or did nothing at all, still sweeps standing cash. */
  cashDeposited: number;
  stoppedReason: 'daily-cap-reached' | 'insufficient-funds' | 'no-idle-pets' | 'no-destination-available' | 'session-error' | 'shape-changed' | 'status-blocked' | null;
  errors: string[];
}

/**
 * One step of a courier run, broadcast live as it happens — see
 * `messaging.ts`'s `courier-run-progress`. Purely a UI convenience: the
 * authoritative record is still the final `CourierRunSummary` a run resolves
 * with, which is what actually gets persisted. A dropped or missed progress
 * event (e.g. the panel wasn't open to hear it) costs nothing but a moment of
 * stale display — nothing here is relied on for correctness.
 */
export type CourierProgressEvent =
  | { kind: 'started' }
  | { kind: 'offloaded'; petName: string; profit: number }
  | { kind: 'drafting'; petName: string }
  | { kind: 'sent'; petName: string; items: { item: string; qty: number }[]; destination: string }
  | { kind: 'skipped'; petName: string; reason: string }
  | { kind: 'deposited'; amount: number }
  | { kind: 'error'; message: string }
  | { kind: 'finished' };

/** Read-only view into what the courier auto-watch background feature is
 *  currently tracking — the player's own ask: "even when it is active i have
 *  no idea what it is doing or even if it is doing anything." Assembled fresh
 *  on every request from live alarm state + storage, not itself persisted. */
export interface CourierWatchSummary {
  watchEnabled: boolean;
  autoDispatchEnabled: boolean;
  autoOffloadEnabled: boolean;
  /** Epoch ms the current rotation closes at, or `null` if the last probe
   *  found both destinations locked (or nothing has probed yet). Only ever
   *  set by an actual probe — see `lastProbeResult`. */
  destinationOpenUntil: number | null;
  /** Epoch ms of the last hourly *cycle*, whether or not it could actually
   *  probe — `0` if none has run yet. Distinct from "last probe": a cycle
   *  with zero idle pets still runs (and reschedules) but has nothing to
   *  draft with, so it can't learn the destination's real state. */
  lastCheckedAt: number;
  /** What the last cycle actually concluded — `null` before the first cycle.
   *  `'skipped-no-idle-pets'` means the timestamp above is honest about *when*
   *  the system last ran, but it learned nothing about the destination that
   *  time (nothing to draft with) — the panel should say so rather than
   *  reusing a stale open/locked verdict from whenever the last real probe was. */
  lastProbeResult: 'open' | 'locked' | 'skipped-no-idle-pets' | null;
  /** Epoch ms the next hourly check is scheduled for, or `null` if — for
   *  whatever reason — no alarm is currently armed. */
  nextDestCheckAt: number | null;
  /** Every pet currently in flight and when it's due back, soonest first. */
  pendingReturns: { petName: string; arrivesAt: number }[];
}

/** Read-only snapshot for the in-page floating panel to render without
 *  triggering a run — the panel runs on the *game's* origin, not the
 *  extension's, so it can't reach `db.petRoster`/`storage` directly and has to
 *  ask background for this the same way it asks for a run. */
export interface CourierStatus {
  roster: PetRosterEntry[];
  lastRun: CourierRunSummary | null;
  watch: CourierWatchSummary;
}

/** User toggles for the courier auto-watch background feature (see
 *  `courierWatch.ts`) — read/written directly by the in-page courier panel,
 *  same direct-storage pattern as `CareerAutoConfig`. Two independent
 *  switches, not one — this system's own convention (applied consistently
 *  across every auto feature) is that anything automated can be turned off
 *  on its own, and offload/dispatch are genuinely two different automated
 *  actions with two different risk profiles (offload only collects what's
 *  already landed; dispatch spends cash and commits a pet to a new trip).
 *
 *  `watchEnabled` is the master switch for detection itself — the hourly
 *  destination probe (which drafts and cancels a real shipment just to read
 *  the destination list) and the pet-return tracking alarm. Neither
 *  `autoDispatchEnabled` nor `autoOffloadEnabled` has any other trigger to
 *  run from (both only ever fire from inside the watch's own alarm
 *  handlers — see `courierWatch.ts`), so they're meaningless without it;
 *  turning `watchEnabled` off forces both back to `false` rather than
 *  leaving them showing "on" while nothing can ever act on them. Defaults to
 *  `false`, same off-by-default convention as every other kill switch in this
 *  extension (including the two action toggles below) — the player controls
 *  when a background feature starts running, not the install itself, even
 *  for a feature (detection) that previously had no switch at all and ran
 *  unconditionally. An existing install upgrading into this flag simply
 *  starts with watch off until turned on, the same thing every other auto
 *  feature already asks of a first-time user. */
export interface CourierAutoConfig {
  watchEnabled: boolean;
  autoDispatchEnabled: boolean;
  autoOffloadEnabled: boolean;
}

/** Background-owned runtime state for the hourly destination-rotation check —
 *  lets the pet-return alarm decide instantly whether a freshly-landed pet can
 *  be redispatched without an extra draft/cancel probe, and lets the panel
 *  (via `CourierWatchSummary`) show honestly what the last cycle actually did. */
export interface CourierWatchState {
  /** Epoch ms marking the end of the currently-open rotation hour, or `null`
   *  if the last probe found both destinations locked (or none has probed
   *  yet). Only ever set by an actual probe — untouched by a cycle that had
   *  no idle pets to probe with. */
  destinationOpenUntil: number | null;
  /** Epoch ms of the last hourly cycle, whether or not it could probe. */
  lastCheckedAt: number;
  /** See `CourierWatchSummary.lastProbeResult` — same field, persisted. */
  lastProbeResult: 'open' | 'locked' | 'skipped-no-idle-pets' | null;
}

/** One in-flight shipment's computed return time, persisted so the dynamic
 *  `SMUGGLING_COURIER_RETURN` alarm survives a service-worker restart between
 *  being armed and firing — same reasoning as `PendingTravel`. */
export interface PendingCourierReturn {
  shipmentId: number;
  petName: string;
  arrivesAt: number;
}

/**
 * One crime card read from the live Crime Alley panel — see
 * `crimesAuto/crimesPanelParser.ts`. There is no persisted "which crimes to
 * grind" list: every cycle re-fetches the panel and targets whichever card
 * isn't `maxed` yet, in the order the page itself renders them (only the
 * player's *current*, unlocked district's crimes appear on the page at all —
 * the next district's cards simply aren't there until this one's boss is
 * beaten), so the automation always tracks the account's live district
 * without needing to be reconfigured when it advances.
 */
export interface CrimeCatalogEntry {
  crimeId: number;
  name: string;
  family: string;
  nerveCost: number;
  maxed: boolean;
}

/** User-configured — read/written directly by the popup, same as
 *  `CourierAutoConfig`. No crime/district selection to store: the runner
 *  always targets whatever the live panel shows (see `CrimeCatalogEntry`),
 *  so there is nothing here to pick beyond the on/off switch itself. */
export interface CrimesAutoConfig {
  enabled: boolean;
}

/** What one automated crime attempt actually did — shown in the popup as
 *  "last attempt", same role `CareerShiftResult` plays for Career Auto. */
export interface CrimeAttemptResult {
  timestamp: number;
  crimeId: number;
  crimeName: string;
  outcome: 'success' | 'busted-clean' | 'busted-bailed';
  cashGained: number;
  xpGained: number;
}

/**
 * Background-owned runtime state for the crimes auto-runner. Counters are
 * lifetime-since-last-reset (there's no natural "today" boundary the way a
 * career shift's daily cap has — Nerve just regenerates continuously), and
 * reset whenever the player flips automation back on after it finished a
 * district or they explicitly disable-then-re-enable it.
 */
export interface CrimesAutoStatus {
  lastAttempt: CrimeAttemptResult | null;
  attempts: number;
  successes: number;
  busts: number;
  cashEarned: number;
  xpEarned: number;
  /** Times bail was paid to clear a real jail sentence from a bust, and the
   *  total spent doing it — computed from the account's own cash balance
   *  immediately before/after each bail call, not a formula, since the
   *  game's own bail cost isn't exposed anywhere the automation reads. */
  bailsPaid: number;
  bailCashSpent: number;
  /** Same idea as the bail pair above, for heat-cap bribes. */
  bribesPaid: number;
  bribeCashSpent: number;
  /** Epoch ms the current district's crimes were all confirmed `maxed` —
   *  `null` until that happens. Automation disables itself the moment this
   *  is set (see `runner.ts`), so the player knows to go challenge the boss. */
  districtMasteredAt: number | null;
  pausedReason: 'error' | null;
  /** Same reasoning as `CareerAutoStatus.pausedMessage` — the notification
   *  that fired this is transient, so this is the only durable record of why. */
  pausedMessage: string | null;
  pausedAt: number | null;
}

/**
 * One job listed on the Careers panel, as read from the live page — see
 * `careersPanelParser.ts`. `otEnergyCost`/`otAvailable` reflect a real quirk
 * confirmed from the panel markup: a job's Overtime button (and its own energy
 * cost) simply doesn't exist in the HTML until that job reaches rank 2 — a
 * never-worked job's card has only the normal Work Shift button.
 */
export interface CareerCatalogEntry {
  careerId: number;
  name: string;
  energyCost: number;
  otEnergyCost: number | null;
  otAvailable: boolean;
}

/** One accuracy value the auto-runner may submit, and how often relative to the
 *  others — see `careerAuto/runner.ts`'s weighted pick. Deliberately a short list
 *  of exact values rather than a random range: every real accuracy this account
 *  has ever submitted was one of a handful of discrete numbers (the mini-game
 *  snaps to zones, not continuous 0–100), so a smooth random spread would look
 *  less natural than picking from the same small set the account already has
 *  real history for. */
export interface CareerAccuracyWeight {
  value: number;
  weight: number;
}

/** User-configured — read/written directly by the popup, same as
 *  `NotificationPreferences`/`PageFeaturePreferences`. `energyCost`/`otEnergyCost`/
 *  `otAvailable` are captured once at job-selection time from a `CareerCatalogEntry`
 *  rather than re-fetched on every run, since a job's energy cost is not expected
 *  to change — the popup's "Refresh job list" action re-syncs it if ever needed. */
export interface CareerAutoConfig {
  enabled: boolean;
  careerId: number | null;
  careerName: string;
  energyCost: number;
  otEnergyCost: number | null;
  otAvailable: boolean;
  accuracyWeights: CareerAccuracyWeight[];
}

/** What one automated shift actually did — the background-owned counterpart to
 *  `CourierRunSummary`, shown in the Career Auto popup tab as "last shift." */
export interface CareerShiftResult {
  timestamp: number;
  careerId: number;
  careerName: string;
  overtime: boolean;
  accuracy: number;
  tier: string;
  tierLabel: string;
  cash: number;
  xp: number;
  promoted: boolean;
  leveledUp: boolean;
  rankName: string;
}

/**
 * Background-owned runtime state for the career auto-runner — distinct from
 * `CareerAutoConfig` (what the player chose) the same way `CourierRunSummary`
 * is distinct from a settings object. `nextEligibleAt` is this feature's own
 * tracking of the job's cooldown, seeded only from `cooldown_seconds` on a
 * response to a call *this automation* made — see `runner.ts`'s note on the
 * residual risk of that going stale if the same job is also run manually.
 */
export interface CareerAutoStatus {
  lastShift: CareerShiftResult | null;
  nextEligibleAt: number | null;
  pausedReason: 'fired' | 'error' | null;
  /** The actual diagnostic text `pause()` fired as a notification — that
   *  notification is transient (missed toast = message gone forever), so
   *  this is the only durable record of *why* it stopped, shown in the
   *  popup's paused banner instead of a generic canned line. */
  pausedMessage: string | null;
  pausedAt: number | null;
  /** Count of shifts run since `shiftsTodayDate`, a local calendar-day key
   *  (`YYYY-M-D`) — not UTC, so it resets at the player's own midnight, not an
   *  arbitrary one. Rolling the day over is the *reader's* job, not something
   *  written proactively at midnight: both `runner.ts` (about to record a new
   *  shift) and the popup (about to display the count) compare this key against
   *  today's before trusting `shiftsToday`, and treat a stale key as 0. */
  shiftsToday: number;
  shiftsTodayDate: string;
  /** Sum of `CareerShiftResult.cash` across every shift counted in
   *  `shiftsToday` — same `shiftsTodayDate` key governs both, so they reset
   *  together at read time rather than needing a second date field. */
  cashToday: number;
}

/** User-configured — read/written directly by the popup, same as
 *  `CareerAutoConfig`. `minSuccessPct` gates which opportunities are worth
 *  scouting into an attempt at all: the automation walks candidates by
 *  reward-per-Stamina value and stops at the first whose best scouted
 *  approach clears this floor, skipping the rest of the cycle if none do.
 *  Default (50) is grounded in this account's own real history — see
 *  docs/street-intel-plan.md's auto-attempt section — not an arbitrary guess. */
export interface StreetIntelAutoConfig {
  enabled: boolean;
  minSuccessPct: number;
  /** 'revealed' (default): only ever ranks/attempts an approach the scout
   *  actually gave real odds for — zero formula risk, but a card where the
   *  one revealed approach misses the floor gets skipped even if a hidden
   *  approach would have been great. 'computed': after scouting, also scores
   *  every hidden approach on the same card via the exact formula (see
   *  `@/shared/streetIntelEstimate`) using that same scout's real `base_pct`
   *  and shared modifiers — worst-case ~3pt error (env_stat defaulted to 0),
   *  90.8% exact on real historical data — and lets a hidden approach win the
   *  ranking. Confirmed live (2026-09-06) that `attempt` accepts any approach
   *  regardless of which one was revealed — see
   *  docs/street-intel-partial-reveal.md's "Correction" note. */
  oddsMode: 'revealed' | 'computed';
}

/** What one automated attempt (+ its complication, if one came up) actually
 *  did — the Street Intel counterpart to `CareerShiftResult`. */
export interface StreetIntelAttemptResult {
  timestamp: number;
  opportunityTitle: string;
  riskTier: 'low' | 'medium' | 'high' | 'extreme';
  legendary: boolean;
  approach: string;
  scoutedPct: number;
  /** Whether `scoutedPct` came from the scout's own real `estimate_pct`
   *  ('real') or from the 'computed' odds mode scoring a hidden approach via
   *  the exact formula (see `StreetIntelAutoConfig.oddsMode`). Always 'real'
   *  when `oddsMode` is 'revealed'. */
  pctSource: 'real' | 'computed';
  outcomeBand: string;
  reward: number;
  jailSeconds: number;
  hadComplication: boolean;
  /** The scenario's own narrative text (`complication.type` from the
   *  `attempt` response, e.g. "You hear footsteps behind the door.") — the
   *  key `complicationTypeStats` below tallies by. Null alongside
   *  `complicationChoice: null` when there was no complication at all. */
  complicationType: string | null;
  complicationChoice: string | null;
  /** True when `complicationChoice` came from the `steel_yourself`-has-no-
   *  equivalent fallback (picked by real historical fallback win rate — see
   *  `pickComplicationChoice` in actionRunner.ts) rather than directly
   *  reusing the approach that actually won the attempt. Null alongside
   *  `complicationChoice: null` when there was no complication at all. See
   *  docs/street-intel-complication-tracking.md. */
  complicationWasFallback: boolean | null;
  complicationSuccess: boolean | null;
}

/**
 * One opportunity the runner actually scouted during a cycle — a real API
 * call and real Stamina spent, whether or not it ended up chosen. Without
 * this, only the winning candidate's `estimate_pct` was ever visible (on
 * `StreetIntelAttemptResult`); everything scouted-and-rejected along the way
 * (e.g. the best-value opportunity coming in under the success threshold and
 * getting passed over for something cheaper) left no trace at all.
 */
/** One approach's odds as considered during ranking — either the scout's own
 *  real number, or (only under `oddsMode: 'computed'`) a hidden approach
 *  scored via the exact formula. Logging both side by side, for every
 *  approach on the card rather than just the winner, is what lets you tell
 *  after the fact whether 'computed' mode actually changed the pick versus
 *  what 'revealed' mode would have done with the same card. */
export interface ScoutedApproachEstimate {
  key: string;
  estimatePct: number;
  source: 'real' | 'computed';
}

export interface ScoutedCandidateLog {
  title: string;
  riskTier: 'low' | 'medium' | 'high' | 'extreme';
  legendary: boolean;
  staminaCost: number;
  /** reward-midpoint ÷ staminaCost — the same ranking value the runner
   *  sorted candidates by, so the log shows *why* this one was tried before
   *  the others. */
  valueRatio: number;
  /** Null if the scout call itself came back `ok:false` (e.g. a stamina
   *  race) rather than with real estimates. */
  approach: string | null;
  estimatePct: number | null;
  /** Null alongside `approach: null`. See `StreetIntelAttemptResult.pctSource`. */
  pctSource: 'real' | 'computed' | null;
  /** Every approach this candidate was actually ranked among — just the
   *  scout's revealed approach(es) under `oddsMode: 'revealed'`, or every
   *  approach on the card (real + computed) under 'computed'. Empty if the
   *  scout call itself failed. */
  approaches: ScoutedApproachEstimate[];
  /** True for the one candidate (at most) that cleared `minSuccessPct` and
   *  was actually attempted. */
  chosen: boolean;
}

/**
 * Background-owned runtime state for the Street Intel auto-runner — same
 * split from `StreetIntelAutoConfig` that `CareerAutoStatus` has from
 * `CareerAutoConfig`. Unlike Career, there's no `'fired'`-equivalent pause
 * reason here: a `disaster` outcome (real jail time) is a confirmed, expected
 * result this feature keeps running through — not an anomaly to stop for. The
 * only pause reason is a response shape this feature doesn't recognize at all.
 */
/** Running win/loss tally for one complication choice, in one situation. */
export interface ComplicationChoiceStats {
  attempts: number;
  successes: number;
}

/**
 * Win/loss tallies for one complication choice, split by *why* that choice
 * was made — see docs/street-intel-complication-tracking.md. `direct` is a
 * choice that matched whatever approach actually won the attempt (a strong
 * signal: it was genuinely the best-scouted option). `fallback` is a choice
 * that only got picked because the real winner was `steel_yourself` (no
 * complication equivalent), so it's the *second*-best scouted approach, not
 * the best — a weaker bet by construction. Kept separate rather than folded
 * into one count per choice, since conflating them would muddy whichever
 * signal either one actually carries.
 */
export interface ComplicationTrackingBucket {
  direct: ComplicationChoiceStats;
  fallback: ComplicationChoiceStats;
}

export type ComplicationChoiceKey = 'fight' | 'run' | 'talk';

/**
 * Win/loss tally per choice, further split by the complication's own scenario
 * text (`complication.type`, e.g. "You hear footsteps behind the door.") —
 * a richer signal than `ComplicationTrackingBucket`'s direct/fallback split,
 * since different scenarios plausibly favor different choices regardless of
 * which approach won the attempt (see docs/street-intel-estimate-calculation.md's
 * "Complication Analysis" section for the hypothesis this exists to test).
 * Keyed by the literal scenario string rather than any enum, since the full
 * set of possible scenarios isn't confirmed closed. Same "accumulates for as
 * long as the automation runs" reasoning as `complicationStats` — most
 * individual scenarios will sit at single-digit sample sizes for a long
 * time, so this is deliberately not surfaced as an actionable signal
 * anywhere yet, only collected.
 */
export type ComplicationTypeStats = Record<string, Record<ComplicationChoiceKey, ComplicationChoiceStats>>;

export interface StreetIntelAutoStatus {
  lastAttempt: StreetIntelAttemptResult | null;
  nextEligibleAt: number | null;
  pausedReason: 'error' | null;
  /** Same reasoning as `CareerAutoStatus.pausedMessage` — the notification
   *  fired alongside a pause is transient, this is the durable record. */
  pausedMessage: string | null;
  pausedAt: number | null;
  /** Same local-calendar-day-key pattern as `CareerAutoStatus.shiftsToday` —
   *  see its comment for why the rollover is read-time, not write-time. */
  attemptsToday: number;
  attemptsTodayDate: string;
  /** Sum of `StreetIntelAttemptResult.reward` across every attempt counted in
   *  `attemptsToday` — same `attemptsTodayDate` key governs both. Deliberately
   *  not netted against `cash_lost` from a failed complication (that's a
   *  separate, rarer number — see docs/street-intel-complication-tracking.md
   *  — and netting it here would make this tile silently disagree with
   *  `lastAttempt.reward`, which is also gross). */
  cashToday: number;
  /** Every candidate scouted on the most recent eligible cycle, in the order
   *  tried — populated even on a cycle where nothing cleared the threshold
   *  and no attempt happened at all, which is exactly the case that's
   *  otherwise invisible. Overwritten in full each cycle, not appended to —
   *  this is "what just happened," not a growing history. */
  lastCycleScouted: ScoutedCandidateLog[];
  lastCycleAt: number | null;
  /** Unlike `lastCycleScouted`, this *does* accumulate across every cycle,
   *  for as long as the account keeps running this automation — there's
   *  currently no odds data for any complication choice at all, so this is
   *  the only way to eventually know which choice actually wins more, rather
   *  than guessing. See docs/street-intel-complication-tracking.md. */
  complicationStats: Record<ComplicationChoiceKey, ComplicationTrackingBucket>;
  /** See `ComplicationTypeStats`'s own doc comment. */
  complicationTypeStats: ComplicationTypeStats;
}

/**
 * One hourly price sample for one stock market symbol — see
 * docs/stock-market-tracker-plan.md. `id` is a natural composite key
 * (`"${symbol}:${hour}"`) rather than an auto-increment one, so re-polling the
 * same hour (the game's own `poll` action returns a rolling 47h window, and
 * `chart` timeframes overlap it further) is a plain overwrite-in-place, never
 * a duplicate row.
 *
 * `hour` is the game's own hour counter (hours since `STOCK_MARKET_LAUNCH_TS`,
 * confirmed 1:1 with real time) — the same unit `StockRumorRecord.generatedHour`/
 * `expiresHour` use, which is what makes joining a rumor to "the price when it
 * fired" and "the price when it resolved" a plain lookup rather than a
 * timestamp-nearest-match.
 */
export interface StockPricePoint {
  id: string;
  symbol: string;
  hour: number;
  price: number;
  /** Real-world ms, derived from `hour` — kept alongside it only so a raw
   *  export reads as a normal timestamp without recomputing one. */
  timestamp: number;
}

/**
 * One stock market rumor, tracked from the moment it's first seen (as the
 * live, unresolved `rumor` a poll returns) through to its resolution (once it
 * ages into that poll's `whispers` history, which is the only place the game
 * reveals whether it was actually `truthFlag: 'True'` or `'False'`).
 *
 * This is the whole point of the tracker: the game itself only keeps ~5-9 of
 * these per stock (its own rolling whispers window) and only 30 days of price
 * history, so this table is the only place this data survives past that —
 * see docs/stock-market-tracker-plan.md for what it's for.
 */
export interface StockRumorRecord {
  /** The game's own id for this rumor (e.g. `"BSEC-Y01-R005"`) — stable and
   *  already unique, so it's the primary key rather than a synthetic one. */
  rumorCode: string;
  symbol: string;
  direction: string;
  severity: string;
  quality: string;
  playerText: string;
  generatedHour: number;
  expiresHour: number;
  /** Null while this is still the live, unresolved rumor. Becomes `'True'`/
   *  `'False'` once it appears in a `whispers` list, and never changes again
   *  after that (the game never revises a resolved rumor). */
  truthFlag: 'True' | 'False' | null;
  firstSeenAt: number;
  /** Updated on every poll that still sees this rumor_code, resolved or not —
   *  lets a later analysis tell "still being tracked" apart from "the account
   *  stopped polling a while ago" without needing the poller's own logs. */
  lastSeenAt: number;
  resolvedAt: number | null;
}

/** Runtime status of the background poller in poller.ts — same "simple
 *  nullable, not merged with defaults" shape as CareerAutoStatus, since
 *  there's no meaningful default for "when did this last run". Read by the
 *  in-page overlay (content/features/stockMarket) via a message round-trip,
 *  the only way it can reach this — the overlay runs on the game's origin,
 *  the data lives in the extension's own IndexedDB, which only the
 *  background service worker/popup can open directly. */
export interface StockMarketPollStatus {
  lastPollAt: number | null;
  /** Set on the most recent failed attempt, cleared on the next success —
   *  not accumulated, so a transient failure that later recovers doesn't
   *  keep reading as broken forever. Still set (to the pause reason) while
   *  `paused` is true. */
  lastError: string | null;
  /** True once the poller has hard-stopped itself after a response it
   *  doesn't recognize at all — deliberately narrower than "any failure":
   *  an ordinary rejection (hospitalized, jailed, or anything else the game
   *  reports through its normal `{ok:false,"error":"..."}` channel) is not
   *  cause for this, since that's just the game's regular error reporting,
   *  the same thing a legitimate player would see. This exists for the
   *  genuinely unrecognized case — because blindly retrying an interaction
   *  the game itself may be treating as unusual, indefinitely and
   *  unattended, is a real account-safety question, not just a wasted call.
   *  Same reasoning Career Auto / Street Intel Auto already pause for, ported
   *  here even though this feature spends nothing and risks no game state,
   *  because the risk being guarded against isn't resource loss — it's
   *  unattended repetition of something the game's response says is not
   *  normal. Cleared only by an explicit resume (see poller.ts's `resume`). */
  paused: boolean;
}

/** One entry from `races_v2.php`'s `get_all` — the racing overlay's own list.
 *  Manual/tap-triggered (see `runRace` in `background/features/streetRacing`),
 *  not a background auto-runner, so unlike Crimes/Career Auto there is no
 *  config type here: nothing to pick ahead of time beyond which race the
 *  player taps. `attemptsToday`/`dailyCap` are the server's own count, not a
 *  locally-tracked one — the same call that runs a race also returns the
 *  post-attempt values, so there's nothing to drift out of sync locally. */
export interface RaceCatalogEntry {
  id: number;
  name: string;
  opponentName: string;
  opponentTitle: string;
  cityName: string;
  cashReward: number;
  xpReward: number;
  staminaCost: number;
  dailyAttempts: number;
  attemptsToday: number;
  unlocked: boolean;
  requiredBossId: number | null;
  bossCleared: boolean;
  grudgeLocked: boolean;
  wins: number;
  losses: number;
  currentStreak: number;
  bestStreak: number;
  /** `'district'` or `'family'` — a `'family'` race is one of the five
   *  weekly Family Challenges (Iron River/SBP/Kito-gumi/Viola/Volkskaya),
   *  which are additionally gated by `RaceCatalog.allegiance` regardless of
   *  `unlocked`/`bossCleared` — see `familySlug`'s own doc. */
  raceType: string;
  /** Only set for a `raceType === 'family'` entry — the same
   *  opponent-name-to-slug mapping the live panel's own client JS uses
   *  (`{"Iron River":"iron_river","SBP":"sbp",...}[opponent_name]`) to
   *  decide whether this is the family the player picked for the week.
   *  `null` for a `'district'` race, or if `opponentName` is ever an
   *  unrecognized value the mapping doesn't cover. */
  familySlug: string | null;
}

export interface RaceCatalog {
  weather: string;
  weatherPct: number;
  car: {
    name: string;
    category: string;
    vehicleClass: string;
    topSpeed: number;
    handling: number;
    acceleration: number;
  };
  races: RaceCatalogEntry[];
  /** The one family slug (see `RaceCatalogEntry.familySlug`) the player
   *  picked this week, confirmed from real captures to reset to `null` on a
   *  weekly boundary until they pick again via `choose_family` — a
   *  `'family'`-type race is only actually runnable when this matches its
   *  own `familySlug`; every other family race is locked ("Not Your
   *  Family") for the rest of the week regardless of anything else about
   *  it. */
  allegiance: string | null;
  allegianceFavor: number;
  allegianceCap: number;
}

/** What one manually-triggered race attempt actually did — same "last
 *  attempt" role `CrimeAttemptResult` plays for Crimes Auto, just returned
 *  directly to the overlay's `chrome.runtime.sendMessage` call rather than
 *  only stored, since the overlay needs it immediately to update the race
 *  row that was just run. */
export interface RaceAttemptResult {
  timestamp: number;
  raceId: number;
  raceName: string;
  opponentName: string;
  won: boolean;
  /** The value actually submitted as `accuracy` — sampled from this
   *  account's own real minigame-result spread, see
   *  `STREET_RACING_ACCURACY_MEAN`'s doc for where that spread came from. */
  accuracySent: number;
  cashAwarded: number;
  xpAwarded: number;
  wins: number;
  losses: number;
  attemptsToday: number;
  dailyCap: number;
  currentStreak: number;
}

/** Background-owned lifetime tally for the Street Racing overlay — same
 *  "simple running counters, no daily boundary tracked locally" shape as
 *  Crimes Auto's, since the per-race daily cap is already the server's own
 *  `attemptsToday`/`dailyCap` on each `RaceCatalogEntry`/`RaceAttemptResult`
 *  rather than something this needs to reset itself. */
export interface StreetRacingStatus {
  lastAttempt: RaceAttemptResult | null;
  attempts: number;
  wins: number;
  losses: number;
  cashEarned: number;
  xpEarned: number;
}

/** One owned vehicle from `chop_shop_proto.php`'s `catalog` action — the
 *  Garage & Dealership overlay's own list (confirmed real, 2026-09-17
 *  archive: `GET /api/panel.php?type=chop_shop` titles itself "Garage &
 *  Dealership"). `isEquipped` is the one vehicle the game itself already
 *  refuses to strip or sell the body of — the live panel's own client JS
 *  disables both buttons whenever `equipped` is true, confirmed by reading
 *  its rendered `renderVehicle`/`bind()` — so the overlay mirrors that same
 *  exclusion rather than relying on the server to reject it. */
export interface GarageCar {
  id: number;
  carModelId: number;
  isEquipped: boolean;
  durability: number;
  name: string;
  category: string;
  vehicleClass: string;
  image: string;
  chopValue: number;
  baseSpeed: number;
  baseHandling: number;
  baseAccel: number;
  bonusStr: number;
  bonusDef: number;
  bonusAgl: number;
  bonusDex: number;
  partsFitted: number;
  modifiable: boolean;
  complete: boolean;
}

/** One purchasable model from the same `catalog` call's `dealer` array —
 *  `buyable: false` means the model has no native part set defined server-
 *  side yet (confirmed real: the live panel disables its own Buy button for
 *  exactly this case, labelled "No parts"), not merely unaffordable. */
export interface GarageDealerListing {
  id: number;
  name: string;
  category: string;
  vehicleClass: string;
  image: string;
  baseSpeed: number;
  baseHandling: number;
  baseAccel: number;
  bonusStr: number;
  bonusDef: number;
  bonusAgl: number;
  bonusDex: number;
  priceCash: number;
  pricePlatinum: number;
  modifiable: boolean;
  buyable: boolean;
  owned: boolean;
}

export interface GarageCatalog {
  cars: GarageCar[];
  dealer: GarageDealerListing[];
  cash: number;
  platinum: number;
}

/** The five fitted-component slots every modifiable vehicle has — confirmed
 *  real from both `chop_shop_proto.php`'s `inventory` action (which groups
 *  loose parts by exactly these keys) and the live panel's own client JS
 *  (`SLOT_META`). `aerodynamics` is the wire key for what the UI labels
 *  "Clutch" — kept as the raw key here since every API call and response
 *  uses it verbatim; display code maps it to the label separately. */
export type GarageSlotKey = 'engine' | 'transmission' | 'tires' | 'suspension' | 'aerodynamics';

/** One loose (uninstalled) part from `inventory`'s per-slot arrays — the
 *  same shape a fitted slot's `loadout` entry has, minus `refit_fee`/
 *  `is_native` (fields that only make sense once a part is actually
 *  installed somewhere) plus `fullPrice`/`quicksell` (only meaningful while
 *  it's sitting loose). `originModel` is `null` for a part that never came
 *  off a named vehicle body (unconfirmed whether this actually occurs in
 *  practice — every real capture so far had one — but the field is
 *  nullable in the response shape, so this doesn't assume it's always set). */
export interface GaragePartEntry {
  userPartId: number;
  name: string;
  topSpeed: number;
  accel: number;
  handling: number;
  installFee: number;
  fullPrice: number;
  quicksell: number;
  originModel: string | null;
  locked: boolean;
}

export type GaragePartsInventory = Record<GarageSlotKey, GaragePartEntry[]>;

/** Per-vehicle detail from `get_state` — fetched on demand (not part of the
 *  catalog call) since `bodyQuicksell` is the one real number the Bulk
 *  Delete tab needs before it can total up a confirm price, and there's no
 *  formula worth guessing it from (confirmed real: a 1993 Karnov Uno's
 *  `chop_value` of 1000 quicksold its body for $833, not a clean fraction of
 *  it — see docs/reverse-engineering-formulas conventions, this is exactly
 *  the "don't hand-wave, go get the real number" case). `migrated`/`missing`
 *  back the Fit Parts overlay: a chassis that predates the component system
 *  (`migrated: false`) needs a one-time free `migrate` call before any
 *  `install` will do anything, and `missing` is the exact list of empty
 *  slots — the catalog's own `partsFitted` count says *how many* are empty
 *  but not *which*, which auto-fit planning needs to know before it can
 *  pick compatible spare parts. */
export interface GarageCarState {
  carId: number;
  equipped: boolean;
  complete: boolean;
  partsFitted: number;
  bodyQuicksell: number;
  migrated: boolean;
  missing: GarageSlotKey[];
}

/** `complete` mirrors `get_state`'s own post-install value directly — lets
 *  the Fit Parts overlay know a just-fitted vehicle is now raceable without
 *  a second round trip. */
export interface GarageInstallResult {
  message: string;
  complete: boolean;
}

/** Installs the free native part set on a pre-component-system chassis —
 *  present in the live client JS (`write("migrate", ...)`) but never
 *  actually triggered in either captured archive, so its response shape
 *  beyond `{ok:true,message}` is unconfirmed. Fit Parts treats it as a
 *  zero-cost, all-five-slots-at-once step rather than guessing at anything
 *  more granular. */
export interface GarageMigrateResult {
  message: string;
}

export interface GarageBuyResult {
  message: string;
  userCarId: number;
}

/** `affected` is how many *other* vehicles got unequipped because a part
 *  native to the stripped one was fitted there — confirmed real from the
 *  live panel's own chop confirmation copy, which warns about exactly this
 *  before the call is made. */
export interface GarageStripResult {
  message: string;
  payout: number;
  partsRemoved: number;
  affected: number;
}

export interface GarageSellBodyResult {
  message: string;
  payout: number;
}

/** The highest tier this line has actually had claimed so far — `'unproven'`
 *  means none yet (confirmed real: the live achievements panel's own
 *  `eyebrow` label literally reads "Unproven" for that case, lowercase tier
 *  names — "silver", "gold" — once one has been claimed). Distinct from
 *  `AchievementLine.ready`, which is a *further* tier already earned but not
 *  yet claimed — the panel's own `eyebrow` renders "Ready" for that case,
 *  overriding whatever the last-claimed tier was. */
export type AchievementTierLabel = 'unproven' | 'bronze' | 'silver' | 'gold' | 'crown';

/** A tier crossed but not yet claimed — confirmed real (2026-09-17 archive):
 *  "First Chop"'s `eyebrow` read "Ready" while its `.av2-claim` button paid
 *  $1,000,000 + 25 Mafia Gold, a *different* (smaller) figure than the
 *  $10,000,000 + 100 Gold shown in that same line's own reward preview —
 *  that preview describes the tier *after* this one (see `AchievementLine`'s
 *  own doc), so the ready reward has to be read from the claim button's own
 *  text, never assumed to match the preview. */
export interface AchievementReadyClaim {
  lineId: string;
  /** Already formatted by the game itself ("$1,000,000 + 25 Mafia Gold") —
   *  kept as display text rather than parsed into cash/gold numbers since
   *  nothing here needs to compute with it, only show it. */
  rewardText: string;
}

/** The upcoming tier's requirement and payout — `null` only when every tier
 *  on this line is already claimed (confirmed real: Estate's "Breaking
 *  Ground" line, `eyebrow: "crown"`, next-text literally "All four counts
 *  proven." instead of the usual "requirement · N / M" shape, and no reward
 *  block at all — that specific case is `AchievementLine.allTiersComplete`,
 *  not this type). */
export interface AchievementNextTier {
  /** e.g. "Own 10 unique vehicles" — the game's own plain-English copy. */
  requirementText: string;
  current: number;
  target: number;
  rewardText: string;
}

export interface AchievementLine {
  name: string;
  description: string;
  /** Highest tier already claimed — see `AchievementTierLabel`'s own doc for
   *  why this is never simply "the ready tier" or "the next tier." */
  tier: AchievementTierLabel;
  ready: AchievementReadyClaim | null;
  next: AchievementNextTier | null;
  allTiersComplete: boolean;
}

/** The category-wide bonus for maxing every line in it — confirmed real
 *  only in its locked state so far (every capture so far showed
 *  `locked: true`); an unlocked/claimable Capstone's markup is unconfirmed,
 *  so nothing here assumes one beyond the fields already visible while
 *  locked. */
export interface AchievementCapstone {
  name: string;
  description: string;
  current: number;
  target: number;
  rewardCash: number;
  rewardGold: number;
  locked: boolean;
}

export interface AchievementCategory {
  name: string;
  lines: AchievementLine[];
  capstone: AchievementCapstone | null;
}

/** Response from a single-line `claim` action (as opposed to the
 *  account-wide `claim_all`) — only ever confirmed as `{ok:true,message}` in
 *  the live client JS (`Av2.claimLine`); no real capture of one firing
 *  exists in either archive, unlike `claim_all`'s own confirmed 22-reward
 *  capture, so no `cash`/`gold` fields are assumed here. */
export interface AchievementClaimResult {
  message: string;
}

// --- Arena auto-attack --------------------------------------------------------

export interface ArenaAutoConfig {
  enabled: boolean;
  /** Attack the boss only when its own server-computed `win_pct` (see
   *  `ArenaBossResult`) is at least this — the boss is never shown a "%
   *  CHANCE" badge in-game the way regular opponents are, but the number
   *  exists and is exposed in `open_next_page`'s own response regardless.
   *  Player-set (player's own words: "let us proceed... make the things
   *  that can be editable like so, like the percentage"), default derived
   *  from the same conversation. */
  bossWinPctThreshold: number;
}

export interface ArenaOpponentResult {
  name: string;
  won: boolean;
  /** The opponent's own `win_pct` as shown on the page at the moment this
   *  fight was attempted — recorded per-fight rather than trusted to still
   *  match a page-open-time snapshot, since a `Refresh` (before combat
   *  begins) can change the roster. */
  winPctAtAttack: number;
  bountyEarned: number;
}

export interface ArenaBossResult {
  name: string;
  attacked: boolean;
  won: boolean | null;
  /** Always recorded, whether or not the boss was actually attacked — this
   *  is what a skip decision was judged against, so it belongs in the log
   *  either way. */
  winPct: number;
  /** Non-null only when `attacked` is false — e.g. "43% < 50% threshold". */
  skippedReason: string | null;
}

/** What one fully-automated page cycle actually did — shown in the popup as
 *  "last page", same role `CareerShiftResult`/`CrimeAttemptResult` play for
 *  their own auto-runners. */
export interface ArenaPageResult {
  timestamp: number;
  pageNumber: number;
  /** In the order actually attacked (see runner.ts for the ordering rule),
   *  not necessarily `opponent_ids` order. */
  opponents: ArenaOpponentResult[];
  /** Null only if the boss's own "ENGAGE BOSS" button never appeared at all
   *  this cycle (unconfirmed edge case — every real capture so far reached
   *  it once all four regular opponents were attacked). */
  boss: ArenaBossResult | null;
  banked: number;
  seasonScore: number;
  /** False for a page this cycle didn't finish — an attack, the boss fight,
   *  or `bank` itself came back an unrecognized response partway through
   *  (see runner.ts's `pause`). `opponents`/`boss` still reflect exactly
   *  what actually happened before that point (real fights, real
   *  win/loss), since this is written incrementally as each step
   *  succeeds, not only once at the very end — a partial run has a real
   *  story to tell, not just "it failed." `banked`/`seasonScore` stay 0
   *  when `bank` itself was never reached or itself failed. */
  complete: boolean;
}

export interface ArenaAutoStatus {
  lastPage: ArenaPageResult | null;
  /** The next page's own `unlocks_next_at`, straight from the game — both
   *  what the runner's own alarm aligns to and what the passive "page
   *  unlocked" notification (see runner.ts's `runPassiveCheck`) watches for
   *  independently of whether `enabled` is on. */
  nextUnlockAt: number | null;
  pausedReason: 'error' | null;
  pausedMessage: string | null;
  pausedAt: number | null;
  pagesRun: number;
  totalBanked: number;
  /** True once the game's own "final summons of the day" banner has been
   *  seen — today's 6 Arena pages are fully used. See
   *  `arenaPanelParser.ts`'s `parseIsDayComplete` for the real markup this
   *  is read from. Not an error state (`pausedReason` stays `null` for it) —
   *  purely informational, so the overlay can show "done for today" instead
   *  of an empty countdown. */
  dayComplete: boolean;
}

/** Read-only counterpart to `CourierStatus` — a surface that can't reach
 *  `storage` directly (the in-page overlay) gets both config and status in
 *  one message round-trip instead of two. */
export interface ArenaStatusResponse {
  config: ArenaAutoConfig;
  status: ArenaAutoStatus | null;
}
