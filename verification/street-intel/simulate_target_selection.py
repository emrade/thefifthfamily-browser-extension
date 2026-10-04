#!/usr/bin/env python3
"""Replays real Street Intel panel snapshots against alternative target-
selection policies, to answer "would a 'big targets only' mode make more
money than the auto-runner's current selection?"

What's replayed (all real, from the archives):
- every `panel.php?type=street_intel` snapshot in the window — which cards
  were on offer, when, and their reward range / stamina / scout cost;
- stamina income: the game's own regen (1 point per 234s) plus every large
  jump actually observed (refills, level-ups) at the time it happened,
  capped at the account's real max stamina;
- each card's best odds: its real scouted `estimate_pct`, plus hidden
  approaches scored with the exact formula (docs/street-intel-estimate-
  calculation.md) — the same thing `oddsMode: 'computed'` does. Validated:
  the computed best approach matches the real runner's chosen approach on
  2,228 of 2,235 historical attempts.

Each policy decides only at real snapshot times when off the 480s cooldown,
and is credited the *expected* net of a pick (reward midpoint x a
calibration curve fitted from real outcomes by odds bucket, net of
complication losses), not a sampled outcome — so policy differences aren't
luck. Baseline sanity check: the "current" policy simulates within ~5% of
the real net over the same window.

Policies:
- current: actionRunner.ts's findScoutedCandidate — scout every affordable
  card (reward/stamina order), pick highest EV among odds >= minPct.
- big-only filters: same, restricted to reward midpoint >= X or a risk tier.
- reserve: big-only unless stamina is above a fraction of max.
- lazy scouting: scout in order of each card's best-*possible* EV (pre-scout
  upper bound from risk-tier max base_pct and the account's max shared
  modifiers — violated by 7 of 7,645 real cards), stopping as soon as the
  best EV already found beats every remaining card's upper bound.

Run: python3 verification/street-intel/simulate_target_selection.py [--archive PATH ...] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
Last run (2026-10-04, window 2026-09-14..2026-10-04, net per *calendar* day
incl. archive gaps): current $18.2M; >=$1M only $6.5M; >=$750k only $13.4M;
high+extreme only $18.5M; lazy scouting $20.8M (scouting 203 -> 64
stamina/day); lazy + let >=$1M cards through down to 45% odds $22.5M.
Below-50% odds have only 8 real samples, so that last figure leans on
extrapolating the calibration curve.
"""

import argparse
import bisect
import collections
import datetime
import json
import re
import statistics

from _lib import add_archives_arg, load_endpoint_records, panel_html, parse_panel_cards, resolve_archive_paths

COOLDOWN_MS = 480_000
REGEN_PER_MS = 1 / 234_000
# Pre-scout upper bound inputs — max observed per risk tier / per modifier.
BASE_MAX = {"low": 61, "medium": 46, "high": 33, "extreme": 22}
SHARED_MAX = 12 + 10 + 12 + 4.5 + 19.5 + 8  # rank, prestige, mastery, collection, recon, env_global
# Real realized net / reward-midpoint by scouted odds (fit 2026-10-04).
CALIBRATION = [(0, 0), (45, 0.45), (55, 0.55), (65, 0.70), (75, 0.75), (85, 0.88), (95, 0.99)]


def calib(pct):
    for (x1, y1), (x2, y2) in zip(CALIBRATION, CALIBRATION[1:]):
        if pct <= x2:
            return y1 + (y2 - y1) * (pct - x1) / (x2 - x1)
    return CALIBRATION[-1][1]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_archives_arg(parser)
    parser.add_argument("--since", default="2026-09-14")
    parser.add_argument("--until", default=None, help="exclusive end date (default: newest data)")
    args = parser.parse_args()
    paths = resolve_archive_paths(args)
    print(f"Loading {len(paths)} archive(s)...")
    rows = load_endpoint_records(paths, ["street_intel", "stats.php", "attack.php", "crimes.php", "career.php"])

    cards, panels = {}, []
    stats_snaps, stamina_tl = [], []
    for row in rows:
        ep = row.get("endpoint", "")
        if "type=street_intel" in ep:
            snap = parse_panel_cards(panel_html(row))
            cards.update(snap)
            panels.append((row["timestamp"], list(snap)))
            continue
        try:
            body = json.loads(row.get("responseBody") or "")
        except json.JSONDecodeError:
            continue
        stats = body.get("stats") if isinstance(body, dict) and isinstance(body.get("stats"), dict) else None
        if stats and "stamina" in stats:
            stamina_tl.append((row["timestamp"], stats["stamina"], stats.get("max_stamina")))
        if stats and "strength" in stats:
            stats_snaps.append((row["timestamp"], stats))
    stamina_tl.sort()
    stats_snaps.sort(key=lambda x: x[0])
    stats_ts = [t for t, _ in stats_snaps]

    def raw_stats_at(t):
        return stats_snaps[max(0, bisect.bisect_right(stats_ts, t) - 1)][1]

    # Best odds per card: real reveals + formula-computed hidden approaches.
    best = {}
    for row in rows:
        if row.get("endpoint") != "POST /actions/street_intel.php" or "action=scout" not in (row.get("requestBody") or ""):
            continue
        try:
            resp = json.loads(row["responseBody"])
        except (json.JSONDecodeError, KeyError, TypeError):
            continue
        if not resp.get("ok"):
            continue
        oid = int(re.search(r"opportunity_id=(\d+)", row["requestBody"]).group(1))
        ests, seed = {}, None
        for e in resp.get("estimates") or []:
            if e.get("estimate_pct") is not None and e.get("revealed", True) is not False:
                ests[e["key"]] = e["estimate_pct"]
                seed = seed or e
        card = cards.get(oid)
        if seed and card and seed.get("modifiers"):
            shared = sum(v for k, v in seed["modifiers"].items() if k not in ("stat", "approach", "env_stat"))
            raw = raw_stats_at(row["timestamp"])
            for a in card["approaches"]:
                if a["key"] in ests:
                    continue
                if a.get("autofail"):
                    ests[a["key"]] = 0
                    continue
                r = seed["base_pct"] * (1 + (shared + raw.get(a["stat"], 0) / 5) / 100) + a.get("bonus", 0)
                ests[a["key"]] = max(0, min(95, int(r + 0.5)))
        if ests:
            best[oid] = max(best.get(oid, 0), max(ests.values()))
    tier_median = collections.defaultdict(list)
    for oid, e in best.items():
        if oid in cards:
            tier_median[cards[oid]["risk"]].append(e)
    tier_median = {k: statistics.median(v) for k, v in tier_median.items()}

    start = datetime.datetime.strptime(args.since, "%Y-%m-%d").timestamp() * 1000
    end = datetime.datetime.strptime(args.until, "%Y-%m-%d").timestamp() * 1000 if args.until else panels[-1][0] + 1
    P = [p for p in panels if start <= p[0] < end]
    days = (end - start) / 86400e3
    refills = [(t2, s2 - s1) for (t1, s1, _), (t2, s2, _) in zip(stamina_tl, stamina_tl[1:]) if s2 - s1 > 10 and t2 - t1 < 300_000 and start <= t2 < end]
    max_tl = [(t, m) for t, _, m in stamina_tl if m]
    max_ts = [t for t, _ in max_tl]
    s0 = stamina_tl[bisect.bisect_left([x[0] for x in stamina_tl], start)][1]

    def mid(c):
        return (c["reward_min"] + c["reward_max"]) / 2

    def ub_pct(c, t):
        raw = raw_stats_at(t)
        u = 0
        for a in c["approaches"]:
            if a.get("autofail"):
                continue
            r = BASE_MAX[c["risk"]] * (1 + (SHARED_MAX + raw.get(a["stat"], 0) / 5 + 5) / 100) + a.get("bonus", 0)
            u = max(u, min(95, round(r)))
        return u

    def run(filt=lambda c, s, cap: True, min_pct=52, lazy=False, big_min_pct=None):
        stam, t_prev, cd_until, ri = s0, P[0][0], 0, 0
        scouted, done = set(), set()
        net = n = scout_spent = wasted = 0
        bands = collections.Counter()

        def bar(c):
            return big_min_pct if big_min_pct is not None and mid(c) >= 1e6 else min_pct

        for t, oids in P:
            stam += REGEN_PER_MS * (t - t_prev)
            t_prev = t
            while ri < len(refills) and refills[ri][0] <= t:
                stam += refills[ri][1]
                ri += 1
            cap = max_tl[max(0, bisect.bisect_right(max_ts, t) - 1)][1]
            if stam > cap:
                wasted += stam - cap
                stam = cap
            if t < cd_until:
                continue
            cands = [dict(cards[o], id=o) for o in oids if o not in done and cards[o]["stamina"] and cards[o]["reward_min"] and cards[o]["approaches"]]
            cands = [c for c in cands if filt(c, stam, cap) and stam >= (0 if c["id"] in scouted else c["scout_cost"]) + c["stamina"]]
            spent, cleared = 0, []
            if lazy:
                cands.sort(key=lambda c: -ub_pct(c, t) * mid(c))
            else:
                cands.sort(key=lambda c: -mid(c) / c["stamina"])
            for c in cands:
                if lazy:
                    found = max((e * mid(x) for e, x in cleared if x["stamina"] <= stam - spent), default=-1)
                    if found >= ub_pct(c, t) * mid(c):
                        break
                if c["id"] not in scouted:
                    need = c["scout_cost"] + (c["stamina"] if lazy else 0)
                    if stam - spent < need:
                        continue
                    spent += c["scout_cost"]
                    scouted.add(c["id"])
                e = best.get(c["id"], tier_median[c["risk"]])
                if e >= bar(c):
                    cleared.append((e, c))
            stam -= spent
            scout_spent += spent
            cleared.sort(key=lambda ec: -ec[0] * mid(ec[1]))
            pick = next(((e, c) for e, c in cleared if c["stamina"] <= stam), None)
            if pick:
                e, c = pick
                stam -= c["stamina"]
                net += mid(c) * calib(e)
                n += 1
                done.add(c["id"])
                cd_until = t + COOLDOWN_MS
                bands[">=1M" if mid(c) >= 1e6 else "750k-1M" if mid(c) >= 7.5e5 else "<750k"] += 1
        return net / days, n / days, scout_spent / days, wasted / days, {k: round(v / days, 1) for k, v in sorted(bands.items())}

    big = lambda th: (lambda c, s, cap: mid(c) >= th)
    reserve = lambda th, frac: (lambda c, s, cap: mid(c) >= th or s > frac * cap)
    policies = [
        ("current (all targets)", {}),
        ("current, minPct 45", dict(min_pct=45)),
        ("current, minPct 60", dict(min_pct=60)),
        ("big only: mid >= $1M", dict(filt=big(1e6))),
        ("big only: mid >= $750k", dict(filt=big(7.5e5))),
        ("big only: mid >= $500k", dict(filt=big(5e5))),
        ("high + extreme only", dict(filt=lambda c, s, cap: c["risk"] in ("high", "extreme"))),
        ("extreme only", dict(filt=lambda c, s, cap: c["risk"] == "extreme")),
        ("reserve: >=$750k unless stamina >40%", dict(filt=reserve(7.5e5, 0.4))),
        ("LAZY scouting", dict(lazy=True)),
        ("LAZY + high + extreme only", dict(lazy=True, filt=lambda c, s, cap: c["risk"] in ("high", "extreme"))),
        ("LAZY + reserve >=$750k unless >25%", dict(lazy=True, filt=reserve(7.5e5, 0.25))),
        ("LAZY + >=$1M cards down to 45% odds", dict(lazy=True, big_min_pct=45)),
    ]
    print(f"\nWindow {args.since} .. {datetime.datetime.utcfromtimestamp(end / 1000).date()} ({days:.1f} calendar days, {len(P)} snapshots, refill income {sum(r[1] for r in refills) / days:.0f}/day)")
    print("Net is per calendar day including archive gaps, so compare policies to each other, not to a single real day.\n")
    for name, kw in policies:
        net, att, sc, wasted, bands = run(**kw)
        print(f"{name:38s} net/day ${net / 1e6:6.2f}M  att/day {att:5.1f}  scout stamina/day {sc:4.0f}  wasted/day {wasted:4.0f}  {bands}")


if __name__ == "__main__":
    main()
