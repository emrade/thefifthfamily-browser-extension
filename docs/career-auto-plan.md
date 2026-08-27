# Career Auto-Runner

Status: **implemented.**

Runs a Careers-panel job (`POST /actions/career.php`) automatically whenever it becomes
available — respecting the server's own cooldown, spending energy only when there's
enough for the shift about to run, refusing to run while travelling/jailed/hospitalized,
and letting the player switch which job it drives from the popup. Built the same way
every other automation in this extension is: verify against the real HTTP archive first,
then implement against confirmed shapes rather than assumptions.

---

## What the archive showed

Checked against a 98 MB real archive export (93 real `career.php` calls, all against
`career_id=89`, "Warehouse Laborer") and the endpoint's shape digest before any code was
written:

- **Accuracy is not a smooth 0–100 value.** Every accuracy this account has ever
  submitted was one of exactly three numbers: `95` (76×, tier `"perfect"`), `70` (16×,
  tier `"good"`), `35` (once, tier `"miss"`). The in-game timing mini-game appears to
  snap to discrete zones, not continuous precision — so the automation picks from that
  same small set (weighted 85/15 toward 95, `35` dropped — no reason to deliberately
  replicate a bad outcome) rather than randomizing across a plausible-looking range,
  which would in fact look *less* natural than the account's real history.
- **`cooldown_seconds` comes back live in every response** (300 in every sample) and is
  never assumed — the automation tracks its own "next eligible" time from whatever the
  server actually returned on the last call it made, the same way `marketPoller.ts`
  tracks the next market shift from the panel's own countdown rather than a hardcoded
  interval.
- **No failure response has ever been captured** — no `ok:false`, no `fired:true`,
  nothing. This shapes the whole design: the automation has to avoid bad calls by
  checking everything client-side first (cooldown, energy, travel state), and treat
  *any* response shape it doesn't recognize as a hard stop, rather than trying to
  pattern-match a rejection nobody has actually seen yet.
- **`Game.buyContraband`-style extra arguments aren't a risk here** — `career.php`'s
  request body is exactly `career_id`, `accuracy`, `overtime`, `_csrf`, confirmed across
  every one of the 93 real calls with no variation.

Reading the live Careers panel HTML directly turned up one more thing not obvious from
the request history alone: **a job's Overtime button only exists in the markup once
that job reaches rank 2.** A never-worked job's card has just the normal Work Shift
button — no `cv2-ot-btn`, no OT energy cost anywhere in it. Verified directly against
two real cards: `career-card-89` (worked to rank 4, has both buttons) vs. `career-card-9`
(never worked, "Unranked", only the normal button). The catalog parser reads this fact
per job rather than assuming OT is always an option.

A level-gated job (player level below what the job requires) renders as
`<button class="cv2-work-btn" disabled>...Lv N Required</button>` — no `onclick`, no
`data-cost`, no career id referenced in it at all — verified against `career-card-97`
("Plant Manager", "Lv 90 Required"). The catalog parser uses this "Lv N Required" copy
to decide a job is level-locked.

**Post-ship correction**, found from a real bug report: the button isn't only ever
"normal" or "level-locked" — there's a *third* variant, confirmed from a capture taken
2 seconds after this account's own `career.php` call: while genuinely on cooldown, the
server replaces the entire button row with `<button class="cooldown-btn">...04:58</span>
</button>` — no `onclick`, no `data-cost`, indistinguishable from the level-locked case
by button markup alone. The catalog parser's first version keyed "is this pickable" off
`Game.doCareer(<id>)` being present, which made a job disappear from the picker the
instant it went on cooldown — i.e. right after every shift the automation itself ran,
which is exactly when the player is most likely to be looking at the dropdown. Fixed to
key off the "Lv N Required" text specifically (the one signal unique to the truly-locked
case) and to read energy costs from the stat tiles / OT summary row instead of the
button's `data-cost` attributes, since those stay present in the card regardless of
which button variant is currently showing.

---

## What shipped

1. **A shared action-calling helper** (`background/gameAction.ts`) — `postAction()`,
   `SystemicActionError`, and the CSRF/rate-limit handling that used to live only in
   `petCourier.ts`, extracted so this feature and the pet courier both fight the exact
   same "the game changed something, stop rather than guess" battle through one
   implementation. Also adds `fetchLiveStatus()`, a fresh (uncached) `stats.php` read
   for energy/travelling/jailed/hospitalized, used for the pre-flight check right before
   spending energy — deliberately not `storage.getLatestStats()`, which is only as
   fresh as the last time a content script happened to observe a `stats.php` call.

2. **A careers-panel catalog parser** (`background/features/careerAuto/careersPanelParser.ts`)
   — DOM-free regex parsing (same reason as `smugglingV2RegexParser.ts`: MV3 service
   workers don't reliably have `DOMParser`), splitting the panel on each job card's own
   `id="career-card-<id>"` marker. Returns every job the account can currently work,
   with its name, normal/OT energy costs, and whether OT is unlocked yet — feeding the
   popup's job picker.

3. **The runner** (`background/features/careerAuto/runner.ts`) — a `chrome.alarms`
   wakeup scheduled for the tracked cooldown's expiry (same pattern as
   `marketPoller.ts`/`travelNotifier.ts`), falling back to a plain re-poll interval when
   there isn't a cooldown to align to yet (not enough energy, or just enabled). On each
   eligible check: fetch live status, gate on travelling/jailed/hospitalized and on
   energy, pick OT vs. a normal shift based on whichever the current energy actually
   covers (OT preferred whenever it's both unlocked and affordable), pick an accuracy
   value, call the action, and — on anything other than a clean `ok:true` — stop and
   notify rather than retry blind. A `fired:true` response (never observed, but the
   game's own OT button warns "Fumble = Fired 1hr") disables the whole automation, not
   just that job, and fires a notification (`careerAutoStopped`, wired into the existing
   `notify()`/`NOTIFICATION_DEFINITIONS` system).

4. **The on/off switch** — `CareerAutoConfig.enabled`, exactly the same idea as every
   other togglable feature in this extension (`PAGE_FEATURE_DEFINITIONS`'s per-feature
   toggles, `NOTIFICATION_DEFINITIONS`'s per-notification toggles). Popup writes it
   directly to `chrome.storage.local` (no message round-trip, same as
   `NotificationSettings.tsx`); background watches for the change via
   `chrome.storage.onChanged` and clears the alarm immediately when it flips off, so
   nothing fires after the switch is off no matter where a stale already-scheduled
   alarm is in its own cycle. `runIfEligible()` also re-checks `enabled` itself as a
   second guard. The popup's Home screen nav row shows the current state at a glance
   ("Off" / "Running Warehouse Laborer"), same as every other feature's status line.

5. **Popup UI** (`popup/features/careerAuto/CareerAutoHome.tsx`) — the toggle, a job
   picker (fetched live from background on open, since it needs a real network call the
   popup itself can't make), and a status block showing the last shift's result, a
   **Shifts Today** count, and the next shift's actual clock time (not just a countdown
   — e.g. "4:15 PM · in 3:42"), including before the very first shift ever runs (read
   directly from the real `chrome.alarms` entry, since `nextEligibleAt` doesn't exist
   until something has actually succeeded to seed it). The status block updates itself
   via `chrome.storage.onChanged` on the background-owned status key, so it reflects a
   shift within moments of it happening without polling. Switching jobs is never
   blocked, including mid-countdown — that's the explicit "grind this one to max rank,
   then move to the next" use case the feature is for — and doing so clears the old
   job's leftover countdown immediately rather than leaving it displayed as if the
   switch hadn't taken effect.

   `Shifts Today` resets at the player's own local midnight, not UTC — both the
   popup and `runner.ts` compare the stored count's date key against today's before
   trusting it, so a stale count from a previous day reads as 0 rather than needing a
   write at the exact moment the day rolls over.

   Enabling automation (or switching jobs) schedules its first check within a few
   seconds, not the multi-minute fallback interval used for "not eligible yet, try
   later" — the two are deliberately different delays (see `onConfigChanged` vs.
   `scheduleNextCheck` in `runner.ts`), since conflating them made flipping the toggle
   on look like nothing had happened for up to two minutes.

---

## Known residual risk

### Concurrency bug confirmed and fixed (2026-08-26)

The "anything other than a clean `ok:true` is a hard stop" behavior above got tested for
real: the automation stopped with `"Not enough energy!"` even though `runIfEligible()`
gates every shift attempt on a live energy check before ever calling `career.php`
(`status.energy >= config.energyCost`, or the overtime equivalent). The archive showed
why — one `stats.php` energy read, followed by *two* `career.php` shift attempts 210ms
apart: both came from the same energy figure, both concluded there was enough, the first
spent it, and the second came back a legitimate rejection. This is the identical
`chrome.alarms` double-firing quirk already caught and fixed in
`streetIntel/actionRunner.ts` (a known MV3 platform behavior, not a wiring bug — there's
exactly one `chrome.alarms.create`/`onAlarm` path for `ALARM_NAMES.CAREER_AUTO`) — this
feature just hadn't shown it yet at the time that fix shipped. Fixed the same way: a
module-level `cycleInFlight` guard around `runIfEligible()` in `runner.ts`, so a second
concurrent alarm firing is a no-op instead of a duplicate shift attempt that gets
misread as the game rejecting the automation.

### Stale-cooldown bug confirmed and fixed (2026-08-26, same day)

`nextEligibleAt` is this feature's *own* tracking of the job's cooldown, seeded only
from `cooldown_seconds` on calls the automation itself makes — with no live cross-check
against the game's own state before firing, unlike Street Intel's runner, which fetches
its panel and checks a live `.si-cooldown-bar` every cycle specifically to catch this.
This went stale for real the same day as the concurrency fix above: a shift fired
purely off tracked state and came back `"On break! Wait 3m 20s"`, which — same as the
energy case — got misread as an unrecognized response shape and paused the automation.

The archive turned up something not previously known about this cooldown: it's not
actually per-job. A capture taken while on cooldown showed **every** career card
rendering the identical `<button class="cooldown-btn"><span class="countdown"
data-seconds="258">...` markup simultaneously — the same account-wide "on break" state
the game's own rejection message names, not something scoped to whichever job is
selected. `parseCareerCooldownSeconds()` (new, in `careersPanelParser.ts`) extracts that
figure, and `runIfEligible()` now fetches the careers panel and checks it — same
"fetch the panel, trust its live state over tracked state" pattern Street Intel already
used — *before* the energy gate, rescheduling off the live figure instead of ever
reaching `career.php` with stale state. A failed panel fetch here doesn't stop the
automation; it just proceeds on tracked state alone for that one cycle, same as any
other transient fetch failure elsewhere in this codebase.

Accuracy weighting (currently a fixed 85/15 default between `95` and `70`, described
above) isn't exposed as an editable setting in this pass — revisit if the player wants
to tune it, or once a different job's own history shows different zone values (nothing
confirms `95`/`70`/`35` hold for jobs other than Warehouse Laborer).

`otAvailable`/`otEnergyCost` are captured once at job-selection time and can go stale in
one specific, foreseeable way: since OT only unlocks at rank 2, a job picked *before*
reaching rank 2 will keep running normal-cost shifts even after the automation's own
`promoted` progress unlocks OT on it — the config doesn't know until the player hits
"Refresh Job List" and re-selects. Not automatically re-synced on every `promoted:true`
response on purpose, to keep the runner's job to "run the shift", not "also decide when
its own config needs re-derivation" — worth automating later if this turns out to
matter in practice.
