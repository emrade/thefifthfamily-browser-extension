import {
  ALARM_NAMES,
  ARENA_REMINDER_NOTIFICATION_ID,
  ARENA_WATCH_BUFFER_MS,
  ARENA_WATCH_REPEAT_MS,
  GAME_ORIGIN,
} from '@/shared/constants';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { notify } from '@/shared/notify';
import { storage } from '@/shared/storage';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import {
  parseArenaTimerEnd,
  parseBossEnginePageId,
  parseCurrentPageNumber,
  parseIsDayComplete,
  parseIsPotActive,
  parseOpenOpponents,
  unwrapArenaPanelHtml,
} from './arenaPanelParser';
import type { ArenaPageState } from '@/shared/types';

const FEATURE_KEY = 'arena';

/**
 * The Arena page reminder: a read-only watcher that never posts a game
 * action. It replaced Arena Auto-Attack on 2026-09-24, when the player chose
 * to play every page by hand with the in-page fight advisor instead (Auto
 * won 16/38 fights and never fought a boss; see
 * docs/arena-combat-mechanics.md).
 *
 * Each check reads the Arena panel once and lands in one of four states:
 *
 * - **in-progress**: a page is open with something left to do (a live
 *   opponent, an engageable boss, or an unbanked pot). Remind, and keep
 *   reminding every `ARENA_WATCH_REPEAT_MS` until it's banked. This is the
 *   player's own ask: the old watcher went quiet as soon as a page was
 *   opened, so an opened-but-unfinished page never reminded again.
 * - **ready**: nothing open and the next page's timer has run out. Remind
 *   on the same cadence until it's opened.
 * - **waiting**: nothing open, timer still running. Check again when it ends.
 * - **day-complete**: today's 6 pages are used. Check again on the fallback
 *   cadence; no reminder.
 *
 * Each reminder uses one fixed notification id with `requireInteraction`,
 * cleared before it's re-created: it stays on screen until the player acts
 * on it, never piles up, and still pops (and sounds) again on each repeat.
 *
 * No kill switch of its own (same "no gameplay action" posture as the stock
 * market poller). The player silences it with the `arenaPageUnlocked`
 * notification preference.
 */

async function fetchPanelHtml(): Promise<string | null> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?arena_tab=v2&av2_view=arena&type=arena&_t=${Date.now()}`, { credentials: 'include' });
  const text = await res.text();
  return unwrapArenaPanelHtml(text);
}

function scheduleAt(when: number): number {
  chrome.alarms.create(ALARM_NAMES.ARENA_WATCH, { when });
  return when;
}

/** Next check at `nextUnlockAt` (plus a small buffer), or on the repeat
 *  cadence when there's no timer to align to. */
export function scheduleNextCheck(nextUnlockAt: number | null): number {
  return scheduleAt(nextUnlockAt !== null ? nextUnlockAt + ARENA_WATCH_BUFFER_MS : Date.now() + ARENA_WATCH_REPEAT_MS);
}

// `chrome.alarms` can fire one scheduled alarm twice after the service
// worker has been dormant (seen here 2026-09-17, and in
// streetIntel/actionRunner.ts). This check only reads, but a duplicate would
// still double-notify, so overlapping runs are skipped.
let checkInFlight = false;

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.ARENA_WATCH) return;
  if (checkInFlight) return;
  checkInFlight = true;
  try {
    await runCheck();
  } finally {
    checkInFlight = false;
  }
}

async function remind(title: string, message: string): Promise<void> {
  await chrome.notifications.clear(ARENA_REMINDER_NOTIFICATION_ID);
  await notify(
    'arenaPageUnlocked',
    {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message,
      requireInteraction: true,
    },
    ARENA_REMINDER_NOTIFICATION_ID,
  );
}

/** What's left on an open page, for the reminder text. */
function describeInProgress(html: string): string {
  const page = parseCurrentPageNumber(html);
  const where = page !== null ? `Page ${page}` : 'Your Arena page';
  const left = parseOpenOpponents(html).length;
  if (left > 0) return `${where}: ${left} opponent${left === 1 ? '' : 's'} left to fight.`;
  if (parseBossEnginePageId(html) !== null) return `${where}: the boss is unlocked. Fight it or bank.`;
  return `${where}: your pot isn't banked yet.`;
}

async function runCheck(): Promise<void> {
  const html = await fetchPanelHtml();
  if (!html) {
    recordParseFailure(FEATURE_KEY);
    const nextCheckAt = scheduleNextCheck(null);
    const prev = await storage.getArenaWatchStatus();
    await storage.setArenaWatchStatus({
      state: prev?.state ?? null,
      nextUnlockAt: prev?.nextUnlockAt ?? null,
      nextCheckAt,
      checkedAt: Date.now(),
    });
    return;
  }
  recordParseSuccess(FEATURE_KEY);

  const timerEnd = parseArenaTimerEnd(html);
  const inProgress = parseOpenOpponents(html).length > 0 || parseBossEnginePageId(html) !== null || parseIsPotActive(html);

  let state: ArenaPageState;
  let nextCheckAt: number;
  if (inProgress) {
    state = 'in-progress';
    await remind('Arena page unfinished', describeInProgress(html));
    nextCheckAt = scheduleNextCheck(null);
  } else if (parseIsDayComplete(html)) {
    // Checked before the timer: the final page of the day has no countdown,
    // so a missing timer alone doesn't mean "ready" (see
    // arenaPanelParser.ts's parseIsDayComplete).
    state = 'day-complete';
    nextCheckAt = scheduleNextCheck(null);
  } else if (timerEnd !== null && timerEnd > Date.now()) {
    state = 'waiting';
    nextCheckAt = scheduleNextCheck(timerEnd);
  } else {
    state = 'ready';
    await remind('Arena page ready', 'A new Arena page is ready to open.');
    nextCheckAt = scheduleNextCheck(null);
  }

  await storage.setArenaWatchStatus({
    state,
    nextUnlockAt: state === 'day-complete' ? null : timerEnd,
    nextCheckAt,
    checkedAt: Date.now(),
  });
}

/** Clicking the reminder brings the game forward (focusing an open game tab,
 *  or opening one) and dismisses it. */
export async function handleNotificationClick(notificationId: string): Promise<void> {
  if (notificationId !== ARENA_REMINDER_NOTIFICATION_ID) return;
  await chrome.notifications.clear(notificationId);
  const [tab] = await chrome.tabs.query({ url: `${GAME_ORIGIN}/*` });
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: `${GAME_ORIGIN}/` });
  }
}
