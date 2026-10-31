import seed from '@/shared/data/streetIntelAnalyticsSeed.json';
import type { SiAnalyticsDay, SiAttemptRecord, SiCardRecord, SiDrop, SiRisk } from '@/shared/streetIntelAnalytics';

/**
 * The history Street Intel Analytics starts from, built from the player's
 * exported archives by verification/street-intel/build_analytics_seed.py
 * (attempts since 2026-10-01, the last 10 days of board cards, paid scouts
 * per day, sell quotes). Stored as positional arrays to keep the bundle
 * small; decoded here into the same records live traffic produces.
 */

const RISKS: SiRisk[] = ['low', 'medium', 'high', 'extreme'];

type SeedDrop = [string, string | null, string | null, number];
type SeedAttempt = [
  number, number, number, string, number, number, number, number | null, number, SeedDrop[],
  number | null, number | null, number | null, number | null, number | null, number | null,
];
type SeedCard = [number, number, number, number, number, number, number, number, number];

interface Seed {
  cutoff: number;
  attempts: SeedAttempt[];
  cards: SeedCard[];
  scoutStamina: Record<string, number>;
  prices: Record<string, number>;
}

const data = seed as unknown as Seed;

/** The newest archived row the seed was built from. */
export const ANALYTICS_SEED_CUTOFF = data.cutoff;

/** The seed's board history starts here (its oldest card); the day it falls
 *  in is only partly covered. */
export const ANALYTICS_SEED_CARDS_FROM = data.cards.length ? Math.min(...data.cards.map((c) => c[1])) : data.cutoff;

function decodeDrop([name, quality, type, header]: SeedDrop): SiDrop {
  return { name, quality, type, header: header === 1 };
}

export function seedAttempts(): SiAttemptRecord[] {
  return data.attempts.map(([id, at, origin, band, reward, jail, comp, compSuccess, cashLost, drops, risk, legendary, min, max, stamina, scout]) => ({
    id,
    at,
    origin: origin === 0 ? 'page' : 'background',
    band,
    reward,
    jailSeconds: jail,
    complication: comp === 1,
    complicationSuccess: compSuccess === null ? null : compSuccess === 1,
    cashLost,
    drops: drops.map(decodeDrop),
    card:
      risk === null || min === null || max === null || stamina === null
        ? null
        : { risk: RISKS[risk], legendary: legendary === 1, rewardMin: min, rewardMax: max, stamina, scoutCost: scout ?? 1 },
  }));
}

export function seedCards(): SiCardRecord[] {
  return data.cards.map(([id, firstSeen, lastSeen, risk, legendary, rewardMin, rewardMax, stamina, scoutCost]) => ({
    id,
    firstSeen,
    lastSeen,
    risk: RISKS[risk],
    legendary: legendary === 1,
    rewardMin,
    rewardMax,
    stamina,
    scoutCost,
  }));
}

export function seedDays(): SiAnalyticsDay[] {
  return Object.entries(data.scoutStamina).map(([day, scoutStamina]) => ({ day, scoutStamina }));
}

/** Sell quotes by lowercased item name, from every archived `dispose_quote`. */
export function seedPrices(): Record<string, number> {
  return data.prices;
}
