export interface Trade {
  id?: number;
  item: string;
  quantity: number;
  buyDistrict: string;
  sellDistrict: string | null;
  buyPrice: number;
  sellPrice: number | null;
  buyTime: number;
  /** The most recent buy leg folded into this trade (a trade can be filled over
   * several purchases). Used only to recognise a stacked network hook re-posting the
   * same physical buy — see openTrade() in tradeMatcher.ts. Optional because trades
   * recorded before multi-leg buys were supported have no leg history, and because a
   * trade inferred by cargoReconciler.ts never saw a buy request at all. */
  lastBuyTime?: number;
  lastBuyQuantity?: number;
  sellTime: number | null;
  travelCost: number;
  grossProfit: number | null;
  profit: number | null;
  roi: number | null;
  caught: boolean | null;
  bribe: number;
  /** How many separate bribe-resolution CustomsEvents were summed into `bribe` — a
   * lump-sum dollar figure alone can look wrong/surprising when it's actually the
   * total of more than one payment; showing the count makes that visible instead of
   * requiring a devtools dig to explain a number that looks too high. */
  bribeCount: number;
  status: 'open' | 'closed';
  /** True when this trade's buy or sell side (or both) was never actually captured —
   * inferred instead from a held-cargo mismatch (see cargoReconciler.ts), most often
   * because the other half happened via the game's mobile app, which the extension
   * has no way to observe. Distinguishes an inferred number from a directly captured
   * one so the UI can flag it rather than presenting a guess as a precise figure. */
  reconciled: boolean;
}

export interface PriceSnapshot {
  id?: number;
  timestamp: number;
  district: string;
  item: string;
  price: number;
  type: 'buy' | 'sell';
  trendPct: number | null;
}

export interface CustomsEvent {
  id?: number;
  timestamp: number;
  item: string | null;
  quantity: number | null;
  cargoValue: number | null;
  bribe: number;
  displayedRisk: number | null;
  district: string | null;
  resolution: 'bribe' | 'run' | 'surrender';
  caught: boolean;
  cargoLost: boolean;
  jailSeconds: number | null;
}

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

/** One `action=travel` leg — the trade matcher sums taxi fares of every leg between
 * a trade's buyTime and sellTime into Trade.travelCost. */
export interface TravelLeg {
  id?: number;
  timestamp: number;
  destinationCityId: number;
  method: 'walk' | 'taxi';
  cost: number;
}

/**
 * Cached from the most recent smuggling-panel view. Customs raid screens never carry
 * cargo type/qty/value or a risk number themselves — see "Customs cargo attribution"
 * in docs/trade-assistant-plan.md — so this is what a detected raid gets attributed
 * against.
 */
export interface LastSmugglingContext {
  district: string;
  borderSeizureRisk: number;
  heldItem: string | null;
  heldQuantity: number;
  cargoCapacity: number;
  /** Absolute epoch ms when the market next shifts, derived from the panel's
   * `data-seconds` countdown at capture time — stored absolute so a countdown
   * computed later (e.g. when the popup opens) stays accurate rather than going
   * stale the moment it's read. Null if the panel didn't carry a timer. */
  marketShiftAt: number | null;
  timestamp: number;
}

/** A raid detected but not yet resolved — completed into a CustomsEvent once the
 * player picks bribe/run/surrender. */
export interface PendingCustoms {
  district: string;
  bribe: number;
  displayedRisk: number;
  item: string | null;
  quantity: number | null;
  cargoValue: number | null;
  timestamp: number;
}

/**
 * One (cargo fullness %, displayed risk %) reading — recorded on every smuggling
 * panel view, regardless of whether anything is held. Lets the Customs Calculator
 * interpolate a real, account-specific fullness→risk curve instead of relying on
 * the single most recent reading or an unverified third-party formula.
 */
export interface RiskObservation {
  id?: number;
  timestamp: number;
  fullnessPct: number;
  riskPct: number;
}

/**
 * Shared between the content-side DOM-based parser (smugglingPanelAdapter.ts) and the
 * background-side regex-based parser (marketPoller.ts's parser) — MV3 service workers
 * don't reliably have DOMParser, so the background poller needs its own DOM-free
 * implementation, but both should produce the exact same shape.
 */
export interface SmugglingListing {
  kind: 'listing';
  district: string;
  hiddenCargo: { current: number; max: number };
  borderSeizureRisk: number;
  marketShiftSeconds: number | null;
  entries: {
    item: string;
    isLocal: boolean;
    price: number;
    trendPct: number | null;
    stash: number;
  }[];
}

export interface SmugglingRaid {
  kind: 'raid';
  district: string;
  bribe: number;
}

export type SmugglingPanelResult = SmugglingListing | SmugglingRaid | null;

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

/**
 * A pet's own `user_pet_id` plus its capacity/speed stats — see
 * docs/smuggling-v2-plan.md's "Pet roster discovery" note. Only learnable from a
 * `smug_tab=proto` response when the account has zero active shipments; persisted
 * once learned so the courier automation doesn't need that rare state on every run.
 */
export interface PetRosterEntry {
  userPetId: number;
  name: string;
  tier: string;
  capacity: number;
  travelPenaltyPct: number;
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

/** Everything `smugglingV2PanelAdapter.ts` can pull from one `smug_tab=proto`
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
  stoppedReason: 'daily-cap-reached' | 'insufficient-funds' | 'no-idle-pets' | 'no-destination-available' | 'session-error' | 'shape-changed' | null;
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

/** Read-only snapshot for the in-page floating panel to render without
 *  triggering a run — the panel runs on the *game's* origin, not the
 *  extension's, so it can't reach `db.petRoster`/`storage` directly and has to
 *  ask background for this the same way it asks for a run. */
export interface CourierStatus {
  roster: PetRosterEntry[];
  lastRun: CourierRunSummary | null;
}
