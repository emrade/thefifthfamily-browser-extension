import { ALARM_NAMES, STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { AutomationCatchUpStatus } from '@/shared/types';
import { SCHEDULED } from './automationSchedule';

/**
 * Catch-up after sleep (Dashboard → Automations; off by default).
 *
 * Firefox runs each `chrome.alarms` alarm on a countdown, and on macOS that
 * countdown stops while the computer sleeps, but the alarm's
 * `scheduledTime` is the wall-clock time it was set for. So after a sleep, a
 * check can be "due" for many minutes without firing (seen 2026-11-11: the
 * stock check due 10:18:59 UTC ran 10:33:24, after ~15 min asleep).
 *
 * With this on, a 1-minute alarm looks for any automation alarm more than
 * a minute past its time and re-creates it to fire now (keeping its period),
 * so the feature's own handler runs through its usual path and guard. The
 * 1-minute alarm's own countdown also pauses in sleep, so it fires within
 * about a minute of awake time.
 *
 * It only re-times alarms that already exist, for automations that are on;
 * it never sends anything to the game itself.
 */

const PERIOD_MIN = 1;
/** An alarm this late hasn't just been about to fire on its own. */
const OVERDUE_MS = 60_000;

let checkInFlight = false;

async function catchUp(): Promise<void> {
  if (checkInFlight) return;
  checkInFlight = true;
  try {
    const now = Date.now();
    const items: AutomationCatchUpStatus['items'] = [];
    for (const s of SCHEDULED) {
      if (!(await s.isOn())) continue;
      for (const name of s.alarms) {
        const alarm = await chrome.alarms.get(name);
        if (!alarm || now - alarm.scheduledTime <= OVERDUE_MS) continue;
        // Same name replaces the paused one, so it can't also fire later.
        chrome.alarms.create(name, alarm.periodInMinutes ? { when: now + 1_000, periodInMinutes: alarm.periodInMinutes } : { when: now + 1_000 });
        items.push({ feature: s.feature, lateMs: now - alarm.scheduledTime });
      }
    }
    if (items.length) {
      console.info(LOG_PREFIX, 'catch-up after sleep re-armed', items);
      await storage.setAutomationCatchUpStatus({ lastAt: now, items });
    }
  } finally {
    checkInFlight = false;
  }
}

async function ensureAlarm(enabled: boolean): Promise<void> {
  if (!enabled) {
    await chrome.alarms.clear(ALARM_NAMES.AUTOMATION_CATCH_UP);
    return;
  }
  if (await chrome.alarms.get(ALARM_NAMES.AUTOMATION_CATCH_UP)) return;
  chrome.alarms.create(ALARM_NAMES.AUTOMATION_CATCH_UP, { periodInMinutes: PERIOD_MIN, delayInMinutes: PERIOD_MIN });
}

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.AUTOMATION_CATCH_UP) return;
  if (!(await storage.getAutomationCatchUpConfig()).enabled) {
    await ensureAlarm(false);
    return;
  }
  await catchUp();
}

export function init(): void {
  storage
    .getAutomationCatchUpConfig()
    .then((c) => ensureAlarm(c.enabled))
    .catch((err) => console.error(LOG_PREFIX, 'catch-up init failed', err));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEYS.AUTOMATION_CATCH_UP_CONFIG in changes)) return;
    const enabled = Boolean((changes[STORAGE_KEYS.AUTOMATION_CATCH_UP_CONFIG].newValue as { enabled?: boolean } | undefined)?.enabled);
    ensureAlarm(enabled)
      .then(() => (enabled ? catchUp() : undefined))
      .catch((err) => console.error(LOG_PREFIX, 'catch-up toggle failed', err));
  });
}
