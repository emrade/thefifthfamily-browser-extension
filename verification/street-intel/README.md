# Street Intel verification scripts

Independent re-derivations of the claims in
`docs/street-intel-estimate-calculation.md`, run directly against a
`fifth-family-archive-*.ndjson.gz` request archive (the export produced by
the extension's own archive feature — one JSON object per line, gzipped).
No dependencies beyond the Python 3 standard library.

Written 2026-09-06 while independently re-checking that doc end to end,
including the numbers in its own "Independent Verification" section. Kept
here so the same checks can be re-run later (a newer archive, a disputed
number, a doc edit) without reconstructing the parsing from scratch. See that
doc's own history/commits for what each script's findings changed.

## Usage

```
python3 verification/street-intel/verify_exact_formula.py [--archive /path/to/archive.ndjson.gz]
python3 verification/street-intel/verify_env_stat_parsing.py [--archive ...]
python3 verification/street-intel/verify_risk_tier_bands.py [--archive ...]
python3 verification/street-intel/verify_complications.py [--archive ...]
python3 verification/street-intel/verify_complication_type_stats.py [--archive ... [--archive ...]]
python3 verification/street-intel/verify_complication_blocked_choices.py [--archive ... [--archive ...]]
python3 verification/street-intel/analyze_profit_and_stamina.py [--archive ...] [--since YYYY-MM-DD]
python3 verification/street-intel/simulate_target_selection.py [--archive ...] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
python3 verification/street-intel/analyze_live_modes.py [--archive ...] [--since YYYY-MM-DD]
```

`--archive` defaults to the newest `fifth-family-archive-*.ndjson.gz` found
in the locations listed in `verification/archive_paths.py` — pass it explicitly if
the archive lives somewhere else or you want to pin a specific export.

`verify_complication_type_stats.py` and the three 2026-10-04 scripts
(`verify_complication_blocked_choices.py`, `analyze_profit_and_stamina.py`,
`simulate_target_selection.py`) are the exceptions: it defaults to
*every* matching archive found (not just the newest) and `--archive` is
repeatable there, since a per-scenario check needs more combined history
than any single export's window usually holds. Overlapping exports are
deduplicated automatically.

## What each script checks

- **`verify_exact_formula.py`** — Section 1-2's exact server formula. Cross-references
  the `autofail` flag (only ever exposed in the pre-scout `data-approaches`
  attribute, never in the scout response itself) and reports any raw value
  that landed exactly on `X.5`, where Python's banker's-rounding `round()`
  disagrees with the game's (and JS `Math.round()`'s) half-up rounding.
- **`verify_env_stat_parsing.py`** — Section 8's correction to Section 5's
  "+ Parsed env_stat" column. Confirms the same `modifier_intel` string maps
  to different real `env_stat` magnitudes on different cards, and backtests
  the flat +3.5/-3.0 heuristic to get its *real* accuracy (not the 100%
  originally claimed).
- **`verify_risk_tier_bands.py`** — Section 6's base_pct range/mean per risk
  tier. Deliberately does not attempt to verify the doc's "20-level cycle"
  framing: no per-card numeric level field exists anywhere in the archive,
  only the categorical `data-risk` tag.
- **`verify_complications.py`** — Section 7's per-choice and per-scenario
  win/loss and cash-lost figures, reconstructed by pairing each
  `action=attempt` (which carries `complication.type`) with the following
  `action=complication` response for the same `opportunity_id`.
- **`verify_complication_type_stats.py`** — same pairing as
  `verify_complications.py`, but broken down by scenario *and* choice (a
  reconstruction of the extension's own `complicationTypeStats`), checking
  every bucket against `docs/street-intel-complication-tracking.md`'s
  ~15-20-per-bucket noise threshold. Answers "is Section 7C's per-scenario
  advice trustworthy yet" directly rather than needing the question re-run
  by hand each time. As of 2026-09-08 (two archives combined): no. As of
  2026-10-04 (all archives, 480 events): only a couple of buckets reach 15
  (run on "smoke" and on "rival informant", 14/15 each), so most *ranking* of
  choices is still noise — but the stronger
  question, whether a choice can be ruled *out* per scenario, is answered yes
  by `verify_complication_blocked_choices.py` below.

- **`verify_complication_blocked_choices.py`** (2026-10-04) — tests whether
  each complication scenario has one choice that essentially never wins.
  Answer, on 480 events: yes for 14 of 24 scenarios — blocked picks went
  0/91 vs 83-90% for every other choice, and cost 86% of all complication
  losses. Includes a chronological replay so the rule isn't judged on
  hindsight.
- **`analyze_profit_and_stamina.py`** (2026-10-04) — daily gross/lost/net,
  stamina regen and per-day spend (attempts vs fresh scouts vs attacks), and
  net profit per stamina by risk tier and reward band.
- **`simulate_target_selection.py`** (2026-10-04) — replays real panel
  snapshots and real stamina income against alternative selection policies
  ("big targets only", tier filters, stamina reserve, lazy scouting).

- **`analyze_live_modes.py`** (2026-10-05) — how the 0.36.0 modes (Smart
  scouting, Smart complication choices, top 2 by payout) are doing on live
  play against the original scout-everything runner. Detects which
  behaviour ran each day from the requests themselves (scouts per cycle;
  complication choices that differ from the attempt's approach), then
  compares per day and before/after on **net per Stamina**, so consumables
  and partial days don't skew it. Also flags attempts where an affordable
  card worth 1.5x+ sat unscouted. Re-run after each new export.

These scripts load every archive in parallel through `_lib.load_endpoint_records`
(~20s for ~5GB on 8 cores) instead of `load_records_deduped`.

## What these scripts can't check

`docs/street-intel-estimate-calculation.md` Section 8 also cites a live
`complicationStats` snapshot (146 events at the time, fight/run fallback win
rates) read straight from the extension's own runtime storage rather than
derived from an archive. Per-choice and per-scenario complication figures
*are* derivable from an archive (see the two scripts above — combine enough
exports and they converge on the same numbers), but that specific snapshot
was a point-in-time read of live storage, taken via the popup UI ("Complication
History" section) rather than reconstructed — re-deriving the *exact same*
historical number requires an archive covering that snapshot's full window,
which retention may have already evicted.

`_lib.py` is shared, not a standalone script.
