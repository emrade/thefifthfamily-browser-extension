import { STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { CrimesAutoConfig, CrimesAutoStatus } from '@/shared/types';
import { onConfigChanged, runIfEligible } from './runner';

export { handleAlarm } from './runner';

/**
 * Forces an eligibility check right now instead of waiting out whatever's
 * left of a scheduled alarm — see `'crimes-check-requested'`'s own doc
 * comment in shared/messaging.ts for the gap this closes (a manually-used
 * Nerve consumable making the account ready earlier than a previously
 * computed `nerveReadyAt` wait accounted for). A no-op, same as the alarm
 * path, if automation is currently disabled or a cycle is already running.
 */
export async function runCheckNow(): Promise<CrimesAutoStatus | null> {
  await runIfEligible();
  return storage.getCrimesAutoStatus();
}

/**
 * Reacts live to the popup writing a new config — same pattern as
 * `careerAuto/index.ts`'s `watchConfigChanges`.
 */
function watchConfigChanges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEYS.CRIMES_AUTO_CONFIG in changes)) return;
    const next = changes[STORAGE_KEYS.CRIMES_AUTO_CONFIG].newValue as CrimesAutoConfig | undefined;
    if (!next) return;
    onConfigChanged(next);
  });
}

/**
 * Re-arms the alarm on service-worker startup if automation is enabled —
 * alarms don't survive a service-worker restart the way `chrome.storage`
 * does, same problem `careerAuto/index.ts`'s `ensureScheduled` solves for
 * its own alarm. Runs an eligibility check right away rather than waiting
 * out the fallback interval, since there's no tracked cooldown to prefer
 * the way Career Auto has.
 */
async function ensureScheduled(): Promise<void> {
  const config = await storage.getCrimesAutoConfig();
  if (!config.enabled) return;
  await runIfEligible();
}

export function init(): void {
  watchConfigChanges();
  ensureScheduled().catch((err) => console.error(LOG_PREFIX, 'crimesAuto ensureScheduled failed', err));
}
