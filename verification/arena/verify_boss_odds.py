#!/usr/bin/env python3
"""Extracts every real Arena boss `attack` call (`opponent_id=0`) from one or
more request archives, pairs each one with the boss `win_pct` the game itself
quoted (from the most recent `open_next_page` response before that attack),
and reports whether the actual win rate matches those quoted odds.

Written 2026-09-20 after the account owner noticed most boss fights succeed
even when the page's own win% badge reads well under 50%. First pass across
all archives found under ~/Downloads (n=12, all `origin: page`
— manual play, not Arena Auto): 10/12 wins (83%) against an average quoted
win_pct of 42%. That gap is not sample noise (exact binomial probability of
>=10/12 wins at each fight's own quoted odds: 0.44%), and two obvious
explanations were ruled out:

  - Not Arena Auto's own >=50% boss threshold (ARENA_AUTO_DEFAULT_BOSS_WIN_PCT_THRESHOLD
    in src/shared/constants.ts) — all 12 samples were manual, so that gate
    never applied.
  - Not stale odds — 11 of 12 attacks landed within ~2 minutes of the
    `open_next_page` call that set the quoted win_pct (one 44-minute outlier,
    which was itself a loss, not a win).

Leading theory, not yet confirmed: the quoted `win_pct` looks like a
simplified pre-fight estimate (plausibly a `combat_power`-ratio style
number), while the actual fight is a full round-by-round simulation (dodge/
crit/block rolls, real HP totals — see the `rounds` field on each attack
response) that may reward this account's specific gear/build (enhancement
levels, crit/dodge/block rates) better than a single aggregate ratio would
predict. Not yet verified against the account's own raw combat stats vs. the
boss's snapshot stats — see the README in this folder for what's still open.

Run: python3 verification/arena/verify_boss_odds.py [--archive PATH ...]

By default this combines every matching archive found under ~/Downloads and
its "tff archives" subfolder (not just the newest), the same reasoning as
verification/street-racing/verify_manual_accuracy.py — a
single export rarely covers enough boss fights (this game mechanic is once
per page-unlock, far rarer than street races) to say anything statistically;
`--archive` is repeatable if you want to pin specific files instead.
"""

import argparse
import gzip
import json
import statistics
from datetime import datetime
from glob import glob
from pathlib import Path

ARCHIVE_GLOBS = [
    str(Path.home() / "Downloads" / "fifth-family-archive-*.ndjson.gz"),
    str(Path.home() / "Downloads" / "tff archives" / "fifth-family-archive-*.ndjson.gz"),
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


def find_boss_attacks(archive_paths):
    """Yields one dict per real boss `attack` call (`opponent_id=0`, `ok:true`),
    paired with the `win_pct` most recently quoted by an `open_next_page` call
    for that same boss. Walks all archives together in timestamp order so the
    "most recent boss_data" tracking works across archive boundaries, and
    dedupes by (timestamp, requestBody) the same way the street-racing script
    does for archives whose time windows overlap."""
    seen = set()
    rows = []
    for path in archive_paths:
        for row in load_records(path):
            if "arena_v2.php" not in row.get("url", ""):
                continue
            key = (row.get("timestamp"), row.get("requestBody"))
            if key in seen:
                continue
            seen.add(key)
            row["_sourceFile"] = Path(path).name
            rows.append(row)

    rows.sort(key=lambda r: r.get("timestamp") or 0)

    last_boss = None
    last_boss_ts = None
    for row in rows:
        req = row.get("requestBody") or ""
        try:
            resp = json.loads(row.get("responseBody") or "{}")
        except json.JSONDecodeError:
            resp = {}

        if "action=open_next_page" in req:
            boss_data = (resp.get("new_page") or {}).get("boss_data")
            if boss_data:
                last_boss = {"name": boss_data.get("name"), "win_pct": boss_data.get("win_pct")}
                last_boss_ts = row.get("isoTime")
            continue

        if "action=attack" not in req or "opponent_id=0" not in req:
            continue
        if resp.get("ok") is not True:
            continue

        att_ts = row.get("isoTime")
        gap_min = None
        if last_boss_ts and att_ts:
            t1 = datetime.fromisoformat(last_boss_ts.replace("Z", "+00:00"))
            t2 = datetime.fromisoformat(att_ts.replace("Z", "+00:00"))
            gap_min = (t2 - t1).total_seconds() / 60

        yield {
            "isoTime": att_ts,
            "origin": row.get("origin"),
            "defender": resp.get("defender"),
            "won": resp.get("won"),
            "quotedWinPct": last_boss["win_pct"] if last_boss else None,
            "quotedBossName": last_boss["name"] if last_boss else None,
            "attLevel": resp.get("att_level"),
            "defLevel": resp.get("def_level"),
            "roundsN": len(resp.get("rounds") or []),
            "attHpStart": resp.get("att_start_hp"),
            "attHpLeft": resp.get("attacker_hp_left"),
            "defHpStart": resp.get("def_start_hp"),
            "defHpLeft": resp.get("defender_hp_left"),
            "quotedOddsAgeMin": gap_min,
            "sourceFile": row["_sourceFile"],
        }


def exact_binomial_tail(probs, k):
    """P(X >= k) where X is the sum of independent Bernoulli trials, one per
    fight, each with its own quoted win probability — exact via DP rather
    than assuming every fight shares a single average probability."""
    dp = [1.0]
    for p in probs:
        new_dp = [0.0] * (len(dp) + 1)
        for i, v in enumerate(dp):
            new_dp[i] += v * (1 - p)
            new_dp[i + 1] += v * p
        dp = new_dp
    return sum(dp[k:])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--archive",
        dest="archives",
        action="append",
        default=None,
        help="Path to a fifth-family-archive-*.ndjson.gz (repeatable; default: every match under "
        "~/Downloads and its 'tff archives' subfolder)",
    )
    args = parser.parse_args()
    archive_paths = args.archives or find_default_archives()
    print(f"Scanning {len(archive_paths)} archive(s):")
    for p in archive_paths:
        print(f"  {p}")
    print()

    rows = list(find_boss_attacks(archive_paths))
    if not rows:
        print("No boss attack (opponent_id=0, ok:true) calls found.")
        return

    print(f"Found {len(rows)} boss attack(s):\n")
    mismatches = 0
    for r in rows:
        match = "OK" if r["quotedBossName"] == r["defender"] else "NAME MISMATCH"
        if match != "OK":
            mismatches += 1
        age = f"{r['quotedOddsAgeMin']:.1f}m" if r["quotedOddsAgeMin"] is not None else "?"
        print(
            f"{r['isoTime']}  origin={r['origin']:<10} boss={r['defender']!r:<28} "
            f"won={str(r['won']):<5} quoted={r['quotedWinPct']}%  odds_age={age:<7} "
            f"rounds={r['roundsN']:<3} att_lvl={r['attLevel']} def_lvl={r['defLevel']}  [{match}]  [{r['sourceFile']}]"
        )

    if mismatches:
        print(f"\n{mismatches} row(s) had a boss-name mismatch between quoted odds and the actual "
              "defender — their quoted% is unreliable and worth double-checking by hand.")

    scored = [r for r in rows if r["quotedWinPct"] is not None and r["won"] is not None]
    if not scored:
        print("\nNo rows had both a quoted win_pct and a known outcome — no stats to report.")
        return

    wins = sum(1 for r in scored if r["won"])
    n = len(scored)
    probs = [r["quotedWinPct"] / 100 for r in scored]
    avg_p = statistics.mean(probs)
    expected = sum(probs)
    tail_p = exact_binomial_tail(probs, wins)

    print(f"\nn={n}  wins={wins}  win_rate={wins / n * 100:.1f}%  avg_quoted_win_pct={avg_p * 100:.1f}%  "
          f"expected_wins={expected:.2f}")
    print(f"Exact P(>= {wins} wins | each fight's own quoted odds): {tail_p * 100:.2f}%  "
          "(small = the quoted odds probably don't reflect your real win rate)")

    by_origin = {}
    for r in scored:
        by_origin.setdefault(r["origin"], []).append(r)
    if len(by_origin) > 1:
        print()
        for origin, subset in by_origin.items():
            w = sum(1 for r in subset if r["won"])
            print(f"  origin={origin}: n={len(subset)} wins={w} ({w / len(subset) * 100:.0f}%)")


if __name__ == "__main__":
    main()
