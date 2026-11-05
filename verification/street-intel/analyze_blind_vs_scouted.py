#!/usr/bin/env python3
"""Go blind against scouted Street Intel attempts, on live results from the
request archives. Re-run it as blind attempts build up; the findings it was
written for are in docs/street-intel-plan.md -> "Go blind: first live results".

A blind attempt is `action=attempt` with `scouted=0`, automated ones having
origin `background`. Everything else is compared against scouted attempts:

- **Cash:** net (reward minus complication losses) per Stamina, scouts
  included, by window, and on cards both sides attempted.
- **Success:** wins (success or critical_success) against each attempt's odds
  predicted from before any scout (same formula as streetIntelPredict.ts), and
  against what scouted attempts really land at for the same odds, plus rolling
  scouted windows of the same size as a control.
- **Drops:** from attempt *and* complication responses (a won complication can
  award its own `loot_drop`, and those are often the valuable ones). Rate per
  attempt and per Stamina, gold by route and card level, value priced as the
  in-game "Drops by day" panel does (see `dropValue` in
  src/shared/streetIntelAnalytics.ts).
- **Control:** gold per crime commit. Crimes have no scouting, so a rise there
  isn't a blind effect.

Prediction caveat: player modifiers come from the most recent scout, so a long
stretch with no scouts freezes them. The script prints the last scout's time.

Run: python3 -I verification/street-intel/analyze_blind_vs_scouted.py [--archive PATH ...] [--since YYYY-MM-DD]
`--since` (default 2026-10-01) starts the scouted baseline for the window tables;
the success baseline always starts 2026-08-21, as the prediction check does.
"""

import argparse
import bisect
import collections
import datetime
import json
import math
import re
import statistics
import sys
from pathlib import Path
from urllib.parse import parse_qsl

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "wiki"))
from _lib import add_archives_arg, load_endpoint_records, panel_html, parse_panel_cards, player_day, resolve_archive_paths  # noqa: E402
import wiki  # noqa: E402

WIN = ("success", "critical_success")
SUCCESS_BASELINE_SINCE = "2026-08-21"
GOLD_MIN_CARD_LEVEL = 120
NON_ITEM_DROP_TYPES = {"consumable", "cash_box", "platinum", "mafia_gold"}


def body_of(row):
    try:
        body = json.loads(row.get("responseBody") or "")
    except json.JSONDecodeError:
        return {}
    return body if isinstance(body, dict) else {}


def fisher(a, b, c, d):
    """Two-sided Fisher exact p for [[a, b], [c, d]]."""
    n, r1, c1 = a + b + c + d, a + b, a + c
    if n == 0 or c1 == 0 or c1 == n:
        return 1.0
    prob = lambda x: math.comb(r1, x) * math.comb(n - r1, c1 - x) / math.comb(n, c1)
    p0 = prob(a)
    return sum(p for p in map(prob, range(max(0, c1 - (n - r1)), min(r1, c1) + 1)) if p <= p0 + 1e-12)


def load(paths):
    """Attempts joined to their card, complication and predicted odds, plus
    scouts, per-item quicksell quotes and crime commits."""
    rows = load_endpoint_records(paths, ["street_intel", "stats.php", "shops_v2.php", "crimes.php"])
    page = wiki.parse_page(wiki.latest("intel").read_text(encoding="utf-8"))
    catalog = {
        c["name"].lower(): {"base": int(c["chips"]["Base Success"].rstrip("%")), "cat": c["chips"]["Category"], "level": c.get("level")}
        for g in page["groups"]
        for c in g["cards"]
    }
    conditions = json.loads((HERE.parents[1] / "src/shared/data/streetIntelConditions.json").read_text())["conditions"]

    cards, stats, actions, quotes, commits = {}, [], [], {}, []
    for row in rows:
        ep = row.get("endpoint") or ""
        if "type=street_intel" in ep:
            cards.update(parse_panel_cards(panel_html(row)))
        elif ep == "GET /api/stats.php":
            st = body_of(row).get("stats")
            if isinstance(st, dict) and "strength" in st:
                stats.append((row["timestamp"], st))
        elif ep == "POST /actions/street_intel.php":
            actions.append((row, dict(parse_qsl(row.get("requestBody") or "")), body_of(row)))
        elif ep == "POST /actions/shops_v2.php" and "action=dispose_quote" in (row.get("requestBody") or ""):
            b = body_of(row)
            if b.get("ok") and b.get("cash") is not None:
                quotes[b.get("name")] = b["cash"]
        elif ep == "POST /api/crimes.php" and "action=commit" in (row.get("requestBody") or ""):
            b = body_of(row)
            if b.get("ok"):
                drops = [v.get("quality") for v in b.values() if isinstance(v, dict) and "quality" in v and "name" in v]
                commits.append({"day": player_day(row["timestamp"]), "gold": drops.count("gold")})
    stats_ts = [t for t, _ in stats]

    scouts, mods_tl, mods_now, mastery, complications = [], [], None, {}, {}
    complication_drops = collections.defaultdict(list)
    for row, q, b in actions:
        oid = int(q["opportunity_id"]) if q.get("opportunity_id") else None
        if q.get("action") == "scout" and b.get("ok"):
            scouts.append({"t": row["timestamp"], "day": player_day(row["timestamp"]), "cost": 0 if b.get("cached") else b.get("scout_cost") or 0})
            revealed = [e for e in b.get("estimates") or [] if isinstance(e, dict) and e.get("estimate_pct") is not None and e.get("modifiers")]
            if revealed:
                m = revealed[0]["modifiers"]
                entry = catalog.get(((cards.get(oid) or {}).get("title") or "").lower())
                if entry:
                    mastery[entry["cat"]] = m.get("mastery", 0)
                mods_now = {k: m.get(k, 0) for k in ("rank", "prestige", "collection", "recon")}
                mods_tl.append((row["timestamp"], dict(mods_now), dict(mastery)))
        elif q.get("action") == "complication" and b.get("ok") and b.get("comp_success") is not None:
            complications.setdefault(oid, b)
        if q.get("action") == "complication" and b.get("ok") and isinstance(b.get("loot_drop"), dict):
            complication_drops[oid].append(b["loot_drop"])
    mods_ts = [m[0] for m in mods_tl]

    def predict(card, t, approach):
        entry = catalog.get((card.get("title") or "").lower())
        cond = conditions.get(card.get("modifier") or "")
        i = bisect.bisect_right(mods_ts, t) - 1
        if not entry or cond is None or i < 0 or not stats or entry["cat"] not in mods_tl[i][2]:
            return None
        _, md, ms = mods_tl[i]
        raw = stats[max(0, bisect.bisect_right(stats_ts, t) - 1)][1]
        shared = md["rank"] + md["prestige"] + md["collection"] + md["recon"] + ms[entry["cat"]] + cond["global"]
        for a in card["approaches"]:
            if a["key"] == approach:
                if a.get("autofail"):
                    return 0
                v = entry["base"] * (1 + (shared + raw.get(a["stat"], 0) / 5 + cond["stats"].get(a["stat"], 0)) / 100) + a.get("bonus", 0)
                return max(0, min(95, int(v + 0.5)))
        return None

    attempts, dropped = [], collections.Counter()
    for row, q, b in actions:
        if q.get("action") != "attempt" or not b.get("ok"):
            continue
        oid = int(q["opportunity_id"])
        card = cards.get(oid)
        if not card or not card["stamina"] or card["reward_min"] is None:
            dropped["no card on any board"] += 1
            continue
        comp = complications.get(oid)
        lost = 0
        if comp and not comp["comp_success"]:
            lost = (comp.get("cash_lost_from_hand") or 0) + (comp.get("cash_lost_from_bank") or 0) or (comp.get("cash_lost") or 0)
        drops = [{**d, "route": "complication"} for d in complication_drops[oid]]
        if isinstance(b.get("loot_drop"), dict):
            drops.append({**b["loot_drop"], "route": "attempt"})
        entry = catalog.get((card.get("title") or "").lower()) or {}
        attempts.append({
            "t": row["timestamp"],
            "day": player_day(row["timestamp"]),
            "blind": q.get("scouted") == "0",
            "auto": row.get("origin") == "background",
            "title": card["title"],
            "risk": card["risk"],
            "stamina": card["stamina"],
            "mid": (card["reward_min"] + card["reward_max"]) / 2,
            "card_level": entry.get("level") or 0,
            "pred": predict(card, row["timestamp"], q.get("approach")),
            "win": b.get("outcome_band") in WIN,
            "band": b.get("outcome_band"),
            "net": (b.get("reward_cash") or 0) - lost,
            "drops": drops,
            "level": (b.get("stats") or {}).get("level"),
        })
    attempts.sort(key=lambda a: a["t"])
    return attempts, scouts, quotes, commits, dropped, mods_ts[-1] if mods_ts else None


def quicksell_values(quotes):
    """The price the in-game "Drops by day" panel uses: the item's last sell
    quote (the seed's, then the archives'), else a typical quote for its quality.
    Banner drops (shards, event items), consumables and cash boxes count as 0."""
    seed = json.loads((HERE.parents[1] / "src/shared/data/streetIntelAnalyticsSeed.json").read_text())["prices"]
    prices = {k.lower(): v for k, v in seed.items()}
    prices.update({k.lower(): v for k, v in quotes.items() if k})
    source = (HERE.parents[1] / "src/shared/streetIntelAnalytics.ts").read_text()
    table = re.search(r"QUALITY_TYPICAL_PRICE[^{]*\{(.*?)\}", source, re.S).group(1)
    typical = {k: float(v.replace("_", "")) for k, v in re.findall(r"(\w+):\s*([\d_]+)", table)}

    def value(drop):
        if drop.get("header") or drop.get("type") in NON_ITEM_DROP_TYPES:
            return 0
        return prices.get((drop.get("name") or "").lower(), typical.get(drop.get("quality"), 0))

    return value


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_archives_arg(ap)
    ap.add_argument("--since", default="2026-10-01")
    args = ap.parse_args()
    paths = resolve_archive_paths(args)
    print(f"Loading {len(paths)} archive(s)...")
    attempts, scouts, quotes, commits, dropped, last_scout = load(paths)
    value = quicksell_values(quotes)

    blind = [a for a in attempts if a["blind"] and a["auto"]]
    if not blind:
        sys.exit("No automated blind attempts in these archives.")
    manual_blind = [a for a in attempts if a["blind"] and not a["auto"]]
    first = blind[0]["day"]
    scouted = [a for a in attempts if not a["blind"]]
    recent = [a for a in scouted if args.since <= a["day"] < first]
    last_six = sorted({a["day"] for a in recent})[-6:]
    tail = [a for a in recent if a["day"] in last_six]
    print(f"Automated blind: {len(blind)} attempts, {first} .. {blind[-1]['day']} (player days). Dropped from the join: {dict(dropped) or 'none'}")
    if last_scout:
        print(f"Last scout with modifiers: {datetime.datetime.fromtimestamp(last_scout / 1000, datetime.timezone.utc):%Y-%m-%d %H:%M} UTC. "
              "Predictions after that use frozen modifiers (live stats).")

    scout_cost = collections.Counter()
    for s in scouts:
        scout_cost[s["day"]] += s["cost"]

    print("\n== Cash ==")

    def cash(label, days):
        L = [a for a in attempts if a["day"] in days]
        if not L:
            return
        st, sc, net = sum(a["stamina"] for a in L), sum(scout_cost[d] for d in days), sum(a["net"] for a in L)
        print(f"{label:22s} {len(L):5d} attempts  net/Stamina ${net / (st + sc) / 1e3:6.1f}k  net/attempt Stamina ${net / st / 1e3:6.1f}k  "
              f"scouting {100 * sc / (st + sc):4.1f}%  avg card ${sum(a['mid'] for a in L) / len(L) / 1e3:5.0f}k  under $800k {100 * sum(a['mid'] < 800_000 for a in L) / len(L):3.0f}%  "
              f"Stamina/day {st / len(days):4.0f}  net/day ${net / len(days) / 1e6:5.1f}M")

    blind_days = sorted({a["day"] for a in attempts if a["day"] >= first})
    cash(f"scouted, {last_six[0]}+", last_six)
    cash(f"blind era, {first}+", blind_days)

    titles = {a["title"] for a in blind} & {a["title"] for a in tail}
    if titles:
        mix = collections.Counter(a["title"] for a in blind if a["title"] in titles)
        per = lambda L, t: [a for a in L if a["title"] == t]
        net_s = sum(n * statistics.mean(a["net"] for a in per(tail, t)) for t, n in mix.items())
        st_s = sum(n * per(tail, t)[0]["stamina"] for t, n in mix.items())
        B = [a for a in blind if a["title"] in titles]
        print(f"Same {len(titles)} titles at blind's mix: scouted ${net_s / st_s / 1e3:.1f}k, blind ${sum(a['net'] for a in B) / sum(a['stamina'] for a in B) / 1e3:.1f}k per attempt Stamina")

    print("\n== Success against predicted odds ==")
    base = [a for a in scouted if a["day"] >= SUCCESS_BASELINE_SINCE and a["pred"] is not None]

    def vs_pred(label, L):
        P = [a for a in L if a["pred"] is not None]
        if not P:
            return
        wins, exp = sum(a["win"] for a in P), sum(a["pred"] / 100 for a in P)
        var = sum(a["pred"] / 100 * (1 - a["pred"] / 100) for a in P)
        print(f"{label:24s} {wins:5d}/{len(P):<5d} {100 * wins / len(P):5.1f}%  predicted {exp:7.1f} ({100 * exp / len(P):4.1f}%)  {100 * (wins - exp) / len(P):+5.1f} pts  z={(wins - exp) / math.sqrt(var):+.2f}")

    vs_pred(f"scouted {SUCCESS_BASELINE_SINCE}+", base)
    vs_pred(f"scouted {last_six[0]}+", tail)
    vs_pred("manual blind", manual_blind)
    vs_pred("AUTOMATED BLIND", blind)
    B = [a for a in blind if a["pred"] is not None]
    buckets = collections.defaultdict(lambda: [0, 0])
    for a in base:
        buckets[a["pred"] // 5][0] += 1
        buckets[a["pred"] // 5][1] += a["win"]
    rate = lambda a: buckets[a["pred"] // 5][1] / buckets[a["pred"] // 5][0] if buckets[a["pred"] // 5][0] else a["pred"] / 100
    exp = sum(map(rate, B))
    sd = math.sqrt(sum(rate(a) * (1 - rate(a)) for a in B))
    wins = sum(a["win"] for a in B)
    print(f"Against what scouted really lands at for the same odds: {wins} against {exp:.1f}, {100 * (wins - exp) / len(B):+.1f} pts "
          f"(95% CI {100 * (wins - exp - 1.96 * sd) / len(B):+.1f} to {100 * (wins - exp + 1.96 * sd) / len(B):+.1f}), z={(wins - exp) / sd:+.2f}")
    obs = 100 * (wins - sum(a["pred"] / 100 for a in B)) / len(B)
    if len(base) > len(B):
        cum = [0.0]
        for a in base:
            cum.append(cum[-1] + a["win"] - a["pred"] / 100)
        roll = [100 * (cum[i + len(B)] - cum[i]) / len(B) for i in range(len(base) - len(B) + 1)]
        print(f"Rolling {len(B)}-attempt scouted windows: mean {statistics.mean(roll):+.1f}, max {max(roll):+.1f} pts; {100 * sum(x >= obs for x in roll) / len(roll):.1f}% reached blind's {obs:+.1f}")
    for key in ("risk", "day"):
        print(f"By {key}: " + "  ".join(
            f"{k} {sum(a['win'] for a in B if a[key] == k)}/{sum(1 for a in B if a[key] == k)} (pred {sum(a['pred'] for a in B if a[key] == k) / 100:.1f})"
            for k in sorted({a[key] for a in B})))
    bands = lambda L: "  ".join(f"{b} {100 * sum(a['band'] == b for a in L) / len(L):.1f}%" for b in ("critical_success", "success", "partial_success", "failure", "disaster"))
    print(f"Bands, scouted {SUCCESS_BASELINE_SINCE}+: {bands(base)}")
    print(f"Bands, blind:            {bands(B)}")

    print("\n== Drops ==")

    gold = lambda L, route=None: sum(d.get("quality") == "gold" and route in (None, d["route"]) for a in L for d in a["drops"])
    count = lambda L: sum(len(a["drops"]) for a in L)

    def drops(label, L):
        if not L:
            return
        n, st = len(L), sum(a["stamina"] for a in L)
        val = sum(value(d) for a in L for d in a["drops"])
        gold_val = sum(value(d) for a in L for d in a["drops"] if d.get("quality") == "gold")
        print(f"{label:24s} {n:5d} attempts  drops {100 * count(L) / n:4.1f}%  {100 * count(L) / st:.2f}/100 Stamina  "
              f"gold {gold(L):3d} ({gold(L, 'attempt')} attempt, {gold(L, 'complication')} complication) {100 * gold(L) / n:.1f}%  "
              f"value ${val / 1e6:7.1f}M  ${val / st / 1e3:4.0f}k/Stamina, without gold ${(val - gold_val) / n / 1e6:.2f}M/attempt")

    for lo, hi in (("2026-10-01", "2026-10-14"), ("2026-10-15", "2026-10-25"), ("2026-10-26", "2026-10-31")):
        drops(f"scouted {lo[5:]}..{hi[5:]}", [a for a in scouted if lo <= a["day"] <= hi])
    drops(f"scouted {last_six[0]}+", tail)
    drops("AUTOMATED BLIND", blind)
    print(f"Per day (blind era), value: " + "  ".join(
        f"{d[5:]} ${sum(value(x) for a in attempts if a['day'] == d for x in a['drops']) / 1e6:.1f}M" for d in blind_days))
    d_s, n_s = count(recent), len(recent)
    print(f"Drops per attempt, blind against scouted {args.since}+: Fisher p={fisher(d_s, max(0, n_s - d_s), count(blind), max(0, len(blind) - count(blind))):.3f}")
    low = [a for a in scouted + blind if a["card_level"] and a["card_level"] < GOLD_MIN_CARD_LEVEL]
    print(f"Gold from cards under level {GOLD_MIN_CARD_LEVEL}: {gold(low, 'attempt')} from attempts, {gold(low, 'complication')} from complications ({len(low)} attempts)")
    print(f"Share on level 125+ cards: scouted {last_six[0]}+ {100 * sum(a['card_level'] >= 125 for a in tail) / len(tail):.0f}%, blind {100 * sum(a['card_level'] >= 125 for a in blind) / len(blind):.0f}%")
    for lo, hi in ((120, 124), (125, 139), (140, 999)):
        s = [a for a in scouted if lo <= a["card_level"] <= hi]
        b = [a for a in blind if lo <= a["card_level"] <= hi]
        if s or b:
            gs, gb = gold(s, "attempt"), gold(b, "attempt")
            print(f"Attempt-route gold on cards {lo}-{hi}: scouted {gs}/{len(s)}, blind {gb}/{len(b)}, Fisher p={fisher(gs, len(s) - gs, gb, len(b) - gb):.3f}")

    print("\n== Control: gold per crime commit (no scouting involved) ==")
    before = [c for c in commits if args.since <= c["day"] < first]
    after = [c for c in commits if c["day"] >= first]
    gb, ga = sum(c["gold"] for c in before), sum(c["gold"] for c in after)
    if before and after:
        print(f"Before {first}: {gb}/{len(before)} = {100 * gb / len(before):.2f}%.  Since: {ga}/{len(after)} = {100 * ga / len(after):.2f}%.  Fisher p={fisher(gb, len(before) - gb, ga, len(after) - ga):.4f}")

    print("\nCaveats: docs/street-intel-plan.md -> \"Go blind: first live results\".")


if __name__ == "__main__":
    main()
