#!/usr/bin/env python3
"""Verifies docs/street-intel-estimate-calculation.md, Section 8's correction
to Section 5's "+ Parsed env_stat" column.

The original doc claimed a text-parsing heuristic (flat +3.5 for "favored",
-3.0 for "hindered") could recover `env_stat` well enough to hit 100% exact /
0.000 MAE. The Independent Verification section disputes this: the same
`modifier_intel` string maps to different real env_stat magnitudes on
different cards, so no text-parsing approach can reach 100%.

This script checks both halves directly:
  1. Does the same modifier_intel text really map to >1 distinct env_stat
     value anywhere in the archive?
  2. What's the real accuracy of the flat +3.5/-3.0 heuristic on a same-card
     seed -> other-approach backtest (only when the two approaches have
     different stats, since only then does the heuristic even engage)?

Run: python3 verification/verify_env_stat_parsing.py [--archive PATH]
"""

import argparse
import collections

from _lib import add_archive_arg, extract_card_autofail, load_records, resolve_archive_path, round_half_up, scout_estimates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_archive_arg(parser)
    args = parser.parse_args()
    archive_path = resolve_archive_path(args)
    print(f"Archive: {archive_path}\n")

    records = list(load_records(archive_path))
    card_autofail = extract_card_autofail(records)
    rows = list(scout_estimates(records))

    # --- Part 1: same text -> multiple real env_stat values? ---
    text_to_envstat = collections.defaultdict(collections.Counter)
    for _oid, est, mi in rows:
        if mi and "env_stat" in est["modifiers"]:
            text_to_envstat[mi][est["modifiers"]["env_stat"]] += 1

    ambiguous = {t: c for t, c in text_to_envstat.items() if len(c) > 1}
    print("=== Part 1: text -> env_stat ambiguity ===")
    print(f"Distinct modifier_intel strings carrying env_stat: {len(text_to_envstat)}")
    print(f"Ambiguous (map to more than one real env_stat value): {len(ambiguous)}")
    for t, c in ambiguous.items():
        print(f"  {t!r} -> {dict(c)}")

    # Real spread behind the flat +3.5 / -3.0 constants used by the heuristic.
    favored, hindered = collections.Counter(), collections.Counter()
    for _oid, est, mi in rows:
        if not mi or "env_stat" not in est["modifiers"]:
            continue
        stat, lower = est["stat"], mi.lower()
        if f"{stat} approaches favored" in lower:
            favored[est["modifiers"]["env_stat"]] += 1
        elif f"{stat} approaches hindered" in lower:
            hindered[est["modifiers"]["env_stat"]] += 1
    print(f"\nReal 'favored' env_stat distribution: {dict(sorted(favored.items()))}")
    print(f"Real 'hindered' env_stat distribution: {dict(sorted(hindered.items()))}")

    # --- Part 2: backtest the flat heuristic, cross-stat pairs only ---
    by_card = collections.defaultdict(list)
    for oid, est, mi in rows:
        by_card[oid].append((est, mi))

    errs = []
    for oid, ests_mi in by_card.items():
        for seed, _ in ests_mi:
            for target, mi in ests_mi:
                if seed is target or target["stat"] == seed["stat"]:
                    continue  # heuristic only engages cross-stat
                af = card_autofail.get(oid, {}).get(target["key"])
                actual = target["estimate_pct"]
                if af == 1:
                    continue  # trivial, doesn't exercise env_stat at all

                shared = sum(v for k, v in seed["modifiers"].items() if k not in ("stat", "approach", "env_stat"))
                hidden_stat_mod = target["modifiers"].get("stat", 0)
                env_stat = 0.0
                if mi:
                    lower, statname = mi.lower(), target["stat"].lower()
                    if f"{statname} approaches favored" in lower:
                        env_stat = 3.5
                    elif f"{statname} approaches hindered" in lower:
                        env_stat = -3.0
                raw = seed["base_pct"] * (1 + (shared + hidden_stat_mod + env_stat) / 100) + target["modifiers"].get("approach", 0)
                pred = min(95, max(0, round_half_up(raw)))
                errs.append(abs(pred - actual))

    print(f"\n=== Part 2: flat +3.5/-3.0 heuristic backtest (cross-stat pairs, non-autofail targets) ===")
    n = len(errs)
    exact = sum(1 for e in errs if e == 0)
    print(f"n={n}  exact={exact} ({exact / n * 100:.2f}%)  MAE={sum(errs) / n:.4f}  worst={max(errs)}")
    print("(the original doc claimed 100.00% / MAE 0.000 for this column)")


if __name__ == "__main__":
    main()
