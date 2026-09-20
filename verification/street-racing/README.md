# Street Racing verification scripts

Independent re-derivations of the account's own real Street Racing play,
run directly against `fifth-family-archive-*.ndjson.gz` request archives
(the export produced by the extension's own archive feature — one JSON
object per line, gzipped). No dependencies beyond the Python 3 standard
library.

Written 2026-09-20 while deciding whether to raise the automated
`accuracy` floor in `src/shared/constants.ts` — kept here so the same check
can be re-run later against a fresh export instead of reconstructing the
parsing from scratch.

## Usage

```
python3 verification/street-racing/verify_manual_accuracy.py [--archive PATH ...]
```

`--archive` is repeatable and defaults to *every* matching archive found
under `~/Downloads` and its `tff archives` subfolder — a
single export's rolling window rarely covers enough real manual play to say
anything about a trend, so this combines as many as it can find rather than
just the newest.

## What it checks

**`verify_manual_accuracy.py`** — finds every real, manually-played
`attempt_race` call (`origin: "page"` — the game's own client, not this
extension's automated `background`-origin attempts) across the given
archives, deduplicated by `(timestamp, requestBody)` for archives whose time
windows overlap. Prints each attempt's submitted `accuracy`, opponent, and
outcome, plus summary stats (min/max/mean) split into a first-half/second-half
comparison by date, so a genuine improving (or declining) trend is visible
directly instead of needing to eyeball a long list.

First pass (2026-09-20, 49 completed manual attempts, Sept 3-15 only —
before more archives covering earlier dates were found under `~/Downloads`)
concluded there was **no clean upward trend**: mean 89.1, range 74-97,
second half of that window (88.2) actually slightly *lower* than the first
half (90.0). That conclusion turned out to be an artifact of the narrow
window, not a real finding — see below.

Re-run same day once the fuller archive set was found (149 completed manual
attempts, Aug 12 - Sept 20): mean 85.1, range 54-97 overall. Broken out by
week, there **is** a real improvement trend, it just finished before the
first pass's window started — mean accuracy climbed from 77.8 (week of Aug
12) to ~89 by late August, then plateaued (88-90) from Aug 24 onward rather
than continuing to climb. A linear regression across all 149 attempts in
chronological order gives slope ≈ +0.10 accuracy points/attempt (≈+15
points first-to-last), driven almost entirely by that first ~2-3 weeks. The
worst-case score also rose with the mean — the low end went from 54 (week
1) to no worse than 74 from week 3 onward — which is the stronger signal,
since a rising mean alone could just mean more high rolls mixed with the
same bad ones.

Within the plateau period (Aug 24 - Sep 20, n=85, the account's current
skill level): mean 89.0, stdev 5.2, low end still real — 74 occurred twice
(2.4%), and sub-80 scores occurred 7.1% of the time, most recently Sept 11
— not confined to an early "still learning" period. Per the account owner,
this matches how the mini-game actually works: click-timing/concentration,
not a skill-progression curve, so low scores are occasional focus lapses
rather than a floor that rises with practice. This directly disproved an
unverified claim in `constants.ts`'s own comment ("since practicing, manual
attempts consistently land 90+") that had been based on a single
post-practice data point rather than a re-run of this script.

Also checked: submitted `accuracy` correlates with the race's `cash_awarded`
(r=0.319 across all 149 completed attempts; high-value races ≥$1M average
87.2 vs. 84.0 for sub-$1M) — consistent with focusing more on lucrative
races, though it doesn't hold cleanly per-race (the ~$1.175M "Stockpile"
race actually averages *lower* accuracy, 83.6, and has the single lowest
floor of any race, 60, than several lower-paying races) — looks more like a
per-opponent timing-pattern effect than a strict stakes-proportional one.
Race-level detail (payout, `base_chance`, per-opponent accuracy) isn't
captured by this script yet; it was pulled with an ad-hoc one-off query
against the same archives, not committed here.

Current `constants.ts` values (`MEAN=91, STDDEV=4, MIN=85, MAX=97`) were set
from this run: `MEAN` at 91 (real mean within the ≥85-floored subset of the
plateau is 90.7 — 92, the old value, overshot what even a good day looks
like); `MAX` at 97, the real all-time high across the full sample (not a
cushion above it, per the account owner directly); `MIN` left at 85 (account
owner's call — this doesn't reach the real observed floor of 54-74, which
only shows up rarely, so treat 85 as a deliberate choice, not a verified
value, if revisiting this again).
