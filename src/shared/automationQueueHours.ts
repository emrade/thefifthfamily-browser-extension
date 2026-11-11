import type { AutomationQueueConfig } from './types';

/**
 * The Automation Queue's quiet hours: a daily window, in the computer's own
 * local time, when the queue steps aside (automations run as if it were off).
 * The window may wrap past midnight (01:00–09:00 doesn't, 23:00–07:00 does).
 * From == To means no window.
 */

const DAY_MIN = 24 * 60;

function minuteOfDay(now: number): number {
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes();
}

export function inQuietHours(config: AutomationQueueConfig, now = Date.now()): boolean {
  if (!config.quietHoursEnabled) return false;
  const from = config.quietFromMin;
  const to = config.quietToMin;
  if (from === to) return false;
  const m = minuteOfDay(now);
  return from < to ? m >= from && m < to : m >= from || m < to;
}

/** When the current quiet hours end; null when not in them. */
export function quietHoursEndAt(config: AutomationQueueConfig, now = Date.now()): number | null {
  if (!inQuietHours(config, now)) return null;
  const d = new Date(now);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(config.quietToMin / 60), config.quietToMin % 60);
  if (end.getTime() <= now) end.setDate(end.getDate() + 1);
  return end.getTime();
}

/** Whether the queue spaces automations out right now. */
export function queueActive(config: AutomationQueueConfig, now = Date.now()): boolean {
  return config.enabled && !inQuietHours(config, now);
}

/** "HH:MM" for an <input type="time">, and back. */
export function minToTime(min: number): string {
  const m = ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function timeToMin(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : null;
}
