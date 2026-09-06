#!/usr/bin/env python3
"""Verifies docs/street-intel-estimate-calculation.md, Section 7A/7B/7C: the
per-choice and per-scenario complication win/loss data.

Pairs each `action=attempt` response that has `has_complication: true` with
the following `action=complication` response for the same opportunity_id, to
reconstruct: which approach won the attempt, which choice was made for the
complication, whether it succeeded, how much cash was lost, and the scenario
narrative (`complication.type`).

Run: python3 verification/verify_complications.py [--archive PATH]
Expected (55 resolved events): fight 7/8 ($150,188 lost), run 17/23
($81,778), talk 15/24 ($1,595,572); talk->talk 8/13 with $1,267,046 lost
across 5 failures; 20 distinct scenario strings.
"""

import argparse
import collections
import json
import re

from _lib import add_archive_arg, load_records, resolve_archive_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_archive_arg(parser)
    args = parser.parse_args()
    archive_path = resolve_archive_path(args)
    print(f"Archive: {archive_path}\n")

    records = list(load_records(archive_path))

    pending_attempts = {}  # oid -> {'approach': ..., 'scenario': ...}
    events = []
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
            approach_m = re.search(r"approach=(\w+)", req_body)
            if oid_m and resp.get("has_complication"):
                pending_attempts[oid_m.group(1)] = {
                    "approach": approach_m.group(1) if approach_m else None,
                    "scenario": resp["complication"]["type"],
                }
        elif "action=complication" in req_body:
            oid_m = re.search(r"opportunity_id=(\d+)", req_body)
            choice_m = re.search(r"choice=(\w+)", req_body)
            oid = oid_m.group(1) if oid_m else None
            if oid in pending_attempts:
                a = pending_attempts[oid]
                events.append(
                    {
                        "attempt_approach": a["approach"],
                        "scenario": a["scenario"],
                        "choice": choice_m.group(1) if choice_m else None,
                        "success": resp.get("comp_success"),
                        "cash_lost": resp.get("cash_lost", 0) or 0,
                    }
                )

    print(f"Total resolved complication events: {len(events)}\n")

    by_choice = collections.defaultdict(lambda: {"wins": 0, "total": 0, "cash_lost": 0})
    for e in events:
        b = by_choice[e["choice"]]
        b["total"] += 1
        b["wins"] += 1 if e["success"] else 0
        b["cash_lost"] += 0 if e["success"] else e["cash_lost"]

    print("=== By choice ===")
    for choice, b in by_choice.items():
        print(f"  {choice}: {b['wins']}/{b['total']} ({b['wins'] / b['total'] * 100:.1f}%)  cash_lost=${b['cash_lost']:,}")

    tt = [e for e in events if e["attempt_approach"] == "talk" and e["choice"] == "talk"]
    tt_wins = sum(1 for e in tt if e["success"])
    tt_losses = sorted((e["cash_lost"] for e in tt if not e["success"]), reverse=True)
    print(f"\ntalk->talk: {tt_wins}/{len(tt)}")
    print(f"talk->talk failure amounts: {tt_losses}")
    print(f"talk->talk total cash lost: ${sum(tt_losses):,}")

    scenarios = collections.Counter(e["scenario"] for e in events)
    print(f"\nDistinct scenario strings: {len(scenarios)}")


if __name__ == "__main__":
    main()
