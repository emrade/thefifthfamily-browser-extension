import type { CourierProgressEvent, CourierRunSummary, PetRosterEntry } from './types';

/**
 * Display logic for the courier UI — the in-page floating panel
 * (`courierPanel.ts`, plain DOM) renders `CourierRunSummary`/roster data through
 * this, so the *data* (which text goes with which reason, how a dollar amount is
 * formatted) lives in one place rather than inline in the panel's render code.
 */

export function formatCourierMoney(n: number): string {
  return `$${n.toLocaleString()}`;
}

/** A shipment's cargo can be mixed — draining pre-existing stash into it ahead of
 *  any new buying (see petCourier.ts) means "what got loaded" is a list, not
 *  always a single item — formatted here once rather than in each of the two
 *  places that show it (live progress, panel summary). */
export function describeItems(items: { item: string; qty: number }[]): string {
  return items.map((i) => `${i.qty}× ${i.item}`).join(', ');
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

/** One line of live progress, shown while a run is in flight — both surfaces
 *  listen for `courier-run-progress` and render whatever this returns. Null for
 *  the two bookend events (`started`/`finished`), which exist to toggle a
 *  "running" state rather than to be shown as their own line. */
export function describeProgressEvent(event: CourierProgressEvent): string | null {
  switch (event.kind) {
    case 'started':
    case 'finished':
      return null;
    case 'drafting':
      return `Drafting ${event.petName}…`;
    case 'offloaded':
      return `Offloaded ${event.petName} — ${formatCourierMoney(event.profit)} profit`;
    case 'sent':
      return `Sent ${event.petName} — ${describeItems(event.items)} → ${event.destination}`;
    case 'skipped':
      return `Skipped ${event.petName} — ${event.reason}`;
    case 'deposited':
      return `Deposited ${formatCourierMoney(event.amount)} to the bank`;
    case 'error':
      return event.message;
  }
}
