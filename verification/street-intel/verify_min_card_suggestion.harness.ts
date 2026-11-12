/**
 * Runs the extension's own `buildStreetIntelAnalytics` (the real code, bundled
 * by verify_min_card_suggestion.py) over archive history as it stood on past
 * days, for several minimum card values, and prints each suggestion as one
 * JSON line. Input: a seed-format file from build_analytics_seed.py --out.
 *
 *   node harness.cjs SEED.json 2026-10-20,2026-11-08 0,500000,800000
 */
import { readFileSync } from 'node:fs';
import { buildStreetIntelAnalytics, type SiAttemptRecord, type SiCardRecord, type SiRisk } from '@/shared/streetIntelAnalytics';

const RISKS: SiRisk[] = ['low', 'medium', 'high', 'extreme'];
const DAY_MS = 86_400_000;
// Same retention as background/features/streetIntel/analytics/index.ts.
const ATTEMPT_RETENTION_MS = 45 * DAY_MS;
const CARD_RETENTION_MS = 14 * DAY_MS;

const [seedPath, datesArg, minimumsArg, extremeArg] = process.argv.slice(2);
const seed = JSON.parse(readFileSync(seedPath, 'utf8'));

const attempts: SiAttemptRecord[] = seed.attempts.map((a: unknown[]) => {
  const [id, at, origin, band, reward, jail, comp, compSuccess, cashLost, drops, risk, legendary, min, max, stamina, scout] = a as [
    number, number, number, string, number, number, number, number | null, number, [string, string | null, string | null, number][], number | null, number | null, number | null, number | null, number | null, number | null,
  ];
  return {
    id, at, origin: origin === 0 ? 'page' : 'background', band, reward, jailSeconds: jail, complication: comp === 1,
    complicationSuccess: compSuccess === null ? null : compSuccess === 1, cashLost,
    drops: drops.map(([name, quality, type, header]) => ({ name, quality, type, header: header === 1 })),
    card: risk === null || min === null || max === null || stamina === null
      ? null
      : { risk: RISKS[risk], legendary: legendary === 1, rewardMin: min, rewardMax: max, stamina, scoutCost: scout ?? 1 },
  };
});
const cards: SiCardRecord[] = seed.cards.map(([id, firstSeen, lastSeen, risk, legendary, rewardMin, rewardMax, stamina, scoutCost]: number[]) => ({
  id, firstSeen, lastSeen, risk: RISKS[risk], legendary: legendary === 1, rewardMin, rewardMax, stamina, scoutCost,
}));
const prices = new Map(Object.entries(seed.prices as Record<string, number>));
const days = Object.entries(seed.scoutStamina as Record<string, number>).map(([day, scoutStamina]) => ({ day, scoutStamina }));

const extremeMinValue = Number(extremeArg ?? 0);
for (const date of datesArg.split(',')) {
  // Early on the player's day `date` (game days start 23:00 UTC the evening
  // before), so the 7 days before it are complete.
  const now = Date.parse(`${date}T00:00:00Z`);
  const live = attempts.filter((a) => a.at < now && a.at >= now - ATTEMPT_RETENTION_MS);
  const board = cards.filter((c) => c.firstSeen < now && c.firstSeen >= now - CARD_RETENTION_MS);
  for (const minimum of minimumsArg.split(',').map(Number)) {
    const config = { minCardValue: minimum, extremeMinEnabled: extremeMinValue > 0, extremeMinValue };
    const a = buildStreetIntelAnalytics(live, board, days, prices, config, now, now - CARD_RETENTION_MS);
    console.log(JSON.stringify({ date, minimum, suggestion: a.suggestion, note: a.suggestionNote }));
    console.log(JSON.stringify({ date, minimum, suggestion: a.suggestionWithDrops, note: a.suggestionNote }));
  }
}
