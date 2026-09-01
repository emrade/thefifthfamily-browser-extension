# Changelog

All notable changes to this extension, by version. Reconstructed from git
history (each entry's version is read directly from `package.json` at that
commit, not just from commit message wording, so it's accurate even for the
handful of releases that bumped the version inline with a feature/fix commit
rather than in a separate `chore: bump version` commit).

To keep this current: add a new `## [x.y.z] - YYYY-MM-DD` section at the top
whenever a version is bumped for release, listing what actually shipped.

## [0.15.4] - 2026-09-01

### Fixed
- Street Intel Auto: stopped a spurious "Not enough stamina!" pause that
  could hit even when the chosen opportunity looked affordable. A cycle that
  scouts more than one candidate spends real stamina on each scout call, but
  the affordability check for an earlier candidate was only measured against
  the stamina spent *up to that point* — so a later candidate's scout cost in
  the same cycle wasn't accounted for by the time the top pick's attempt
  actually fired. The check now runs once, after all of that cycle's
  scouting is done, against the true remaining stamina, and falls through to
  the next-best-EV candidate if the top pick no longer fits.

## [0.15.3] - 2026-08-30

### Fixed
- Pet Couriers: turning auto-offload on now immediately checks for a pet
  that already landed while it was off. The return alarm that drives
  offloading only stays armed while a pet is still in flight — it gets
  cleared once nothing is `'moving'` — so a pet that landed before the
  toggle was flipped on had nothing left to notice it, and previously only
  appeared to get picked up by an unrelated pet's own dispatch/return cycle.
- Pet Couriers: turning auto-dispatch back on now forces a fresh destination
  probe instead of re-serving a cached verdict from earlier in the same
  rotation hour. A `'locked'` verdict from an earlier check was being reused
  as-is on every subsequent toggle, so re-enabling dispatch after a
  suspected-wrong "locked" reading did nothing — the toggle now doubles as a
  manual recheck, since the panel had no dedicated affordance for that.

## [0.15.2] - 2026-08-29

### Fixed
- Pet Couriers: an auto-dispatched run now shows the same live step-by-step
  breakdown a manual Run does. The panel's progress listener only rendered
  when a manual button click had set `activeAction`, so an auto-triggered
  run's own progress messages were silently discarded even though the
  background was already sending them. Both paths now share one
  message-driven mechanism.
- Pet Couriers: the "sent" notification now fires after the "En route" list
  is actually updated, not before — previously the notification could arrive
  several seconds ahead of the panel having anything new to show. The
  panel's own auto-refresh on completion also gets one follow-up refresh a
  couple seconds later, since the `finished` signal itself still arrives
  slightly ahead of that data (confirmed via a background-flow simulation,
  not just read from the code).

## [0.15.1] - 2026-08-29

### Fixed
- Pet Couriers: a genuine unrecognized-response error now disables both
  auto-offload and auto-dispatch, not just dispatch — both alarms already
  get cleared on this path, so leaving one toggle showing "on" misrepresented
  it as still active.
- Pet Couriers: the in-page panel's toggles now refresh the status display
  immediately on change, and toggling auto-dispatch on schedules a follow-up
  refresh a few seconds later to catch the background's own immediate check
  — previously the display could sit showing pre-toggle data for up to ~30s
  (whatever was left of the panel's unrelated periodic refresh) with no
  indication anything had happened.
- Pet Couriers: swapped the toggle order (Auto-Dispatch before Auto-Offload)
  in both the in-page panel and the popup page, matching the logical flow of
  sending pets before collecting their cargo.

## [0.15.0] - 2026-08-29

### Added
- Pet Couriers: a popup page (Home → Pet Couriers) showing the same live
  watch status the in-page panel does — destination state, next check, pets
  en route, last run — plus both auto toggles, reachable without being on
  the smuggling page. Opening it clears the icon badge, and the Home
  screen's own Pet Couriers row now shows the same count the badge does
  rather than leaving it a mystery until you dig in.

### Fixed
- Pet Couriers: auto-offload and auto-dispatch are now independent toggles —
  offload had no toggle at all (always ran unconditionally), inconsistent
  with this system's own convention that any automated action can be turned
  off on its own. Both default off. The panel's checkbox is also now the
  same toggle-switch styling used everywhere else in the app.
- `npm run preflight` now hard-fails if `package.json` and `manifest.json`
  disagree on version, and reminds (non-blocking) of the versioning
  convention: minor bump for a new feature, patch bump for a fix.

## [0.14.0] - 2026-08-29

### Added
- Pet Couriers: an auto-watch that detects when a smuggling destination opens
  (aligned to the confirmed hourly rotation, and re-checked the moment a pet
  lands if no destination had been confirmed yet this hour) and, when
  auto-dispatch is enabled from the in-page panel, sends idle pets out
  automatically. Includes a live status readout (destination state, next
  check, pets en route) and notifications for a freshly-opened destination or
  a completed auto-dispatch — kept to once per opened window rather than once
  per pet, so a returning pet redispatched into an already-known-open
  destination doesn't re-notify.

### Fixed
- `SystemicActionError`: a rejection caused by being jailed/hospitalized/
  travelling right now (confirmed real: "You can't do that while
  hospitalized!") was misclassified the same as a genuinely unrecognized
  response shape, disabling Career Auto / Street Intel automation over a
  transient, recoverable condition instead of just rescheduling around it.
- Every `chrome.notifications.create` call used a bare relative `iconUrl`,
  which Chrome can't resolve on its own — notification icons were silently
  failing to load across every feature that fires one, not just Pet Couriers.
- Pet Couriers auto-watch: the pet-return alarm didn't survive an extension
  reload while pets were still in flight, silently stranding them (never
  offloaded or redispatched) until unrelated activity happened to trigger a
  new check.

## [0.13.8] - 2026-08-28

### Added
- Stock Market Tracker: pause itself (and notify, repeating on every
  scheduled tick until resumed) after a poll response it doesn't recognize
  at all — distinct from an ordinary rejection (hospitalized, jailed, etc.),
  which still just retries on schedule with its real message shown.
- `npm run preflight` reminds (non-blocking) when CHANGELOG.md has no entry
  for the version about to be released.

### Fixed
- Stock Market Tracker: surface the game's actual rejection message (e.g.
  "You can't do that while hospitalized!") instead of a generic "poll
  returned an unexpected shape" for an ordinary, well-formed rejection.

## [0.13.7] - 2026-08-28

No functional changes (version bump only).

## [0.13.6] - 2026-08-28

### Added
- Stock Market Tracker: passively records price and rumor history in the
  background (with a one-time 30-day backfill) since the game itself only
  retains a fraction of what's needed to ever evaluate a trading strategy.

## [0.13.5] - 2026-08-28

### Added
- Real Estate Advisor: flags any property losing income to a vault too small
  for its revenue, with the exact upgrade level (and cost) to fix it.

## [0.13.4] - 2026-08-27

### Fixed
- Handle undefined cashToday with fallback to 0
- Correct overtime availability check using live panel data

## [0.13.3] - 2026-08-27

No functional changes (version bump only).

## [0.13.2] - 2026-08-27

### Added
- Add cashToday tracking to Career Auto and Street Intel

### Fixed
- Guard against duplicate concurrent runs from chrome.alarms double-firing
- Fix stale cooldown by fetching live panel state

## [0.13.1] - 2026-08-26

No functional changes (version bump only).

## [0.13.0] - 2026-08-26

### Added
- Add auto-attempt runner for Street Intel
- Add paused message and scouted candidate logging
- Add complication choice win/loss tracking
- Split complication tracking into direct and fallback buckets
- Implement EV-based candidate selection with concurrency guard

### Changed
- Replace ff-fc-captured with ff-auto-row class for repeatable text rows

### Fixed
- Clone response before returning to fix background request logging race
- Check cash balance before attempting deposit

## [0.12.1] - 2026-08-26

### Changed
- Remove courier tab from trade assistant
- Route courier progress updates to in-page panel via tab ID
- Extract SystemicActionError, postAction, and sleep to shared gameAction module

### Fixed
- Check destination availability before spending on pet cargo
- Fix buyContraband regex to handle additional args
- Handle cooldown state in career parser and add shifts today counter

## [0.12.0] - 2026-08-19

### Changed
- Remove debug console.log from smuggling panel parser

## [0.11.1] - 2026-08-19

No functional changes (version bump only).

## [0.11.0] - 2026-08-19

### Added
- Add pet courier automation for Smuggling V2
- Add shape-changed error kind to distinguish game format changes from auth errors
- Display known pets in courier panel
- Add in-page floating courier panel
- Broadcast live courier run progress and fix stash capacity handling
- Drain existing stash before buying and support mixed shipments
- Add offload-only courier action and cash deposit protection
- Add shared dollar range parser utility

### Fixed
- Adapt travel adapter to new /actions/travel_proto.php endpoint
- Detect stale session or CSRF errors to prevent repeated failures
- Remove broken smuggling panel parser and simplify URL matching
- Handle stuck shipments that block courier batch execution
- Parse cargo counts correctly and handle overflow state

## [0.10.4] - 2026-08-11

### Added
- Detect endpoint rewrites, and surface adapter breakage directly

### Fixed
- Require 400 observations before trusting "always present"

## [0.10.3] - 2026-08-10

No functional changes (version bump only).

## [0.10.2] - 2026-08-10

### Added
- Thin capture by policy, and budget the archive in bytes

### Changed
- Tag released versions, and tag automatically on release

## [0.10.1] - 2026-08-10

No functional changes (version bump only).

## [0.10.0] - 2026-08-10

### Fixed
- Detect structural change by vocabulary, not shape count

## [0.9.3] - 2026-08-10

### Added
- Calculate optimal cargo quantity based on risk vs margin
- Add local HTTP archive with endpoint shape index

### Changed
- Promote HTTP Archive to a top-level feature view

## [0.9.2] - 2026-08-07

### Fixed
- Correct profit calculation to include trip costs and handle multi-leg trades

## [0.9.1] - 2026-08-02

No functional changes (version bump only).

## [0.9.0] - 2026-08-02

### Fixed
- Correct title extraction from opportunity cards

## [0.8.0] - 2026-07-31

### Added
- Add Street Intel feature with opportunity notifications
- Add user-configurable toggles for Fight Club toolbar and Street Intel highlights

## [0.7.5] - 2026-07-30

### Added
- Add ROI percentage to sell opportunity notifications
- Add strength, defence, agility and dexterity stats to live display
- Add Fight Club stats tracking and popup view
- Persist sort/filter preferences in chrome.storage

## [0.7.4] - 2026-07-25

### Added
- Trigger immediate market poll on travel arrival

## [0.7.3] - 2026-07-25

### Fixed
- Prevent duplicate data from race conditions and duplicate message deliveries

## [0.7.2] - 2026-07-25

### Fixed
- Prevent duplicate open trades from phantom buy captures

## [0.7.1] - 2026-07-25

### Added
- Notify sell opportunity every cycle profitable

## [0.7.0] - 2026-07-25

### Added
- Add cross-client cargo reconciliation for mobile app trades

## [0.6.0] - 2026-07-25

### Added
- Add sell opportunity alerts and notification preferences

## [0.5.1] - 2026-07-23

### Fixed
- Correct network hook installation guard condition

## [0.5.0] - 2026-07-23

### Added
- Add SVG icon components and replace text icons

## [0.4.0] - 2026-07-23

### Added
- Add background market polling and risk database UI
- Track multiple bribes per trade and add data reset UI
- Add settings view with data export and reset functionality

## [0.3.4] - 2026-07-23

### Changed
- Upgrade console logging levels

## [0.3.3] - 2026-07-23

### Changed
- Align smuggling panel adapter with envelope pattern

## [0.3.2] - 2026-07-23

### Fixed
- Resolve relative URLs before path matching

## [0.3.1] - 2026-07-23

No functional changes (version bump only).

## [0.2.0] - 2026-07-23

### Added
- Add dashboard UI with trade history and loss tracking
- Add analytics tab with charts and risk observation tracking

## [0.1.0] - 2026-07-22

### Added
- Initial commit for The Fifth Family browser extension
- Add Firefox extension support with release workflow
