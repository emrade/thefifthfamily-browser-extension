# Background automations acting at the same time

Status (2026-11-03): **design agreed, refined check done, nothing built.**
See "Decisions" and "Refined check" below. Next step: build the queue (step 2). The question to settle
first: how often do two different background automations act at the same
moment? A real player in one tab can't do that unless they play from two
devices, so it's a pattern the game's developers could notice.

## How it was measured

Script: `scratchpad/clash.py`, a temporary script outside the repo; rebuild it
from this description if needed. It reads every archive via `find_archives()`.
Each archive row has `origin: 'background' | 'page'`, so the extension's own
automated requests can be told apart from the player's.

- Counted: background POSTs, grouped by endpoint file (the feature).
- A **clash**: two background POSTs from *different* endpoints, the second
  starting while the first is still in flight (within its `durationMs`), or
  within 1 s of it.
- Also counted: background POSTs within 1 s of a player (`page`) POST on an
  automated feature.

## Results (all archives, 64 days with automation)

- Rows: 183,079 background, 114,436 page. Background POSTs: 89,837. By
  endpoint: smuggling 40,461; bank 23,153; street_intel 18,440; crimes 1,954;
  career 1,878; races_v2 1,646; stocks_v2 1,242; shops_v2 469.
- Cross-endpoint overlaps: **11,736**. The most common pairs:

| Pair | Count |
|---|---|
| bank + smuggling | 6,757 |
| smuggling + street_intel | 1,347 |
| bank + street_intel | 812 |
| bank + races_v2 | 756 |
| career + street_intel | 579 |
| crimes + street_intel | 447 |
| crimes + smuggling | 208 |
| career + smuggling | 180 |

- Background POSTs within 1 s of a player POST: 296.

### Reading it

- **Most "bank" pairs are probably not clashes.** Bank deposits are likely
  steps inside one feature's own run (e.g. Pet Courier selling and then
  depositing), so they're one automation doing two things in a row. **Check
  this first:** confirm which feature sends each bank call, by looking at the
  calls just before it from the same feature.
- **Without bank, real cross-feature overlaps are still about 3,000 over 64
  days, roughly 45 a day.** Smuggling + Street Intel is the largest pair, then
  Career + Street Intel and Crimes + Street Intel. So it does happen
  regularly. A queue is justified, unless the refined check below brings
  these numbers down a lot.

## Refined check (2026-11-03): bank calls attributed

Done. Scratch scripts `posts.py` and `clash3.py` in the session scratchpad;
rebuild them from this description if needed. All archives through
2026-11-02 (139,686 POSTs, 66 days with background activity).

**Attribution.**
- Every deposit goes through `depositCashOnHand(feature)` in
  `gameAction.ts`. In the code, it's called by Pet Courier, Street Intel,
  Racing, Real Estate and Inventory sell.
- Withdrawals come only from Pet Courier and Crimes Auto.
- Each bank call was given to the nearest earlier background POST (within
  3 min) from a feature that sends that kind of bank call. 38 of 23,885
  couldn't be matched.
- Result: 19,512 bank calls were Pet Courier's own, 3,216 Street Intel's,
  791 Racing's. So the "bank + smuggling" pair (6,757) was almost entirely
  Pet Courier depositing and withdrawing inside its own run. **Not a clash.**

**Real cross-feature overlaps, after attribution:**

| Measure | Count (66 days) |
|---|---|
| Next request started while the other feature's was still in flight | 1,237 |
| … or within 1 s of it | 2,877 |
| … or within 3 s of it | 3,225 |
| Whole runs overlapping (each feature's requests ≤ 60 s apart = one run) | 1,638 |

Run-level pairs: Pet Courier + Street Intel 372, Career + Street Intel 303,
Career + Pet Courier 192, Crimes + Street Intel 191, Career + Crimes 172,
Crimes + Pet Courier 158, Pet Courier + Stocks poll 106, Pet Courier +
Racing 53.

**Steady, not bursts.** Since Oct 15 there are 14–34 run overlaps per day
(about 25 on a typical day), and 10–40 request-level clashes (1 s). There's
no day with a spike: it's the ordinary result of independent alarms.

**Players' clicks.** 2,050 background POSTs landed within 1 s of any player
POST. This is broader than the earlier 296, which counted only player POSTs
on automated features. Per the decisions, this is left to the "Up next" chip.

**Verdict:** the problem is real but smaller than first measured: ~25
overlapping runs a day, not ~180. The queue is still justified, since a
single player can't run two features at once. It is not urgent.

**Stocks poll joins the queue** (decided 2026-11-03). `stocks_v2.php
action=poll` only reads prices, but the real client sends it only while the
player is on the Stock Market page, and a player can't be on that page and
Career at the same time. It's a single quick request, so it barely delays
anyone. If the queue is busy, it skips that poll and takes the next one,
rather than waiting.

## Refine before building (done 2026-11-03, see above)

1. Attribute every bank, shops and stocks call to the feature that made it
   (by sequence, or by the `action=` value), then recount true cross-feature
   overlaps.
2. Compare the 1 s window with stricter (in-flight only) and looser (3 s)
   windows. Natural one-device play needs a few seconds between actions on
   different pages.
3. Break the counts down by day, to show whether clashes are steady or come
   in bursts (e.g. when alarms line up after the browser wakes).

## Proposed fix: one shared action queue (if the refined check confirms)

- A single background **action lock/queue**, shared by every automation
  (Street Intel, Pet Courier, Career, Crimes, Racing, Stocks, Bank deposits).
  A feature takes the lock for the **whole cycle** (e.g. scout → attempt →
  complication), not per request, so cycles never interleave.
- After releasing the lock, wait a short, human-like gap (a few seconds,
  randomised) before the next feature's cycle starts, as if the player
  switched pages.
- ~~Optionally hold automation back while the player is actively
  clicking.~~ Rejected 2026-11-03: see Decisions.
- This sits *above* each feature's existing `cycleInFlight`/`activeRun`
  guard (see CLAUDE.md), which stays as it is. That guard stops a feature
  overlapping *itself*; the queue stops features overlapping *each other*.
- Behind its own setting, **default off**, so nothing changes until the player
  turns it on (see the memories `feedback_auto_features_off_by_default` and
  `feedback_keep_existing_behavior_toggle_new`).
## Decisions (2026-11-03)

The player's answers to the open questions:

- **Pet Courier goes first in line**, ahead of every other waiting
  automation.
- **Gap between automations:** a random 3–8 s after one releases the queue,
  before the next starts.
- **Things the player starts themselves wait their turn:** Garage bulk jobs,
  Inventory bulk sell, and the Run Now / Check Now buttons.
- **No holding off while the player is clicking.** The player can be
  clicking for over an hour, and automation must not stall for that long.
  The 296 automation-vs-player overlaps are covered by the "Up next" chip
  below, so the player can plan around what's coming.
- **An off switch that restores today's behaviour exactly.** This is the
  queue's own setting, default off. When off, the lock does nothing and every
  automation runs as it does now. The background reads the setting on each
  cycle, so turning it off takes effect at once, with no reload.
  - Where: the popup's Settings, the dashboard page, and the chip's expanded
    view.
  - Why: if the queue doesn't work out, the player can turn it off and keep
    playing as before while an alternative is worked out.

### Issues to design around (from the 2026-11-03 code review)

- Every background action already goes through `postAction`
  (`src/background/gameAction.ts`), and every automation already has its own
  `cycleInFlight` / `activeRun` guard. The lock wraps each automation's
  guarded run function (~10 places), and nothing inside a feature changes.
  Rough size: 150–300 lines.
- **Firefox unloads the background script after ~30 s idle.** An automation
  that waits for the lock can lose its turn. Some only schedule their next
  check at the end of a cycle, so a lost turn could stop that feature
  silently. Fix: an automation that finds the lock busy reschedules its own
  alarm a short time later instead of waiting in memory. Test this
  carefully.
- **Maximum hold time** on the lock, as a backstop. Every request already
  has a time limit, so a stuck request can't hold it forever.
- **Long Pet Courier runs** can hold the lock for minutes. That's acceptable:
  other features start late, not wrong.
- **Worst case:** an automation runs late or skips a turn, visible in its
  panel and on the dashboard. It can't cause wrong actions or spent
  resources, and the off switch restores today's behaviour.

### "Up next" chip (on the game page)

- A floating button like the achievement chip, collapsed by default.
  - Collapsed: an icon plus the time until the next automation check
    ("⏱ 2m"); gold while one is running.
  - Expanded: each automation in time order: "running now", "in 2m",
    "paused", "off". Plus the queue's on/off switch and a link to the
    dashboard.
- Times come from each automation's own alarm, read in the background.
  Label them "next check", not "next action": a check can find nothing to do
  (e.g. no Street Intel card worth taking).
- Its own page setting, default off.

### Dashboard (a full extension page in its own tab)

- **Not the popup or the sidebar.** The popup closes too easily, and the
  sidebar shrinks the game page. A new extension page opens in its own
  browser tab, from the popup's Home and from the chip.
- Shows:
  - **Now:** which automation holds the queue, and which are waiting.
  - **Coming up:** a timeline of each automation's next check.
  - **Recent activity:** the last few dozen runs, with time, feature and
    result (acted / nothing to do / paused / skipped / waited N s).
  - **Queue stats:** how many times today the queue made something wait,
    and for how long.
  - The queue's on/off switch.

### Order of work

1. **Bank attribution check (archive only).** Work out which feature sends
   each bank call, and recount the real cross-feature overlaps (see "Refine
   before building").
2. **The queue,** with the decisions above, plus a log of what it did, for
   the dashboard. Behind its own setting, default off.
3. **The "Up next" chip.**
4. **The dashboard page,** built once the queue has logged a day or two of
   real data.
