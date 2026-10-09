#!/usr/bin/env python3
"""Re-derives the Arena V2 combat findings in `docs/arena-combat-mechanics.md`
from every real `attack` call in the request archives.

Reports, in order:

  1. How the quoted "% CHANCE" (`win_pct`) compares with actual results, split
     boss / regular.
  2. That `win_pct` is a function of the opponent's Combat Power alone
     (fit `win_pct ~ a + b*ln(CP)` per ISO week).
  3. How the opponent's card (STR / DEF / level) maps to what the combat log
     shows: base damage, reduction, max HP.
  4. The dice rules: dodge / block / crit happen when roll < chance; block and
     crit multipliers.
  5. The kill-race score rule's accuracy against actual results, by score
     band.
  6. Boss results by family, with STR.
  7. Passive vs active opponents inside the coin-flip band.
  8. Win rate per verdict band, as `WIN_CHANCE` in src/shared/arenaCombat.ts
     uses it (regular coin-flips split by quoted >= 50%; boss bands with the
     1.3 boss "Beatable" line), plus the old vs new coin-flip lean rule.
  9. Bounty economics: bounty = slot base x a multiplier set by
     threat_ratio, win rate by bounty, and points_earned == bounty.

Run: python3 verification/arena/verify_combat_rule.py [--archive PATH ...]

Defaults to every archive in the locations in verification/archive_paths.py
(overlapping windows deduplicated). Standard library only.

Written 2026-09-24. First run: 179 V2 fights (156 regular, 23 bosses,
2026-09-09 .. 09-24): rule 155/179 correct vs 138/179 for "quoted >= 50";
score >= 1.2 won 81/81; score < 0.8 won 2/40; every boss loss was Iron
River (STR-built).

2026-10-05 fix: fights after a Refresh were silently dropped (their
opponents never appear in `open_next_page`, only on the page's cards), and
a boss was scored with whichever boss the last captured `open_next_page`
offered, which goes stale when page opens aren't captured. Both now read
the opponent's own card. Run that day: 388 fights (331 regular, 57 boss).
For regular opponents alone, "quoted >= 50" is right 297/331 vs the score's
294/331 — the quote is a fine cut-off; it's bosses where it's useless.
Score >= 1.2 won 176/176; < 0.8 won 3/56. Bosses: score >= 1.3 won 25/25,
1.1-1.3 won 23/27 (all four non-Iron River losses). In the coin-flip band,
quoted >= 50% won 37/50 vs 14/48 under 50% (a Passive opponent quoted
under 50% won only 10/24, so the coin-flip lean now follows the quote).
Bounty and quoted % now come from the card itself: `open_next_page` quotes
pile up across pages and go stale for an opponent met again (with them,
only 156 of 187 wins matched their bounty; with the card, 230/230).
"""

import argparse
import collections
import gzip
import json
import sys
import math
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path

# Archive locations live in verification/archive_paths.py — shared by every script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from archive_paths import find_archives as find_default_archives  # noqa: E402

FLOOR_FRACTION = 0.088  # min-damage mean / attacker mean base: measured 8.5% (you) and 9.1% (opponents); 8.8% shared fits results best



def load_arena_rows(archive_paths):
    seen = {}
    for path in archive_paths:
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rt", encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f):
                if i == 0 or "arena" not in line[:500]:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "arena" not in row.get("url", ""):
                    continue
                seen[(row.get("timestamp"), row.get("url"), row.get("requestBody"))] = row
    return [seen[k] for k in sorted(seen, key=lambda k: k[0])]


def body(row):
    try:
        b = json.loads(row.get("responseBody") or "")
    except json.JSONDecodeError:
        return None
    return b if isinstance(b, dict) else None


def num(s):
    return float(str(s).replace(",", ""))


CARD_RE = re.compile(r'<div class="ar-opp[ "][^>]*>(.*?)</button>', re.S)


def parse_cards(html):
    """Opponent cards on the Arena V2 page: name, level, win%, passive, CP, STR/DEF/AGI/DEX."""
    out = []
    for m in CARD_RE.finditer(html):
        c = m.group(1)
        g = lambda p: (re.search(p, c, re.S) or [None, None])[1]
        name = g(r'ar-opp-name">([^<]*)<')
        stats = [g(p) for p in (r"STR ([\d,]+)", r"DEF ([\d,]+)", r"AGI ([\d,]+)", r"DEX ([\d,]+)")]
        if not name or not all(stats):
            continue
        cp = g(r"fa-bolt\"></i>([\d,]+) Combat Power")
        wp = g(r'ar-opp-winpct[^"]*">(\d+)')
        bounty = g(r'ar-opp-bounty[^"]*">(\d+)')
        out.append({"name": name, "passive": "ar-opp-passive" in c, "stats": [num(s) for s in stats],
                    "cp": num(cp) if cp else None, "wp": int(wp) if wp else None,
                    "bounty": int(bounty) if bounty else None})
    return out


def iso_week(ts_ms):
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isocalendar()[1]


def linfit(xs, ys):
    mx, my = statistics.mean(xs), statistics.mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    a = my - b * mx
    r = b * math.sqrt(sxx / sum((y - my) ** 2 for y in ys))
    resid = statistics.pstdev([y - (a + b * x) for x, y in zip(xs, ys)])
    return a, b, r, resid


def mean_pos(xs):
    xs = [x for x in xs if x and x > 0]
    return statistics.mean(xs) if xs else None


def build_fights(rows):
    quotes, boss_quote, cards, fights, hits = {}, None, {}, [], []
    for row in rows:
        req = row.get("requestBody") or ""
        b = body(row)
        if b is None:
            continue
        if "type=arena" in row["url"] and b.get("html"):
            for c in parse_cards(b["html"]):
                cards[c["name"]] = c
            continue
        if "arena_v2.php" not in row["url"] or not b.get("ok"):
            continue
        if "open_next_page" in req:
            page = b["new_page"]
            quotes.update(page.get("opponent_bounties") or {})
            boss_quote = page.get("boss_data")
        elif "action=attack" in req:
            oid = re.search(r"opponent_id=(\d+)", req).group(1)
            is_boss = oid == "0"
            card = cards.get(b["defender"])
            if is_boss:
                # The boss's own card first: `boss_quote` is whichever boss the
                # last *captured* page open offered, stale when a page open
                # wasn't captured.
                fresh = boss_quote if boss_quote and boss_quote.get("name") == b["defender"] else None
                if card:
                    stats, cp = card["stats"], card["cp"]
                elif fresh:
                    stats = [fresh["snapshot_strength"], fresh["snapshot_defence"], fresh["snapshot_agility"], fresh["snapshot_dexterity"]]
                    cp = fresh["combat_power"]
                else:
                    continue
                passive = False
                q = {"win_pct": fresh["win_pct"] if fresh else None,
                     "bounty": b.get("points_earned") if b["won"] else (fresh or {}).get("bounty")}
            else:
                # Opponents brought in by a Refresh never appear in
                # `open_next_page`, only on the page's cards.
                if not card:
                    continue
                # The card is the reliable source for bounty and quoted %:
                # `quotes` accumulates every page's `opponent_bounties`, so an
                # opponent met again on a later page can carry an old entry.
                # The quote's threat_ratio/multiplier are only kept when its
                # bounty agrees with the card (same encounter).
                qq = quotes.get(oid) or {}
                same = qq.get("bounty") is not None and qq.get("bounty") == card["bounty"]
                stats, passive, cp = card["stats"], card["passive"], card["cp"]
                q = {"win_pct": card["wp"] if card["wp"] is not None else qq.get("win_pct"),
                     "bounty": card["bounty"] if card["bounty"] is not None else qq.get("bounty"),
                     "threat_ratio": qq.get("threat_ratio") if same else None,
                     "multiplier": qq.get("multiplier") if same else None}
            rounds = b.get("rounds") or []
            atk = [x["attacker"] for x in rounds if isinstance(x.get("attacker"), dict) and "base_dmg" in x["attacker"]]
            dfd = [x["defender"] for x in rounds if isinstance(x.get("defender"), dict) and "base_dmg" in x["defender"]]
            nz = lambda L, k: statistics.median([h[k] for h in L if h.get(k)]) if any(h.get(k) for h in L) else None
            for side, L in (("attacker", atk), ("defender", dfd)):
                hits.extend(dict(h, side=side) for h in L)
            fights.append({
                "ts": row["timestamp"], "t": row.get("isoTime", "")[:16], "boss": is_boss, "name": b["defender"],
                "family": b.get("boss_family"), "won": bool(b["won"]), "wp": q["win_pct"], "cp": cp,
                "bounty": q.get("bounty"), "threat": q.get("threat_ratio"), "mult": q.get("multiplier"),
                "pts": b.get("points_earned"),
                "stats": stats, "passive": passive, "lvl": b["def_level"],
                "my_hp": b["att_max_hp"], "op_hp": b["def_max_hp"],
                # Misses log base_dmg 0; including them drags the mean down ~5%.
                "my_base": mean_pos([h["base_dmg"] for h in atk]),
                "op_base": mean_pos([h["base_dmg"] for h in dfd]),
                "my_red": nz(dfd, "reduction"), "op_red": nz(atk, "reduction"),
            })
    return fights, hits


def score(f, my):
    """Kill-race score: >1 means you're expected to outlast them."""
    STR, DEF = f["stats"][0], f["stats"][1]
    # Same coefficients as src/shared/arenaCombat.ts.
    if f["boss"]:
        op_base, op_hp = 0.4824 * STR + 9.85, 95 + 5 * f["lvl"]
    else:
        op_base, op_hp = 0.5546 * STR - 6.77, 7.19 * f["lvl"] - 49
    theirs = max(FLOOR_FRACTION * op_base, op_base - my["red"])
    mine = max(FLOOR_FRACTION * my["base"], my["base"] - DEF)
    return (my["hp"] / theirs) / (op_hp / mine)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--archive", dest="archives", action="append", default=None)
    args = ap.parse_args()
    paths = args.archives or find_default_archives()
    print(f"Scanning {len(paths)} archive(s)...")
    fights, hits = build_fights(load_arena_rows(paths))
    reg = [f for f in fights if not f["boss"]]
    boss = [f for f in fights if f["boss"]]
    print(f"{len(fights)} fights ({len(reg)} regular, {len(boss)} boss)\n")

    print("== 1. Quoted win% vs actual ==")
    for label, G in (("boss", boss), ("regular", reg)):
        G = [f for f in G if f["wp"] is not None]
        print(f"{label}: n={len(G)} won={sum(f['won'] for f in G)} expected-from-quote={sum(f['wp'] for f in G) / 100:.1f}")
        bins = collections.defaultdict(list)
        for f in G:
            bins[f["wp"] // 10 * 10].append(f["won"])
        for k in sorted(bins):
            v = bins[k]
            print(f"   quoted {k}-{k + 9}%: n={len(v):3} won {sum(v):3} ({sum(v) / len(v):.0%})")

    print("\n== 2. Quoted win% vs the opponent's Combat Power ==")
    by_week = collections.defaultdict(list)
    for f in fights:
        if f["cp"] and f["wp"] is not None:
            by_week[iso_week(f["ts"])].append((f["cp"], f["wp"]))
    for w, L in sorted(by_week.items()):
        if len(L) < 5:
            continue
        a, b_, r, res = linfit([math.log(x) for x, _ in L], [y for _, y in L])
        print(f"   week {w}: n={len(L):3} win% = {a:.1f} {b_:+.1f}*ln(CP)  r={r:.3f} resid sd={res:.1f}")

    print("\n== 3. Card stats -> combat log ==")
    for label, G in (("regular", reg), ("boss", boss)):
        g = [f for f in G if f["op_base"]]
        a, b_, r, res = linfit([f["stats"][0] for f in g], [f["op_base"] for f in g])
        print(f"   {label:7} base_dmg = {a:7.1f} + {b_:.3f}*STR   r={r:.3f} resid sd={res:.1f}")
        g = [f for f in G if f["op_red"]]
        a, b_, r, res = linfit([f["stats"][1] for f in g], [f["op_red"] for f in g])
        print(f"   {label:7} reduction = {a:7.1f} + {b_:.3f}*DEF   r={r:.3f} resid sd={res:.1f}")
        a, b_, r, res = linfit([f["lvl"] for f in G], [f["op_hp"] for f in G])
        print(f"   {label:7} max HP    = {a:7.1f} + {b_:.3f}*level r={r:.3f} resid sd={res:.1f}")

    print("\n== 4. Dice ==")
    for name, act, ck, rk in (("dodge", "miss", "dodge_chance", "dodge_roll"), ("crit", "critical", "crit_chance", "crit_roll"), ("block", "blocked", "block_chance", "block_roll")):
        g = [h for h in hits if rk in h]
        ok = sum((h[rk] < h[ck]) == (h["action"] == act) for h in g)
        print(f"   {name:5}: roll<chance matches outcome in {ok}/{len(g)} ({ok / len(g):.1%})")
    bm = collections.Counter(h.get("block_mult") for h in hits if h["action"] == "blocked")
    cm = collections.Counter(h.get("crit_mult") for h in hits if h["action"] == "critical")
    print(f"   block_mult: {dict(bm)}")
    print(f"   crit_mult (top): {cm.most_common(6)}")
    below = [h for h in hits if h["action"] == "hit" and h.get("min_dmg") is not None and h["base_dmg"] < h["reduction"]]
    print(f"   hits where base < reduction (floor damage): {len(below)}/{sum(1 for h in hits if h['action'] == 'hit')}")

    print("\n== 5. Kill-race score rule ==")
    # Your side is grouped by season loadout (your locked max HP), not by
    # calendar week: a week can straddle two seasons.
    season = collections.defaultdict(lambda: collections.defaultdict(list))
    for f in fights:
        s = season[f["my_hp"]]
        if f["my_base"]:
            s["base"].append(f["my_base"])
        if f["my_red"]:
            s["red"].append(f["my_red"])
        s["hp"].append(f["my_hp"])
    my_by_season = {hp: {k: statistics.median(v) for k, v in s.items()} for hp, s in season.items()}
    for hp, m in sorted(my_by_season.items()):
        k_const = m["hp"] * m["base"] / 0.5546
        boss_str = (m["hp"] * m["base"] / 625 - 9.85) / 0.4824
        print(f"   season with max HP {hp:.0f}: my base {m['base']:.0f}  reduction {m['red']:.0f}"
              f"  -> K ≈ {k_const:,.0f}, boss break-even STR ≈ {boss_str:,.0f}")
    scored = [(score(f, my_by_season[f["my_hp"]]), f) for f in fights]
    ok = sum((s >= 1) == f["won"] for s, f in scored)
    q_ok = sum((f["wp"] >= 50) == f["won"] for f in fights if f["wp"] is not None)
    print(f"   rule correct {ok}/{len(scored)}   vs quoted>=50 correct {q_ok}/{sum(f['wp'] is not None for f in fights)}")
    r_ok = sum((s >= 1) == f["won"] for s, f in scored if not f["boss"])
    rq_ok = sum((f["wp"] >= 50) == f["won"] for f in reg if f["wp"] is not None)
    print(f"   regular only: rule correct {r_ok}/{len(reg)}   vs quoted>=50 correct {rq_ok}/{sum(f['wp'] is not None for f in reg)}")
    for lo, hi in ((0, 0.8), (0.8, 1.0), (1.0, 1.2), (1.2, 1e9)):
        g = [f for s, f in scored if lo <= s < hi]
        if g:
            print(f"   score {lo:.1f}-{'∞' if hi > 1e8 else f'{hi:.1f}'}: n={len(g):3} won {sum(f['won'] for f in g):3} ({sum(f['won'] for f in g) / len(g):.0%})")

    print("\n== 6. Bosses by family ==")
    fam = collections.defaultdict(list)
    for f in boss:
        fam[f["family"]].append(f)
    for k, G in sorted(fam.items(), key=lambda kv: -len(kv[1])):
        print(f"   {k:10} n={len(G)} won {sum(f['won'] for f in G)}  STR " + ", ".join(
            f"{f['stats'][0]:.0f}{'' if f['won'] else '(L)'}" for f in sorted(G, key=lambda f: f['stats'][0])))

    print("\n== 7. Passive vs active in the coin-flip band (0.8 <= score < 1.2, regular) ==")
    for pv in (True, False):
        for lo, hi in ((0.8, 1.0), (1.0, 1.2)):
            g = [f for s, f in scored if not f["boss"] and f["passive"] == pv and lo <= s < hi]
            if g:
                print(f"   {'passive' if pv else 'active '} score {lo}-{hi}: n={len(g):2} won {sum(f['won'] for f in g)}")
    band = [f for s, f in scored if 0.8 <= s < 1.2 and not f["boss"] and f["wp"] is not None]
    hi_q = [f for f in band if f["wp"] >= 50]
    print(f"   in-band quoted >= 50%: n={len(hi_q)} won {sum(f['won'] for f in hi_q)}")

    rate = lambda g: f"{sum(f['won'] for f in g)}/{len(g)}" + (f" ({sum(f['won'] for f in g) / len(g):.0%})" if g else "")
    print("\n== 8. Win rate per verdict band (WIN_CHANCE in src/shared/arenaCombat.ts) ==")
    regs = [(s, f) for s, f in scored if not f["boss"] and f["wp"] is not None]
    print(f"   regular score >= 1.2: {rate([f for s, f in regs if s >= 1.2])}")
    for lo, hi in ((0.8, 1.0), (1.0, 1.2)):
        g = [f for s, f in regs if lo <= s < hi]
        print(f"   regular score {lo}-{hi}: quoted >= 50 {rate([f for f in g if f['wp'] >= 50])}   under 50 {rate([f for f in g if f['wp'] < 50])}")
    print(f"   regular score < 0.8: {rate([f for s, f in regs if s < 0.8])}")
    bs = [(s, f) for s, f in scored if f["boss"]]
    for lo, hi in ((1.3, 1e9), (1.1, 1.3), (0.8, 1.1), (0, 0.8)):
        print(f"   boss score {lo}-{'∞' if hi > 1e8 else hi}: {rate([f for s, f in bs if lo <= s < hi])}")
    cb = [f for s, f in regs if 0.8 <= s < 1.2]
    for name, rule in (("old: passive or quoted >= 51", lambda f: f["passive"] or f["wp"] >= 51),
                       ("new: quoted >= 50", lambda f: f["wp"] >= 50)):
        print(f"   coin-flip lean {name}: right {sum(rule(f) == f['won'] for f in cb)}/{len(cb)}")
    for pv in (True, False):
        print(f"   {'passive' if pv else 'active '} in band: quoted >= 50 {rate([f for f in cb if f['passive'] == pv and f['wp'] >= 50])}"
              f"   under 50 {rate([f for f in cb if f['passive'] == pv and f['wp'] < 50])}")

    print("\n== 9. Bounty ==")
    paid = [f for f in reg if f["won"] and f["bounty"] is not None]
    print(f"   points_earned == bounty on wins: {sum(f['pts'] == f['bounty'] for f in paid)}/{len(paid)}")
    mt = collections.defaultdict(list)
    for f in reg:
        if f["mult"] is not None and f["threat"] is not None:
            mt[f["mult"]].append(f["threat"])
    for m in sorted(mt):
        print(f"   multiplier x{m}: threat_ratio {min(mt[m]):.2f}-{max(mt[m]):.2f} (n={len(mt[m])})")
    for bnt in sorted({f["bounty"] for f in reg if f["bounty"] is not None}):
        g = [f for f in reg if f["bounty"] == bnt]
        if len(g) >= 5:
            print(f"   bounty {bnt:4}: won {rate(g)}")


if __name__ == "__main__":
    main()
