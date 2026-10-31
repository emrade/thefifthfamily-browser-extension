#!/usr/bin/env python3
"""Builds src/shared/data/streetIntelAnalyticsSeed.json — the history the
Street Intel Analytics tab starts from (see
src/background/features/streetIntel/analytics/).

Writes, from every archive combined:

- `attempts`: every `ok:true` attempt since `--since` (manual and automated),
  with its card (from the latest panel that showed it), its complication
  outcome and cash lost, and its loot drops.
- `cards`: every card first seen on the board in the last `--card-days` days
  before the cutoff — only the recent board feeds the supply numbers and the
  suggested minimum, so older cards would just be dead weight in the bundle.
- `scoutStamina`: Stamina spent on paid scouts (`cached:true` re-scouts are
  free) per game day.
- `prices`: the latest `dispose_quote` cash for every item name quoted.
- `cutoff`: the newest archived row. The extension replays its own request
  archive after this and records live traffic from there, so nothing is
  counted twice.

Run: python3 verification/street-intel/build_analytics_seed.py [--archive PATH ...] [--since YYYY-MM-DD]
"""

import argparse
import datetime
import json
import os
import re

from _lib import add_archives_arg, load_endpoint_records, panel_html, parse_panel_cards, resolve_archive_paths

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "src", "shared", "data", "streetIntelAnalyticsSeed.json")
RISKS = ("low", "medium", "high", "extreme")


def game_day(ts_ms):
    # The game's day turns over at 23:00 UTC (the player's midnight, WAT).
    return (datetime.datetime.fromtimestamp(ts_ms / 1000, datetime.UTC) + datetime.timedelta(hours=1)).strftime("%Y-%m-%d")


def drop_of(d):
    if not d:
        return None
    return [d.get("name") or "", d.get("quality"), d.get("type"), 1 if d.get("header") else 0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_archives_arg(parser)
    parser.add_argument("--since", default="2026-10-01", help="first game day of attempts to include")
    parser.add_argument("--card-days", type=int, default=10, help="days of board history to include")
    args = parser.parse_args()

    rows = load_endpoint_records(resolve_archive_paths(args), ["street_intel", "POST /actions/shops_v2.php"])
    cutoff = max(r["timestamp"] for r in rows)
    card_from = cutoff - args.card_days * 86_400_000

    cards, first_seen, last_seen = {}, {}, {}
    prices = {}
    scout_stamina = {}
    attempts = {}
    for row in rows:
        ep = row.get("endpoint") or ""
        t = row["timestamp"]
        if "type=street_intel" in ep:
            for oid, c in parse_panel_cards(panel_html(row)).items():
                if not c.get("reward_min") or not c.get("stamina"):
                    continue
                cards[oid] = c
                first_seen.setdefault(oid, t)
                last_seen[oid] = t
            continue
        body = row.get("requestBody") or ""
        try:
            resp = json.loads(row.get("responseBody") or "")
        except json.JSONDecodeError:
            continue
        if not isinstance(resp, dict) or not resp.get("ok"):
            continue
        if ep == "POST /actions/shops_v2.php":
            if "action=dispose_quote" in body and resp.get("name") and isinstance(resp.get("cash"), (int, float)):
                prices[resp["name"].lower()] = resp["cash"]
            continue
        if game_day(t) < args.since:
            continue
        oid_m = re.search(r"opportunity_id=(\d+)", body)
        if not oid_m:
            continue
        oid = int(oid_m.group(1))
        if "action=scout" in body:
            if not resp.get("cached"):
                d = game_day(t)
                scout_stamina[d] = scout_stamina.get(d, 0) + (resp.get("scout_cost") or 1)
        elif "action=attempt" in body:
            c = cards.get(oid)
            drops = [x for x in (drop_of(resp.get("loot_drop")), drop_of(resp.get("hw26Drop"))) if x]
            attempts[oid] = [
                oid, t, 0 if row.get("origin") == "page" else 1,
                resp.get("outcome_band") or "", resp.get("reward_cash") or 0, resp.get("jail_time") or 0,
                1 if resp.get("has_complication") else 0, None, 0, drops,
                RISKS.index(c["risk"]) if c else None, (1 if c["legendary"] else 0) if c else None,
                c["reward_min"] if c else None, c["reward_max"] if c else None,
                c["stamina"] if c else None, c["scout_cost"] if c else None,
            ]
        elif "action=complication" in body and resp.get("comp_success") is not None and oid in attempts:
            a = attempts[oid]
            a[7] = 1 if resp["comp_success"] else 0
            if not resp["comp_success"]:
                a[8] = (resp.get("cash_lost_from_hand") or 0) + (resp.get("cash_lost_from_bank") or 0) or (resp.get("cash_lost") or 0)
            a[9] = a[9] + [x for x in (drop_of(resp.get("loot_drop")), drop_of(resp.get("hw26Drop"))) if x]

    card_rows = [
        [oid, first_seen[oid], last_seen[oid], RISKS.index(c["risk"]), 1 if c["legendary"] else 0,
         c["reward_min"], c["reward_max"], c["stamina"], c["scout_cost"]]
        for oid, c in cards.items() if first_seen[oid] >= card_from
    ]
    seed = {
        "cutoff": cutoff,
        "attempts": sorted(attempts.values(), key=lambda a: a[1]),
        "cards": sorted(card_rows, key=lambda c: c[1]),
        "scoutStamina": dict(sorted(scout_stamina.items())),
        "prices": dict(sorted(prices.items())),
    }
    with open(OUT, "w") as f:
        json.dump(seed, f, separators=(",", ":"))
    print(f"cutoff {cutoff} ({datetime.datetime.fromtimestamp(cutoff / 1000, datetime.UTC).isoformat()})")
    print(f"{len(seed['attempts'])} attempts since {args.since}, {len(card_rows)} cards, {len(prices)} prices, {os.path.getsize(OUT):,} bytes -> {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
