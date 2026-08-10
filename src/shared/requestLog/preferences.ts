import { REQUEST_LOG_RETENTION_DAYS } from '@/shared/constants';

export interface RequestLogPreferences {
  /** Master switch. When off, nothing is captured — existing rows are left alone
   *  rather than deleted, so toggling off is a pause, not a wipe. */
  enabled: boolean;
  /** Age cutoff in days. Exposed as a preference because the right answer depends
   *  on disk headroom and how far back the player wants to be able to re-derive
   *  a mechanic, neither of which the extension can know. */
  retentionDays: number;
}

// Opt-out rather than opt-in, matching notifications and page features. The
// archive is only useful in retrospect — a change you want to diff has to have
// been captured *before* you knew you wanted it — so a default-off switch would
// mean it is reliably empty exactly when it is first needed.
export const DEFAULT_REQUEST_LOG_PREFERENCES: RequestLogPreferences = {
  enabled: true,
  retentionDays: REQUEST_LOG_RETENTION_DAYS,
};

/** Offered in the popup. 7 is the "keep it small" answer, 30 the measured-affordable
 *  default (~75 MB gzipped at this account's traffic), 90 for long-run analysis. */
export const RETENTION_CHOICES = [7, 14, 30, 90] as const;
