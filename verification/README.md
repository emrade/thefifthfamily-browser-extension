# Verification scripts

One-off analysis scripts that independently re-derive a doc's or feature's
claims from real exported game data, kept around so they can be re-run later
instead of rebuilt from scratch. One subfolder per feature/investigation;
each subfolder has its own README describing what it checks and how to run
it.

- **`street-intel/`** — checks the claims in
  `docs/street-intel-estimate-calculation.md` against a
  `fifth-family-archive-*.ndjson.gz` request archive.
- **`street-racing/`** — `verify_manual_accuracy.py` (real manual mini-game
  accuracy, for the automation's accuracy constants) and
  `verify_leaderboard_speed.py` (checks `docs/street-racing-leaderboard.md`:
  the Street Kings `avg_speed` formula and the 11:00/23:00 UTC weather slots).
- **`arena/`**: `verify_boss_odds.py` (quoted boss odds vs results) and
  `verify_combat_rule.py` (checks `docs/arena-combat-mechanics.md`: combat
  mechanics, the kill-race score, bosses by family).
