# Arena verification scripts

Independent re-derivations of the account's own real Arena play, run
directly against `fifth-family-archive-*.ndjson.gz` request archives (the
export produced by the extension's own archive feature — one JSON object
per line, gzipped). No dependencies beyond the Python 3 standard library.

Written 2026-09-20 after the account owner noticed most boss battles
succeed even when the page's own win% badge looks low — kept here so the
same check can be re-run later against a fresh export instead of
reconstructing the parsing from scratch.

## Usage

```
python3 verification/arena/verify_boss_odds.py [--archive PATH ...]
```

`--archive` is repeatable and defaults to *every* matching archive found
under `~/Downloads` and its `tff archives` subfolder — boss fights are far
rarer than street races (once per page-unlock, not several times a
session), so a single export's window is even less likely to have enough
samples than the street-racing check.

## What it checks

**`verify_boss_odds.py`** — finds every real Arena boss `attack` call
(`opponent_id=0`, `ok:true`) across the given archives, pairs each one with
the `win_pct` the game itself quoted in the most recent `open_next_page`
response before that attack, and reports whether the account's actual win
rate matches those quoted odds. Also reports the time gap between when the
odds were quoted and when the attack landed (to catch stale-odds
explanations) and flags any row where the quoted boss name doesn't match
the actual defender (a sign the odds pairing itself is unreliable for that
row).

### Findings as of the 2026-09-20 run

12 real boss attacks found across all available archives (Sept 12–20),
**all `origin: page`** — manual play, not Arena Auto:

**10/12 wins (83.3%) against an average quoted win_pct of 42.1%.** Expected
wins at that rate: ~5. Exact probability of hitting 10+ out of 12 using
each fight's own quoted odds: **0.44%** — not sample noise at any
reasonable confidence level, though n=12 is still a thin sample in
absolute terms.

Two explanations were checked and ruled out:

- **Not Arena Auto's own boss threshold** (`ARENA_AUTO_DEFAULT_BOSS_WIN_PCT_THRESHOLD`
  = 50 in `src/shared/constants.ts`) — every one of the 12 samples is
  manual (`origin: page`), so that ≥50% gate never applied to any of them.
- **Not stale odds** — 11 of 12 attacks landed within ~2 minutes of the
  `open_next_page` call that set the quoted `win_pct` (one 44-minute
  outlier, which was itself a *loss*, not a win — so staleness isn't
  hiding a pattern of easy wins either).

**Leading theory, not yet confirmed:** each boss attack response includes a
full round-by-round combat log (`rounds` — dodge/crit/block rolls, real HP
totals through the fight), not a single roll against the quoted `win_pct`.
The quoted badge is plausibly a simplified pre-fight estimate (e.g. a
`combat_power`-ratio style number) that may not fully capture this
account's specific build — enhancement levels, crit/dodge/block rates —
against a given boss's stat spread. **Not yet verified**: would need the
account's own raw combat stats (strength/defence/agility/dexterity, gear
enhancement levels) compared directly against each boss's snapshot stats
(already captured in `boss_data` — see the `open_next_page` response) to
say anything concrete about *why* the gap exists, only that it does.

Re-run this against a fresh export once more boss fights have accumulated
— 12 samples supports "there's a real gap," not yet "here's the exact
size of the gap" or "here's why."
