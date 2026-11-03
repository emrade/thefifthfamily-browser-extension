# Background automations acting at the same time

Status (2026-11-01): **measured, nothing built.** The question to settle
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

## Refine before building

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
- Optionally hold automation back while the player is actively clicking
  (a `page` POST in the last few seconds), to cover the 296
  automation-vs-player overlaps.
- This sits *above* each feature's existing `cycleInFlight`/`activeRun`
  guard (see CLAUDE.md), which stays as it is. That guard stops a feature
  overlapping *itself*; the queue stops features overlapping *each other*.
- Behind its own setting, **default off**, so nothing changes until the player
  turns it on (see the memories `feedback_auto_features_off_by_default` and
  `feedback_keep_existing_behavior_toggle_new`).
- Open questions for the player, to answer before coding:
  - Should one feature be able to jump the queue (e.g. a time-limited
    courier)?
  - How long a gap between features?
  - Should automation wait while the player is clicking?
