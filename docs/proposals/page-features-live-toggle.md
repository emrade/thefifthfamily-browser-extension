# Page features: turn on and off instantly (no reload)

Status (2026-11-03): **shelved.** The full start/stop design below is kept on
file but won't be built for now. A reload note in Settings was built instead
(see "Decision" below).

## Decision (2026-11-03)

The player doesn't change page settings often. Weighed against that:
- the full version touches ~20 files (600–1,000 lines);
- every future page feature would need its own working "stop";
- the likely bugs (a feature coming back blank or doubled after off/on)
  would be in features that work fine today.

So it isn't worth it, and the player shares the concern about bugs.

**Built instead: a reload note in Settings.**
- After any page-feature setting changes, the top of the
  **In-Game Page Features** section shows the same gold banner as the
  "Updated to vX" notice:
  - "Page settings changed"
  - "Takes effect after reloading N game tab(s)"
  - a **Reload now** button
- "Reload now" reloads every open game tab, the same as Home's "Reload game
  tabs" button.
- With no game tab open, the banner says "No game tabs open" and the button
  is disabled.
- It goes away once a game tab finishes reloading, and isn't saved, so it
  starts clear each time the popup opens.
- Code: `PageSettingsReloadBanner` in `src/popup/views/GameTabs.tsx`, shown
  from `src/popup/views/PageFeatureSettings.tsx`.
- Nothing renamed: every setting keeps its own description, including
  "Reload the page to apply.", and Home's reload button is unchanged.

**If this is ever picked up again**, the player's answers to the two open
questions:
- **Garage bulk tools / Inventory auto-sell turned off mid-job:** let the
  job finish.
- **Fight Club toolbar turned off:** leave the targets in their current order
  until the game redraws the list. Don't restore the original order.

Other findings from the 2026-11-03 code review, beyond the design below:
- Many features keep module-level state (e.g. `enabled`, "already painted"
  signatures, caches; see `arena/fightAdvisor.ts`). It must be reset on
  stop, or a restart silently paints nothing. This is the biggest bug risk.
- Real Estate's auto-collect section (`mountAutoCollect`) and the Arena
  advisor's details popup need their own clean-up.
- Request-capture handlers (e.g. Inventory quick-sell recording sell
  quotes) keep running whatever the settings say, as they do today. That's
  harmless, since they only save data.

---

Original plan (2026-11-01) follows.

## The problem

Turning a page feature off in Settings saves at once, but the feature stays on
the page until the tab is reloaded. Turning one on also needs a reload.

Why: `src/content/index.ts` reads the page settings **once**, at load
(`storage.getPageFeaturePreferences().then(prefs => { if (prefs.x) initX(); … })`,
around line 136), and starts the features that are on. Nothing listens for the
setting changing afterwards, and no feature has a way to stop. The comment
above that block says so: "Toggling takes effect on the next page load, not
live".

## What the player wants

"If I turn it off, it should be off; if it is on, it should be on." Both
directions take effect immediately, with no reload, and leave nothing behind.

Rejected alternative: hiding a feature's elements with a CSS flag on the page.
It's quicker, but the feature keeps running underneath, so "off" isn't really
off.

## Design

### 1. A start/stop contract per feature

Each feature's `initX()` becomes `startX(): () => void`. It returns its own
`stop` function, or exports a matching `stopX()`. `stop` must:

- disconnect every `MutationObserver` it created;
- clear every `setInterval` / `setTimeout` / `requestAnimationFrame`;
- remove every DOM and `chrome.storage.onChanged` listener it added;
- remove everything it injected, **including classes, attributes and badges
  put on the game's own elements** (Street Intel ribbons, Arena badges, Real
  Estate ribbons, Inventory price tags, Forge `.ff-fg-line`), not only its own
  panels;
- reset its `window.__ff…Installed` install flag. Most features guard against
  double-init with one (e.g. `__ffForgeAdvisorInstalled`). If the flag isn't
  cleared, starting again silently does nothing;
- leave its injected `<style>` in place, which is harmless, or remove it. Either
  way, a restart must not add a second copy.

Starting after stopping must behave exactly like a fresh page load: nothing
appears twice, and nothing is left from before.

### 2. A controller in `content/index.ts`

It replaces the one-time block:

- At load, it starts every feature whose setting is on and keeps the `stop`
  handles in a map keyed by the setting name.
- It adds a `chrome.storage.onChanged` listener on the page-feature preferences
  key. On a change, it diffs the old and new values. Off → on calls `start`;
  on → off calls `stop` and drops the handle.
- **Linked settings restart a feature.** Some settings are passed in as
  arguments rather than being features of their own:
  - `streetIntelExactOdds` → `initStreetIntelHighlights(prefs.streetIntelExactOdds)`
  - `arenaMasteryTag` → `initArenaFightAdvisor(prefs.arenaMasteryTag)`

  When one of these changes while its parent feature is on, stop the parent
  and start it again with the new value.
- Check how the master `enabled` setting in the page preferences is used
  before wiring it, and keep its behaviour as it is.
- Async starts (`initFightClubControls`, `initRealEstateAdvisor`,
  `initMenagerieAssistant`): if the feature is turned off while its start is
  still running, `stop` must still clean up whatever the start goes on to
  create. Use a "cancelled" flag that the start checks after each `await`.

### 3. Not affected

- Background automations (Street Intel Auto, Pet Courier, Career Auto, etc.)
  are not page features and keep their own toggles.
- Request capture (the `__ffCapturedRequestListenerInstalled` block) and
  Arena Mastery's capture handler keep running regardless of page settings.
- No setting is renamed and none changes its default (see the memory
  `feedback_keep_existing_behavior_toggle_new`).

## Inventory (what each feature sets up today)

From a scan of each file on 2026-11-01: observers / intervals / DOM listeners
/ storage listeners.

| Setting key | File | Lines | Obs | Int | DOM | Storage |
|---|---|---|---|---|---|---|
| streetIntelStatusPanel | `content/features/streetIntel/statusPanel.ts` | 788 | 1 | 2 | 16 | 1 |
| arenaOverlay | `content/features/arena/overlay.ts` | 424 | 1 | 2 | 4 | 1 |
| courierPanel | `content/features/smuggling/courierPanel.ts` | 660 | 1 | 2 | 7 | 1 |
| careerAutoPanel | `content/features/careerAuto/panel.ts` | 651 | 1 | 2 | 6 | 1 |
| furyCatcherPanel | `content/features/halloween/furyCatcherPanel.ts` | 380 | 1 | 2 | 5 | 1 |
| streetIntelHighlights (+ streetIntelExactOdds) | `content/features/streetIntel/pageHighlights.ts` | 569 | 1 | 0 | 0 | 0 |
| streetIntelComplicationHint | `content/features/streetIntel/complicationHint.ts` | 229 | 1 | 0 | 0 | 1 |
| arenaFightAdvisor (+ arenaMasteryTag) | `content/features/arena/fightAdvisor.ts` | 656 | 1 | 0 | 5 | 1 |
| realEstateAdvisor | `content/features/realEstate/index.ts` | 885 | 1 | 1 | 5 | 1 |
| inventoryQuickSell | `content/features/inventory/quickSellTotal.ts` | 655 | 2 | 0 | 1 | 1 |
| inventoryAutoSell | `content/features/inventory/autoSell.ts` | 982 | 2 | 0 | 3 | 1 |
| forgeAdvisor | `content/features/forge/forgeAdvisor.ts` | 161 | 1 | 0 | 0 | 0 |
| fightClubToolbar | `content/features/fightClub/targetControls.ts` | 268 | 1 | 0 | 2 | 0 |
| fightClubRecon | `content/features/fightClub/reconOverlay.ts` | 403 | 1 | 0 | 3 | 0 |
| menagerieAssistant | `content/features/menagerieAssistant/index.ts` | 392 | 1 | 0 | 2 | 0 |
| stockMarketStatus | `content/features/stockMarket/index.ts` | 339 | 1 | 1 | 3 | 0 |
| streetRacingOverlay | `content/features/streetRacing/overlay.ts` | 795 | 1 | 2 | 10 | 0 |
| garageBulkOps | `content/features/garage/overlay.ts` | 1419 | 1 | 0 | 36 | 0 |
| achievementChip | `content/shared/achievementChip.ts` | 303 | 1 | 0 | 5 | 0 |

Before relying on the "Setting key" column, confirm each pairing against the
`if (prefs.…)` lines in `content/index.ts`. The scan counts only the
`new MutationObserver`, `setInterval` and `addEventListener` calls in each
file. Look for `setTimeout`, `requestAnimationFrame` and listeners added in
helper modules too.

Rough size: 600–1,000 lines touched, mostly the same pattern repeated.

## Order of work

1. The controller, plus the floating panels (Street Intel, Arena, Pet Courier,
   Career Auto, Fury Catcher). They're self-contained and the most noticeable.
2. The features that mark up the game's own elements: Street Intel highlights
   and complication hint, Arena advisor, Real Estate, Inventory (both), Forge,
   Fight Club (both), Menagerie, Stock Market, Racing, Garage, and the
   achievement chip. These need the most care, to remove classes and
   attributes from the game's DOM.
3. Update the comment in `content/index.ts`, the popup's help text for any
   setting that says it needs a reload (grep for "reload" / "next page
   load"), and the CHANGELOG.

## How to test each feature

On real game pages from the archive (load the captured HTML in a preview, as
was done for the Forge Advisor), then in the live game:

1. Load the page with the setting on: it appears as it does today.
2. Turn it off: everything it added is gone, including classes on the game's
   elements. Check this with a DOM query for its class or attribute prefix.
   Its observers and timers have stopped (no console logs, no re-injection
   when the game redraws).
3. Turn it on again: it appears exactly once.
4. Repeat steps 2–3 a few times quickly: no duplicates, no errors.
5. For linked settings: change Exact Odds and Needed for Mastery while the
   parent is on, and check that the page updates without a reload.
6. Load the page with the setting off, then turn it on: it starts as if the
   page had loaded with it on.

Then run `npm run type-check` and `npm run build`.

## Other open items from the 2026-11-01 session (for context)

- Arena advisor vs the game's own %: on hold while the player gathers more
  post-patch fights (44 so far, 10 in the coin-flip band).
- Odds source → Computed ignores per-stat conditions on hidden approaches.
  Judged too small to fix (all conditions are worth about $30k a day). Offered
  to document it in `docs/street-intel-estimate-calculation.md`; no answer yet.
- Refit the Arena card coefficients after about 150 post-patch fights.
