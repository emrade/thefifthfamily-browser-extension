import { normalizeScenario } from './streetIntelComplications';
import type { ComplicationChoiceStats, StandGroundTestStats } from './types';

/**
 * Temporary: opt-in test of the fourth complication choice, `stand_ground`
 * (Defence), which the runner never used. Everything about the test lives
 * here so it can be removed cleanly once there's enough data — see
 * docs/street-intel-stand-ground-test.md for why and when.
 */

export const STAND_GROUND_CHOICE = 'stand_ground';
export const STAND_GROUND_TEST_DEFAULT_MAX_REWARD = 200_000;
/** Same as the blocked-choice rule: 0 wins in this many tries in one
 *  scenario stops the test there. */
const SCENARIO_BLOCKED_MIN_ATTEMPTS = 2;
/** After this many tries overall, the test stops if it has fewer than
 *  `OVERALL_MIN_WINS` wins — clearly worse than the ~85% the other choices
 *  manage, not worth paying for more data. */
const OVERALL_CHECK_AFTER = 6;
const OVERALL_MIN_WINS = 3;

export const EMPTY_STAND_GROUND_TEST_STATS: StandGroundTestStats = { attempts: 0, successes: 0, cashLost: 0, byScenario: {} };

function scenarioRecord(stats: StandGroundTestStats, scenario: string): ComplicationChoiceStats {
  const s = normalizeScenario(scenario);
  let attempts = 0;
  let successes = 0;
  for (const [key, rec] of Object.entries(stats.byScenario)) {
    if (normalizeScenario(key) !== s) continue;
    attempts += rec.attempts;
    successes += rec.successes;
  }
  return { attempts, successes };
}

/** True once the test has stopped itself overall. */
export function standGroundTestFailed(stats: StandGroundTestStats | undefined): boolean {
  return !!stats && stats.attempts >= OVERALL_CHECK_AFTER && stats.successes < OVERALL_MIN_WINS;
}

/** Whether this complication should be answered with `stand_ground` instead
 *  of the runner's normal pick. */
export function shouldTestStandGround(
  enabled: boolean,
  maxReward: number,
  reward: number,
  scenario: string | null,
  stats: StandGroundTestStats | undefined,
): boolean {
  if (!enabled || scenario === null || reward > maxReward) return false;
  const s = stats ?? EMPTY_STAND_GROUND_TEST_STATS;
  if (standGroundTestFailed(s)) return false;
  const rec = scenarioRecord(s, scenario);
  return !(rec.attempts >= SCENARIO_BLOCKED_MIN_ATTEMPTS && rec.successes === 0);
}

export function bumpStandGroundTestStats(
  current: StandGroundTestStats | undefined,
  scenario: string,
  success: boolean,
  cashLost: number,
): StandGroundTestStats {
  const base = current ?? EMPTY_STAND_GROUND_TEST_STATS;
  const prior = base.byScenario[scenario] ?? { attempts: 0, successes: 0 };
  return {
    attempts: base.attempts + 1,
    successes: base.successes + (success ? 1 : 0),
    cashLost: base.cashLost + cashLost,
    byScenario: { ...base.byScenario, [scenario]: { attempts: prior.attempts + 1, successes: prior.successes + (success ? 1 : 0) } },
  };
}

/** One-line summary for the popup / in-page panel. */
export function describeStandGroundTest(stats: StandGroundTestStats | undefined): string {
  const s = stats ?? EMPTY_STAND_GROUND_TEST_STATS;
  if (s.attempts === 0) return 'No tries yet.';
  const pct = Math.round((s.successes / s.attempts) * 100);
  const stopped = standGroundTestFailed(s) ? ' Stopped: too few wins in the first 6 tries.' : '';
  return `Won ${s.successes}/${s.attempts} (${pct}%) · lost $${s.cashLost.toLocaleString()}.${stopped}`;
}
