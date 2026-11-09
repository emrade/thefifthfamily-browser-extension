import { LOG_PREFIX } from './log';
import { storage } from './storage';
import type { AutomationQueueFeature } from './types';

/**
 * A lasting record of every time an automation switched itself off, with the
 * time and the reason. Each feature's own `pausedMessage` is cleared the
 * moment the player switches it back on, so before this the reason for a stop
 * was gone by the time anyone looked into it (2026-11-08/09: Pet Couriers and
 * Crimes Auto found off in the morning, cause unrecoverable).
 *
 * Shown on Dashboard → Automations, and copied whole into every HTTP-archive
 * export's header (`stopLog`) so the history can be read alongside the
 * requests. Only stops the extension decided on: the player's own switch-offs
 * aren't recorded.
 */

/** Stops are rare (a few a week at most), so this covers many months. */
const STOP_LOG_LIMIT = 1000;

let write: Promise<void> = Promise.resolve();

export function recordStop(feature: AutomationQueueFeature, message: string): Promise<void> {
  const entry = { at: Date.now(), feature, message };
  // Chained so two stops landing together can't overwrite each other's append.
  write = write
    .then(async () => {
      const log = await storage.getAutomationStopLog();
      log.push(entry);
      await storage.setAutomationStopLog(log.slice(-STOP_LOG_LIMIT));
    })
    .catch((err) => console.error(LOG_PREFIX, 'stop log write failed', err));
  return write;
}
