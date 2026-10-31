import { cardMinimumFor } from './streetIntelCardMinimum';
import type { StreetIntelAutoConfig } from './types';

/**
 * Street Intel Analytics — the records background keeps (see
 * background/features/streetIntel/analytics/) and the pure summary built from
 * them for the Analytics tab in the popup and the in-page panel.
 *
 * Kept free of storage and DOM so the same numbers can be checked against the
 * archive offline: the summary is a function of the records, the config and
 * the clock, nothing else.
 */

export type SiRisk = 'low' | 'medium' | 'high' | 'extreme';

/** One card as the board showed it, first and last time it was seen. */
export interface SiCardRecord {
  id: number;
  firstSeen: number;
  lastSeen: number;
  risk: SiRisk;
  legendary: boolean;
  rewardMin: number;
  rewardMax: number;
  /** The attempt's own Stamina cost. */
  stamina: number;
  scoutCost: number;
}

export interface SiDrop {
  name: string;
  quality: string | null;
  type: string | null;
  /** Drops with a banner header (alignment shards, event currency) aren't
   *  sellable items. */
  header: boolean;
}

/** One attempt, manual or automated, with its complication outcome and drops. */
export interface SiAttemptRecord {
  id: number;
  at: number;
  origin: 'page' | 'background';
  band: string;
  reward: number;
  jailSeconds: number;
  complication: boolean;
  complicationSuccess: boolean | null;
  /** Cash a failed complication took back (hand + bank). */
  cashLost: number;
  drops: SiDrop[];
  /** The card as last seen before the attempt — null if the board was never
   *  read while it was listed. */
  card: Omit<SiCardRecord, 'id' | 'firstSeen' | 'lastSeen'> | null;
}

/** Per-game-day totals that don't belong to one card. */
export interface SiAnalyticsDay {
  day: string;
  /** Stamina spent on paid scouts (`cached` re-scouts are free). */
  scoutStamina: number;
}

export interface SiDaySummary {
  day: string;
  attempts: number;
  fails: number;
  /** Cash won minus cash complications took back. */
  cash: number;
  drops: number;
  /** Estimated sale value of the drops. */
  dropValue: number;
  /** Attempt Stamina plus paid scouts. */
  stamina: number;
  topDrop: { name: string; value: number } | null;
}

export interface SiCell {
  risk: SiRisk;
  band: string;
  attempts: number;
  failPct: number;
  cashPerStamina: number;
}

export interface SiSupply {
  /** Stamina's worth of cards at or above the minimum that appeared today. */
  todayStamina: number;
  todaySpent: number;
  /** Daily averages over `days` recent complete days, null without any. */
  avgStamina: number | null;
  avgSpent: number | null;
  days: number;
}

export interface SiSuggestion {
  value: number;
  /** Daily Stamina's worth of cards at or above `value`, and Stamina spent. */
  supply: number;
  spent: number;
  days: number;
}

/** One extreme-card minimum and what it would have changed per day, over
 *  the card value table's window. `value` 0 is the rule switched off. */
export interface SiExtremeOption {
  value: number;
  /** Extreme attempts at or above your minimum card value that it skips. */
  skipped: number;
  cashPerDay: number;
  failsPerDay: number;
}

export interface SiExtremeSuggestion {
  /** 0 means leave the rule off. */
  value: number;
  options: SiExtremeOption[];
  /** Average cash per day over the window, for scale. */
  dailyCash: number;
  days: number;
}

export interface StreetIntelAnalytics {
  generatedAt: number;
  today: SiDaySummary;
  /** Average of up to 7 previous days with attempts. */
  average: SiDaySummary | null;
  averageDays: number;
  /** Up to 7 most recent days with attempts, today first. */
  recentDays: SiDaySummary[];
  cells: SiCell[];
  cellDays: number;
  supply: SiSupply;
  suggestion: SiSuggestion | null;
  /** Why there's no suggestion, when there isn't one. */
  suggestionNote: string | null;
  extremeSuggestion: SiExtremeSuggestion | null;
  extremeSuggestionNote: string | null;
  /** Oldest attempt on record, so the tab can say how far back it goes. */
  since: number | null;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The game's day turns over at 23:00 UTC (the player's midnight, WAT) — see
 *  memory `game_daily_reset_time`. Keyed as the player's calendar date. */
export function gameDay(ts: number): string {
  return new Date(ts + HOUR_MS).toISOString().slice(0, 10);
}

/** When a `gameDay` key's day begins (23:00 UTC the evening before). */
function gameDayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) - HOUR_MS;
}

/** Typical `dispose_quote` cash per quality, for an item never quoted
 *  itself — the averages across every quote archived through 2026-10-28. */
const QUALITY_TYPICAL_PRICE: Record<string, number> = {
  gold: 33_300_000,
  underworld_epic: 15_625_000,
  purple: 1_890_000,
  infamous_rare: 550_000,
  blue: 240_000,
  green: 18_400,
  grey: 21_000,
};

/** Not inventory items: a cash box is already cash, the rest are currencies
 *  or used straight away. */
const NON_ITEM_DROP_TYPES = new Set(['consumable', 'cash_box', 'platinum', 'mafia_gold']);

/** `prices`: sell quotes by lowercased item name — the inventory's
 *  `QuickSellPriceBook.quotesByName` over the archive-built seed. */
export function dropValue(drop: SiDrop, prices: Map<string, number>): number {
  if (drop.header || (drop.type && NON_ITEM_DROP_TYPES.has(drop.type))) return 0;
  return prices.get(drop.name.toLowerCase()) ?? QUALITY_TYPICAL_PRICE[drop.quality ?? ''] ?? 0;
}

export function isFailure(band: string): boolean {
  return band === 'failure' || band === 'disaster';
}

export function cardMidpoint(card: { rewardMin: number; rewardMax: number }): number {
  return (card.rewardMin + card.rewardMax) / 2;
}

const VALUE_BANDS: [number, string][] = [
  [250_000, 'Under $250k'],
  [500_000, '$250k–500k'],
  [1_000_000, '$500k–1M'],
  [2_000_000, '$1M–2M'],
  [Infinity, '$2M+'],
];

function valueBand(midpoint: number): string {
  return VALUE_BANDS.find(([limit]) => midpoint < limit)![1];
}

/** How many recent days feed the averages and the suggestion. */
const RECENT_DAYS = 7;
/** How far back the card value table looks. */
const CELL_DAYS = 30;
/** A cell needs this many attempts before its rates mean anything. */
const CELL_MIN_ATTEMPTS = 5;
/** A day counts toward supply only if the board was read enough to see it. */
const SUPPLY_MIN_CARDS = 30;
const SUPPLY_MIN_ATTEMPTS = 5;
/** The suggestion needs at least this many such days. */
const SUGGESTION_MIN_DAYS = 3;
/** Cards at or above the suggestion should add up to this multiple of the
 *  Stamina spent. Some slack, because a card on the board isn't always one
 *  you can take — it can expire during a cooldown or cost more than you hold.
 *  Over Oct 12–30 this lands at $700–800k, where the board replay paid best. */
const SUGGESTION_SUPPLY_MARGIN = 1.1;
const SUGGESTION_STEP = 50_000;
const SUGGESTION_MAX = 5_000_000;

/** Extreme minimums the tab weighs. */
const EXTREME_OPTIONS = [1_000_000, 1_500_000, 2_000_000, 3_000_000];
/** An option is only judged on at least this many skipped attempts. */
const EXTREME_MIN_SKIPPED = 15;
/** An option is only suggested if it adds at least this share of daily
 *  cash — smaller differences are noise at these sample sizes. Judged on
 *  cash alone: failures already cost their Stamina, and their longer lockout
 *  (12–15 min against 8 for a success, Oct 2026) mostly overlaps time spent
 *  waiting for Stamina anyway. */
const EXTREME_MIN_CASH_GAIN = 0.01;

type CardMinimumConfig = Pick<StreetIntelAutoConfig, 'minCardValue' | 'extremeMinEnabled' | 'extremeMinValue'>;

function summarizeDay(day: string, attempts: SiAttemptRecord[], scoutStamina: number, prices: Map<string, number>): SiDaySummary {
  let cash = 0;
  let fails = 0;
  let stamina = scoutStamina;
  let drops = 0;
  let value = 0;
  let topDrop: SiDaySummary['topDrop'] = null;
  for (const a of attempts) {
    cash += a.reward - a.cashLost;
    if (isFailure(a.band)) fails++;
    stamina += a.card?.stamina ?? 0;
    for (const d of a.drops) {
      const v = dropValue(d, prices);
      drops++;
      value += v;
      if (v > 0 && (!topDrop || v > topDrop.value)) topDrop = { name: d.name, value: v };
    }
  }
  return { day, attempts: attempts.length, fails, cash, drops, dropValue: value, stamina, topDrop };
}

function averageOf(days: SiDaySummary[]): SiDaySummary | null {
  if (days.length === 0) return null;
  const mean = (pick: (d: SiDaySummary) => number) => days.reduce((sum, d) => sum + pick(d), 0) / days.length;
  return {
    day: 'average',
    attempts: mean((d) => d.attempts),
    fails: mean((d) => d.fails),
    cash: mean((d) => d.cash),
    drops: mean((d) => d.drops),
    dropValue: mean((d) => d.dropValue),
    stamina: mean((d) => d.stamina),
    topDrop: null,
  };
}

/** Stamina's worth of the day's new cards that clear `minimum` (the extreme
 *  rule applied as configured) — what the runner could have spent on. */
function supplyAt(cards: SiCardRecord[], minimum: number, config: CardMinimumConfig): number {
  const rule = { ...config, minCardValue: minimum };
  let stamina = 0;
  for (const c of cards) {
    if (cardMidpoint(c) >= cardMinimumFor(c.risk, rule)) stamina += c.stamina + c.scoutCost;
  }
  return stamina;
}

export function buildStreetIntelAnalytics(
  attempts: SiAttemptRecord[],
  cards: SiCardRecord[],
  days: SiAnalyticsDay[],
  prices: Map<string, number>,
  config: CardMinimumConfig,
  now: number,
  /** The oldest card `cards` can hold (load window or retention): a day
   *  starting before it is only partly there, and its supply would read
   *  low. On 2026-10-31 a 9-day load window cut Oct 22 to 242 of its 431
   *  cards and dragged the suggestion from $800k to $550k. */
  cardsSince = 0,
): StreetIntelAnalytics {
  const today = gameDay(now);

  const attemptsByDay = new Map<string, SiAttemptRecord[]>();
  for (const a of attempts) {
    const key = gameDay(a.at);
    const list = attemptsByDay.get(key);
    if (list) list.push(a);
    else attemptsByDay.set(key, [a]);
  }
  const cardsByDay = new Map<string, SiCardRecord[]>();
  for (const c of cards) {
    const key = gameDay(c.firstSeen);
    const list = cardsByDay.get(key);
    if (list) list.push(c);
    else cardsByDay.set(key, [c]);
  }
  const scoutByDay = new Map(days.map((d) => [d.day, d.scoutStamina]));

  const summaries = new Map<string, SiDaySummary>();
  for (const [day, list] of attemptsByDay) summaries.set(day, summarizeDay(day, list, scoutByDay.get(day) ?? 0, prices));
  const todaySummary = summaries.get(today) ?? summarizeDay(today, [], scoutByDay.get(today) ?? 0, prices);

  const previous = [...summaries.values()].filter((d) => d.day < today).sort((a, b) => (a.day < b.day ? 1 : -1));
  const averageWindow = previous.slice(0, RECENT_DAYS);
  const recentDays = [...(todaySummary.attempts > 0 ? [todaySummary] : []), ...previous].slice(0, RECENT_DAYS);

  // Results by card value and risk, last CELL_DAYS days, best cash per Stamina first.
  const cellFrom = now - CELL_DAYS * DAY_MS;
  const cellMap = new Map<string, { risk: SiRisk; band: string; attempts: number; fails: number; cash: number; stamina: number }>();
  for (const a of attempts) {
    if (a.at < cellFrom || !a.card) continue;
    const band = valueBand(cardMidpoint(a.card));
    const key = `${a.card.risk}|${band}`;
    const cell = cellMap.get(key) ?? { risk: a.card.risk, band, attempts: 0, fails: 0, cash: 0, stamina: 0 };
    cell.attempts++;
    if (isFailure(a.band)) cell.fails++;
    cell.cash += a.reward - a.cashLost;
    cell.stamina += a.card.stamina + a.card.scoutCost;
    cellMap.set(key, cell);
  }
  const cells: SiCell[] = [...cellMap.values()]
    .filter((c) => c.attempts >= CELL_MIN_ATTEMPTS && c.stamina > 0)
    .map((c) => ({ risk: c.risk, band: c.band, attempts: c.attempts, failPct: (c.fails / c.attempts) * 100, cashPerStamina: c.cash / c.stamina }))
    .sort((a, b) => b.cashPerStamina - a.cashPerStamina);

  // Board supply vs Stamina spent, on days the board was actually watched.
  const supplyDays = previous
    .filter(
      (d) =>
        gameDayStart(d.day) >= cardsSince && d.attempts >= SUPPLY_MIN_ATTEMPTS && (cardsByDay.get(d.day)?.length ?? 0) >= SUPPLY_MIN_CARDS,
    )
    .slice(0, RECENT_DAYS);
  const mean = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);
  const supply: SiSupply = {
    todayStamina: supplyAt(cardsByDay.get(today) ?? [], config.minCardValue, config),
    todaySpent: todaySummary.stamina,
    avgStamina: mean(supplyDays.map((d) => supplyAt(cardsByDay.get(d.day) ?? [], config.minCardValue, config))),
    avgSpent: mean(supplyDays.map((d) => d.stamina)),
    days: supplyDays.length,
  };

  // Suggested minimum: the highest value whose cards still add up to the
  // Stamina you actually spend, with some margin.
  let suggestion: SiSuggestion | null = null;
  let suggestionNote: string | null = null;
  if (supplyDays.length < SUGGESTION_MIN_DAYS) {
    suggestionNote = `Needs ${SUGGESTION_MIN_DAYS} days with the board watched and attempts made — has ${supplyDays.length}.`;
  } else {
    const spent = mean(supplyDays.map((d) => d.stamina))!;
    const supplyFor = (minimum: number) => mean(supplyDays.map((d) => supplyAt(cardsByDay.get(d.day) ?? [], minimum, config)))!;
    let value = 0;
    for (let v = SUGGESTION_MAX; v >= SUGGESTION_STEP; v -= SUGGESTION_STEP) {
      if (supplyFor(v) >= spent * SUGGESTION_SUPPLY_MARGIN) {
        value = v;
        break;
      }
    }
    suggestion = { value, supply: supplyFor(value), spent, days: supplyDays.length };
  }

  // Extreme card minimum: for each option, the extreme cards it would skip
  // (worth at least your minimum card value, under the option) against
  // high/medium/low cards of the same value range taken instead, per
  // Stamina. Suggests the option that adds the most cash, if it adds at
  // least EXTREME_MIN_CASH_GAIN of daily cash; otherwise off.
  let extremeSuggestion: SiExtremeSuggestion | null = null;
  let extremeSuggestionNote: string | null = null;
  const windowAttempts = attempts.filter((a) => a.at >= cellFrom && a.card);
  const windowDays = new Set(windowAttempts.map((a) => gameDay(a.at))).size;
  if (windowDays > 0) {
    const dailyCash = windowAttempts.reduce((sum, a) => sum + a.reward - a.cashLost, 0) / windowDays;
    const options: SiExtremeOption[] = [{ value: 0, skipped: 0, cashPerDay: 0, failsPerDay: 0 }];
    for (const value of EXTREME_OPTIONS) {
      if (value <= config.minCardValue) continue;
      const inRange = windowAttempts.filter((a) => {
        const mid = cardMidpoint(a.card!);
        return mid >= config.minCardValue && mid < value;
      });
      const skipped = inRange.filter((a) => a.card!.risk === 'extreme');
      const others = inRange.filter((a) => a.card!.risk !== 'extreme');
      if (skipped.length < EXTREME_MIN_SKIPPED || others.length < EXTREME_MIN_SKIPPED) continue;
      const stamina = (xs: SiAttemptRecord[]) => xs.reduce((sum, a) => sum + a.card!.stamina + a.card!.scoutCost, 0);
      const cash = (xs: SiAttemptRecord[]) => xs.reduce((sum, a) => sum + a.reward - a.cashLost, 0);
      const fails = (xs: SiAttemptRecord[]) => xs.filter((a) => isFailure(a.band)).length;
      const skippedStamina = stamina(skipped);
      const otherStamina = stamina(others);
      options.push({
        value,
        skipped: skipped.length,
        cashPerDay: ((cash(others) / otherStamina) * skippedStamina - cash(skipped)) / windowDays,
        failsPerDay: ((fails(others) / otherStamina) * skippedStamina - fails(skipped)) / windowDays,
      });
    }
    if (options.length === 1) {
      extremeSuggestionNote = `Needs at least ${EXTREME_MIN_SKIPPED} extreme and ${EXTREME_MIN_SKIPPED} other attempts above your minimum card value in the last ${CELL_DAYS} days.`;
    } else {
      const best = options
        .filter((o) => o.value > 0 && o.cashPerDay >= EXTREME_MIN_CASH_GAIN * dailyCash)
        .sort((a, b) => b.cashPerDay - a.cashPerDay)[0];
      extremeSuggestion = { value: best?.value ?? 0, options, dailyCash, days: windowDays };
    }
  }

  const since = attempts.reduce<number | null>((min, a) => (min === null || a.at < min ? a.at : min), null);

  return {
    generatedAt: now,
    today: todaySummary,
    average: averageOf(averageWindow),
    averageDays: averageWindow.length,
    recentDays,
    cells,
    cellDays: CELL_DAYS,
    supply,
    suggestion,
    suggestionNote,
    extremeSuggestion,
    extremeSuggestionNote,
    since,
  };
}
