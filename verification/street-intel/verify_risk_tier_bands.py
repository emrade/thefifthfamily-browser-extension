#!/usr/bin/env python3
"""Verifies docs/street-intel-estimate-calculation.md, Section 6: base_pct
range and mean per risk tier.

Cross-references each card's `data-risk` tag (from `panel.php?type=street_intel`)
with its real `base_pct` (from the matching `street_intel.php` scout response),
keyed by opportunity_id. Deliberately does NOT attempt to verify the doc's
"20-level cycle" framing — no per-card numeric level field could be found
anywhere in the archive (only the categorical risk tag and an unrelated
`Band` location number that doesn't correlate with risk at all), so that part
of the doc should be treated as unverified narrative, not a confirmed
mechanic.

Run: python3 verification/verify_risk_tier_bands.py [--archive PATH]
Expected (819 cards): low 46-61/53.6, medium 38-46/41.7, high 26-33/29.3,
extreme 17-23/19.4.
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

    # oid -> risk tier, from each card's `si-card risk-<tier>` wrapper.
    oid_risk = {}
    for row in records:
        ep = row.get("endpoint", "")
        if "panel.php" not in ep or "street_intel" not in ep:
            continue
        raw = row.get("responseBody")
        if not raw:
            continue
        try:
            html_body = json.loads(raw).get("html", "")
        except json.JSONDecodeError:
            continue
        for card_html in re.split(r"(?=si-card risk-)", html_body)[1:]:
            risk_m = re.match(r"si-card risk-(\w+)", card_html)
            oid_m = re.search(r"siScout\((\d+),this\)", card_html)
            if risk_m and oid_m:
                oid_risk[oid_m.group(1)] = risk_m.group(1)

    # oid -> base_pct, from the first revealed estimate in its scout response.
    oid_basepct = {}
    for row in records:
        if row.get("endpoint") != "POST /actions/street_intel.php":
            continue
        m = re.search(r"opportunity_id=(\d+)", row.get("requestBody", "") or "")
        if not m:
            continue
        try:
            resp = json.loads(row["responseBody"])
        except (json.JSONDecodeError, KeyError, TypeError):
            continue
        if not resp.get("ok") or "estimates" not in resp:
            continue
        for est in resp["estimates"]:
            if est.get("base_pct") is not None:
                oid_basepct[m.group(1)] = est["base_pct"]
                break

    by_tier = collections.defaultdict(list)
    for oid, bp in oid_basepct.items():
        tier = oid_risk.get(oid)
        if tier:
            by_tier[tier].append(bp)

    total = sum(len(v) for v in by_tier.values())
    print(f"Unique cards with both a known risk tier and a real base_pct: {total}\n")
    for tier in ("low", "medium", "high", "extreme"):
        vals = by_tier.get(tier, [])
        if not vals:
            continue
        print(f"  {tier:8s} n={len(vals):4d}  range {min(vals)}-{max(vals)}  mean {sum(vals) / len(vals):.1f}")


if __name__ == "__main__":
    main()
