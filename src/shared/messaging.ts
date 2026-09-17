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
  // Sent from the in-page Street Intel status overlay (content/features/
  // streetIntel/statusPanel.ts) — same request/response exception as
  // 'stock-tracker-status-requested'. Everything else that overlay shows
  // (`StreetIntelAutoConfig`/`StreetIntelAutoStatus`) lives in
  // `chrome.storage.local`, which a content script can read directly the
  // same way the popup does — no round trip needed. `chrome.alarms`, unlike
  // `chrome.storage`, isn't reachable from a content script at all, so the
  // one thing that *does* need asking background is the poll alarm's own
  // `scheduledTime`, for the narrow "no attempt has ever run yet, so
  // `StreetIntelAutoStatus.nextEligibleAt` is still null" case — mirrors
  // `StreetIntelAutoHome.tsx`'s own `nextAlarmAt` fallback in the popup.
  | { type: 'street-intel-next-check-requested' }
  // Sent from the popup's Career Auto tab, not a content-script adapter — same
  // request/response exception as 'courier-run-requested'. Returns a fresh
  // Promise<CareerCatalogEntry[]> (background fetches+parses the live careers
  // panel on every call rather than caching it) for the job picker, since this
  // is a rare, user-initiated action where staleness costs more than the fetch.
  | { type: 'career-catalog-requested' }
  // Sent from the popup's Crimes Auto tab's "Check Now" button — same
  // "run for real right now, return the resulting fresh status" exception as
  // 'stock-tracker-poll-requested'. Exists for the gap a purely time-based
  // schedule can't cover on its own: the player manually using a Nerve-restoring
  // consumable while the runner is sitting on a computed `nerveReadyAt` wait
  // makes Nerve sufficient early, but nothing re-evaluates state until that
  // alarm fires — this lets the player force the recheck immediately instead
  // of it going unnoticed until the original wait elapses anyway.
  | { type: 'crimes-check-requested' }
  // Sent from the in-page Street Racing overlay on mount/refresh — same
  // "live fetch+parse only background can do" exception as
  // 'career-catalog-requested'. Returns a fresh `RaceCatalog` (car, weather,
  // every race with its current unlocked/attemptsToday/wins state) rather
  // than anything cached, since the overlay's whole point is showing the
  // player's real current standing before they tap a race.
  | { type: 'street-race-catalog-requested' }
  // Sent from the overlay when the player taps a race's Run button — same
  // request/response shape as 'courier-run-requested': background performs
  // the whole `can_race` -> (sampled minigame delay) -> `attempt_race`
  // sequence (see `background/features/streetRacing`) and returns the
  // resulting `RaceAttemptResult` directly, so the overlay can update just
  // that race's row the moment it resolves rather than re-fetching the
  // whole catalog. `raceName` is threaded through only because
  // `attempt_race`'s own response never echoes it back.
  | { type: 'street-race-run-requested'; raceId: number; raceName: string }
  // Broadcast (via `chrome.tabs.sendMessage`, not `chrome.runtime.sendMessage`
  // — same targeting reason as 'courier-run-progress') the moment `can_race`
  // clears and the sampled minigame delay starts, so the overlay can show a
  // real progress bar/countdown against `durationMs` instead of an
  // indeterminate spinner for the ~20-27s wait before `attempt_race` actually
  // fires. `startedAt` (not just `durationMs`) lets the overlay compute
  // accurate remaining time even if this message arrives a little late.
  | { type: 'street-race-progress'; raceId: number; startedAt: number; durationMs: number }
  // Sent from the in-page Garage & Dealership overlay on mount/refresh — same
  // "live fetch+parse only background can do" exception as
  // 'street-race-catalog-requested'. Returns a fresh `GarageCatalog` (owned
  // vehicles + dealer stock + cash/platinum on hand) rather than anything
  // cached, since both the Bulk Buy total and the Strip/Delete selection
  // lists need the player's real current state before anything is confirmed.
  | { type: 'garage-catalog-requested' }
  // Sent when the Bulk Delete tab needs a real payout number for a vehicle
  // before it can total up a confirm price — `bodyQuicksell` isn't on the
  // catalog's own car list (see `GarageCarState`'s own doc for why this
  // isn't derived instead of fetched).
  | { type: 'garage-car-state-requested'; carId: number }
  // Live cash-on-hand, straight from `stats.php` (via `fetchLiveStatus`) —
  // what the Bulk Buy tab checks against its computed total both right after
  // the player says they've withdrawn, and again immediately before the
  // batch actually starts spending, since time (and other spending) may have
  // passed between the two.
  | { type: 'garage-cash-requested' }
  // Sent by the Bulk Buy tab's confirmed batch, once per vehicle — same
  // "one action per message, loop lives in the overlay" shape as
  // 'street-race-run-requested', so pacing (`postAction`'s baseline gap) and
  // per-item error handling both go through the same single-item path a
  // manual purchase would.
  | { type: 'garage-buy-requested'; modelId: number }
  // Same per-item shape as 'garage-buy-requested', for the Strip Parts tab's
  // confirmed batch. `GarageStripResult.affected` (other vehicles unequipped
  // because a part native to this one was fitted elsewhere) is why the
  // overlay re-fetches the whole catalog once a strip batch finishes rather
  // than patching just the rows it touched.
  | { type: 'garage-strip-requested'; carId: number }
  // Same per-item shape, for the Delete Bodies tab's confirmed batch.
  | { type: 'garage-sell-body-requested'; carId: number }
  // Sent when the Fit Parts tab needs a fresh read of the player's whole
  // loose-parts bin to plan an auto-fit — fetched live immediately before
  // planning (see `background/features/garage`'s `fetchInventory` doc), not
  // cached, since a part one plan step consumes must not be offered again
  // to the next.
  | { type: 'garage-inventory-requested' }
  // Same per-item shape as 'garage-buy-requested', for the Fit Parts tab's
  // confirmed plan — one `install` call per planned (vehicle, part) pair.
  | { type: 'garage-install-requested'; carId: number; partId: number }
  // Same per-item shape, for a vehicle a Fit Parts plan found to be
  // `migrated: false` — see `GarageMigrateResult`'s own doc.
  | { type: 'garage-migrate-requested'; carId: number }
  // Sent by a page's Achievement chip when opened — same "live fetch+parse
  // only background can do" exception as 'career-catalog-requested'.
  // `category` is the achievement category name verbatim (e.g. "Vehicles &
  // Chop Shop"), not a slug — see `background/features/achievements`'s
  // `fetchCategory` doc.
  | { type: 'achievements-category-requested'; category: string }
  // Sent from the chip's modal when the player taps Claim on a Ready line.
  | { type: 'achievements-claim-line-requested'; lineId: string }
  // Sent by the in-page Arena overlay on mount — same bootstrap role as
  // 'street-intel-viewed': arms the passive "page ready" watcher's alarm the
  // first time the player is seen on Arena, rather than running it from
  // install for an account that never touches the page. Read-only and
  // deliberately independent of `ArenaAutoConfig.enabled` — see that
  // watcher's own doc in background/features/arena/runner.ts.
  | { type: 'arena-viewed'; timestamp: number }
  // Sent by the in-page Arena overlay on mount/refresh — read-only
  // counterpart to 'courier-status-requested', for a surface that can't
  // reach `storage`/`chrome.alarms` directly the way the popup does.
  | { type: 'arena-status-requested' }
  // Sent by the overlay's own "Check Now" button — same escape-hatch role
  // as 'crimes-check-requested', for a schedule that's otherwise purely
  // time-based (aligned to the page's own `unlocks_next_at`).
  | { type: 'arena-check-requested' }
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
