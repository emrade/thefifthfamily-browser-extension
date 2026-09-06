# Verification scripts

One-off analysis scripts that independently re-derive a doc's or feature's
claims from real exported game data, kept around so they can be re-run later
instead of rebuilt from scratch. One subfolder per feature/investigation;
each subfolder has its own README describing what it checks and how to run
it.

- **`street-intel/`** — checks the claims in
  `docs/street-intel-estimate-calculation.md` against a
  `fifth-family-archive-*.ndjson.gz` request archive.
