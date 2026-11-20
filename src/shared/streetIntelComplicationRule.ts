/**
 * The rule that turns complication results into advice: which choice to pick
 * and which to avoid in one scenario. Kept in its own file with no imports:
 * `describeComplicationChoices` uses it on the player's own record, and TFF
 * Consigliere's copy is compiled from it (scripts/consigliere/build_rules.mjs)
 * to apply the same rule to the family's results.
 *
 * - Blocked (Avoid): never won in BLOCKED_MIN_ATTEMPTS or more tries.
 * - Pick: the unblocked choice with the best win rate, shrunk toward the
 *   choice's pooled win rate (PRIOR_WEIGHT tries' worth) so a 1/1 doesn't
 *   outrank a 14/15. Ties keep the order the choices are listed in.
 */

/** Pooled win rate of each choice in scenarios where it isn't blocked
 *  (2026-10-04 analysis, verify_complication_blocked_choices.py). */
export const POOLED_WIN_RATE = { fight: 0.85, run: 0.83, talk: 0.9 } as const;
export const PRIOR_WEIGHT = 2;
/** Zero wins in at least this many tries = blocked. Replayed chronologically
 *  over the full history (only data available before each event), this rule
 *  cut expected losses from $30.7M to ~$10M. */
export const BLOCKED_MIN_ATTEMPTS = 2;

export interface AssessedChoice<K extends string> {
  choice: K;
  wins: number;
  attempts: number;
  blocked: boolean;
  /** Shrunk win rate, what ranking uses; 0 when blocked. */
  score: number;
}

export function assessChoices<K extends string>(
  choices: readonly K[],
  record: (choice: K) => { wins: number; attempts: number },
  pooled: Record<K, number>,
): { choices: AssessedChoice<K>[]; best: K | null } {
  const assessed = choices.map((choice) => {
    const { wins, attempts } = record(choice);
    const blocked = attempts >= BLOCKED_MIN_ATTEMPTS && wins === 0;
    const score = blocked ? 0 : (wins + pooled[choice] * PRIOR_WEIGHT) / (attempts + PRIOR_WEIGHT);
    return { choice, wins, attempts, blocked, score };
  });
  const best = assessed.filter((c) => !c.blocked).sort((a, b) => b.score - a.score)[0]?.choice ?? null;
  return { choices: assessed, best };
}
