import { storage } from './storage';
import type { NotificationId } from './notifications';

/**
 * Single entry point for firing any notification — checks the player's own
 * enabled/disabled preference first. Every call site should go through this rather
 * than calling chrome.notifications.create directly, so a new notification type only
 * ever needs one new entry in notifications.ts, not a separate preference check
 * hand-wired at each call site.
 */
export async function notify(
  id: NotificationId,
  options: chrome.notifications.NotificationOptions<true>,
  /** Optional fixed notification id, so a repeating reminder replaces its
   *  own previous notification instead of stacking a new one each time. */
  notificationId?: string,
): Promise<void> {
  const prefs = await storage.getNotificationPreferences();
  if (!prefs[id]) return;
  if (notificationId) chrome.notifications.create(notificationId, options);
  else chrome.notifications.create(options);
}
