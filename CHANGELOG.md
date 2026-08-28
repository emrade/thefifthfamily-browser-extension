# Changelog

All notable changes to this extension, by version. Reconstructed from git
history (each entry's version is read directly from `package.json` at that
commit, not just from commit message wording, so it's accurate even for the
handful of releases that bumped the version inline with a feature/fix commit
rather than in a separate `chore: bump version` commit).

To keep this current: add a new `## [x.y.z] - YYYY-MM-DD` section at the top
whenever a version is bumped for release, listing what actually shipped.

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
