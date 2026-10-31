import catalogData from '@/shared/data/streetIntelCatalog.json';
import conditionsData from '@/shared/data/streetIntelConditions.json';

/**
 * A Street Intel card's exact odds before scouting it.
 *
 * Every input to the game's formula (`@/shared/streetIntelEstimate`) is known
 * without a scout:
 * - `base_pct` — the game's own wiki lists it for all 240 tip-offs, keyed by
 *   title (`streetIntelCatalog.json`); it equalled the scouted value on every
 *   one of 9,341 scouted cards.
 * - `env_global` / `env_stat` — the board shows each card's conditions as a
 *   sentence (`data-modifier`), and each of the 39 sentences always means the
 *   same values (`streetIntelConditions.json`, learned from every scout).
 * - rank, prestige, collection, recon, mastery — player-level, the same on
 *   every card (mastery per category), carried over from the latest scout
 *   (`PlayerIntelMods`); rank is also refreshed from every attempt.
 * - stat — the player's own base stat ÷ 5 (stats.php).
 *
 * Replaying every scout since 2026-08-21 from only what was known before it
 * predicts 99.0% of revealed estimates exactly; the rest are moments a buff,
 * rank-up or mastery level changed in between. Both tables are built (and
 * that check re-run) by verification/street-intel/build_intel_tables.py.
 *
 * `temporary` (a short buff, seen on 523 of 14,307 scouts) is left out: it
 * can only be read from a scout and may have expired since, so a prediction
 * never counts on it — it can only come out low, never high.
 */

export interface CatalogCard {
  base: number;
  category: string;
  level: number;
  legendary: boolean;
  xp: number;
}

export interface CardConditions {
  global: number;
  stats: Partial<Record<string, number>>;
  complication: 'lower' | 'higher' | null;
}

const CATALOG = (catalogData as { cards: Record<string, CatalogCard> }).cards;
const CONDITIONS = (conditionsData as { conditions: Record<string, CardConditions> }).conditions;

export function catalogCard(title: string): CatalogCard | null {
  return CATALOG[title.trim().toLowerCase()] ?? null;
}

/** A card with no `data-modifier` has no conditions (stored under ""). */
export function cardConditions(modifier: string | null): CardConditions | null {
  return CONDITIONS[modifier ?? ''] ?? null;
}

/** The player's own modifiers, from the latest scout (any card). */
export interface PlayerIntelMods {
  rank: number;
  prestige: number;
  collection: number;
  recon: number;
  /** By catalog category (Robbery, Interception, ...) — differs per category. */
  mastery: Record<string, number>;
  updatedAt: number;
}

/** Folds one scout's revealed modifiers in. `category` is the scouted card's
 *  (null when its title isn't in the catalog — the rest still updates). */
export function foldScoutMods(
  prev: PlayerIntelMods | null,
  modifiers: Record<string, number>,
  category: string | null,
  at: number,
): PlayerIntelMods {
  const mastery = { ...(prev?.mastery ?? {}) };
  if (category && typeof modifiers.mastery === 'number') mastery[category] = modifiers.mastery;
  return {
    rank: modifiers.rank ?? prev?.rank ?? 0,
    prestige: modifiers.prestige ?? prev?.prestige ?? 0,
    collection: modifiers.collection ?? prev?.collection ?? 0,
    recon: modifiers.recon ?? prev?.recon ?? 0,
    mastery,
    updatedAt: at,
  };
}

/** An attempt reports the Street Intel rank; its modifier is always 2 × rank
 *  (14k scouts, every pair outside a rank-up). */
export function foldAttemptRank(prev: PlayerIntelMods | null, rank: number): PlayerIntelMods | null {
  if (!prev || !Number.isInteger(rank) || rank * 2 === prev.rank) return prev;
  return { ...prev, rank: rank * 2 };
}

export interface PredictedApproach {
  key: string;
  pct: number;
}

export interface CardPrediction {
  category: string;
  base: number;
  conditions: CardConditions;
  approaches: PredictedApproach[];
}

interface PredictableCard {
  title: string;
  modifier: string | null;
  approaches: { key: string; stat: string; bonus: number; autofail: boolean }[];
}

/** Null when anything isn't known yet — an unlisted title (a new tip-off),
 *  an unseen sentence, or no scout of this category to take mastery from. */
export function predictCard(card: PredictableCard, mods: PlayerIntelMods | null, rawStats: Record<string, number> | null): CardPrediction | null {
  const entry = catalogCard(card.title);
  const conditions = cardConditions(card.modifier);
  if (!entry || !conditions || !mods || !rawStats) return null;
  const mastery = mods.mastery[entry.category];
  if (mastery === undefined) return null;
  const shared = mods.rank + mods.prestige + mods.collection + mods.recon + mastery + conditions.global;
  const approaches: PredictedApproach[] = [];
  for (const a of card.approaches) {
    const stat = rawStats[a.stat];
    if (typeof stat !== 'number') return null;
    if (a.autofail) {
      approaches.push({ key: a.key, pct: 0 });
      continue;
    }
    const raw = entry.base * (1 + (shared + stat / 5 + (conditions.stats[a.stat] ?? 0)) / 100) + a.bonus;
    approaches.push({ key: a.key, pct: Math.max(0, Math.min(95, Math.round(raw))) });
  }
  return { category: entry.category, base: entry.base, conditions, approaches };
}

/** The approach a prediction rates highest, or null. */
export function bestPredicted(prediction: CardPrediction | null): PredictedApproach | null {
  if (!prediction) return null;
  return prediction.approaches.reduce<PredictedApproach | null>((best, a) => (!best || a.pct > best.pct ? a : best), null);
}
