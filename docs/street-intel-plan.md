# Street Intel — Browser Extension Feature

The third feature of **The Fifth Family Enhancements**, after Trade Assistant (see
`docs/trade-assistant-plan.md`) and Fight Club (no separate plan doc — built directly
from real captures in one pass). This file originally captured an early, unverified
idea (a "highlight the best reward" note based on a single payload); it's now rewritten
to describe what actually shipped.

Status: **implemented, v0.9.0.** Auto-attempt added later — see "Auto-Attempt" below.

A separate game system from smuggling/trading — a crime/heist mini-game: pick an
"opportunity" card, optionally scout it (reveals success odds per approach), choose an
approach, resolve the attempt (success/critical success/failure), sometimes handle a
follow-up "complication." Has its own rank progression, contacts, and specializations.

---

## What shipped

Three independent pieces, all reading live/real data — no separate list or dashboard
the player can't act on:

1. **In-page highlights** (`content/features/streetIntel/pageHighlights.ts`) — a
   `MutationObserver`-driven script that marks up the *real* Street Intel page directly:
   - The single best-value opportunity (highest reward-midpoint ÷ Stamina cost, among
     cards not already completed this cycle) gets a small gold **"FF BEST VALUE"**
     ribbon.
   - Any `risk-medium`/`risk-high`/`risk-extreme`/`legendary` card gets a colored,
     pulsing glow keyed to its tier — those are rare against an otherwise mostly-low-risk
     list and pay well, so the point is catching them without reading every card's risk
     badge.
   - Once a scout reveals per-approach odds, the "Choose Your Approach" dialog gets its
     highest-`%` approach marked with an **"FF BEST ODDS"** badge.

   Everything here only ever adds a class/attribute to an existing DOM node — nothing is
   cloned or replaced — so Scout, Go Blind, and the approach rows themselves stay exactly
   as clickable as the game shipped them. This mirrors the lesson from Fight Club's own
   in-page toolbar (`targetControls.ts`): a separate list in the popup the player can't
   act on isn't useful; the real page is.

2. **Background notification** (`background/features/streetIntel/`) — a recurring poll,
   every 5 minutes (`STREET_INTEL_POLL_INTERVAL_MS`), that re-fetches
   `panel.php?type=street_intel` and notifies (via the shared `notify()`/
   `NOTIFICATION_DEFINITIONS` system, id `streetIntelOpportunity`) whenever a
   medium-risk-or-better job is currently listed. **Repeats every cycle for as long as a
   qualifying job is still on the board** — there's deliberately no notify-once dedup, so
   a missed notification isn't a missed job; it stops only because the job itself
   disappears (expired, or completed — a completed card's markup drops the `Scout`
   button entirely, which is what the parser keys off to consider a card "live").
   Started lazily: the poll only arms itself the first time the player is seen using
   Street Intel at all (a panel view or a resolved `attempt`), not from cold start.

3. **Settings toggle** — both of the above are gated by
   `shared/pageFeatures.ts`'s `PAGE_FEATURE_DEFINITIONS` (`streetIntelHighlights`),
   rendered in Settings → **In-Game Page Features** alongside Fight Club's own toggle.
   Enabled by default (opt-out). Since starting/stopping a `MutationObserver` is an
   init-time decision, toggling takes effect on the next page load, not live — the
   toggle row's own description says so.

Not built (out of scope for this pass, no explicit ask):
- A popup dashboard/history view for Street Intel (Fight Club got a minimal one — hero
  stats only — but Street Intel wasn't asked for one; its own "Operation Dossier" table
  already lives in-game).
- Highlighting the best complication-handling choice (`fight`/`run`/`talk`) — the
  complication dialog shows no odds/percentages at all for any choice, so there's no
  data signal to rank by, unlike the scout-approach dialog.
- A configurable poll interval — fixed at 5 minutes, chosen against the shortest
  observed opportunity expiries (~80s–1100s).

---

## Confirmed API details

- **View:** `GET /api/panel.php?type=street_intel` — same panel-JSON envelope as every
  other panel (`{"ok":true,"title":"Street Intel","html":"..."}`), unwrapped via the
  shared `panelEnvelope.ts` helper.
- **Actions:** `POST /actions/street_intel.php`, distinguished by the request body's
  `action=` field (same convention as `smuggling.php`):
  - `scout` — `{opportunity_id}`. Costs 1–2 Stamina (contact-perk dependent). Response:
    `{"ok":true,"scouted":true,"estimates":[{"key","label","stat","estimate_pct",
    "rating","rating_color","stat_tip"}...],"modifier_intel":null|string,"scout_cost":1}`
    — this is what feeds the scout-dialog's per-approach odds, which the in-page
    highlighter reads straight off the rendered `.scout-pct` text rather than this
    response directly (the dialog itself is built and inserted by the game's own inline
    script, not by us, so reading the settled DOM is simpler than re-deriving it).
  - `attempt` — `{opportunity_id, approach, scouted}`. Response includes
    `outcome_band`/`band_label`/`band_color`/`result_text`, `reward_cash`, `heat_added`,
    `xp_gained`, `intel_xp_gained`, possible `loot_drop`, possible `jail_time`/
    `hospital_time`, `has_complication` (+ `complication.type`/`.difficulty` when true),
    and **`cooldown_seconds`** — the player-wide action cooldown (confirmed values:
    300–900s — wider than an earlier pass of this doc claimed, from a larger sample
    taken while building auto-attempt; still always read live, never assumed),
    independent of any single opportunity's own expiry.
  - `complication` — `{opportunity_id, choice}` (`fight`/`run`/`talk`, tied to
    strength/agility/dexterity respectively; a `stand_ground`/defence option exists in
    the game's own script gated behind a `window.SI_V2` flag not yet enabled). Response:
    `{"ok":true,"comp_success":bool,"result_text",...,"cash_lost","extra_heat",
    "jail_time","hospital_time",possible "loot_drop"}` — no `cooldown_seconds` here; the
    cooldown was already set by the `attempt` that triggered the complication.
- **Per-opportunity card data:** title, description, risk tier
  (`risk-low`/`risk-medium`/`risk-high`/`risk-extreme` class, sometimes also
  `legendary`), reward range (e.g. `$400–$1,200`), heat range, Stamina cost, level
  requirement, an expiry countdown (`data-seconds` on `.countdown`), Intel XP range, an
  optional hidden "modifier" (only revealed post-scout via `modifier_intel`), and a list
  of approaches (`key`, `stat`, `bonus`, `label`). A completed card for the current
  cycle swaps its Scout/Go-Blind buttons for a single disabled "Completed" button with
  **no `opportunity_id` embedded anywhere in its markup** — confirmed useful downstream:
  it's exactly what both the in-page highlighter and the background parser use to tell
  a live card from a resolved one, with no separate "is this done" flag needed.
- **Cooldown UI:** while on the shared action cooldown, the panel response additionally
  includes a `.si-cooldown-bar` with a `.countdown[data-seconds]`, and every card's
  Scout/Go-Blind buttons carry `disabled`. Confirmed present/absent depending on live
  server-side cooldown state at fetch time (not a client-side-only countdown) — a fresh
  fetch after the cooldown elapses simply omits the bar and re-enables the buttons.
- **Player meta, also on this panel:** Intel Rank (0–6: Street Rat, Lookout, Scout,
  Informant, Operative, Spymaster, Ghost) with a flat `+N%` rank bonus, unlocked
  contacts (e.g. "The Rat" cuts scout cost to 1 Stamina, "The Fence" adds +15% loot
  chance on high/extreme risk), category specializations (Robbery/Interception/
  Extortion/Exploitation/Leverage, each with an op count and a bonus % past a
  threshold), and an "Operation Dossier" history table — confirmed the panel ships
  markup for the hero scoreboard, contacts, specializations, and dossier in the *same*
  response regardless of what's actually being looked at, same as Fight Club's
  attack_hub panel bundling all three of its own tabs into one payload.

---

## Decisions locked in (why it's built this way)

- **DOM-based live highlighting, not a popup list.** First implementation attempt was a
  Fight-Club-style popup view showing a sortable target list — rejected by direct player
  feedback ("I want to affect things in the game, not have a list in the popup that I
  can't do anything with"). Every highlight now acts on the actual rendered `.si-card`/
  `.si-approach` elements in place, so the game's own buttons stay live.
- **Recurring poll, not a single cooldown-timed check.** The first pass scheduled one
  `chrome.alarms` check timed off a captured `attempt`'s `cooldown_seconds`. Revised
  after player feedback: opportunities rotate on their own per-card expiry timers,
  independent of the action cooldown, so a single post-cooldown check misses anything
  that appears afterward. A recurring 5-minute poll (`streetIntelPanelRegexParser.ts` +
  `background/features/streetIntel/index.ts`, mirroring `marketPoller.ts`'s own
  self-rescheduling pattern) supersedes the cooldown-timed version entirely.
- **No notify-once dedup — repeats until the opportunity passes.** Explicit player
  request: a notification missed the first time (player not looking) shouldn't mean the
  job is missed forever. The poll simply notifies every cycle a qualifying job is still
  parseable off the page; it stops on its own once the card drops out (expired or
  completed), not via any stored "already told you" state.
- **DOM-free regex parser for the background poller.** Same reasoning as
  `smugglingHtmlRegexParser.ts` — MV3 service workers don't reliably have `DOMParser`.
  `streetIntelPanelRegexParser.ts` only extracts what the notification needs (id, title,
  risk tier, legendary flag, reward range), keyed off each card's
  `onclick="siScout(ID,...)"` for a stable identifier — deliberately not a full parse of
  every field the in-page highlighter reads, since those two code paths solve different
  problems (live DOM manipulation vs. a background-only fetch) and don't need to share
  a data model.
- **Shared crest/style-injection helpers, factored out during this build
  (`content/shared/injectStyle.ts`, `content/shared/brandBadge.ts`).** Fight Club's
  toolbar and Street Intel's highlights both inject their own `<style>` and (in Fight
  Club's case) the same gold "V" crest branding — pulled into one shared module rather
  than copy-pasted a second time, per explicit player DRY feedback earlier in the
  build.
- **Settings toggle per feature, not one master switch** — deliberate choice (discussed
  with the player, who deferred to the recommendation): a player might want Fight Club's
  toolbar but not Street Intel's highlights, or vice versa. `shared/pageFeatures.ts`
  mirrors `shared/notifications.ts`'s exact self-registering-list shape so a future
  in-page feature only needs one new entry, nothing hand-wired.
- **Bug found and fixed during this build:** `initStreetIntelHighlights()` originally
  called `injectStyleOnce()` eagerly, synchronously, at content-script load time —
  which runs at `document_start`, before `document.head` is guaranteed to exist.
  Appending to a null `head` threw, silently aborting the function before it ever
  reached `observer.observe(...)` — so the entire feature was inert regardless of page
  content, with no visible error to the player. Fixed at the shared helper level
  (`injectStyleOnce` now falls back to `document.documentElement` when `head` is
  missing) rather than special-casing the call site, since any future eager caller
  would hit the identical failure otherwise.

---

## Auto-Attempt

Status: **implemented.**

The highlights and notifier above still leave every action manual — the player scouts,
picks an approach, attempts, and answers any complication by hand. This adds a
background auto-attempt loop on top, the same way `careerAuto` automated what used to
be a manual career shift. Built the same way: verify against the real archive first
(255 real `street_intel.php` calls), then implement against confirmed shapes.

This system carries more real risk than Career: a confirmed `disaster` outcome (~4% of
real attempts) costs zero reward and puts the player in jail for real minutes (221–592s
range seen for Career's own disaster equivalent; Street Intel's own real jail times run
similarly, up to ~10 minutes), and a `complication` follow-up has no odds data for any
of its three choices at all.

### What the archive showed

- **A card's `data-approaches` attribute already carries an `autofail` flag per
  approach, before ever scouting** — common (67% of a 30-panel sample had at least one),
  dominated by `fight` on this account (weak Strength: scouted `fight` estimates
  averaged 36% vs 52–56% for the other three approaches). Picking the scouted approach
  with the highest `estimate_pct` naturally avoids autofail approaches without a
  separate rule — they score at/near 0%.
- **A real rejection example exists**: `{"ok":false,"msg":"Not enough stamina! Need N"}`
  — the error key is **`msg`**, not `error` like `career.php`/`smuggling.php` use.
  `gameAction.ts`'s `postAction()` now checks both.
- **The shared cooldown disables every card's Scout/Go-Blind buttons but — unlike
  Career's cooldown, which swaps the button out and drops its data — keeps
  `data-approaches`/cost/`onclick` intact**, just adds `disabled`. Confirmed from a live
  capture also showing a `.si-cooldown-bar` with its own live countdown — used as a
  cross-check against this feature's own tracked cooldown, which (like Career's) can go
  stale if the account is also played manually.
- **Opportunities expire on their own independent per-card timers** — median ~588s in a
  480-panel sample, a real quarter under ~228s, one seen with 4 seconds left. No server
  signal exists for "a new one is about to appear," only for the shared cooldown's own
  expiry.
- Every real attempt in this account's history was scouted first (104/105) and never
  made below a ~40% estimated success.
- Complications only ever follow `success`/`partial_success` (never
  `critical_success`/`failure`/`disaster`) — about 20% of real attempts.
- **`bank.php`'s deposit action actually sends `amount=ALL`**, not a specific figure —
  confirmed from 279 real deposit calls, all identical. `petCourier.ts`'s
  `depositLeftoverCash` had been sending a comma-formatted number since it was written,
  on an unconfirmed guess from `withdraw`'s shape (its own comment said as much); this
  was corrected as part of extracting the shared `depositCashOnHand()` helper both
  features now use.

### What shipped

- **Extends `background/features/streetIntel/`** rather than a separate top-level
  feature — same domain as the existing notifier/highlights, not a new one. The
  existing 5-minute notifier is untouched and runs independently; not merged with the
  new runner's own polling in this pass.
- **`streetIntelPanelRegexParser.ts`** extended (not duplicated) with `staminaCost`,
  `scoutCost`, `expirySeconds`, and `approaches[]` (with `autofail`) per card, plus a new
  `parseSharedCooldownSeconds()` for the cross-check above.
- **`actionRunner.ts`**: on each eligible cycle (off cooldown, not
  travelling/jailed/hospitalized), sorts affordable live opportunities by reward ÷
  Stamina cost, scouts them in that order until one's best approach clears the
  configured minimum success % (default **50%** — just above this account's own
  realized ~40% floor), attempts it, answers any complication by reusing the same
  approach key that won the attempt (falling back to the second-best-scouted approach
  for the one case with no direct equivalent — `steel_yourself`/defence, which was in
  fact this account's single most-used approach), then deposits all cash on hand via
  `depositCashOnHand()` — explicit player request, unconditional every cycle, same
  reasoning as courier's own sweep.
- **`disaster`/jail is not treated as an anomaly to pause on** — confirmed, expected
  (~4% of real attempts), unlike Career's never-observed "fired." The existing
  travelling/jailed/hospitalized gate naturally holds the next cycle off until released;
  a hard stop (auto-disable + `streetIntelAutoStopped` notification) is reserved for a
  response that isn't a recognized `ok:true` or `ok:false`/`msg` shape at all.
- **Popup** (`popup/features/streetIntelAuto/StreetIntelAutoHome.tsx`): enable toggle, a
  minimum-success-% field, and a status block (last attempt, today's attempt count, next
  check's real time) — same shape as `CareerAutoHome.tsx`, including reading the actual
  scheduled `chrome.alarms` entry for "before the first attempt ever runs."

### Residual risk

Same shape as Career's: the tracked cooldown is this feature's *own*, seeded only from
calls it makes itself, and can go stale if the account also plays Street Intel manually
— mitigated, not eliminated, by cross-checking the panel's own live cooldown bar each
cycle. And the complication-choice mapping (reuse the attempt's winning approach) is a
reasoned heuristic based on how the choices map to stats, not something confirmed
against real per-choice odds — none exist to confirm against.
