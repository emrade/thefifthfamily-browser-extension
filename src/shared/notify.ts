import { storage } from './storage';
import type { NotificationId } from './notifications';

/**
 * Single entry point for firing any notification — checks the player's own
 * enabled/disabled preference first. Every call site should go through this rather
 * than calling chrome.notifications.create directly, so a new notification type only
 * ever needs one new entry in notifications.ts, not a separate preference check
 * hand-wired at each call site.
 */
export async function notify(id: NotificationId, options: chrome.notifications.NotificationOptions<true>): Promise<void> {
  const prefs = await storage.getNotificationPreferences();
  if (!prefs[id]) return;
  chrome.notifications.create(options);
}
