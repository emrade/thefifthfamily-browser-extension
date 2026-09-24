import type { ArenaMyProfile } from './types';

/**
 * The Arena V2 kill-race model from docs/arena-combat-mechanics.md, as pure
 * functions: turn an opponent card (STR / DEF / level, plus the Passive tag
 * and the game's quoted %) and the player's own season numbers into a score
 * and a verdict. Re-derived against every real fight in the archives by
 * verification/arena/verify_combat_rule.py (155/179 correct; score ≥ 1.2 won
 * 81/81; score < 0.8 won 1/39). Update the coefficients here and there
 * together.
 */

/** Mean of the five "minimum damage" steps, as a fraction of the attacker's
 *  mean base damage. About 95% of all logged hits land on this floor,
 *  because base damage rarely beats the defender's reduction. Measured 8.5%
 *  for the player and 9.1% for opponents; one shared 8.8% fits the actual
 *  results best (only the ratio between the two sides matters). */
export const FLOOR_FRACTION = 0.088;

/** Score bands. ≥ BEATABLE has won every time so far; < AVOID almost never. */
export const SCORE_BEATABLE = 1.2;
export const SCORE_AVOID = 0.8;

/** Within the coin-flip band, a quoted % at or above this leaned to a win
 *  (11/13). */
export const COINFLIP_LEAN_QUOTED_PCT = 51;

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
  /** Only meaningful for `coinflip`. */
  leansWin: boolean;
  /** Highest STR at this card's level/DEF that still scores 1.0. */
  maxStrength: number;
  opponentHp: number;
  /** True when the player's base damage gets past this card's DEF, i.e.
   *  real damage instead of the minimum-damage floor. */
  breaksThrough: boolean;
  /** True when their base damage gets past the player's armour. */
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
  return Math.max(FLOOR_FRACTION * me.baseDamage, me.baseDamage - card.defence);
}

/** > 1 means the player is expected to outlast this opponent: rounds they
 *  need to kill the player ÷ rounds the player needs to kill them. */
export function killRaceScore(card: ArenaOpponentCard, me: ArenaMyProfile): number {
  const base = opponentBase(card);
  const theirHit = Math.max(FLOOR_FRACTION * base, base - me.reduction);
  const roundsToKillMe = me.maxHp / theirHit;
  const roundsToKillThem = opponentHp(card) / myHitOn(card, me);
  return roundsToKillMe / roundsToKillThem;
}

export function verdictFor(card: ArenaOpponentCard, me: ArenaMyProfile): ArenaVerdict {
  const score = killRaceScore(card, me);
  const hp = opponentHp(card);
  const mine = myHitOn(card, me);
  const base = opponentBase(card);
  const theirHit = Math.max(FLOOR_FRACTION * base, base - me.reduction);
  // Score = 1 with their hits on the floor: base = myHp·mine / (floor·theirHp).
  const breakEvenBase = (me.maxHp * mine) / (FLOOR_FRACTION * hp);
  const kind: ArenaVerdictKind = score >= SCORE_BEATABLE ? 'beatable' : score < SCORE_AVOID ? 'avoid' : 'coinflip';
  const leansWin =
    card.passive ||
    (card.quotedPct !== null && card.quotedPct >= COINFLIP_LEAN_QUOTED_PCT && !card.isBoss) ||
    (card.isBoss && score >= 1);
  return {
    kind,
    score,
    leansWin,
    maxStrength: Math.max(0, Math.round(strengthForBase(breakEvenBase, card.isBoss))),
    opponentHp: Math.round(hp),
    breaksThrough: me.baseDamage > card.defence,
    theyBreakThrough: base > me.reduction,
    myHit: mine,
    theirHit,
    hitsToKillThem: hp / mine,
    hitsToKillMe: me.maxHp / theirHit,
  };
}

/** Should the player take this fight? Beatable, or a coin-flip leaning win. */
export function isRecommended(v: ArenaVerdict): boolean {
  return v.kind === 'beatable' || (v.kind === 'coinflip' && v.leansWin);
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
