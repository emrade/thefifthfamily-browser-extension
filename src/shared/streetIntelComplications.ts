import type { ComplicationChoiceKey, ComplicationTypeStats } from './types';

/**
 * Real complication outcomes per scenario and choice — `[wins, attempts]`.
 *
 * Built by verification/street-intel/build_complication_seed.py from every
 * archive up to `SEED_CUTOFF` (2026-08-10..10-28): 711 resolved
 * complications, manual (46) and automated (665), paired with their
 * attempt's scenario by `opportunity_id`. Re-run it on a newer archive and
 * paste the output here to refresh.
 *
 * The first table (2026-10-04, 480 complications — see
 * verify_complication_blocked_choices.py) found 14 of 24 scenarios with one
 * choice that went 0-for-everything while every other choice wins 83–90%
 * pooled; those blocked picks cost $26.4M of the $30.7M lost to
 * complications in that window. Card `autofail` flags don't explain it —
 * this is keyed on the scenario text alone. The rebuild leaves every one of
 * those cells still winless.
 *
 * Excludes the 7 complications from 2026-08-10/11 that still returned a
 * `comp_score` (all manual `fight` wins, before the game's Phase One change
 * hid the score and fixed difficulty at 40). Counting them hid three blocked
 * cells — getaway driver, off-duty cop and police spotted you. See
 * docs/street-intel-complication-findings.md and
 * verification/street-intel/verify_complication_post_patch_blocked.py.
 *
 * The live tally (`storage.getStreetIntelComplicationTally`) only counts
 * complications after `SEED_CUTOFF`, so `cellRecord` adds the two together.
 * This replaced a "whichever has more attempts" rule over the auto-runner's
 * own all-time tally, which overlapped this table: it froze cells like a 3/3
 * at their seeded value until automation alone out-sampled them, and never
 * counted manual play.
 */
export const SEED_CUTOFF = 1793202148915;
const SEED_RECORDS: Record<string, Partial<Record<ComplicationChoiceKey, [number, number]>>> = {
  'Your getaway driver never showed up.': { fight: [0, 4], run: [19, 22], talk: [9, 11] },
  'Your fake credentials are questioned.': { fight: [0, 7], run: [19, 20], talk: [7, 9] },
  'The room is filling with smoke.': { fight: [6, 7], run: [21, 23], talk: [0, 5] },
  'You hear footsteps behind the door.': { fight: [5, 5], run: [17, 18], talk: [0, 12] },
  'The drop site is surrounded.': { fight: [8, 9], run: [12, 19], talk: [0, 6] },
  'The target building went into lockdown.': { fight: [8, 8], run: [15, 17], talk: [0, 8] },
  'The meeting location changed last minute.': { fight: [0, 2], run: [20, 21], talk: [8, 9] },
  'Your contact is late and the area is getting hot.': { fight: [0, 3], run: [21, 25], talk: [2, 3] },
  'Silent alarm was tripped. Security is closing in.': { fight: [2, 3], run: [18, 23], talk: [0, 5] },
  'The package is booby-trapped. You need to act fast.': { fight: [3, 3], run: [17, 19], talk: [0, 9] },
  'A rival crew followed you and wants a cut.': { fight: [6, 6], run: [10, 15], talk: [8, 9] },
  'A security guard asks to check your bag.': { fight: [6, 6], run: [13, 15], talk: [9, 9] },
  'Someone triggered a silent distress signal.': { fight: [6, 7], run: [13, 19], talk: [0, 4] },
  'The informant demands more money.': { fight: [6, 6], run: [17, 20], talk: [4, 4] },
  'A rival informant recognizes you.': { fight: [3, 3], run: [19, 20], talk: [6, 6] },
  'The evidence is heavier than expected.': { fight: [11, 12], run: [0, 11], talk: [4, 5] },
  'Police spotted you leaving the scene.': { fight: [0, 4], run: [15, 17], talk: [6, 6] },
  'A witness is threatening to call the cops.': { fight: [6, 6], run: [13, 14], talk: [5, 6] },
  'An off-duty cop recognized your face.': { fight: [0, 3], run: [11, 13], talk: [9, 10] },
  'A patrol car slows down beside you.': { fight: [0, 2], run: [14, 17], talk: [7, 7] },
  'A camera catches your face.': { fight: [0, 4], run: [9, 11], talk: [10, 10] },
  "The mark had backup you didn't see coming.": { fight: [3, 3], run: [13, 15], talk: [0, 6] },
  'The item is locked in a reinforced case.': { fight: [5, 5], run: [0, 9], talk: [9, 9] },
  'The client starts panicking.': { fight: [0, 1], run: [10, 12], talk: [8, 9] },
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

/** Wins/attempts for one scenario+choice: the seeded history plus the live
 *  tally since `SEED_CUTOFF` (summed across apostrophe variants of the same
 *  scenario). The two never overlap, so they add. */
function cellRecord(scenario: string, choice: ComplicationChoiceKey, typeStats: ComplicationTypeStats | undefined): { wins: number; attempts: number } {
  const [seedWins, seedAttempts] = SEED_RECORDS[scenario]?.[choice] ?? [0, 0];
  let wins = seedWins;
  let attempts = seedAttempts;
  for (const [key, bucket] of Object.entries(typeStats ?? {})) {
    if (normalizeScenario(key) !== scenario) continue;
    wins += bucket[choice]?.successes ?? 0;
    attempts += bucket[choice]?.attempts ?? 0;
  }
  return { wins, attempts };
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
