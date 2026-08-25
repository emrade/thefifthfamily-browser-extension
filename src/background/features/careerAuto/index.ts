import { GAME_ORIGIN, STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { storage } from '@/shared/storage';
import type { CareerAutoConfig, CareerCatalogEntry } from '@/shared/types';
import { parseCareersCatalog } from './careersPanelParser';
import { onConfigChanged, scheduleNextCheck } from './runner';

export { handleAlarm } from './runner';

/** For the popup's job picker — fetched fresh on every call rather than cached,
 *  since this is a rare, user-initiated action (opening the tab, or hitting
 *  "Refresh job list") where staleness (a level-up not yet reflected) costs more
 *  than the network round trip. */
export async function fetchCareerCatalog(): Promise<CareerCatalogEntry[]> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?type=careers&_t=${Date.now()}`, { credentials: 'include' });
  return parseCareersCatalog(await res.text());
}

/**
 * Re-arms the alarm on service-worker startup if automation is enabled — alarms
 * don't survive a service-worker restart the way `chrome.storage` does, same
 * problem `ensureSweepAlarm` already solves for its own alarm. Prefers the
 * tracked cooldown over an immediate check, so a restart mid-cooldown doesn't
 * cause an early attempt.
 */
export async function ensureScheduled(): Promise<void> {
  const config = await storage.getCareerAutoConfig();
  if (!config.enabled || config.careerId == null) return;

  const status = await storage.getCareerAutoStatus();
  scheduleNextCheck(status?.nextEligibleAt ?? null);
}

/**
 * Reacts live to the popup writing a new config — flipping `enabled` or
 * switching jobs takes effect immediately rather than waiting for whatever's
 * left of an earlier schedule. Registered once at module load, same as
 * `content/index.ts`'s own `chrome.storage.onChanged` listener for page-feature
 * preferences (the same API, just used on the background side here).
 */
export function watchConfigChanges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEYS.CAREER_AUTO_CONFIG in changes)) return;
    const next = changes[STORAGE_KEYS.CAREER_AUTO_CONFIG].newValue as CareerAutoConfig | undefined;
    if (!next) return;
    onConfigChanged(next);
  });
}

export function init(): void {
  watchConfigChanges();
  ensureScheduled().catch((err) => console.error(LOG_PREFIX, 'careerAuto ensureScheduled failed', err));
}
