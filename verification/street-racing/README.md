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
under `~/Downloads`, `~/Desktop`, and their `tff archives` subfolders — a
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

Confirmed as of the 2026-09-20 run (49 completed manual attempts, Sept 3-15):
mean 89.1, range 74-97, and **no clean upward trend** — the lowest score
(74) landed on Sept 11, not during an early "just started" period, and the
second half of the date range actually had a slightly *lower* mean (88.2)
than the first half (90.0). This doesn't necessarily contradict a claim like
"when I'm paying attention I score 90+" (the archive can't tell a focused
attempt from a casual one), but it doesn't confirm it either — re-run this
against a fresh export once more post-decision manual attempts exist to see
whether the trend actually shows up.
