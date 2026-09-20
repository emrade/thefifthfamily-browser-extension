#!/usr/bin/env python3
"""Extracts every real, manually-played Street Racing attempt (`origin:
"page"` — the game's own client, not this extension's automated
`background`-origin attempts) from one or more request archives, and reports
the submitted `accuracy` values.

This is what `STREET_RACING_ACCURACY_MEAN`/`_STDDEV`/`_MIN`/`_MAX` (and the
`_HARD_RACE_*` variants) in `src/shared/constants.ts` are meant to track —
re-run this against a fresh export whenever there's reason to believe the
account's real mini-game performance has shifted, rather than guessing.

Run: python3 verification/street-racing/verify_manual_accuracy.py [--archive PATH ...]

By default this combines *every* matching archive found under ~/Downloads,
~/Desktop, and their "tff archives" subfolders (not just the newest) — a
single export's rolling window rarely covers enough real manual play to say
anything about a trend; `--archive` is repeatable if you want to pin specific
files instead.

Written 2026-09-20 after the account owner asked whether recent manual play
supports raising the accuracy floor — see `STREET_RACING_ACCURACY_MIN`'s own
doc in constants.ts, and this script's own README, for what that check
found. Short version: a real first-pass run against a narrow date window
looked flat, but a same-day re-run against a fuller archive set showed a
genuine improvement trend in the first ~2-3 weeks of play followed by a
plateau — low 70s-80s scores are real and recur even well past that
plateau, just infrequently (a concentration-lapse pattern, not a skill
floor), so re-run this against the *fullest* archive set you can find
rather than trusting a single narrow pull.
"""

import argparse
import gzip
import json
import statistics
from glob import glob
from pathlib import Path
from urllib.parse import parse_qs

ARCHIVE_GLOBS = [
    str(Path.home() / "Downloads" / "fifth-family-archive-*.ndjson.gz"),
    str(Path.home() / "Downloads" / "tff archives" / "fifth-family-archive-*.ndjson.gz"),
    str(Path.home() / "Desktop" / "fifth-family-archive-*.ndjson.gz"),
    str(Path.home() / "Desktop" / "tff archives" / "fifth-family-archive-*.ndjson.gz"),
]


def find_default_archives() -> list:
    candidates = sorted({p for pattern in ARCHIVE_GLOBS for p in glob(pattern)})
    if not candidates:
        raise SystemExit(
            "No archive found. Pass --archive /path/to/fifth-family-archive-*.ndjson.gz "
            "(repeatable)\n"
            f"(looked in: {', '.join(ARCHIVE_GLOBS)})"
        )
    return candidates


def load_records(archive_path: str):
    """Yields each parsed JSON line except the header (first line)."""
    opener = gzip.open if archive_path.endswith(".gz") else open
    with opener(archive_path, "rt", encoding="utf-8", errors="replace") as f:
        for i, line in enumerate(f):
            if i == 0:
                continue  # header row (export metadata), not a request record
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def find_manual_attempts(archive_paths):
    """Yields one dict per real manual `attempt_race` call, deduplicated by
    (timestamp, requestBody) across archives whose time windows overlap —
    same reasoning as street-intel's `load_records_deduped`."""
    seen = set()
    for path in archive_paths:
        for row in load_records(path):
            if row.get("origin") != "page":
                continue
            if "races_v2.php" not in row.get("url", ""):
                continue
            req_body = row.get("requestBody") or ""
            if "attempt_race" not in req_body:
                continue

            key = (row.get("timestamp"), req_body)
            if key in seen:
                continue
            seen.add(key)

            params = parse_qs(req_body)
            try:
                resp = json.loads(row.get("responseBody") or "{}")
            except json.JSONDecodeError:
                resp = {}

            yield {
                "timestamp": row.get("timestamp"),
                "isoTime": row.get("isoTime"),
                "raceId": params.get("race_id", [None])[0],
                "accuracySent": params.get("accuracy", [None])[0],
                "ok": resp.get("ok"),
                "won": resp.get("won"),
                "opponent": resp.get("opponent_name"),
                "error": resp.get("error") or resp.get("msg"),
                "sourceFile": Path(path).name,
            }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--archive",
        dest="archives",
        action="append",
        default=None,
        help="Path to a fifth-family-archive-*.ndjson.gz (repeatable; default: every match under "
        "~/Downloads, ~/Desktop, and their 'tff archives' subfolders)",
    )
    args = parser.parse_args()
    archive_paths = args.archives or find_default_archives()
    print(f"Scanning {len(archive_paths)} archive(s):")
    for p in archive_paths:
        print(f"  {p}")
    print()

    rows = sorted(find_manual_attempts(archive_paths), key=lambda r: r["timestamp"])
    if not rows:
        print("No manual (origin: page) attempt_race calls found.")
        return

    print(f"Found {len(rows)} manual race attempt(s):\n")
    for r in rows:
        if r["ok"] is False:
            outcome = f"REJECTED: {r['error']}"
        elif r["ok"] is True:
            outcome = "WON" if r["won"] else "LOST"
        else:
            outcome = "unknown response shape"
        print(
            f"{r['isoTime']}  race_id={r['raceId']}  accuracy={r['accuracySent']}  "
            f"opponent={r['opponent']}  {outcome}  [{r['sourceFile']}]"
        )

    completed = [int(r["accuracySent"]) for r in rows if r["ok"] is True and r["accuracySent"] is not None]
    if not completed:
        print("\nNo completed (ok:true) attempts with a numeric accuracy — no stats to report.")
        return

    print(f"\nCompleted attempts: n={len(completed)}  min={min(completed)}  max={max(completed)}  mean={statistics.mean(completed):.1f}")

    if len(completed) >= 4:
        half = len(completed) // 2
        first, second = completed[:half], completed[half:]
        first_dates = [r["isoTime"][:10] for r in rows if r["ok"] is True][: len(first)]
        second_dates = [r["isoTime"][:10] for r in rows if r["ok"] is True][len(first) :]
        print(
            f"First half  ({first_dates[0]} .. {first_dates[-1]}): n={len(first)}  "
            f"mean={statistics.mean(first):.1f}  min={min(first)}  max={max(first)}"
        )
        print(
            f"Second half ({second_dates[0]} .. {second_dates[-1]}): n={len(second)}  "
            f"mean={statistics.mean(second):.1f}  min={min(second)}  max={max(second)}"
        )


if __name__ == "__main__":
    main()
