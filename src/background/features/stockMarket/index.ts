import { STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { ensureScheduled } from './poller';

export { handlePollAlarm, getStatus, pollNow, resume } from './poller';
export type { StockTrackerStatus } from './poller';

/**
 * Reacts live to the player's Settings toggle — flipping `stockMarketStatus`
 * off clears the poll alarm immediately (see `ensureScheduled` in poller.ts),
 * rather than waiting for the next service-worker wake. Same
 * watch-and-react shape as career-auto's `watchConfigChanges`, just against
 * the shared page-feature-preferences key instead of a feature-specific one
 * — `ensureScheduled` re-reads the full preferences object itself, so this
 * only needs to know *that* it changed, not decode which field.
 */
function watchEnabledChanges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEYS.PAGE_FEATURE_PREFERENCES in changes)) return;
    ensureScheduled().catch((err) => console.error(LOG_PREFIX, 'stockMarket ensureScheduled (on toggle change) failed', err));
  });
}

/** Arms (or, if the toggle is off, leaves disarmed) the poll alarm on every
 *  service-worker wake — alarms don't survive a restart, same problem
 *  `ensureSweepAlarm`/career-auto's `ensureScheduled` already solve for their
 *  own alarms. */
export function init(): void {
  watchEnabledChanges();
  ensureScheduled().catch((err) => console.error(LOG_PREFIX, 'stockMarket ensureScheduled failed', err));
}
