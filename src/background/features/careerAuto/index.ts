import { GAME_ORIGIN, STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { storage } from '@/shared/storage';
import type { CareerAutoConfig, CareerAutoStatus, CareerCatalogEntry, CareerGoalsConfig } from '@/shared/types';
import { parseCareers, type CareersSnapshot } from '@/shared/statAdvisorSources';
import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';
import type { Live } from '@/shared/careerAdvisor';
import { clearQueueFinished, onGoalsConfigChanged } from './goals';
import { fetchLiveStatus } from '../../gameAction';
import { parseCareersCatalog } from './careersPanelParser';
import { onConfigChanged, runIfEligible, scheduleNextCheck } from './runner';

export { handleAlarm } from './runner';

/** For the popup's job picker — fetched fresh on every call rather than cached,
 *  since this is a rare, user-initiated action (opening the tab, or hitting
 *  "Refresh job list") where staleness (a level-up not yet reflected) costs more
 *  than the network round trip. */
export async function fetchCareerCatalog(): Promise<CareerCatalogEntry[]> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?type=careers&_t=${Date.now()}`, { credentials: 'include' });
  const text = await res.text();
  // The player's level keeps locked jobs out of the list during the
  // after-shift break, when their lock isn't shown (see `cardRequiredLevel`).
  // Live first; the last stats a game tab saw if that read fails.
  const level = (await fetchLiveStatus().catch(() => null))?.level || (await storage.getLatestStats())?.level || null;
  return parseCareersCatalog(text, level);
}

/** Run Now from the popup or the in-page panel: one check right now through
 *  the same guard as the alarm, even while switched off, then the fresh
 *  status. A no-op if a check is already running or no job is picked. */
export async function runCheckNow(): Promise<CareerAutoStatus | null> {
  await runIfEligible(true);
  return storage.getCareerAutoStatus();
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
    if (area !== 'local') return;
    if (STORAGE_KEYS.CAREER_AUTO_CONFIG in changes) {
      const next = changes[STORAGE_KEYS.CAREER_AUTO_CONFIG].newValue as CareerAutoConfig | undefined;
      if (next) onConfigChanged(next);
    }
    // Career Advisor goals: goal mode switched on or a goal added should take
    // effect now, not after the current wait.
    if (STORAGE_KEYS.CAREER_GOALS_CONFIG in changes) {
      const next = changes[STORAGE_KEYS.CAREER_GOALS_CONFIG].newValue as CareerGoalsConfig | undefined;
      if (!next) return;
      onGoalsConfigChanged(next).catch((err) => console.error(LOG_PREFIX, 'career goals change failed', err));
      if (next.enabled) storage.getCareerAutoConfig().then(onConfigChanged).catch(() => {});
    }
  });
}

/** Career Advisor's Refresh: reads the Careers page and the player's live
 *  energy/level once. The page is also saved for Combat Stats. */
export async function refreshCareerAdvisor(): Promise<{ snapshot: CareersSnapshot | null; live: Live | null; error: string | null }> {
  try {
    const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?type=careers&_t=${Date.now()}`, { credentials: 'include' });
    const envelope = unwrapPanelEnvelope(await res.text());
    const snapshot = envelope ? parseCareers(envelope.html, Date.now()) : null;
    if (snapshot) await storage.setStatSourceCareers(snapshot);
    const status = await fetchLiveStatus().catch(() => null);
    const live: Live | null = status
      ? { level: status.level, energy: status.energy, maxEnergy: status.maxEnergy, energyRegenSeconds: status.energyRegenSeconds }
      : null;
    return { snapshot, live, error: snapshot ? null : "Couldn't read the jobs on the Careers page." };
  } catch (err) {
    console.error(LOG_PREFIX, 'career advisor refresh failed', err);
    return { snapshot: null, live: null, error: "Couldn't reach the game. Is a game tab open and logged in?" };
  }
}

/** "Keep running this job": stop the all-goals-done reminders. */
export async function keepRunningAfterGoals(): Promise<void> {
  await clearQueueFinished();
}

export function init(): void {
  watchConfigChanges();
  ensureScheduled().catch((err) => console.error(LOG_PREFIX, 'careerAuto ensureScheduled failed', err));
}
