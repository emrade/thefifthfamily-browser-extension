import { LOG_PREFIX } from '@/shared/log';
import { notify } from '@/shared/notify';
import { storage } from '@/shared/storage';
import { exportMessage, readExportPressure, type ExportLevel } from '@/shared/requestLog/exportReminder';
import { openDashboard } from '../../automationSchedule';

/**
 * Reminds the player to export the HTTP archive before unexported rows are
 * trimmed (shared/requestLog/exportReminder.ts). Checked after each hourly
 * archive sweep. Each level notifies once per export cycle (reset when an
 * export is downloaded), replacing its own previous notification.
 */

const NOTIFICATION_ID = 'ff-archive-export-reminder';
const RANK: Record<ExportLevel, number> = { ok: 0, soon: 1, now: 2, lost: 3 };
const TITLE: Record<Exclude<ExportLevel, 'ok'>, string> = {
  soon: 'Time to export the HTTP Archive soon',
  now: 'Export the HTTP Archive now',
  lost: 'HTTP Archive: rows were lost before export',
};

export async function checkExportReminder(): Promise<void> {
  const p = await readExportPressure();
  if (p.inactive || p.level === 'ok') return;
  const reminded = (await storage.getRequestLogExportReminded()) as ExportLevel | null;
  if (reminded && RANK[reminded] >= RANK[p.level]) return;
  await notify(
    'archiveExportReminder',
    { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon-128.png'), title: TITLE[p.level], message: exportMessage(p) },
    NOTIFICATION_ID,
  );
  await storage.setRequestLogExportReminded(p.level);
}

export function init(): void {
  chrome.notifications.onClicked.addListener((id) => {
    if (id !== NOTIFICATION_ID) return;
    chrome.notifications.clear(id);
    openDashboard('http-archive').catch((err) => console.error(LOG_PREFIX, 'open HTTP Archive failed', err));
  });
}
