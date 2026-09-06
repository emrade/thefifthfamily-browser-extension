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
```

`--archive` defaults to the newest `fifth-family-archive-*.ndjson.gz` found
under `~/Downloads` or `~/Desktop` — pass it explicitly if the archive lives
somewhere else or you want to pin a specific export.

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

## What these scripts can't check

`docs/street-intel-estimate-calculation.md` Section 8 also cites a
`complicationStats` snapshot (146 events, fight/run fallback win rates) from
*after* this archive's time window. That number lives in the extension's own
runtime storage, not in any request archive — the only way to check it is to
read it straight out of the extension's popup UI ("Complication History"
section) on a real account.

`_lib.py` is shared, not a standalone script.
