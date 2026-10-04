import type { ComplicationChoiceKey, ComplicationChoiceStats, ComplicationTypeStats } from './types';

/**
 * Complication choices known to (essentially) never win in a given scenario.
 *
 * From the 2026-10-04 analysis of every archive combined (480 resolved
 * complications, 2026-08-10..10-04 — see
 * verification/street-intel/verify_complication_blocked_choices.py): 14 of 24
 * scenarios have one choice that went 0-for-everything (0/91 combined), while
 * every other choice wins 83–90% pooled. These picks cost $26.4M of the
 * $30.7M lost to complications in that window. Card `autofail` flags don't
 * explain it — this is keyed on the scenario text alone.
 *
 * Seeded here (rather than relying only on the live `complicationTypeStats`)
 * because the live tally only covers automated attempts and misses some of
 * these at n=0-1. The live tally still adds to it — see `isBlockedChoice`.
 */
const KNOWN_BLOCKED: Record<string, ComplicationChoiceKey> = {
  'You hear footsteps behind the door.': 'talk', // 0/12
  'The evidence is heavier than expected.': 'run', // 0/11
  'The package is booby-trapped. You need to act fast.': 'talk', // 0/9
  'The item is locked in a reinforced case.': 'run', // 0/9
  'The target building went into lockdown.': 'talk', // 0/8
  'Your fake credentials are questioned.': 'fight', // 0/7
  "The mark had backup you didn't see coming.": 'talk', // 0/6
  'The drop site is surrounded.': 'talk', // 0/6
  'The room is filling with smoke.': 'talk', // 0/5
  'Silent alarm was tripped. Security is closing in.': 'talk', // 0/5
  'A camera catches your face.': 'fight', // 0/4
  'Someone triggered a silent distress signal.': 'talk', // 0/4
  'Your contact is late and the area is getting hot.': 'fight', // 0/3
  'A patrol car slows down beside you.': 'fight', // 0/2
};

/** Pooled win rate of each choice in scenarios where it *isn't* blocked
 *  (same analysis) — the prior `pickAvoidingBlocked` shrinks a scenario's
 *  own small sample toward. */
const POOLED_WIN_RATE: Record<ComplicationChoiceKey, number> = { fight: 0.85, run: 0.83, talk: 0.9 };
const PRIOR_WEIGHT = 2;
/** A choice with this many tries in a scenario and zero wins is treated as
 *  blocked even if it's not in `KNOWN_BLOCKED` — the same rule replayed
 *  chronologically over the full history cut losses from $30.7M to ~$10M. */
const LIVE_BLOCKED_MIN_ATTEMPTS = 2;

const CHOICES: ComplicationChoiceKey[] = ['fight', 'run', 'talk'];

/** The game has served the same scenario with both a curly and a straight
 *  apostrophe ("didn’t" / "didn't"). */
export function normalizeScenario(scenario: string): string {
  return scenario.replace(/’/g, "'").trim();
}

/** Live tally for one scenario+choice, summed across every raw key that
 *  normalizes to the same scenario (see `normalizeScenario`). */
function liveStats(typeStats: ComplicationTypeStats | undefined, scenario: string, choice: ComplicationChoiceKey): ComplicationChoiceStats {
  const total = { attempts: 0, successes: 0 };
  if (!typeStats) return total;
  for (const [key, bucket] of Object.entries(typeStats)) {
    if (normalizeScenario(key) !== scenario) continue;
    total.attempts += bucket[choice]?.attempts ?? 0;
    total.successes += bucket[choice]?.successes ?? 0;
  }
  return total;
}

export function isBlockedChoice(scenario: string, choice: ComplicationChoiceKey, typeStats: ComplicationTypeStats | undefined): boolean {
  const s = normalizeScenario(scenario);
  if (KNOWN_BLOCKED[s] === choice) return true;
  const live = liveStats(typeStats, s, choice);
  return live.attempts >= LIVE_BLOCKED_MIN_ATTEMPTS && live.successes === 0;
}

/**
 * Keeps `preferred` (whatever the original reuse/fallback rule picked) unless
 * it's blocked for this scenario; otherwise picks the unblocked choice with
 * the best win rate for this scenario, shrunk toward its pooled rate so a
 * 1/1 doesn't outrank a 12/14. `avoided` is the original pick when it was
 * overridden, null otherwise.
 */
export function pickAvoidingBlocked(
  scenario: string,
  preferred: ComplicationChoiceKey,
  typeStats: ComplicationTypeStats | undefined,
): { choice: ComplicationChoiceKey; avoided: ComplicationChoiceKey | null } {
  if (!isBlockedChoice(scenario, preferred, typeStats)) return { choice: preferred, avoided: null };

  const s = normalizeScenario(scenario);
  let best: ComplicationChoiceKey | null = null;
  let bestRate = -1;
  for (const choice of CHOICES) {
    if (isBlockedChoice(s, choice, typeStats)) continue;
    const live = liveStats(typeStats, s, choice);
    const rate = (live.successes + POOLED_WIN_RATE[choice] * PRIOR_WEIGHT) / (live.attempts + PRIOR_WEIGHT);
    if (rate > bestRate) {
      bestRate = rate;
      best = choice;
    }
  }
  // Every choice blocked has never been observed — keep the original pick
  // rather than invent a fourth option.
  return best ? { choice: best, avoided: preferred } : { choice: preferred, avoided: null };
}
