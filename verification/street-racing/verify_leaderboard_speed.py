#!/usr/bin/env python3
"""Re-derives the Street Kings leaderboard's `avg_speed` from the account's own
`attempt_race` results, and checks the 12-hour weather-slot schedule.

Checks the claims in `docs/street-racing-leaderboard.md`:

1. Per-race speed = `player_stats_effective.top_speed` x (0.7 + 0.3 x accuracy/100),
   stored at 2 decimals, and `avg_speed` = the mean of that over the current
   board day (23:00 UTC reset), shown half-up to 1 decimal. Every distinct snapshot of the account's own
   leaderboard row (from `races_v2.php?action=get_all`) is compared against
   the prediction under two hypotheses — losses excluded / losses included —
   since the data so far doesn't settle which one the server uses (see the
   doc's "Open question" section).
2. Weather only changes at 11:00 / 23:00 UTC. Every weather observation is
   bucketed into its 12-hour slot; any slot that shows two different weathers
   is reported as a conflict.

Run: python3 verification/street-racing/verify_leaderboard_speed.py [--archive PATH ...]

Defaults to every archive under ~/Downloads and its "tff archives" subfolder
(overlapping windows are deduplicated), same as verify_manual_accuracy.py.

Written 2026-09-24. First run: 41 distinct snapshots (2026-09-11 .. 09-23),
40 matching under each hypothesis — the one miss per hypothesis is the other
hypothesis's match (09-11 fits losses-out only, 09-20 00:21 fits losses-in
only); 50 weather slots, 0 conflicts.
"""

import argparse
import collections
import gzip
import json
from glob import glob
from pathlib import Path

ARCHIVE_GLOBS = [
    str(Path.home() / "Downloads" / "fifth-family-archive-*.ndjson.gz"),
    str(Path.home() / "Downloads" / "tff archives" / "fifth-family-archive-*.ndjson.gz"),
]
HOUR_MS = 3600 * 1000
RESET_HOUR_UTC = 23  # board day + weather slot boundary (midnight WAT)
SLOT_OFFSET_HOUR_UTC = 11  # the other weather-slot boundary


def find_default_archives() -> list:
    candidates = sorted({p for pattern in ARCHIVE_GLOBS for p in glob(pattern)})
    if not candidates:
        raise SystemExit(
            "No archive found. Pass --archive /path/to/fifth-family-archive-*.ndjson.gz (repeatable)\n"
            f"(looked in: {', '.join(ARCHIVE_GLOBS)})"
        )
    return candidates


def load_racing_rows(archive_paths):
    """Every races_v2.php row across all archives, deduplicated by
    (timestamp, url, requestBody), sorted by time."""
    seen = {}
    for path in archive_paths:
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rt", encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f):
                if i == 0 or "races_v2.php" not in line[:400]:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "races_v2.php" not in row.get("url", ""):
                    continue
                seen[(row.get("timestamp"), row.get("url"), row.get("requestBody"))] = row
    return [seen[k] for k in sorted(seen, key=lambda k: k[0])]


def parse_body(row):
    try:
        body = json.loads(row.get("responseBody") or "")
    except json.JSONDecodeError:
        return None
    return body if isinstance(body, dict) else None


def board_day(ts_ms):
    """Board days run 23:00 UTC -> 23:00 UTC; key each by its start slot."""
    return (ts_ms - RESET_HOUR_UTC * HOUR_MS) // (24 * HOUR_MS)


def round_half_up(x, places):
    # Server rounds half-up (221.85 shows as 221.9); Python's round() is
    # banker's on the binary value, so do it explicitly. The epsilon absorbs
    # float noise like 281.85 -> 281.8499999.
    scale = 10 ** places
    return int(x * scale + 0.5 + 1e-6) / scale


def race_speed(resp):
    # Each race's speed is stored at 2 decimals (half-up) *before* averaging;
    # the average is then shown half-up at 1 decimal. The 2026-09-20T23:08
    # snapshot (accuracy 93/94/85/95 at top speed 289) only matches this way:
    # the unrounded mean 281.847 would show 281.8, the board shows 281.9
    # (= mean of 282.93/283.80/276.00/284.67 = 281.85). Rounding per race to
    # 1 decimal instead breaks the 2026-09-15 snapshots (245.65 -> 245.7).
    return round_half_up(resp["player_stats_effective"]["top_speed"] * (0.7 + 0.3 * resp["accuracy"] / 100), 2)


def check_avg_speed(rows):
    races_by_day = collections.defaultdict(list)  # day -> [(ts, resp)]
    snapshots = []  # (ts, iso, entry)
    for row in rows:
        req = row.get("requestBody") or ""
        resp = parse_body(row)
        if resp is None:
            continue
        if "attempt_race" in req and "won" in resp and "player_stats_effective" in resp:
            races_by_day[board_day(row["timestamp"])].append((row["timestamp"], resp))
        elif "action=get_all" in row.get("url", ""):
            for entry in resp.get("leaderboard") or []:
                if entry.get("id") == resp.get("you_id"):
                    snapshots.append((row["timestamp"], row.get("isoTime", ""), entry))

    print("== avg_speed check (only snapshots where the account is in the top 10) ==")
    print(f"{'snapshot (UTC)':20} {'board':>13} | {'wins-only':>18} | {'all races':>18}")
    last_key, totals = None, collections.Counter()
    for ts, iso, entry in snapshots:
        day = board_day(ts)
        key = (day, entry["total_wins"], entry["avg_speed"])
        if key == last_key:
            continue
        last_key = key
        so_far = [r for t, r in races_by_day.get(day, []) if t <= ts]
        wins = [r for r in so_far if r["won"]]
        cells = []
        for label, subset in (("wins-only", wins), ("all", so_far)):
            if not subset:
                cells.append(f"{'-':>18}")
                continue
            pred = sum(race_speed(r) for r in subset) / len(subset)
            ok = len(wins) == entry["total_wins"] and round_half_up(pred, 1) == round(entry["avg_speed"], 1)
            totals[label, ok] += 1
            cells.append(f"{'OK' if ok else 'XX'} n={len(subset):2} {pred:8.2f}")
        print(f"{iso[:19]:20} {entry['total_wins']:3}w {entry['avg_speed']:7.1f} | {cells[0]} | {cells[1]}")
    for label in ("wins-only", "all"):
        print(f"{label:10} hypothesis: {totals[label, True]} OK, {totals[label, False]} mismatched")
    print(
        "(A mismatch under one hypothesis is expected only on days with a loss at a\n"
        " different speed than that day's wins — see the doc's open question.)\n"
    )


def check_weather_slots(rows):
    slots, conflicts = {}, []
    for row in rows:
        resp = parse_body(row)
        if not resp or "weather" not in resp:
            continue
        slot = (row["timestamp"] - SLOT_OFFSET_HOUR_UTC * HOUR_MS) // (12 * HOUR_MS)
        if slot in slots and slots[slot][0] != resp["weather"]:
            conflicts.append((slots[slot], (resp["weather"], row.get("isoTime"))))
        slots[slot] = (resp["weather"], row.get("isoTime"))
    print("== weather slots (boundaries 11:00 / 23:00 UTC) ==")
    print(f"slots observed: {len(slots)}  conflicts: {len(conflicts)}")
    for c in conflicts:
        print(f"  CONFLICT: {c[0]} vs {c[1]}")
    freq = collections.Counter(w for w, _ in slots.values())
    print("frequency: " + ", ".join(f"{w} {n}" for w, n in freq.most_common()))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--archive", dest="archives", action="append", default=None)
    args = parser.parse_args()
    archive_paths = args.archives or find_default_archives()
    print(f"Scanning {len(archive_paths)} archive(s)...\n")
    rows = load_racing_rows(archive_paths)
    check_avg_speed(rows)
    check_weather_slots(rows)


if __name__ == "__main__":
    main()
