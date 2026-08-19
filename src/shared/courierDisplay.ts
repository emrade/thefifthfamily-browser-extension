import type { CourierRunSummary, PetRosterEntry } from './types';

/**
 * Display logic shared between the two courier UI surfaces — the popup's Couriers
 * tab (`Courier.tsx`, Preact) and the in-page floating panel (`courierPanel.ts`,
 * plain DOM) — both render the exact same `CourierRunSummary`/roster, just through
 * different rendering paths, so the *data* (which text goes with which reason, how
 * a dollar amount is formatted) has no reason to be typed out twice.
 */

export function formatCourierMoney(n: number): string {
  return `$${n.toLocaleString()}`;
}

export const STOP_REASON_LABEL: Record<NonNullable<CourierRunSummary['stoppedReason']>, string> = {
  'daily-cap-reached': "Today's profit cap is reached — resumes after the midnight reset.",
  'insufficient-funds': 'Not enough cash + bank to load even one pet.',
  'no-idle-pets': 'No idle pets right now — everything is already out or in transit.',
  'no-destination-available': "Neither of this hour's two open destinations is available — try again after the next rotation.",
  'session-error': 'Stopped early — the game rejected a request (stale session or token). Reload the game tab, view Smuggling once, then run again.',
  'shape-changed': "Stopped early — a response didn't look like what this feature expects. The game may have changed something; check the errors below before running again.",
};

/** The "N pets known: ..." line both surfaces show above the Run button. */
export function describeRoster(roster: PetRosterEntry[] | null): string {
  if (roster === null) return 'Loading known pets…';
  if (roster.length === 0) {
    return "0 pets known yet — with all your pets idle, view the Smuggling panel once in-game to populate this.";
  }
  return `${roster.length} pet${roster.length === 1 ? '' : 's'} known: ${roster.map((p) => p.name).join(', ')}`;
}
