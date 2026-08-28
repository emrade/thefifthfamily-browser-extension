import type { CourierProgressEvent, CourierRunSummary, District, FightClubHeroStats, PetRosterEntry, RawStatsPayload } from './types';
import { LOG_PREFIX } from './log';

/**
 * Raw envelope posted from the MAIN-world fetch/XHR hook (mainWorldHook.ts) to the
 * isolated-world content script (content/index.ts) via window.postMessage. The
 * isolated script owns all parsing — the MAIN-world hook only ever forwards bytes.
 */
export interface CapturedRequest {
  source: 'ff-network-hook';
  /** Widened from `'GET' | 'POST'` when the hook started capturing every
   *  same-origin call for the archive: the two endpoints the adapters parse are
   *  GET/POST, but nothing guarantees that of an endpoint we haven't seen yet. */
  method: string;
  url: string;
  /** True only for `/api/` and `/actions/` paths. Feature adapters run on these;
   *  the archive takes every capture regardless. */
  tracked: boolean;
  requestBody: string | null;
  responseText: string;
  /** Set when the body exceeded REQUEST_LOG_MAX_BODY_BYTES and was cut short in
   *  the page, before crossing the message boundary. */
  truncated: boolean;
  status: number | null;
  durationMs: number | null;
  timestamp: number;
}

/**
 * Structured events sent from the isolated content script to the background worker
 * via chrome.runtime.sendMessage, after adapters have parsed a CapturedRequest.
 */
export type ExtensionMessage =
  | { type: 'district-catalog'; districts: District[] }
  | {
      type: 'price-snapshot';
      district: string;
      timestamp: number;
      borderSeizureRisk: number;
      hiddenCargo: { current: number; max: number };
      marketShiftSeconds: number | null;
      entries: { item: string; price: number; type: 'buy' | 'sell'; trendPct: number | null; stash: number }[];
    }
  | { type: 'trade-buy'; item: string; quantity: number; timestamp: number }
  | { type: 'trade-sell'; item: string; quantity: number; sellTotal: number; grossProfit: number; timestamp: number }
  | { type: 'customs-raid-detected'; district: string; bribe: number; timestamp: number }
  | { type: 'customs-resolved'; resolution: 'bribe' | 'run' | 'surrender'; caught: boolean; cargoLost: boolean; jailSeconds: number | null; bribeAmount: number | null; timestamp: number }
  | { type: 'player-stats'; snapshot: RawStatsPayload }
  // Carries the destination by name, not id — `/actions/travel_proto.php` (the
  // endpoint this is parsed from) reports it that way, and resolving to an id needs
  // the district table, which only background has. See travelAdapter.ts.
  | { type: 'travel-started'; destinationCityName: string; method: 'walk' | 'taxi'; travelTimeSeconds: number; timestamp: number }
  | { type: 'travel-cancelled'; timestamp: number }
  // The freshest CSRF token seen on any captured POST body — cached by background
  // for the pet-courier automation's own outgoing action calls. Sent on every
  // observed token, not just changes; background only writes to storage when the
  // value actually differs, so the redundant sends cost a cheap comparison, not a
  // storage write. See docs/smuggling-v2-plan.md's "CSRF" note.
  | { type: 'csrf-observed'; token: string }
  // Opportunistic — only sent when a `smug_tab=proto` capture happened to show the
  // full roster (zero active shipments; see docs/smuggling-v2-plan.md). Most
  // captures produce an empty array and aren't sent at all.
  | { type: 'pet-roster-observed'; entries: PetRosterEntry[] }
  | { type: 'fight-stats'; heroStats: FightClubHeroStats; timestamp: number }
  // Sent from the popup, not a content-script adapter — the one exception to this
  // union's usual "parsed capture" shape. background/index.ts special-cases it,
  // returning a Promise<CourierRunSummary> from the listener rather than the
  // fire-and-forget `void` every other message gets, so the popup can await the
  // result directly instead of polling storage for it.
  | { type: 'courier-run-requested' }
  // Same shape of exception as 'courier-run-requested' above — returns a
  // Promise<CourierStatus> rather than firing and forgetting. Read-only (unlike a
  // run, never spends anything), so unlike the run button this is safe to call
  // opportunistically — e.g. the in-page floating panel refreshing itself whenever
  // it's opened, not just on an explicit action.
  | { type: 'courier-status-requested' }
  // Same request/response exception as 'courier-run-requested' — a lighter action
  // that only collects arrived shipments (and sweeps cash to the bank), skipping
  // the draft/buy/load/depart cycle entirely. Exists because offloading one pet at
  // a time in-game is exactly the repetitive tapping this feature was built to
  // remove, even on visits where the player doesn't want to spend on a full send.
  | { type: 'courier-offload-requested' }
  // Same request/response exception as 'courier-status-requested' — read-only,
  // so safe to call opportunistically. Sent by the in-page Stock Market status
  // overlay (content/features/stockMarket), which — like the courier panel —
  // runs on the game's own origin and so can't reach `db`/`storage` directly;
  // this is the only way for it to show whether the background poller
  // (background/features/stockMarket/poller.ts) is actually running.
  | { type: 'stock-tracker-status-requested' }
  // Same request/response exception, triggered by the overlay's "Sync Now"
  // button — runs a real poll immediately (rather than waiting out however
  // much of the 30-minute schedule is left) and returns the resulting fresh
  // status in one round trip, so e.g. fixing a stale CSRF token can be
  // confirmed right away instead of by waiting for the next scheduled attempt.
  | { type: 'stock-tracker-poll-requested' }
  // Same read-only, opportunistic-call exception, triggered by the overlay's
  // "Resume Tracking" button — clears a pause set by poller.ts's `pause`
  // (see its own comment for why that exists) and returns the refreshed
  // status. Never fires automatically; a human explicitly deciding to
  // resume is the whole point of pausing in the first place.
  | { type: 'stock-tracker-resume-requested' }
  // Broadcast (not awaited, no response expected) from background *during* a run
  // — the popup and the in-page floating panel both listen for this to show
  // progress live instead of going quiet until the final summary arrives. Purely
  // additive: the run still resolves with the complete `CourierRunSummary` the
  // same way it always did, this is only ever a UI convenience layered on top.
  | { type: 'courier-run-progress'; event: CourierProgressEvent }
  // Fired on any sign the player is actively using Street Intel — a panel view or a
  // resolved attempt — just to arm background's recurring poll (see background/
  // features/streetIntel) the first time it's needed. Carries no data of its own;
  // the poll re-fetches the panel itself on every cycle rather than working off
  // whatever this particular view happened to show.
  | { type: 'street-intel-viewed'; timestamp: number }
  // Sent from the popup's Career Auto tab, not a content-script adapter — same
  // request/response exception as 'courier-run-requested'. Returns a fresh
  // Promise<CareerCatalogEntry[]> (background fetches+parses the live careers
  // panel on every call rather than caching it) for the job picker, since this
  // is a rare, user-initiated action where staleness costs more than the fetch.
  | { type: 'career-catalog-requested' }
  // Raw archive write. Unlike every other message here this one carries unparsed
  // bytes, because that is the point — the archive's value is in holding exactly
  // what the server sent, including from endpoints no adapter understands yet.
  // Handled off the ordered feature queue in background/index.ts.
  | {
      type: 'request-log';
      method: string;
      url: string;
      requestBody: string | null;
      responseText: string;
      /** Forwarded from the hook. Without it the flag would be lost: the body is
       *  capped in the page, so by the time the background worker measures it, it
       *  is under the limit and looks complete. */
      truncated: boolean;
      status: number | null;
      durationMs: number | null;
      timestamp: number;
    };

/**
 * Every content-script feature adapter sends its parsed ExtensionMessage the same
 * way — fire-and-forget to the background worker, logging (not throwing) on
 * failure since a dropped message here shouldn't break the page. Centralized so
 * that behavior lives in exactly one place instead of being re-copied per feature.
 */
export function sendMessage(message: ExtensionMessage): void {
  chrome.runtime.sendMessage(message).catch((err) => {
    console.error(LOG_PREFIX, 'sendMessage failed for', message.type, err);
  });
}
