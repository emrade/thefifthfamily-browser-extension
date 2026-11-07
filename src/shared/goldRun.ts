import {
  GOLD_RUN_DEFAULT_CAP,
  GOLD_RUN_DEFAULT_GOLD_PER_FIGHT,
  GOLD_RUN_DEFAULT_HEAL_FLOOR_PCT,
  GOLD_RUN_DEFAULT_MIN_CHANCE_PCT,
  GOLD_RUN_MIN_FIGHTS_FOR_OWN_AVERAGE,
  GOLD_RUN_ODDS_MARGIN_PCT,
  GOLD_RUN_ODDS_TTL_MS,
  GOLD_RUN_PAUSE_TTL_MS,
  GOLD_RUN_STAMINA_PER_FIGHT,
} from './constants';
import type { GoldRunConfig, GoldRunFightResult, GoldRunOdds, GoldRunState, GoldRunTarget } from './types';

/**
 * Gold Run's parsing and arithmetic, with no chrome.* or network use, shared by
 * the background runner and the in-page panel. Design and evidence:
 * docs/gold-run-plan.md.
 */

export const DEFAULT_GOLD_RUN_CONFIG: GoldRunConfig = {
  automationEnabled: false,
  minChancePct: GOLD_RUN_DEFAULT_MIN_CHANCE_PCT,
  healFloorPct: GOLD_RUN_DEFAULT_HEAL_FLOOR_PCT,
};

/** The game day a moment belongs to. Gold resets at 23:00 UTC (seen at exactly
 *  23:00:00 on 2026-08-12). If that hour ever moves, the next won fight still
 *  corrects the counter, because a win's `gold_today` always overwrites it. */
export function gameDayKey(now: number): string {
  return new Date(now + 3_600_000).toISOString().slice(0, 10);
}

export function emptyGoldRunState(now: number): GoldRunState {
  return {
    dayKey: gameDayKey(now),
    goldToday: 0,
    goldCap: GOLD_RUN_DEFAULT_CAP,
    fightsToday: 0,
    goldEarnedToday: 0,
    attackedIds: [],
    run: 'idle',
    pauseKind: null,
    pausedAt: null,
    notice: null,
    runFights: 0,
    runGold: 0,
    rejectStreak: 0,
    skipStreak: 0,
    myLevel: null,
    reserveUntil: 0,
    busy: false,
    stamina: null,
    maxStamina: null,
    hp: null,
    maxHp: null,
    targets: [],
    targetsAt: 0,
    hubQuery: null,
    log: [],
  };
}

/** Zeroes yesterday's counters. Everyone can be attacked again on a new day, so
 *  the attacked list and any skip verdicts go too. */
export function withCurrentDay(stored: GoldRunState, now: number): GoldRunState {
  // State saved by 0.60.0 doesn't have these yet.
  const state = stored.skipStreak === undefined ? { ...stored, skipStreak: 0, myLevel: stored.myLevel ?? null } : stored;
  const dayKey = gameDayKey(now);
  if (state.dayKey === dayKey) return state;
  return {
    ...state,
    skipStreak: 0,
    dayKey,
    goldToday: 0,
    goldCap: GOLD_RUN_DEFAULT_CAP,
    fightsToday: 0,
    goldEarnedToday: 0,
    attackedIds: [],
    targets: [],
    targetsAt: 0,
  };
}

export interface GoldRunEstimate {
  goldLeft: number;
  fightsLeft: number;
  staminaNeeded: number;
  /** Null until Stamina has been read once. */
  topUp: number | null;
}

/** Ignores Stamina regen, so it leans slightly high. Today's own average takes
 *  over once there are enough fights for it to mean something. */
export function estimateRemaining(state: GoldRunState): GoldRunEstimate {
  const goldLeft = Math.max(0, state.goldCap - state.goldToday);
  const perFight =
    state.fightsToday >= GOLD_RUN_MIN_FIGHTS_FOR_OWN_AVERAGE && state.goldEarnedToday > 0
      ? state.goldEarnedToday / state.fightsToday
      : GOLD_RUN_DEFAULT_GOLD_PER_FIGHT;
  const fightsLeft = Math.ceil(goldLeft / perFight);
  const staminaNeeded = fightsLeft * GOLD_RUN_STAMINA_PER_FIGHT;
  return { goldLeft, fightsLeft, staminaNeeded, topUp: state.stamina === null ? null : Math.max(0, staminaNeeded - state.stamina) };
}

/** Whether Street Intel Auto should leave Stamina alone. Worked out from the
 *  clock, so a missed expiry alarm can't hold the reserve forever. */
export function holdsStamina(state: GoldRunState | null, now: number): boolean {
  if (!state) return false;
  if (state.run === 'running') return true;
  if (state.run === 'paused' && state.pausedAt !== null && now - state.pausedAt < GOLD_RUN_PAUSE_TTL_MS) return true;
  return state.reserveUntil > now;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const CARD_RE = /<div class="fc-p-card[^"]*"[^>]*data-level="(\d+)"[^>]*data-status="(\w+)"[^>]*>([\s\S]*?)<\/button>/g;

/**
 * Target cards from `panel.php?type=attack_hub`'s `html`. Regex rather than
 * DOMParser because this also runs in the background. Null means this doesn't
 * look like the Fight Club panel at all. `#fc-view-state` was on all 163 pages
 * from Nov 4-5, and no page with zero cards has been captured, so that marker
 * is what tells "nobody left here" apart from "the game changed this page".
 */
export function parseHubTargets(html: string): GoldRunTarget[] | null {
  if (!html.includes('fc-view-state')) return null;
  const targets: GoldRunTarget[] = [];
  for (const match of html.matchAll(CARD_RE)) {
    const body = match[3];
    const id = /attackPlayer\((\d+)\)/.exec(body);
    if (!id) continue;
    const name = /fc-p-name" title="([^"]*)"/.exec(body);
    const rating = /stat-num rating">([\d,]+)/.exec(body);
    targets.push({
      id: Number(id[1]),
      name: name ? decodeEntities(name[1]) : `#${id[1]}`,
      level: Number(match[1]),
      rating: rating ? Number(rating[1].replace(/,/g, '')) : 0,
      online: match[2] === 'online',
      chance: null,
      skipped: null,
    });
  }
  return targets;
}

/**
 * Whether the list continues after this page, from the game's own "Page 1 / 2"
 * label. The label is missing when there's only one page. Asked for a page past
 * the end, the game returns the last page again, so the card count can't tell
 * you this: a last page can hold a full 20 cards. The label's number agreed with
 * the page served on all 249 labelled responses from Nov 1-6, and all 74 without
 * one were page 1.
 */
export function hubHasMorePages(html: string): boolean {
  const label = />Page (\d+) \/ (\d+)</.exec(html);
  return !!label && Number(label[1]) < Number(label[2]);
}

/** Keeps each player's first appearance. The list can shift between page reads,
 *  which puts one player on two pages (seen Nov 5). */
export function uniqueTargets(targets: GoldRunTarget[]): GoldRunTarget[] {
  const seen = new Set<number>();
  return targets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

/** The game's own list query, ready to reuse: without `_t`, and with the two
 *  filters this feature depends on forced on. Every one of the 2,464 archived
 *  list loads had both on, so that's the only combination known to behave. */
export function normaliseHubQuery(url: string): string | null {
  const query = url.split('?')[1];
  if (!query) return null;
  const params = new URLSearchParams(query);
  if (params.get('type') !== 'attack_hub') return null;
  params.delete('_t');
  params.set('fc_fresh', '1');
  params.set('fc_same_dist', '1');
  return params.toString();
}

export function hubQueryForPage(query: string, page: number, now: number): string {
  const params = new URLSearchParams(query);
  params.set('radar_page', String(page));
  params.set('_t', String(now));
  return params.toString();
}

/** Parses a full `POST /actions/attack.php` response. Null means it isn't the
 *  fight shape every `ok:true` response on record has (1,425 of 1,425). */
export function parseFightResult(json: any): GoldRunFightResult | null {
  if (json?.ok !== true || typeof json.won !== 'boolean') return null;
  const stats = json.stats;
  if (!stats || typeof stats.vitality !== 'number' || typeof stats.stamina !== 'number') return null;
  if (typeof json.gold_gained !== 'number' || typeof json.gold_today !== 'number' || typeof json.gold_cap !== 'number') return null;
  return {
    won: json.won,
    defender: typeof json.defender === 'string' ? json.defender : '',
    defenderLevel: Number(json.def_level) || 0,
    goldGained: json.gold_gained,
    goldToday: json.gold_today,
    goldCap: json.gold_cap,
    attackerLevel: Number(json.att_level) || 0,
    xpGained: Number(json.xp_gained) || 0,
    cashStolen: Number(json.cash_stolen) || 0,
    stamina: stats.stamina,
    maxStamina: Number(stats.max_stamina) || 0,
    hp: stats.vitality,
    maxHp: Number(stats.max_vitality) || 0,
  };
}

export type AttackRejection = 'target-unavailable' | 'no-stamina' | 'self-hospitalized' | 'unknown';

/** The four rejection wordings on record. Anything else is `unknown`, which
 *  pauses a run for the player to look at. */
export function classifyAttackRejection(message: string): AttackRejection {
  if (/already hospitalized|different district/i.test(message)) return 'target-unavailable';
  if (/not enough stamina/i.test(message)) return 'no-stamina';
  if (/cannot attack while hospitalized/i.test(message)) return 'self-hospitalized';
  return 'unknown';
}

/** Highest level first (it pays best), offline only (3 of 1,425 fights were
 *  against online players, so nothing is known about attacking them). */
export function nextCandidate(targets: GoldRunTarget[]): GoldRunTarget | null {
  let best: GoldRunTarget | null = null;
  for (const t of targets) {
    if (t.skipped || t.online) continue;
    if (!best || t.level > best.level) best = t;
  }
  return best;
}

/**
 * Rules that skip a target without sending a recon, so a run doesn't scan target
 * after target. Above your own level: nobody at 140+ reached 60% with the player
 * at level 137-138 (0 of 11, Nov 4-5). Remembered low odds: see
 * `GOLD_RUN_ODDS_MARGIN_PCT`. Targets already skipped keep their reason.
 */
export function withoutReconSkips(targets: GoldRunTarget[], myLevel: number | null, odds: GoldRunOdds, minChancePct: number, now: number): GoldRunTarget[] {
  return targets.map((t) => {
    if (t.skipped) return t;
    if (myLevel !== null && myLevel > 0 && t.level > myLevel) return { ...t, skipped: 'Above your level' };
    const known = odds[t.id];
    if (known && now - known.at < GOLD_RUN_ODDS_TTL_MS && known.chance < minChancePct - GOLD_RUN_ODDS_MARGIN_PCT) {
      return { ...t, chance: known.chance, skipped: `${known.chance}% last check` };
    }
    return t;
  });
}

/** Adds one recon's odds and drops anything past its time. */
export function rememberOdds(odds: GoldRunOdds, targetId: number, chance: number, now: number): GoldRunOdds {
  const kept: GoldRunOdds = {};
  for (const [id, entry] of Object.entries(odds)) {
    if (now - entry.at < GOLD_RUN_ODDS_TTL_MS) kept[Number(id)] = entry;
  }
  kept[targetId] = { chance, at: now };
  return kept;
}

/** Folds in a re-read first page: adds who's new, and drops anyone missing from
 *  it who, by level, should have appeared. They've moved or gone to hospital. */
export function mergeFirstPage(current: GoldRunTarget[], page: GoldRunTarget[], attackedIds: number[], sortedByLevel: boolean): GoldRunTarget[] {
  const known = new Map(current.map((t) => [t.id, t]));
  const onPage = new Set(page.map((t) => t.id));
  const lowest = page.length ? Math.min(...page.map((t) => t.level)) : 0;
  const kept = current.filter((t) => onPage.has(t.id) || !sortedByLevel || !page.length || t.level <= lowest);
  const added = page.filter((t) => !known.has(t.id) && !attackedIds.includes(t.id));
  const refreshed = kept.map((t) => {
    const fresh = page.find((p) => p.id === t.id);
    return fresh ? { ...fresh, chance: t.chance, skipped: t.skipped } : t;
  });
  return [...refreshed, ...added].sort((a, b) => b.level - a.level);
}
