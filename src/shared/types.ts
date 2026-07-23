export interface Trade {
  id?: number;
  item: string;
  quantity: number;
  buyDistrict: string;
  sellDistrict: string | null;
  buyPrice: number;
  sellPrice: number | null;
  buyTime: number;
  sellTime: number | null;
  travelCost: number;
  grossProfit: number | null;
  profit: number | null;
  roi: number | null;
  caught: boolean | null;
  bribe: number;
  status: 'open' | 'closed';
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
