#!/usr/bin/env python3
"""How the Street Intel auto-runner's newer modes are doing on live play,
against the original behaviour — straight from the request archives.

Built for the 0.36.0 modes (Smart scouting, Smart complication choices, and
top-2-by-payout replacing scout-everything). Nothing here needs the
extension's own data export: which behaviour actually ran is read off the
requests themselves.

- **Scouting mode, per cycle.** Background scout/attempt calls less than 60s
  apart are one cycle. The original runner scouted every affordable card
  (typically 3-12 per cycle); top 2 by payout scouts at most 2; Smart often
  just 1. A day is labelled "new" when nearly every cycle scouted 2 or fewer.
- **Complication overrides.** When the attempt's own approach was fight, run
  or talk, the original rule always reused it — a different choice by the
  auto-runner can only be Smart complication choices avoiding a known loser.
  (Overrides after a steel_yourself attempt can't be told apart from the
  original fallback, so they aren't counted; manual in-game picks are
  ignored.)

Everything is compared **per Stamina** (net after complication losses,
divided by Stamina spent on attempts *and* paid scouts). Daily totals swing
with consumables (refills, drinks), level-ups and how long the extension
ran; net per Stamina doesn't, so partial days count fully and a day with
extra consumables isn't flattered.

Also checks that smart scouting didn't skip anything obviously better: for
each attempt, whether an affordable card worth 1.5x+ the one taken was on
the panel but never scouted.

Run: python3 verification/street-intel/analyze_live_modes.py [--archive PATH ...] [--since YYYY-MM-DD]

`--since` (default: 2026-09-14, the start of the current reward regime)
limits the "before" side to comparable days. Days are the player's own
(WAT, UTC+1).

First run (2026-10-05, one day of new modes): scouting 30% -> 9% of
Stamina (6.7 -> 1.15 scouts per attempt), net per Stamina $28.7k -> $33.3k,
complications 134/192 -> 10/11 won, no bigger card skipped. One day is
within the old day-to-day range ($23.7k-$36.3k), so re-run after a few more.
"""

import argparse
import bisect
import collections
import datetime
import json
import re

from _lib import add_archives_arg, load_endpoint_records, panel_html, parse_panel_cards, player_day, resolve_archive_paths

CYCLE_GAP_MS = 60_000
# Days with fewer attempts than this still count in the totals (everything is
# per Stamina) but not in the day-to-day range, where a 2-attempt day is noise.
RANGE_MIN_ATTEMPTS = 20
CHOICES = ("fight", "run", "talk")


def parse(row):
    try:
        body = json.loads(row.get("responseBody") or "")
    except json.JSONDecodeError:
        return None
    return body if isinstance(body, dict) else None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_archives_arg(parser)
    parser.add_argument("--since", default="2026-09-14")
    args = parser.parse_args()
    paths = resolve_archive_paths(args)
    print(f"Loading {len(paths)} archive(s)...")
    rows = load_endpoint_records(paths, ["street_intel", "stats.php"])

    cards, panels = {}, []
    actions = []  # (ts, action, oid, origin, request body, response)
    stamina = []  # (ts, stamina)
    for row in rows:
        ep = row.get("endpoint") or ""
        ts = row.get("timestamp")
        if "type=street_intel" in ep:
            snap = parse_panel_cards(panel_html(row))
            cards.update(snap)
            panels.append((ts, list(snap)))
            continue
        body = parse(row)
        if body is None:
            continue
        stats = body.get("stats") if isinstance(body.get("stats"), dict) else None
        if stats and "stamina" in stats:
            stamina.append((ts, stats["stamina"]))
        if ep == "POST /actions/street_intel.php":
            req = row.get("requestBody") or ""
            a = re.search(r"action=(\w+)", req)
            o = re.search(r"opportunity_id=(\d+)", req)
            actions.append((ts, a.group(1) if a else None, int(o.group(1)) if o else None, row.get("origin"), req, body))
    stamina.sort()
    panel_ts = [p[0] for p in panels]
    mid = lambda c: (c["reward_min"] + c["reward_max"]) / 2

    days = collections.defaultdict(collections.Counter)

    # --- cycles (background only) ---
    cycle_sizes = collections.defaultdict(list)
    cur = []
    bg = [x for x in actions if x[3] == "background" and x[1] in ("scout", "attempt")]
    for x in bg + [None]:
        if cur and (x is None or x[0] - cur[-1][0] > CYCLE_GAP_MS):
            if any(y[1] == "attempt" for y in cur):
                cycle_sizes[player_day(cur[0][0])].append(sum(1 for y in cur if y[1] == "scout"))
            cur = []
        if x is not None:
            cur.append(x)

    # --- scouts, attempts, complications ---
    complication_for = {}
    for ts, act, oid, origin, req, body in actions:
        if act == "complication" and body.get("ok") and body.get("comp_success") is not None:
            ch = re.search(r"choice=(\w+)", req)
            complication_for.setdefault(oid, (ch.group(1) if ch else None, body, origin))
    scouted = set()
    for ts, act, oid, origin, req, body in actions:
        d = days[player_day(ts)]
        if act == "scout" and body.get("ok"):
            d["scouts"] += 1
            scouted.add(oid)
            if not body.get("cached"):
                d["scout_st"] += body.get("scout_cost") or 0
        if act != "attempt" or not body.get("ok"):
            continue
        card = cards.get(oid)
        if not card or not card["stamina"]:
            continue
        ap = re.search(r"approach=(\w+)", req)
        approach = ap.group(1) if ap else None
        reward = body.get("reward_cash") or 0
        d["att"] += 1
        d["att_st"] += card["stamina"]
        d["gross"] += reward
        d["win"] += body.get("outcome_band") in ("success", "critical_success", "partial_success")
        d["card_mid"] += mid(card)
        comp = complication_for.get(oid)
        if body.get("has_complication") and comp:
            choice, cb, comp_origin = comp
            d["cplx"] += 1
            if cb["comp_success"]:
                d["cplx_won"] += 1
            else:
                d["lost"] += (cb.get("cash_lost_from_hand") or 0) + (cb.get("cash_lost_from_bank") or 0) or (cb.get("cash_lost") or 0)
            # Only the auto-runner's own choices — a manual pick in-game can
            # differ from the attempt approach for any reason.
            if comp_origin == "background" and approach in CHOICES and choice != approach:
                d["overrides"] += 1
                d["overrides_won"] += 1 if cb["comp_success"] else 0
        # Skipped-bigger check: an affordable 1.5x+ card on the panel, never scouted.
        i = bisect.bisect_right(panel_ts, ts) - 1
        after = (body.get("stats") or {}).get("stamina")
        if i >= 0 and after is not None:
            budget = after + card["stamina"]
            for o in panels[i][1]:
                c = cards.get(o)
                if c and c["reward_min"] and c["stamina"] and o not in scouted and c["stamina"] <= budget and mid(c) >= 1.5 * mid(card):
                    d["skipped_bigger"] += 1
                    break

    for (t1, s1), (t2, s2) in zip(stamina, stamina[1:]):
        if s2 - s1 > 10 and t2 - t1 < 300_000:
            days[player_day(t2)]["refills"] += s2 - s1

    # --- per-day table ---
    def label(d):
        sizes = cycle_sizes.get(d, [])
        if not sizes:
            return "—"
        small = sum(1 for s in sizes if s <= 2) / len(sizes)
        ones = sum(1 for s in sizes if s <= 1) / len(sizes)
        if small < 0.9:
            return "scout all"
        return "smart" if ones >= 0.5 else "top 2"

    print("\nday         scouting   att  scouts/att  scout%  net/stamina  net $M  cplx won  overrides  skipped  refills")
    groups = collections.defaultdict(list)
    for day in sorted(days):
        if day < args.since:
            continue
        d = days[day]
        if d["att"] == 0:
            continue
        st = d["scout_st"] + d["att_st"]
        net = d["gross"] - d["lost"]
        lab = label(day)
        groups["new" if lab in ("smart", "top 2") else "old"].append(d)
        print(
            f"{day}  {lab:9s} {d['att']:4d}  {d['scouts'] / d['att']:9.2f}  {100 * d['scout_st'] / st:5.0f}%"
            f"  {net / st / 1e3:9.1f}k  {net / 1e6:6.2f}  {d['cplx_won']:3d}/{d['cplx']:<3d}  {d['overrides_won']:3d}/{d['overrides']:<3d}"
            f"  {d['skipped_bigger']:6d}  {d['refills']:6d}"
        )

    # --- before vs after ---
    print()
    for name in ("old", "new"):
        L = groups.get(name, [])
        if not L:
            print(f"{name}: no days")
            continue
        s = lambda k: sum(d[k] for d in L)
        st = s("scout_st") + s("att_st")
        net = s("gross") - s("lost")
        full = [d for d in L if d["att"] >= RANGE_MIN_ATTEMPTS] or L
        per_day = sorted((d["gross"] - d["lost"]) / (d["scout_st"] + d["att_st"]) / 1e3 for d in full)
        print(
            f"{'before (scout all)' if name == 'old' else 'after (new modes)':20s} {len(L):2d} day(s): net/stamina ${net / st / 1e3:.1f}k"
            f" (days with {RANGE_MIN_ATTEMPTS}+ attempts: {per_day[0]:.1f}k-{per_day[-1]:.1f}k), scouting {100 * s('scout_st') / st:.0f}% of stamina,"
            f" {s('scouts') / s('att'):.2f} scouts/attempt, complications {s('cplx_won')}/{s('cplx')} won,"
            f" lost ${s('lost') / len(L) / 1e6:.2f}M/day, avg card ${s('card_mid') / s('att') / 1e3:.0f}k, win {100 * s('win') / s('att'):.0f}%"
        )
    if groups.get("new") and len(groups["new"]) < 4:
        print("\nOnly a few new-mode days so far: a day's net/stamina swings a lot on its own — "
              "compare against the 'before' day range, and re-run after more days.")


if __name__ == "__main__":
    main()
