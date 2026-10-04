#!/usr/bin/env python3
"""Street Intel daily profit, stamina budget, and profit-per-stamina by
target size — across every archive combined.

Answers "how much does Street Intel actually make per day, where does the
stamina go, and which targets pay best per stamina":

1. Per player-day (WAT): attempts, gross reward, cash lost to complications,
   net. Cross-check: the export's own `cashToday` in
   `ff_street_intel_auto_status` is the gross column for the current day.
2. Stamina: measured regen rate (also exposed directly as
   `regen_rates.stamina`, seconds per point, in `GET stats.php`), and per-day
   spend split into attempts vs fresh scouts (a `cached: true` re-scout is
   free — confirmed by bracketing single scouts between stats readings) vs
   `attack.php` (5 stamina each).
3. Profit per stamina by risk tier and by reward-midpoint band, over the
   recent regime (default: since 2026-09-14).

Run: python3 verification/street-intel/analyze_profit_and_stamina.py [--archive PATH ...] [--since YYYY-MM-DD]
Last run (2026-10-04): full days since 09-07 net ~$18-29M from ~55-70
attempts; regen 15.4/hr (1 per 234s) + ~430/day from refills/level-ups;
fresh scouting ~30% of all stamina spent (~200-380/day); net per stamina
low $14k, medium $28k, high $37k, extreme $64k, $1M+ midpoint $84-96k.
"""

import argparse
import collections
import datetime
import json

from _lib import add_archives_arg, build_attempts, load_endpoint_records, player_day, resolve_archive_paths


def stamina_timeline(rows):
    out = []
    for row in rows:
        try:
            body = json.loads(row.get("responseBody") or "")
        except json.JSONDecodeError:
            continue
        if not isinstance(body, dict):
            continue
        stats = body.get("stats") if isinstance(body.get("stats"), dict) else None
        if stats and "stamina" in stats:
            out.append((row["timestamp"], stats["stamina"], stats.get("max_stamina")))
    out.sort()
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_archives_arg(parser)
    parser.add_argument("--since", default="2026-09-14", help="start of the 'recent regime' for the per-tier table")
    args = parser.parse_args()
    paths = resolve_archive_paths(args)
    print(f"Loading {len(paths)} archive(s)...")
    rows = load_endpoint_records(paths, ["street_intel", "stats.php", "attack.php", "crimes.php", "career.php"])
    attempts = build_attempts(rows)

    # --- 1. daily profit ---
    by_day = collections.defaultdict(list)
    for a in attempts:
        by_day[player_day(a["t"])].append(a)
    print("\nday         att        gross         lost          net    >=$1M rewards")
    for d in sorted(by_day):
        L = by_day[d]
        g = sum(a["reward"] for a in L)
        lost = sum(a["lost"] for a in L)
        print(f"{d} {len(L):5d} {g:12,.0f} {lost:12,.0f} {g - lost:12,.0f} {sum(a['reward'] >= 1e6 for a in L):6d}")
    print("(days with few attempts are usually archive gaps, not quiet days)")

    # --- 2. stamina ---
    tl = stamina_timeline(rows)
    regen_samples = []
    for row in rows:
        if "stats.php" in row.get("endpoint", ""):
            try:
                rr = json.loads(row["responseBody"]).get("regen_rates", {})
            except (json.JSONDecodeError, KeyError, TypeError, AttributeError):
                continue
            if rr.get("stamina"):
                regen_samples.append(rr["stamina"])
    if regen_samples:
        latest = regen_samples[-1]
        print(f"\nStamina regen (stats.php regen_rates.stamina): 1 per {latest}s = {3600 / latest:.1f}/hr = {86400 / latest:.0f}/day")

    spend = collections.defaultdict(collections.Counter)
    for row in rows:
        ep = row.get("endpoint", "")
        d = player_day(row["timestamp"])
        if ep == "POST /actions/street_intel.php" and "action=scout" in (row.get("requestBody") or ""):
            try:
                resp = json.loads(row["responseBody"])
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
            if resp.get("ok"):
                spend[d]["scouts"] += 1
                if not resp.get("cached"):
                    spend[d]["scout_st"] += resp.get("scout_cost") or 0
        elif ep == "POST /actions/attack.php":
            spend[d]["attack_st"] += 5
    for a in attempts:
        spend[player_day(a["t"])]["attempt_st"] += a["stamina"] or 0
    for (t1, s1, _), (t2, s2, _) in zip(tl, tl[1:]):
        if s2 - s1 > 10 and t2 - t1 < 300_000:
            spend[player_day(t2)]["refill"] += s2 - s1

    print("\nday        attempt_st  scout_st  attack_st  refills_in   scout share")
    for d in sorted(spend):
        s = spend[d]
        total = s["attempt_st"] + s["scout_st"] + s["attack_st"]
        if total < 100:
            continue
        print(f"{d} {s['attempt_st']:10d} {s['scout_st']:9d} {s['attack_st']:10d} {s['refill']:11d}   {100 * s['scout_st'] / total:5.0f}%")

    # --- 3. profit per stamina ---
    since = datetime.datetime.strptime(args.since, "%Y-%m-%d").timestamp() * 1000
    recent = [a for a in attempts if a["t"] >= since and a["stamina"] and a["reward_min"]]
    mid = lambda a: (a["reward_min"] + a["reward_max"]) / 2

    def line(label, L):
        if not L:
            return
        st = sum(a["stamina"] for a in L)
        net = sum(a["net"] for a in L)
        win = sum(a["band"] in ("success", "critical_success", "partial_success") for a in L)
        print(
            f"{label:20s} n={len(L):4d}  stam/att={st / len(L):5.1f}  win={100 * win / len(L):3.0f}%  "
            f"avg net=${net / len(L):>10,.0f}  net/stamina=${net / st:>7,.0f}"
        )

    print(f"\nProfit per stamina since {args.since} (attempt stamina only, before scouting overhead):")
    for r in ("low", "medium", "high", "extreme"):
        line(r, [a for a in recent if a["risk"] == r and not a["legendary"]])
    line("legendary", [a for a in recent if a["legendary"]])
    for lo, hi in [(0, 1e5), (1e5, 3e5), (3e5, 6e5), (6e5, 1e6), (1e6, 2e6), (2e6, 1e12)]:
        line(f"mid ${lo / 1e3:.0f}k-{hi / 1e3:.0f}k", [a for a in recent if lo <= mid(a) < hi])


if __name__ == "__main__":
    main()
