import { db } from '@/shared/db';
import { REQUEST_LOG_MAX_BYTES } from '@/shared/constants';
import { storage } from '@/shared/storage';
import { countRowsAfter } from './exportRequestLog';
import { readStats } from './stats';

/**
 * How close the request archive is to losing rows that were never exported.
 *
 * The archive is trimmed oldest-first whenever it passes
 * `REQUEST_LOG_MAX_BYTES` (retention.ts). Rows already exported go first, so
 * nothing is lost until the rows *since the last export* alone fill the cap.
 * That share is what this measures, not the time since the last export: the
 * cap holds ~1.4–2 days at normal play, less on a heavy day.
 *
 * Two real gaps in the merged history came from this (2026-10-23 22:43 →
 * 10-25 23:18, and 10-28 15:44 → 10-29 00:24 UTC); both were flagged
 * "evicted before this export's first row" by scripts/merge-archives.py.
 *
 * The unexported size is estimated from the row count (unexported rows ×
 * average stored row size). Measuring it exactly would mean loading every
 * compressed body.
 */

/** Share of the cap at which to remind: about a day left at normal play. */
export const EXPORT_SOON_AT = 0.5;
/** Share of the cap at which to say "now": hours left. */
export const EXPORT_NOW_AT = 0.8;

export type ExportLevel = 'ok' | 'soon' | 'now' | 'lost';

export interface ExportPressure {
  level: ExportLevel;
  /** Unexported share of the cap (0–1+); null before the first export. */
  share: number | null;
  unexportedRows: number;
  /** Hours until rows start being lost at the rate since the last export;
   *  null when it can't be told yet. */
  hoursLeft: number | null;
  lastExportAt: number | null;
  /** Rows after the last export were already trimmed away: a gap. */
  lost: boolean;
  /** Request archiving is switched off, or nothing has ever been exported. */
  inactive: boolean;
}

export async function readExportPressure(now = Date.now()): Promise<ExportPressure> {
  const [prefs, cursor, lastExportAt, stats] = await Promise.all([
    storage.getRequestLogPreferences(),
    storage.getRequestLogExportCursor(),
    storage.getRequestLogLastExportAt(),
    readStats(),
  ]);
  const inactive = { level: 'ok' as const, share: null, unexportedRows: 0, hoursLeft: null, lastExportAt, lost: false, inactive: true };
  // Never exported: nothing to protect yet, and no cursor to measure from.
  if (!prefs.enabled || cursor === null) return inactive;

  const oldestKey = await db.requestLog.orderBy(':id').firstKey();
  const newestKey = await db.requestLog.orderBy(':id').lastKey();
  const oldestId = typeof oldestKey === 'number' ? oldestKey : null;
  const newestId = typeof newestKey === 'number' ? newestKey : 0;
  if (cursor > newestId) return inactive; // archive was cleared since

  // The first row after the export is gone: those rows were trimmed unexported.
  const lost = oldestId !== null && oldestId > cursor + 1;
  const unexportedRows = await countRowsAfter(cursor, newestId);
  const avg = stats.rows > 0 ? stats.storedBytes / stats.rows : 0;
  const share = (unexportedRows * avg) / REQUEST_LOG_MAX_BYTES;

  let hoursLeft: number | null = null;
  if (lastExportAt !== null && share > 0 && now > lastExportAt) {
    const perHour = share / ((now - lastExportAt) / 3_600_000);
    hoursLeft = Math.max(0, (1 - share) / perHour);
  }

  const level: ExportLevel = lost ? 'lost' : share >= EXPORT_NOW_AT ? 'now' : share >= EXPORT_SOON_AT ? 'soon' : 'ok';
  return { level, share, unexportedRows, hoursLeft, lastExportAt, lost, inactive: false };
}

export function hoursText(h: number | null): string {
  if (h === null) return '';
  if (h < 1) return 'within the hour';
  if (h < 36) return `in about ${Math.round(h)} hours`;
  return `in about ${Math.round(h / 24)} days`;
}

/** One line for banners and notifications. */
export function exportMessage(p: ExportPressure): string {
  if (p.level === 'lost') return 'Some requests were trimmed from the archive before being exported, leaving a gap. Export now to keep the rest.';
  const pct = Math.round((p.share ?? 0) * 100);
  const left = p.hoursLeft !== null ? ` Rows start being lost ${hoursText(p.hoursLeft)} at your current pace.` : '';
  return `Unexported requests fill ${pct}% of the archive.${left}`;
}
