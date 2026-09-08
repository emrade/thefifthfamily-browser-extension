#!/usr/bin/env python3
"""Checks whether `complicationTypeStats` (per-scenario, per-choice win
tallies — src/shared/types.ts) has enough data yet to trust any of
docs/street-intel-estimate-calculation.md Section 7C's story-prompt
recommendations.

Same pairing as verify_complications.py (an `action=attempt` response's
`complication.type` -> the following `action=complication` response's
`choice`/`comp_success`, joined on `opportunity_id`), but broken down by
scenario *and* choice, with every resulting bucket checked against
docs/street-intel-complication-tracking.md's own "~15-20 resolved
complications per bucket" noise threshold.

Unlike this folder's other scripts, this one combines every archive it's
given (or every archive found by default, not just the newest) — a single
export's window rarely holds enough complications to say anything meaningful
once split this finely, so accumulated history matters more here than
recency. Overlapping exports are deduplicated by (timestamp, requestBody).

Run: python3 verification/street-intel/verify_complication_type_stats.py [--archive PATH ...]
Last run (2026-09-08, two archives combined spanning 2026-09-02 to
2026-09-08): 80 resolved events across 22 scenarios; busiest single
scenario+choice bucket was 5/5 ("A rival informant recognizes you" / run) —
nowhere near the 15-20 threshold, so Section 7C remains unactionable.
"""

import argparse
import collections
import json
import re

from _lib import add_archives_arg, load_records_deduped, resolve_archive_paths

NOISE_THRESHOLD = 15


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_archives_arg(parser)
    args = parser.parse_args()
    archive_paths = resolve_archive_paths(args)
    print(f"Archives ({len(archive_paths)}):")
    for p in archive_paths:
        print(f"  {p}")
    print()

    records = list(load_records_deduped(archive_paths))

    pending_attempts = {}  # opportunity_id -> scenario (complication.type)
    stats = collections.defaultdict(lambda: collections.defaultdict(lambda: {"attempts": 0, "successes": 0}))
    total_resolved = 0

    for row in records:
        if row.get("endpoint") != "POST /actions/street_intel.php":
            continue
        req_body = row.get("requestBody", "") or ""
        try:
            resp = json.loads(row["responseBody"])
        except (json.JSONDecodeError, KeyError, TypeError):
            continue

        if "action=attempt" in req_body:
            oid_m = re.search(r"opportunity_id=(\d+)", req_body)
            if oid_m and resp.get("has_complication") and resp.get("complication"):
                pending_attempts[oid_m.group(1)] = resp["complication"]["type"]
        elif "action=complication" in req_body:
            oid_m = re.search(r"opportunity_id=(\d+)", req_body)
            choice_m = re.search(r"choice=(\w+)", req_body)
            oid = oid_m.group(1) if oid_m else None
            if oid not in pending_attempts:
                continue  # complication for an attempt we didn't see (window edge)
            if resp.get("ok") is not True or resp.get("comp_success") is None:
                continue  # unresolved/rejected call — actionRunner.ts doesn't count these either

            scenario = pending_attempts[oid]
            choice = choice_m.group(1) if choice_m else None
            bucket = stats[scenario][choice]
            bucket["attempts"] += 1
            if resp["comp_success"]:
                bucket["successes"] += 1
            total_resolved += 1

    print(f"Total resolved complication events (with known scenario): {total_resolved}")
    print(f"Distinct scenarios: {len(stats)}\n")

    cleared = []
    for scenario, choices in sorted(stats.items(), key=lambda kv: -sum(c["attempts"] for c in kv[1].values())):
        total = sum(c["attempts"] for c in choices.values())
        parts = ", ".join(f"{k}:{v['successes']}/{v['attempts']}" for k, v in choices.items())
        print(f"{total:3d}  {scenario!r:60s} {parts}")
        for choice, v in choices.items():
            if v["attempts"] >= NOISE_THRESHOLD:
                cleared.append((scenario, choice, v))

    print()
    if cleared:
        print(f"Buckets clearing the {NOISE_THRESHOLD}-sample threshold:")
        for scenario, choice, v in cleared:
            print(f"  {scenario!r} / {choice}: {v['successes']}/{v['attempts']}")
    else:
        print(
            f"No scenario+choice bucket clears the {NOISE_THRESHOLD}-sample noise threshold yet "
            "(docs/street-intel-complication-tracking.md) — Section 7C's per-scenario "
            "recommendations remain unactionable; keep collecting."
        )


if __name__ == "__main__":
    main()
