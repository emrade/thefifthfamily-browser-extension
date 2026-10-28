import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { SEED_CUTOFF, normalizeScenario } from '@/shared/streetIntelComplications';
import type { ComplicationChoiceKey, ComplicationTypeStats } from '@/shared/types';

/**
 * The live complication tally the FF PICK/AVOID hint and `avoidBlocked` add
 * on top of the archive-built `SEED_RECORDS`: every complication resolved
 * after `SEED_CUTOFF`, by the auto-runner or by hand on the page. Anything at
 * or before the cutoff is already in the seed, so it's skipped here — that's
 * what lets the two be summed rather than double-counting.
 *
 * Kept in its own storage key, written only from background, one write at a
 * time: the auto-runner reads `StreetIntelAutoStatus` at the start of a cycle
 * and writes it back at the end, so a manual result folded into that object
 * mid-cycle would be lost.
 */

let writeChain: Promise<void> = Promise.resolve();

export function bumpComplicationTypeStats(
  current: ComplicationTypeStats | undefined,
  type: string,
  choice: ComplicationChoiceKey,
  success: boolean,
): ComplicationTypeStats {
  const base = current ?? {};
  const bucket = base[type] ?? { fight: { attempts: 0, successes: 0 }, run: { attempts: 0, successes: 0 }, talk: { attempts: 0, successes: 0 } };
  const prior = bucket[choice];
  return {
    ...base,
    [type]: { ...bucket, [choice]: { attempts: prior.attempts + 1, successes: prior.successes + (success ? 1 : 0) } },
  };
}

export function recordComplicationOutcome(scenario: string, choice: ComplicationChoiceKey, success: boolean, at: number): Promise<void> {
  const key = normalizeScenario(scenario);
  if (at <= SEED_CUTOFF || !key) return writeChain;
  writeChain = writeChain
    .then(async () => {
      const tally = await storage.getStreetIntelComplicationTally();
      await storage.setStreetIntelComplicationTally(bumpComplicationTypeStats(tally, key, choice, success));
    })
    .catch((err) => console.error(LOG_PREFIX, 'street intel complication tally write failed', err));
  return writeChain;
}
