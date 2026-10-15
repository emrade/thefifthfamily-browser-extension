import type { ArenaLineupPoints, ArenaMyProfile, ArenaTrackRecord, ArenaVerdictTally } from './types';

/**
 * The Arena V2 kill-race model from docs/arena-combat-mechanics.md, as pure
 * functions: turn an opponent card (STR / DEF / level, plus the Passive tag
 * and the game's quoted %) and the player's own season numbers into a score
 * and a verdict, and verdicts plus bounties into an expected pot. Re-derived
 * against every real fight in the archives by
 * verification/arena/verify_combat_rule.py (2026-10-05, 387 fights: regular
 * score ≥ 1.2 won 176/176, < 0.8 won 3/57; boss ≥ 1.3 won 24/24; re-run
 * 2026-10-15 with the random minimum-damage ceiling, 685 fights each scored
 * with only the fights before it: regular ≥ 1.2 won 315/315, boss ≥ 1.3 won
 * 59/60). Update the coefficients here and there together.
 */

/** Mean of the five "minimum damage" steps, as a fraction of the attacker's
 *  mean base damage. About 95% of all logged hits land on this floor,
 *  because base damage rarely beats the defender's reduction. Measured 8.5%
 *  for the player and 9.1% for opponents; one shared 8.8% fits the actual
 *  results best (only the ratio between the two sides matters). */
export const FLOOR_FRACTION = 0.088;

/** Each minimum-damage hit is its step or a ceiling rolled between these
 *  two (whole numbers, inclusive), whichever is lower. Every logged
 *  `min_dmg` fits (15,435 hits, 2026-09-09 → 10-15); none is over 75. At the
 *  player's 850-HP loadout (steps 42/56/70/84/98) the logged values cover
 *  every number from 45 to 75 and average ~55, where a fixed cap at 75 would
 *  give only 42/56/70/75 and average ~64. It only bites once base damage
 *  passes ~370 (the top step reaching 45). */
export const MIN_DAMAGE_CEILING_LOW = 45;
export const MIN_DAMAGE_CAP = 75;

/** Expected value of min(x, ceiling) over the rolled ceiling. */
function underCeiling(x: number): number {
  if (x <= MIN_DAMAGE_CEILING_LOW) return x;
  let sum = 0;
  for (let c = MIN_DAMAGE_CEILING_LOW; c <= MIN_DAMAGE_CAP; c++) sum += Math.min(x, c);
  return sum / (MIN_DAMAGE_CAP - MIN_DAMAGE_CEILING_LOW + 1);
}

/** The five minimum-damage steps are 3:4:5:6:7 of a common unit (the
 *  player's were 21/28/35/42/49 at base ~431, then 24/33/41/49/58 at ~480),
 *  so their mean is `FLOOR_FRACTION` of base. */
const MIN_DAMAGE_STEPS = [3, 4, 5, 6, 7].map((n) => (FLOOR_FRACTION * n) / 5);

/** Expected minimum-damage hit for a mean base damage: the five steps'
 *  mean, each under the rolled ceiling. Tops out at 60 (the ceiling's mean). */
export function minDamage(base: number): number {
  return MIN_DAMAGE_STEPS.reduce((sum, step) => sum + underCeiling(step * base), 0) / MIN_DAMAGE_STEPS.length;
}

/** Lowest base damage whose expected minimum-damage hit reaches `hit`;
 *  Infinity when the ceiling puts it out of reach. */
function baseForMinDamage(hit: number): number {
  let lo = 0;
  let hi = MIN_DAMAGE_CAP / MIN_DAMAGE_STEPS[0];
  if (minDamage(hi) < hit) return Infinity;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (minDamage(mid) >= hit) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Score bands. ≥ BEATABLE has won every time so far; < AVOID almost never.
 *  Re-checked 2026-10-15 with the random ceiling: regular ≥ 1.2 won 315/315,
 *  and the 850-HP loadout's three regular losses score 1.11–1.13. */
export const SCORE_BEATABLE = 1.2;
export const SCORE_AVOID = 0.8;
/** Bosses need a higher score to be safe. Re-checked 2026-10-05 on 57 boss
 *  fights: every boss scoring 1.3+ was won (24/24), but 1.1–1.3 went 23/27 —
 *  all four non–Iron River boss losses (Kito-gumi STR 821/871, Volkskaya
 *  857/885) scored 1.13–1.22, as boss HP grew with level (645 at level 110).
 *  2026-10-15, 103 bosses: 1.3+ won 59/60 (the loss: Rachel Kim, 1.33,
 *  10-10); Priya Nair's 10-15 loss now scores 1.28, a coin-flip. */
export const SCORE_BOSS_BEATABLE = 1.3;

/**
 * Real win rate per verdict band, from 685 archived Arena V2 fights
 * (2026-09-09 → 10-15; verification/arena/verify_combat_rule.py, section 8,
 * which scores each fight with only the fights before it, as the advisor
 * does). Used to turn verdicts into an expected pot, not shown as a precise %.
 */
const WIN_CHANCE = {
  regular: {
    beatable: 0.99, // 315/315
    avoid: 0.04, // 3/76
    // Lean = quoted ≥ 50% (see COINFLIP_LEAN_QUOTED_PCT).
    coinflipLow: { leanWin: 0.73, leanLoss: 0.24 }, // score 0.8–1.0: 19/26, 15/63
    coinflipHigh: { leanWin: 0.71, leanLoss: 0.55 }, // score 1.0–1.2: 48/68, 16/29
  },
  boss: {
    beatable: 0.98, // score ≥ 1.3: 59/60
    coinflip: 0.87, // score 0.8–1.3: 39/45
    avoid: 0.4, // score < 0.8: 1/3 (2/5 before the ceiling fix); too few to refit
  },
} as const;

/** Expected points a fresh set of four regular opponents banks when played
 *  riskiest first, from 136 real lineups: mean 87 (103 last season, 77 this
 *  one). Only the fallback: it moves a lot with the loadout (re-checked
 *  2026-10-15 on 287 lineups: mean 55 at max HP 710, 109 at 737, 86 at 804,
 *  153 at 850), so the advisor measures the lineups it sees itself
 *  (`lineupBenchmark`) and uses this until it has enough of them. */
export const TYPICAL_LINEUP_POINTS = 87;

/** Fresh lineups needed with the current loadout before their own average
 *  replaces `TYPICAL_LINEUP_POINTS` (a lineup's expected points spread
 *  roughly ±45, so 8 puts the mean within ~±16). */
export const ARENA_LINEUP_MIN_SAMPLES = 8;
export const ARENA_LINEUP_MAX_SAMPLES = 60;

/** Adds one fresh lineup's expected points. A lineup already counted (same
 *  key) is left alone, so repaints don't count it twice; a new max HP starts
 *  the record over. */
export function recordLineup(
  prev: ArenaLineupPoints | null,
  lineup: { maxHp: number; key: string; points: number; at: number },
): ArenaLineupPoints {
  const same = prev !== null && prev.maxHp === lineup.maxHp ? prev.lineups : [];
  if (same.some((l) => l.key === lineup.key)) return prev!;
  return {
    maxHp: lineup.maxHp,
    lineups: [...same, { key: lineup.key, points: lineup.points, at: lineup.at }].slice(-ARENA_LINEUP_MAX_SAMPLES),
  };
}

/** What an average re-roll banks with this loadout: the mean of the other
 *  fresh lineups seen with it (the one on screen left out), or
 *  `TYPICAL_LINEUP_POINTS` until there are enough. */
export function lineupBenchmark(
  record: ArenaLineupPoints | null,
  maxHp: number,
  excludeKey: string | null,
): { points: number; measured: number | null } {
  const others = record && record.maxHp === maxHp ? record.lineups.filter((l) => l.key !== excludeKey) : [];
  if (others.length < ARENA_LINEUP_MIN_SAMPLES) return { points: TYPICAL_LINEUP_POINTS, measured: null };
  return { points: others.reduce((s, l) => s + l.points, 0) / others.length, measured: others.length };
}

/** Within the coin-flip band, a quoted % at or above this leans to a win.
 *  Re-checked 2026-10-05 on 98 coin-flip fights: quoted ≥ 50% won 37/50,
 *  under 50% won 14/48 — right 71/98, vs 68/98 for the old "Passive or
 *  quoted ≥ 51%" rule, which leaned win on every Passive opponent even
 *  though a Passive one quoted under 50% won only 10/24 (≥ 50%: 22/28). */
export const COINFLIP_LEAN_QUOTED_PCT = 50;

/** `preview_loadout` locked stats → the player's own combat numbers, before
 *  any fight has been logged this season. Measured ratios across three
 *  seasons: base 0.51–0.53 × STR, reduction 1.04–1.09 × DEF (e.g. Sep 23–29:
 *  STR 844 → base 433, DEF 747 → reduction 773). They drift with weapon and
 *  bonuses, so the first real fight's log replaces this estimate. */
const PREVIEW_BASE_PER_STR = 0.52;
const PREVIEW_REDUCTION_PER_DEF = 1.05;

export interface ArenaOpponentCard {
  name: string;
  isBoss: boolean;
  level: number;
  strength: number;
  defence: number;
  agility: number;
  dexterity: number;
  passive: boolean;
  /** The game's own "N% CHANCE" (regular opponents; bosses only via
   *  `open_next_page`). */
  quotedPct: number | null;
  /** Boss family slug (`iron_river`, `kito_gumi`, …); null for regular
   *  opponents. */
  family: string | null;
}

export type ArenaVerdictKind = 'beatable' | 'coinflip' | 'avoid';

export interface ArenaVerdict {
  kind: ArenaVerdictKind;
  score: number;
  /** Only meaningful for `coinflip`: which of its two `WIN_CHANCE` cells
   *  this fight falls in (regular: quoted ≥ 50%). The lean shown to the
   *  player comes from the resulting win chance instead (`leanFor`). */
  leansWin: boolean;
  /** Highest STR at this card's level/DEF that still scores 1.0. */
  maxStrength: number;
  opponentHp: number;
  /** True when the player's base damage gets far enough past this card's
   *  DEF to beat the minimum-damage floor, i.e. `myHit` is real damage. */
  breaksThrough: boolean;
  /** The same for their hits against the player's armour. */
  theyBreakThrough: boolean;
  /** Expected damage per landed hit, each way. */
  myHit: number;
  theirHit: number;
  /** Hits each side needs to finish the other (the "kill race"). */
  hitsToKillThem: number;
  hitsToKillMe: number;
}

/** Card STR → mean base damage per hit (misses excluded). Regular:
 *  r 0.99; boss: r 0.997. */
function opponentBase(card: ArenaOpponentCard): number {
  return card.isBoss ? 0.4824 * card.strength + 9.85 : 0.5546 * card.strength - 6.77;
}

function strengthForBase(base: number, isBoss: boolean): number {
  return isBoss ? (base - 9.85) / 0.4824 : (base + 6.77) / 0.5546;
}

export function opponentHp(card: Pick<ArenaOpponentCard, 'isBoss' | 'level'>): number {
  return card.isBoss ? 95 + 5 * card.level : 7.19 * card.level - 49;
}

function myHitOn(card: ArenaOpponentCard, me: ArenaMyProfile): number {
  return Math.max(minDamage(me.baseDamage), me.baseDamage - card.defence);
}

/** > 1 means the player is expected to outlast this opponent: rounds they
 *  need to kill the player ÷ rounds the player needs to kill them. */
export function killRaceScore(card: ArenaOpponentCard, me: ArenaMyProfile): number {
  const base = opponentBase(card);
  const theirHit = Math.max(minDamage(base), base - me.reduction);
  const roundsToKillMe = me.maxHp / theirHit;
  const roundsToKillThem = opponentHp(card) / myHitOn(card, me);
  return roundsToKillMe / roundsToKillThem;
}

export function verdictFor(card: ArenaOpponentCard, me: ArenaMyProfile): ArenaVerdict {
  const score = killRaceScore(card, me);
  const hp = opponentHp(card);
  const mine = myHitOn(card, me);
  const base = opponentBase(card);
  const theirHit = Math.max(minDamage(base), base - me.reduction);
  // Score = 1 when their hit = myHp·mine / theirHp: the lower of the base
  // whose minimum damage gets there and the base that gets there by beating
  // the player's reduction.
  const breakEvenHit = (me.maxHp * mine) / hp;
  const breakEvenBase = Math.min(baseForMinDamage(breakEvenHit), me.reduction + breakEvenHit);
  const beatableAt = card.isBoss ? SCORE_BOSS_BEATABLE : SCORE_BEATABLE;
  const kind: ArenaVerdictKind = score >= beatableAt ? 'beatable' : score < SCORE_AVOID ? 'avoid' : 'coinflip';
  // Regular: the game's quoted % decides the lean when it's on the card;
  // Passive is only the fallback when it isn't. Boss: score 1.0+.
  const leansWin = card.isBoss
    ? score >= 1
    : card.quotedPct !== null
      ? card.quotedPct >= COINFLIP_LEAN_QUOTED_PCT
      : card.passive;
  return {
    kind,
    score,
    leansWin,
    maxStrength: Math.max(0, Math.round(strengthForBase(breakEvenBase, card.isBoss))),
    opponentHp: Math.round(hp),
    breaksThrough: me.baseDamage - card.defence > minDamage(me.baseDamage),
    theyBreakThrough: base - me.reduction > minDamage(base),
    myHit: mine,
    theirHit,
    hitsToKillThem: hp / mine,
    hitsToKillMe: me.maxHp / theirHit,
  };
}

/** A coin-flip's lean, from its measured win chance rather than the quoted %
 *  alone: only a band whose real record is clearly away from 50% leans. On
 *  2026-10-15 every band's 90% range agreed with these cut-offs: regular
 *  0.8–1.0 quoted 50%+ 73% (19/26), under 50% 24% (15/63), 1.0–1.2 quoted
 *  50%+ 71% (48/68) all lean; 1.0–1.2 quoted under 50% won 16/29 (55%,
 *  range 40–70%) and is even. Follows `WIN_CHANCE` whenever that's refit. */
export const LEAN_WIN_AT = 0.6;
export const LEAN_LOSS_AT = 0.4;

export type ArenaLean = 'win' | 'even' | 'loss';

export function leanFor(winChance: number): ArenaLean {
  return winChance >= LEAN_WIN_AT ? 'win' : winChance <= LEAN_LOSS_AT ? 'loss' : 'even';
}

/** The lean as the badge words it. */
export function leanText(winChance: number): string {
  const lean = leanFor(winChance);
  return lean === 'even' ? 'even' : `leans ${lean}`;
}

/** The real win rate for this verdict's band — see `WIN_CHANCE`. */
export function winChance(card: Pick<ArenaOpponentCard, 'isBoss'>, v: ArenaVerdict): number {
  if (card.isBoss) return WIN_CHANCE.boss[v.kind];
  const r = WIN_CHANCE.regular;
  if (v.kind === 'beatable') return r.beatable;
  if (v.kind === 'avoid') return r.avoid;
  const band = v.score < 1 ? r.coinflipLow : r.coinflipHigh;
  return v.leansWin ? band.leanWin : band.leanLoss;
}

export interface PotFight<T> {
  item: T;
  /** Win chance, 0–1. */
  p: number;
  bounty: number;
}

/** Expected points banked from `startPot` plus `fights` played in the given
 *  order: any loss wipes the unbanked pot, so each bounty counts only if it
 *  and every later fight are won, and the starting pot only if every fight
 *  is won. (A bounty-weighted order can edge riskiest-first by ~3 points a
 *  page on real lineups; the player chose to keep riskiest first,
 *  2026-10-05.) */
export function expectedPot(fights: PotFight<unknown>[], startPot = 0): number {
  let total = 0;
  let tail = 1; // chance of winning every fight after this one
  for (let i = fights.length - 1; i >= 0; i--) {
    total += fights[i].bounty * fights[i].p * tail;
    tail *= fights[i].p;
  }
  return total + startPot * tail;
}

/** Largest pot still worth risking on the boss: fight while
 *  p × (pot + bounty) > pot, i.e. pot < p × bounty ÷ (1 − p). Infinity when
 *  the boss is (near enough) certain. */
export function bossPotLimit(p: number, bossBounty: number): number {
  return p >= 0.999 ? Infinity : (p * bossBounty) / (1 - p);
}

/** Per-fight samples kept for the season medians (a season is ~7 days of
 *  up to 6 pages × 5 fights). */
export const ARENA_PROFILE_MAX_SAMPLES = 250;

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function profileFromPreview(
  stats: { strength: number; defence: number; agility: number; dexterity: number },
  maxHp: number,
): ArenaMyProfile {
  return {
    source: 'preview',
    maxHp,
    baseDamage: stats.strength * PREVIEW_BASE_PER_STR,
    reduction: stats.defence * PREVIEW_REDUCTION_PER_DEF,
    fightCount: 0,
    baseSamples: [],
    reductionSamples: [],
    lockedStats: stats,
    updatedAt: Date.now(),
  };
}

export interface ArenaFightSample {
  maxHp: number;
  baseDamage: number;
  reduction: number;
}

/** The player's own numbers from one `attack` response's combat log:
 *  mean `base_dmg` of their regular hits (first strikes are weaker and
 *  excluded), the `reduction` on the opponent's hits against them (misses
 *  log 0 and are skipped), and `att_max_hp`. */
export function sampleFromAttack(resp: unknown): ArenaFightSample | null {
  const r = resp as { att_max_hp?: unknown; rounds?: unknown };
  if (typeof r?.att_max_hp !== 'number' || !Array.isArray(r.rounds)) return null;
  const bases: number[] = [];
  const reductions: number[] = [];
  for (const round of r.rounds as Record<string, unknown>[]) {
    const a = round?.attacker as { base_dmg?: unknown } | undefined;
    const d = round?.defender as { reduction?: unknown } | undefined;
    if (a && typeof a.base_dmg === 'number' && a.base_dmg > 0) bases.push(a.base_dmg);
    if (d && typeof d.reduction === 'number' && d.reduction > 0) reductions.push(d.reduction);
  }
  if (bases.length === 0 || reductions.length === 0) return null;
  reductions.sort((x, y) => x - y);
  return {
    maxHp: r.att_max_hp,
    baseDamage: bases.reduce((s, x) => s + x, 0) / bases.length,
    reduction: reductions[Math.floor(reductions.length / 2)],
  };
}

/** Folds one fight into the profile. A preview estimate, or a profile from
 *  a different max HP (a new season's loadout), is replaced outright;
 *  otherwise the fight is added to the season's samples and base damage and
 *  reduction are their medians (what verify_combat_rule.py scores with). */
export function foldFight(prev: ArenaMyProfile | null, sample: ArenaFightSample): ArenaMyProfile {
  const sameSeason = prev !== null && prev.source === 'fights' && prev.maxHp === sample.maxHp;
  const baseSamples = [...(sameSeason ? prev.baseSamples ?? [] : []), sample.baseDamage].slice(-ARENA_PROFILE_MAX_SAMPLES);
  const reductionSamples = [...(sameSeason ? prev.reductionSamples ?? [] : []), sample.reduction].slice(-ARENA_PROFILE_MAX_SAMPLES);
  return {
    source: 'fights',
    maxHp: sample.maxHp,
    baseDamage: median(baseSamples),
    reduction: median(reductionSamples),
    fightCount: (sameSeason ? prev.fightCount : 0) + 1,
    baseSamples,
    reductionSamples,
    lockedStats: prev && prev.maxHp === sample.maxHp ? prev.lockedStats : null,
    updatedAt: Date.now(),
  };
}

/** Rough "beat anyone under this STR" line for a regular opponent at
 *  `level` with DEF above the player's base damage — the table in
 *  docs/arena-combat-mechanics.md. */
export function regularStrengthLimit(level: number, me: ArenaMyProfile): number {
  const card: ArenaOpponentCard = {
    name: '', isBoss: false, level, strength: 0, defence: Number.MAX_SAFE_INTEGER,
    agility: 0, dexterity: 0, passive: false, quotedPct: null, family: null,
  };
  return verdictFor(card, me).maxStrength;
}

/** Boss STR at which a level-106 boss (625 HP) becomes a coin-flip. */
export function bossStrengthBreakEven(me: ArenaMyProfile, bossLevel = 106): number {
  const card: ArenaOpponentCard = {
    name: '', isBoss: true, level: bossLevel, strength: 0, defence: Number.MAX_SAFE_INTEGER,
    agility: 0, dexterity: 0, passive: false, quotedPct: null, family: null,
  };
  return verdictFor(card, me).maxStrength;
}

// ---------------------------------------------------------------------------
// Track record
// ---------------------------------------------------------------------------

/** The record behind each verdict from the archive analysis (184 fights,
 *  2026-09-09 → 09-24, verify_combat_rule.py). Live fights add to this for
 *  the all-time figures. */
export const ARENA_BASELINE_TALLY: ArenaVerdictTally = {
  beatable: { fights: 85, won: 85 },
  coinflip: { fights: 59, won: 29 },
  avoid: { fights: 40, won: 2 },
};
export const ARENA_BASELINE_SINCE = '9 Sep';

export function emptyTally(): ArenaVerdictTally {
  return { beatable: { fights: 0, won: 0 }, coinflip: { fights: 0, won: 0 }, avoid: { fights: 0, won: 0 } };
}

export function addTallies(a: ArenaVerdictTally, b: ArenaVerdictTally): ArenaVerdictTally {
  const add = (k: ArenaVerdictKind) => ({ fights: a[k].fights + b[k].fights, won: a[k].won + b[k].won });
  return { beatable: add('beatable'), coinflip: add('coinflip'), avoid: add('avoid') };
}

/** Folds one judged fight into the record. `maxHp` is the player's locked
 *  max HP for that fight; a change means a new season's loadout. */
export function recordFight(
  prev: ArenaTrackRecord | null,
  fight: { name: string; verdict: ArenaVerdict; won: boolean; maxHp: number; at: number },
): ArenaTrackRecord {
  const bump = (t: ArenaVerdictTally): ArenaVerdictTally => ({
    ...t,
    [fight.verdict.kind]: { fights: t[fight.verdict.kind].fights + 1, won: t[fight.verdict.kind].won + (fight.won ? 1 : 0) },
  });
  const seasonTally = prev?.season && prev.season.maxHp === fight.maxHp ? prev.season.tally : emptyTally();
  const k = fight.verdict.kind;
  const against = (k === 'beatable' && !fight.won) || (k === 'avoid' && fight.won);
  return {
    live: bump(prev?.live ?? emptyTally()),
    season: { maxHp: fight.maxHp, tally: bump(seasonTally) },
    surprise: against
      ? { name: fight.name, kind: k as 'beatable' | 'avoid', won: fight.won, score: fight.verdict.score, at: fight.at }
      : (prev?.surprise ?? null),
    startedAt: prev?.startedAt ?? fight.at,
  };
}
