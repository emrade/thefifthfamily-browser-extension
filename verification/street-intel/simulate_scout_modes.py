#!/usr/bin/env python3
"""Replays the archive against the four Street Intel scouting options:

- top2:   scout the 2 highest-paying affordable cards, pick the best EV that
          clears the success floor (scoutMode 'topPayout', today's default)
- smart:  scout in order of each card's best *possible* EV (risk-tier max
          base, best possible conditions), stop once the best EV found beats
          every remaining card's bound (scoutMode 'smart')
- exact:  as smart, but ranked by each card's exact pre-scout odds (wiki base
          + the card's condition sentence + the player's modifiers, see
          build_intel_tables.py) and never scouting a card predicted under
          the floor
- blind:  no scouting; attempt the best EV whose predicted odds clear the
          floor. Credited at the same success curve as a scouted attempt —
          i.e. this assumes blind rolls the same, which is the open question

What's real (as in simulate_target_selection.py): every board snapshot in the
window, the 480s cooldown, Stamina regen (1 per 234s) plus every refill /
level-up jump actually seen, capped at the real max. The card-value minimum
and its release at 90% Stamina apply, as in actionRunner.ts.

A card's true odds: its real scouted best where it was scouted (computed
hidden approaches included), else its exact prediction (99% exact against
every scout since 08-21). Each pick is credited its *expected* net: reward
midpoint x a success curve fitted from real outcomes (complication losses
included) — policy differences aren't luck.

Run: python3 verification/street-intel/simulate_scout_modes.py [--since YYYY-MM-DD] [--until ...]
     [--min-pct 50] [--min-card 800000]
"""

import argparse
import bisect
import collections
import datetime
import json
import re
import sys
from pathlib import Path

from _lib import add_archives_arg, load_endpoint_records, panel_html, parse_panel_cards, resolve_archive_paths

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "wiki"))
import wiki  # noqa: E402

COOLDOWN_MS = 480_000
REGEN_PER_MS = 1 / 234_000
RELEASE = 0.9
BASE_MAX = {"low": 61, "medium": 46, "high": 33, "extreme": 23}
RANK_MAX, ENV_GLOBAL_MAX, ENV_STAT_MAX = 12, 8, 5
CALIBRATION = [(0, 0), (45, 0.45), (55, 0.55), (65, 0.70), (75, 0.75), (85, 0.88), (95, 0.99)]
WIKI_COL = {"fight": "Fight", "steel_yourself": "Steel Yourself", "run": "Run", "talk": "Talk"}


def calib(pct):
    for (x1, y1), (x2, y2) in zip(CALIBRATION, CALIBRATION[1:]):
        if pct <= x2:
            return y1 + (y2 - y1) * (pct - x1) / (x2 - x1)
    return CALIBRATION[-1][1]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_archives_arg(ap)
    ap.add_argument("--since", default="2026-10-01")
    ap.add_argument("--until", default=None)
    ap.add_argument("--min-pct", type=float, default=50)
    ap.add_argument("--min-card", type=float, default=800_000)
    args = ap.parse_args()

    page = wiki.parse_page(wiki.latest("intel").read_text(encoding="utf-8"))
    catalog = {c["name"].lower(): {"base": int(c["chips"]["Base Success"].rstrip("%")), "cat": c["chips"]["Category"]}
               for g in page["groups"] for c in g["cards"]}

    rows = load_endpoint_records(resolve_archive_paths(args), ["street_intel", "stats.php", "attack.php", "crimes.php", "career.php"])
    cards, panels, stamina_tl, stats_snaps = {}, [], [], []
    scouts, attempts = [], []
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
        if not isinstance(body, dict):
            continue
        st = body.get("stats") if isinstance(body.get("stats"), dict) else None
        if st and "stamina" in st:
            stamina_tl.append((row["timestamp"], st["stamina"], st.get("max_stamina")))
        if st and "strength" in st:
            stats_snaps.append((row["timestamp"], st))
        if ep == "POST /actions/street_intel.php" and body.get("ok"):
            req = row.get("requestBody") or ""
            m = re.search(r"opportunity_id=(\d+)", req)
            if m and "action=scout" in req:
                scouts.append((row["timestamp"], int(m.group(1)), body))
            elif "action=attempt" in req and isinstance(body.get("rank"), int):
                attempts.append((row["timestamp"], body["rank"]))
    stamina_tl.sort()
    stats_snaps.sort(key=lambda x: x[0])
    stats_ts = [t for t, _ in stats_snaps]

    def raw_stats_at(t):
        return stats_snaps[max(0, bisect.bisect_right(stats_ts, t) - 1)][1]

    # Player modifiers over time (as the extension keeps them), and every
    # scouted card's real best odds.
    scouts.sort(key=lambda s: s[0])
    mods_tl, mods, mastery = [], None, {}
    real_best = {}
    for t, oid, resp in scouts:
        card = cards.get(oid)
        entry = catalog.get((card or {}).get("title", "").lower()) if card else None
        revealed = [e for e in resp.get("estimates") or [] if isinstance(e, dict) and e.get("estimate_pct") is not None and e.get("modifiers")]
        if not revealed:
            continue
        m = revealed[0]["modifiers"]
        if entry:
            mastery[entry["cat"]] = m.get("mastery", 0)
        mods = {k: m.get(k, 0) for k in ("rank", "prestige", "collection", "recon")}
        mods_tl.append((t, dict(mods), dict(mastery)))
        # Real best: revealed + hidden approaches computed from this scout.
        ests = {e["key"]: e["estimate_pct"] for e in revealed}
        if card:
            shared = sum(v for k, v in m.items() if k not in ("stat", "approach", "env_stat"))
            raw = raw_stats_at(t)
            for a in card["approaches"]:
                if a["key"] in ests:
                    continue
                ests[a["key"]] = 0 if a.get("autofail") else max(0, min(95, int(revealed[0]["base_pct"] * (1 + (shared + raw.get(a["stat"], 0) / 5) / 100) + a.get("bonus", 0) + 0.5)))
        real_best[oid] = max(ests.values())
    mods_ts = [x[0] for x in mods_tl]

    cond_table = json.loads((Path(__file__).resolve().parents[2] / "src/shared/data/streetIntelConditions.json").read_text())["conditions"]

    def predict(c, t):
        """Exact pre-scout best odds, as streetIntelPredict.ts computes them."""
        entry = catalog.get((c.get("title") or "").lower())
        cond = cond_table.get(c.get("modifier") or "")
        i = bisect.bisect_right(mods_ts, t) - 1
        if not entry or cond is None or i < 0:
            return None
        _, md, ms = mods_tl[i]
        if entry["cat"] not in ms:
            return None
        raw = raw_stats_at(t)
        shared = md["rank"] + md["prestige"] + md["collection"] + md["recon"] + ms[entry["cat"]] + cond["global"]
        best = 0
        for a in c["approaches"]:
            if a.get("autofail"):
                continue
            r = entry["base"] * (1 + (shared + raw.get(a["stat"], 0) / 5 + cond["stats"].get(a["stat"], 0)) / 100) + a.get("bonus", 0)
            best = max(best, max(0, min(95, round(r))))
        return best

    def ub_pct(c, t):
        raw = raw_stats_at(t)
        i = bisect.bisect_right(mods_ts, t) - 1
        own = mods_tl[i][1] if i >= 0 else {"prestige": 10, "collection": 4.5, "recon": 19.5}
        ms = mods_tl[i][2] if i >= 0 else {}
        shared = RANK_MAX + own["prestige"] + own["collection"] + own["recon"] + max(ms.values(), default=12) + ENV_GLOBAL_MAX
        u = 0
        for a in c["approaches"]:
            if a.get("autofail"):
                continue
            u = max(u, min(95, round(BASE_MAX[c["risk"]] * (1 + (shared + raw.get(a["stat"], 0) / 5 + ENV_STAT_MAX) / 100) + a.get("bonus", 0))))
        return u

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

    coverage = collections.Counter()

    def truth(c, t):
        if c["id"] in real_best:
            coverage["scouted"] += 1
            return real_best[c["id"]]
        p = predict(c, t)
        coverage["predicted" if p is not None else "unknown"] += 1
        return p

    def run(mode):
        stam, t_prev, cd_until, ri = s0, P[0][0], 0, 0
        scouted, done = set(), set()
        net = n = scout_spent = 0
        for t, oids in P:
            stam += REGEN_PER_MS * (t - t_prev)
            t_prev = t
            while ri < len(refills) and refills[ri][0] <= t:
                stam += refills[ri][1]
                ri += 1
            cap = max_tl[max(0, bisect.bisect_right(max_ts, t) - 1)][1]
            stam = min(stam, cap)
            if t < cd_until:
                continue
            saving = args.min_card > 0 and stam < RELEASE * cap
            pool = [dict(cards[o], id=o) for o in oids if o not in done and cards[o]["stamina"] and cards[o]["reward_min"] and cards[o]["approaches"]]
            pool = [c for c in pool if not saving or mid(c) >= args.min_card]
            spent, cleared = 0, []

            if mode == "blind":
                for c in pool:
                    p = predict(c, t)
                    if p is not None and p >= args.min_pct and c["stamina"] <= stam:
                        cleared.append((p, c))
            else:
                cands = [c for c in pool if stam >= (0 if c["id"] in scouted else c["scout_cost"]) + c["stamina"]]
                if mode == "top2":
                    cands.sort(key=lambda c: -mid(c))
                    cands = cands[:2]
                elif mode == "smart":
                    cands.sort(key=lambda c: -ub_pct(c, t) * mid(c))
                else:  # exact
                    pred = {c["id"]: predict(c, t) for c in cands}
                    cands = [c for c in cands if pred[c["id"]] is None or pred[c["id"]] >= args.min_pct]
                    cands.sort(key=lambda c: -(pred[c["id"]] if pred[c["id"]] is not None else ub_pct(c, t)) * mid(c))
                for c in cands:
                    if mode in ("smart", "exact"):
                        bound = ub_pct(c, t) if mode == "smart" or predict(c, t) is None else predict(c, t)
                        found = max((e * mid(x) for e, x in cleared if x["stamina"] <= stam - spent), default=-1)
                        if found >= bound * mid(c):
                            continue
                    if c["id"] not in scouted:
                        if stam - spent < c["scout_cost"] + c["stamina"]:
                            continue
                        spent += c["scout_cost"]
                        scouted.add(c["id"])
                    e = truth(c, t)
                    if e is not None and e >= args.min_pct:
                        cleared.append((e, c))
            stam -= spent
            scout_spent += spent
            cleared.sort(key=lambda ec: -ec[0] * mid(ec[1]))
            pick = next(((e, c) for e, c in cleared if c["stamina"] <= stam), None)
            if pick:
                e, c = pick
                if mode == "blind":
                    e = truth(c, t)  # the card's real odds, not the prediction it was picked on
                stam -= c["stamina"]
                net += mid(c) * calib(e)
                n += 1
                done.add(c["id"])
                cd_until = t + COOLDOWN_MS
        return net / days, n / days, scout_spent / days

    print(f"window {args.since} .. {datetime.datetime.utcfromtimestamp(end / 1000).date()} ({days:.1f} days, {len(P)} board snapshots), "
          f"min success {args.min_pct:.0f}%, min card ${args.min_card:,.0f} (lifted at {RELEASE:.0%} Stamina)")
    print("expected net per calendar day (archive gaps included — compare rows, not to a real day)\n")
    results = {}
    for mode, label in (("top2", "Top 2 by payout"), ("smart", "Smart"), ("exact", "Smart, exact odds"), ("blind", "Go blind (if blind rolls the same)")):
        net, att, sc = run(mode)
        results[mode] = net
        print(f"{label:36s} net/day ${net / 1e6:6.2f}M  attempts/day {att:5.1f}  scout Stamina/day {sc:5.1f}")
    print(f"\ncard odds used: {dict(coverage)}")


if __name__ == "__main__":
    main()
