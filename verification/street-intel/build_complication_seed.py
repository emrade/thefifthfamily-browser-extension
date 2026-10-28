#!/usr/bin/env python3
"""Rebuilds `SEED_RECORDS` in src/shared/streetIntelComplications.ts from every
archive combined.

Pairs each resolved `action=complication` (manual or automated) with the
`action=attempt` for the same `opportunity_id`, whose response names the
scenario (`complication.type`). Skips the pre-Phase-One rows that still
returned a `comp_score` (2026-08-10/11) — see
verify_complication_post_patch_blocked.py for why counting them hid three
blocked cells.

Prints the TypeScript literal to paste in, plus `SEED_CUTOFF` (the newest
archived row's timestamp): the extension's live tally only counts
complications after that, so the two can be summed without overlap.

`--until YYYY-MM-DD` limits the data, e.g. `--until 2026-10-05` to reproduce
the 2026-10-04 table as a check.

Run: python3 verification/street-intel/build_complication_seed.py [--archive PATH ...] [--until YYYY-MM-DD]
"""

import argparse
import collections
import json
import re

from _lib import add_archives_arg, load_endpoint_records, resolve_archive_paths

CHOICES = ("fight", "run", "talk")


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("’", "'")).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_archives_arg(parser)
    parser.add_argument("--until", help="only rows before this UTC date (YYYY-MM-DD)")
    args = parser.parse_args()

    rows = load_endpoint_records(resolve_archive_paths(args), ["POST /actions/street_intel.php"])
    if args.until:
        rows = [r for r in rows if r.get("isoTime", "") < args.until]
    rows.sort(key=lambda r: r["timestamp"])
    newest = max((r["timestamp"] for r in rows), default=0)

    scenario_by_opp = {}
    seen_opp = set()
    tally = collections.defaultdict(lambda: {c: [0, 0] for c in CHOICES})
    by_origin = collections.Counter()
    skipped_pre_patch = 0
    unpaired = 0

    for row in rows:
        body = row.get("requestBody") or ""
        try:
            resp = json.loads(row.get("responseBody") or "")
        except json.JSONDecodeError:
            continue
        opp = re.search(r"opportunity_id=(\d+)", body)
        if not opp or not resp.get("ok"):
            continue
        opp = int(opp.group(1))

        if "action=attempt" in body:
            comp = resp.get("complication") or {}
            if resp.get("has_complication") and isinstance(comp.get("type"), str):
                scenario_by_opp[opp] = norm(comp["type"])
        elif "action=complication" in body:
            if not isinstance(resp.get("comp_success"), bool) or opp in seen_opp:
                continue
            seen_opp.add(opp)
            if resp.get("comp_score") is not None:
                skipped_pre_patch += 1
                continue
            choice = re.search(r"choice=(\w+)", body)
            choice = choice.group(1) if choice else None
            scenario = scenario_by_opp.get(opp)
            if choice not in CHOICES or not scenario:
                unpaired += 1
                continue
            cell = tally[scenario][choice]
            cell[1] += 1
            cell[0] += 1 if resp["comp_success"] else 0
            by_origin[row.get("origin")] += 1

    total = sum(by_origin.values())
    print(f"// {total} resolved complications ({dict(by_origin)}), {len(tally)} scenarios;")
    print(f"// skipped {skipped_pre_patch} pre-Phase-One, {unpaired} unpaired.")
    print(f"export const SEED_CUTOFF = {newest};")
    print("const SEED_RECORDS = {")
    for scenario in sorted(tally, key=lambda s: -sum(c[1] for c in tally[s].values())):
        cells = ", ".join(f"{c}: [{w}, {n}]" for c, (w, n) in tally[scenario].items() if n > 0)
        print(f"  {json.dumps(scenario)}: {{ {cells} }},")
    print("};")


if __name__ == "__main__":
    main()
