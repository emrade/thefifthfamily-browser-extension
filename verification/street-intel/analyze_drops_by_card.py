#!/usr/bin/env python3
"""Street Intel cash *and drops* per Stamina, by value band and by card.

Backs docs/street-intel-drops-by-card.md. The Analytics tab's minimum-card
suggestion compares cash only; this adds the estimated sale value of drops,
valued the same way the extension does (src/shared/streetIntelAnalytics.ts
`dropValue`: the item's last dispose_quote, else a typical quote for its
quality; banner drops, consumables, cash boxes and currencies count 0).

1. By value band (<$850k, $850k-999k, $1M+) for today, 7 and 30 days.
2. By card (midpoint, risk, legendary) at $800k+ over 30 days: tries,
   Stamina per try, gold-or-better drops per try, underworld epics, success
   rate, cash/S, drops/S, total/S.

Cash is net of complication losses. Stamina is the card's attempt cost (no
scouting), so cash/S here runs higher than the Analytics tab's.

Run: python3 -I verification/street-intel/analyze_drops_by_card.py [--seed FILE] [--since YYYY-MM-DD] [--asof YYYY-MM-DD]
Without --seed it builds one with build_analytics_seed.py from every archive.
--asof is the game day the "today" row and the 7/30-day windows end on
(default: the seed's last day).
"""

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
RISKS = ["low", "medium", "high", "extreme"]
# Mirrors QUALITY_TYPICAL_PRICE / NON_ITEM_DROP_TYPES in src/shared/streetIntelAnalytics.ts.
QUALITY_TYPICAL_PRICE = {"gold": 33_300_000, "underworld_epic": 15_625_000, "purple": 1_890_000,
                         "infamous_rare": 550_000, "blue": 240_000, "green": 18_400, "grey": 21_000}
NON_ITEM = {"consumable", "cash_box", "platinum", "mafia_gold"}
GOLD_PLUS = {"gold", "crowned_legendary"}

# Seed attempt row (build_analytics_seed.py): [oid, ts, _, outcome, cash, _, _, comp_success,
#   cash_lost, drops, risk, legendary, reward_min, reward_max, stamina, scout_cost]
# drop: [name, quality, type, header]


def game_day_start(day):
    """The game's day begins 23:00 UTC the evening before (player midnight, WAT)."""
    return (dt.datetime.combine(day, dt.time(), dt.timezone.utc) - dt.timedelta(hours=1)).timestamp() * 1000


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--seed")
    p.add_argument("--since", default=None, help="first game day loaded when building a seed (default: asof - 31 days)")
    p.add_argument("--asof", default=None)
    args = p.parse_args()

    seed = args.seed
    if not seed:
        since = args.since or ((dt.date.fromisoformat(args.asof) if args.asof else dt.date.today()) - dt.timedelta(days=31)).isoformat()
        seed = os.path.join(tempfile.mkdtemp(prefix="si-drops-"), "seed.json")
        subprocess.run([sys.executable, os.path.join(HERE, "build_analytics_seed.py"), "--since", since,
                        "--card-days", "1", "--out", seed], check=True, cwd=HERE)
    d = json.load(open(seed))
    prices = d["prices"]

    def value(x):
        name, quality, typ, header = x
        if header or typ in NON_ITEM:
            return 0
        return prices.get(name.lower(), QUALITY_TYPICAL_PRICE.get(quality or "", 0))

    last = dt.datetime.fromtimestamp(d["cutoff"] / 1000 + 3600, dt.timezone.utc).date()
    asof = dt.date.fromisoformat(args.asof) if args.asof else last
    end = game_day_start(asof + dt.timedelta(days=1))
    attempts = [a for a in d["attempts"] if a[12] is not None and a[1] < end]
    print(f"seed {seed}; data to {dt.datetime.fromtimestamp(d['cutoff'] / 1000, dt.timezone.utc):%Y-%m-%d %H:%M} UTC; as of game day {asof}")

    def band(a):
        m = (a[12] + a[13]) / 2
        return "<$850k" if m < 849_000 else "$850k-999k" if m < 1_000_000 else "$1M+"

    for label, days in (("today", 1), ("last 7 days", 7), ("last 30 days", 30)):
        start = game_day_start(asof - dt.timedelta(days=days - 1))
        g = defaultdict(lambda: [0, 0, 0.0, 0.0])
        for a in attempts:
            if a[1] < start:
                continue
            r = g[band(a)]
            r[0] += 1
            r[1] += a[14]
            r[2] += a[4] - (a[8] or 0)
            r[3] += sum(value(x) for x in a[9])
        total = sum(r[3] for r in g.values()) or 1
        print(f"\n== {label}: drop value ${total / 1e6:.1f}M")
        print(f"{'band':12}{'tries':>6}{'Stam':>7}{'cash/S':>9}{'drops':>9}{'drop/S':>9}{'total/S':>9}{'share':>7}")
        for b in ("<$850k", "$850k-999k", "$1M+"):
            if b in g:
                n, s, c, v = g[b]
                print(f"{b:12}{n:6}{s:7.0f}{c / s / 1e3:8.1f}k{v / 1e6:8.1f}M{v / s / 1e3:8.1f}k{(c + v) / s / 1e3:8.1f}k{v / total * 100:6.0f}%")

    start = game_day_start(asof - dt.timedelta(days=29))
    g = defaultdict(lambda: [0, 0, 0, 0, 0.0, 0.0, 0])
    for a in attempts:
        m = (a[12] + a[13]) / 2
        if a[1] < start or m < 800_000:
            continue
        r = g[(round(m / 1e3), RISKS[a[10]], "LEG" if a[11] else "")]
        r[0] += 1
        r[1] += a[14]
        r[2] += sum(1 for x in a[9] if x[1] in GOLD_PLUS and not x[3])
        r[3] += sum(1 for x in a[9] if x[1] == "underworld_epic" and not x[3])
        r[4] += sum(value(x) for x in a[9])
        r[5] += a[4] - (a[8] or 0)
        r[6] += 1 if a[3] in ("success", "partial_success") else 0
    print("\n== by card, $800k+, last 30 days (10+ tries)")
    print(f"{'card $k':>8} {'risk':8}{'':4}{'tries':>6}{'S':>4}{'gold+':>6}{'/try':>6}{'UWepic':>7}{'ok%':>5}{'cash/S':>8}{'drop/S':>8}{'total/S':>8}")
    for k, (n, s, gp, ue, v, c, ok) in sorted(g.items()):
        if n >= 10:
            print(f"{k[0]:8} {k[1]:8}{k[2]:4}{n:6}{s / n:4.0f}{gp:6}{gp / n:6.2f}{ue:7}{ok / n * 100:5.0f}"
                  f"{c / s / 1e3:7.0f}k{v / s / 1e3:7.0f}k{(c + v) / s / 1e3:7.0f}k")


if __name__ == "__main__":
    main()
