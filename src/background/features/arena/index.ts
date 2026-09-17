import { ALARM_NAMES, ARENA_AUTO_IMMEDIATE_CHECK_DELAY_MS, STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { ArenaAutoConfig, ArenaStatusResponse } from '@/shared/types';
import type { ExtensionMessage } from '@/shared/messaging';
import { onConfigChanged, scheduleNextCheck } from './runner';

export { handleAlarm, runCheckNow } from './runner';

/**
 * Re-arms the shared alarm on service-worker startup — alarms don't survive
 * a restart the way `chrome.storage` does, same problem every other
 * auto-feature's own `ensureScheduled()` solves. Unconditional on
 * `enabled` (unlike those): even with Auto-Attack off, the passive "page
 * ready" watcher (see runner.ts's module doc) still needs to keep running.
 * Gated instead on `ArenaAutoStatus` existing at all — `null` means the
 * player has never been seen on Arena yet (nothing has ever written a
 * status record), so there's nothing to resume; `handleMessage` below
 * arms it fresh the first time that changes, same bootstrap-on-first-view
 * gate `streetIntel/index.ts` uses for its own poll.
 */
export async function ensureScheduled(): Promise<void> {
  const status = await storage.getArenaAutoStatus();
  if (status === null) return;
  scheduleNextCheck(status.nextUnlockAt);
}

/** Reacts live to the popup/overlay flipping `enabled` or changing the boss
 *  threshold — same `chrome.storage.onChanged` pattern as every other auto
 *  feature's own config watcher. Only `enabled` actually needs to trigger a
 *  reschedule (the threshold takes effect on whichever cycle next runs
 *  regardless), but re-checking on any config write is cheap and avoids a
 *  second, narrower listener for no real benefit. */
export function watchConfigChanges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEYS.ARENA_AUTO_CONFIG in changes)) return;
    const next = changes[STORAGE_KEYS.ARENA_AUTO_CONFIG].newValue as ArenaAutoConfig | undefined;
    if (!next) return;
    onConfigChanged();
  });
}

export function init(): void {
  watchConfigChanges();
  ensureScheduled().catch((err) => console.error(LOG_PREFIX, 'arena ensureScheduled failed', err));
}

/** Bootstraps the alarm the first time the player is actually seen on
 *  Arena — same "don't run anything for an account that's never touched
 *  this page" reasoning as `streetIntel/index.ts`'s own view-triggered
 *  bootstrap. Checked via `chrome.alarms.get` rather than unconditionally
 *  recreating it, so a later visit doesn't keep pushing an already-running
 *  cycle's next check back out. */
export async function handleMessage(msg: ExtensionMessage): Promise<void> {
  if (msg.type !== 'arena-viewed') return;
  const existing = await chrome.alarms.get(ALARM_NAMES.ARENA_AUTO);
  if (existing) return;
  // Not `scheduleNextCheck(null)` (that means "unknown timer, use the
  // nag/fallback cadence", a 15-minute wait) — this is a brand new
  // bootstrap, so it gets the same "don't sit idle before the first real
  // check" immediate delay every other auto feature's own enable path uses.
  chrome.alarms.create(ALARM_NAMES.ARENA_AUTO, { when: Date.now() + ARENA_AUTO_IMMEDIATE_CHECK_DELAY_MS });
}

export async function getStatus(): Promise<ArenaStatusResponse> {
  const [config, status] = await Promise.all([storage.getArenaAutoConfig(), storage.getArenaAutoStatus()]);
  return { config, status };
}
