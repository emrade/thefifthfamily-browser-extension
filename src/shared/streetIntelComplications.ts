import type { ComplicationChoiceKey, ComplicationTypeStats } from './types';

/**
 * Real complication outcomes per scenario and choice — `[wins, attempts]`.
 *
 * From the 2026-10-04 analysis of every archive combined (480 resolved
 * complications, 2026-08-10..10-04, manual and automated — see
 * verification/street-intel/verify_complication_blocked_choices.py). 14 of 24
 * scenarios have one choice that went 0-for-everything (0/91 combined), while
 * every other choice wins 83–90% pooled; those blocked picks cost $26.4M of
 * the $30.7M lost to complications in that window. Card `autofail` flags
 * don't explain it — this is keyed on the scenario text alone.
 *
 * Seeded here (rather than relying only on the live `complicationTypeStats`)
 * because the live tally only covers automated attempts since it was added,
 * and misses some of these cells entirely. The two overlap (most of the live
 * tally is inside this history), so they're never summed — `cellRecord` uses
 * whichever has more attempts for a given cell.
 */
const SEED_RECORDS: Record<string, Partial<Record<ComplicationChoiceKey, [number, number]>>> = {
  'The drop site is surrounded.': { fight: [7, 8], run: [8, 15], talk: [0, 6] },
  'You hear footsteps behind the door.': { fight: [3, 3], run: [10, 11], talk: [0, 12] },
  'Your getaway driver never showed up.': { fight: [1, 4], run: [11, 14], talk: [6, 7] },
  'Your fake credentials are questioned.': { fight: [0, 7], run: [9, 10], talk: [4, 6] },
  'The room is filling with smoke.': { fight: [3, 3], run: [14, 15], talk: [0, 5] },
  'A security guard asks to check your bag.': { fight: [5, 5], run: [8, 10], talk: [7, 7] },
  'The package is booby-trapped. You need to act fast.': { fight: [2, 2], run: [9, 10], talk: [0, 9] },
  'The target building went into lockdown.': { fight: [6, 6], run: [5, 7], talk: [0, 8] },
  'Silent alarm was tripped. Security is closing in.': { fight: [2, 2], run: [12, 14], talk: [0, 5] },
  'A rival informant recognizes you.': { fight: [3, 3], run: [14, 15], talk: [2, 2] },
  'Someone triggered a silent distress signal.': { fight: [3, 4], run: [8, 12], talk: [0, 4] },
  'The evidence is heavier than expected.': { fight: [4, 4], run: [0, 11], talk: [3, 4] },
  'A patrol car slows down beside you.': { fight: [0, 2], run: [11, 12], talk: [6, 6] },
  "The mark had backup you didn't see coming.": { fight: [3, 3], run: [8, 10], talk: [0, 6] },
  'The item is locked in a reinforced case.': { fight: [5, 5], run: [0, 9], talk: [5, 5] },
  'A rival crew followed you and wants a cut.': { fight: [4, 4], run: [7, 9], talk: [5, 6] },
  'The informant demands more money.': { fight: [3, 3], run: [11, 14], talk: [2, 2] },
  'An off-duty cop recognized your face.': { fight: [2, 4], run: [7, 9], talk: [5, 5] },
  'Police spotted you leaving the scene.': { fight: [1, 4], run: [9, 10], talk: [4, 4] },
  'The meeting location changed last minute.': { fight: [0, 1], run: [10, 10], talk: [6, 7] },
  'A witness is threatening to call the cops.': { fight: [7, 7], run: [5, 5], talk: [3, 4] },
  'A camera catches your face.': { fight: [0, 4], run: [4, 5], talk: [6, 6] },
  'Your contact is late and the area is getting hot.': { fight: [0, 3], run: [9, 11] },
  'The client starts panicking.': { run: [6, 7], talk: [6, 7] },
};

/** Pooled win rate of each choice in scenarios where it *isn't* blocked
 *  (same analysis) — the prior a scenario's own small sample is shrunk
 *  toward when ranking choices. */
const POOLED_WIN_RATE: Record<ComplicationChoiceKey, number> = { fight: 0.85, run: 0.83, talk: 0.9 };
const PRIOR_WEIGHT = 2;
/** Zero wins in at least this many tries = blocked. Replayed chronologically
 *  over the full history (only data available before each event), this rule
 *  cut expected losses from $30.7M to ~$10M. */
const BLOCKED_MIN_ATTEMPTS = 2;

export const COMPLICATION_CHOICES: ComplicationChoiceKey[] = ['fight', 'run', 'talk'];

/** The game has served the same scenario with both a curly and a straight
 *  apostrophe ("didn’t" / "didn't"). */
export function normalizeScenario(scenario: string): string {
  return scenario.replace(/’/g, "'").replace(/\s+/g, ' ').trim();
}

/** True when the scenario text has any recorded history at all — seeded or
 *  live. */
export function isKnownScenario(scenario: string, typeStats: ComplicationTypeStats | undefined): boolean {
  const s = normalizeScenario(scenario);
  if (SEED_RECORDS[s]) return true;
  return Object.keys(typeStats ?? {}).some((key) => normalizeScenario(key) === s);
}

/** Wins/attempts for one scenario+choice: whichever of the seeded history and
 *  the live tally (summed across apostrophe variants of the same scenario)
 *  has more attempts. */
function cellRecord(scenario: string, choice: ComplicationChoiceKey, typeStats: ComplicationTypeStats | undefined): { wins: number; attempts: number } {
  const seed = SEED_RECORDS[scenario]?.[choice] ?? [0, 0];
  let liveWins = 0;
  let liveAttempts = 0;
  for (const [key, bucket] of Object.entries(typeStats ?? {})) {
    if (normalizeScenario(key) !== scenario) continue;
    liveWins += bucket[choice]?.successes ?? 0;
    liveAttempts += bucket[choice]?.attempts ?? 0;
  }
  return liveAttempts > seed[1] ? { wins: liveWins, attempts: liveAttempts } : { wins: seed[0], attempts: seed[1] };
}

export interface ComplicationChoiceAssessment {
  choice: ComplicationChoiceKey;
  wins: number;
  attempts: number;
  /** Never won in `BLOCKED_MIN_ATTEMPTS`+ tries in this scenario. */
  blocked: boolean;
  /** Win rate shrunk toward the choice's pooled rate — what ranking uses, so
   *  a 1/1 doesn't outrank a 14/15. 0 when blocked. */
  score: number;
}

/** Every choice for one scenario, assessed — plus the best unblocked one
 *  (null only if all three are blocked, which has never been observed). */
export function describeComplicationChoices(
  scenario: string,
  typeStats: ComplicationTypeStats | undefined,
): { choices: ComplicationChoiceAssessment[]; best: ComplicationChoiceKey | null } {
  const s = normalizeScenario(scenario);
  const choices = COMPLICATION_CHOICES.map((choice) => {
    const { wins, attempts } = cellRecord(s, choice, typeStats);
    const blocked = attempts >= BLOCKED_MIN_ATTEMPTS && wins === 0;
    const score = blocked ? 0 : (wins + POOLED_WIN_RATE[choice] * PRIOR_WEIGHT) / (attempts + PRIOR_WEIGHT);
    return { choice, wins, attempts, blocked, score };
  });
  const best = choices.filter((c) => !c.blocked).sort((a, b) => b.score - a.score)[0]?.choice ?? null;
  return { choices, best };
}

export function isBlockedChoice(scenario: string, choice: ComplicationChoiceKey, typeStats: ComplicationTypeStats | undefined): boolean {
  return describeComplicationChoices(scenario, typeStats).choices.find((c) => c.choice === choice)?.blocked ?? false;
}

/**
 * Keeps `preferred` (whatever the original reuse/fallback rule picked) unless
 * it's blocked for this scenario; otherwise picks the best unblocked choice
 * for that scenario. `avoided` is the original pick when it was overridden,
 * null otherwise.
 */
export function pickAvoidingBlocked(
  scenario: string,
  preferred: ComplicationChoiceKey,
  typeStats: ComplicationTypeStats | undefined,
): { choice: ComplicationChoiceKey; avoided: ComplicationChoiceKey | null } {
  const { choices, best } = describeComplicationChoices(scenario, typeStats);
  const preferredBlocked = choices.find((c) => c.choice === preferred)?.blocked ?? false;
  if (!preferredBlocked || best === null) return { choice: preferred, avoided: null };
  return { choice: best, avoided: preferred };
}
