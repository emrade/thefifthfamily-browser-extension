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

/** "in 12m" / "in 1h 20m" / "any moment" — used for both the next hourly
 *  check and each en-route pet's ETA, so the two read consistently. Absolute
 *  time is shown alongside this wherever it's used (the panel isn't polled
 *  continuously, so a bare relative string would go stale between refreshes). */
export function formatRelativeTime(atMs: number, nowMs: number = Date.now()): string {
  const diff = atMs - nowMs;
  if (diff <= 0) return 'any moment';
  const totalMinutes = Math.round(diff / 60_000);
  if (totalMinutes < 1) return 'under a minute';
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** A shipment's cargo can be mixed — draining pre-existing stash into it ahead of
 *  any new buying (see petCourier.ts) means "what got loaded" is a list, not
 *  always a single item — formatted here once rather than in each of the two
 *  places that show it (live progress, panel summary). */
export function describeItems(items: { item: string; qty: number }[]): string {
  return items.map((i) => `${i.qty}× ${i.item}`).join(', ');
}

/** One line for a `v2_launch` bulk-dispatch result — the `sent`-list
 *  counterpart for `CourierRunSummary.launched`, see its own doc comment. */
export function describeLaunched(launched: NonNullable<CourierRunSummary['launched']>): string {
  return `${launched.petCount} courier${launched.petCount === 1 ? '' : 's'} → ${launched.destination} — ${launched.unitsBought} units bought for ${formatCourierMoney(launched.cashSpent)}`;
}

/** One line for a `v2_offload_all` bulk-collect result — the `offloaded`-list
 *  counterpart for `CourierRunSummary.offloadedBatch`, see its own doc comment. */
export function describeOffloadedBatch(batch: NonNullable<CourierRunSummary['offloadedBatch']>): string {
  return `Collected ${batch.runsCollected} deliveries — ${batch.unitsSold} units for ${formatCourierMoney(batch.cashReceived)} (${formatCourierMoney(batch.netProfit)} profit)`;
}

export const STOP_REASON_LABEL: Record<NonNullable<CourierRunSummary['stoppedReason']>, string> = {
  'daily-cap-reached': "Today's profit cap is reached — resumes after the midnight reset.",
  'insufficient-funds': 'Not enough cash + bank to load even one pet.',
  'no-idle-pets': 'No idle pets right now — everything is already out or in transit.',
  'no-destination-available': "Neither of this hour's two open destinations is available — try again after the next rotation.",
  'session-error': 'Stopped early — the game rejected a request (stale session or token). Reload the game tab, view Smuggling once, then run again.',
  'shape-changed': "Stopped early — a response didn't look like what this feature expects. The game may have changed something; check the errors below before running again.",
  'status-blocked': 'Stopped early — jailed, hospitalized, or travelling right now. Try again once that clears.',
  'repeated-rejection': 'Stopped — the game kept rejecting the same request the same way. Check the errors below before running again.',
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
