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

Run: python3 verification/arena/verify_combat_rule.py [--archive PATH ...]

Defaults to every archive under ~/Downloads and its "tff archives" subfolder
(overlapping windows deduplicated). Standard library only.

Written 2026-09-24. First run: 179 V2 fights (156 regular, 23 bosses,
2026-09-09 .. 09-24): rule 155/179 correct vs 138/179 for "quoted >= 50";
score >= 1.2 won 80/80; every boss loss was Iron River (STR-built).
"""

import argparse
import collections
import gzip
import json
import math
import re
import statistics
from datetime import datetime, timezone
from glob import glob
from pathlib import Path

ARCHIVE_GLOBS = [
    str(Path.home() / "Downloads" / "fifth-family-archive-*.ndjson.gz"),
    str(Path.home() / "Downloads" / "tff archives" / "fifth-family-archive-*.ndjson.gz"),
]
FLOOR_FRACTION = 0.088  # mean of the 5 min-damage steps, as a fraction of the attacker's mean base damage


def find_default_archives() -> list:
    candidates = sorted({p for pattern in ARCHIVE_GLOBS for p in glob(pattern)})
    if not candidates:
        raise SystemExit(
            "No archive found. Pass --archive /path/to/fifth-family-archive-*.ndjson.gz (repeatable)\n"
            f"(looked in: {', '.join(ARCHIVE_GLOBS)})"
        )
    return candidates


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
        out.append({"name": name, "passive": "ar-opp-passive" in c, "stats": [num(s) for s in stats],
                    "cp": num(cp) if cp else None})
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
            if is_boss:
                if not boss_quote:
                    continue
                q = boss_quote
                stats = [q["snapshot_strength"], q["snapshot_defence"], q["snapshot_agility"], q["snapshot_dexterity"]]
                passive, cp = False, q["combat_power"]
            else:
                q, card = quotes.get(oid), cards.get(b["defender"])
                if not q or not card:
                    continue
                stats, passive, cp = card["stats"], card["passive"], card["cp"]
            rounds = b.get("rounds") or []
            atk = [x["attacker"] for x in rounds if isinstance(x.get("attacker"), dict) and "base_dmg" in x["attacker"]]
            dfd = [x["defender"] for x in rounds if isinstance(x.get("defender"), dict) and "base_dmg" in x["defender"]]
            nz = lambda L, k: statistics.median([h[k] for h in L if h.get(k)]) if any(h.get(k) for h in L) else None
            for side, L in (("attacker", atk), ("defender", dfd)):
                hits.extend(dict(h, side=side) for h in L)
            fights.append({
                "ts": row["timestamp"], "t": row.get("isoTime", "")[:16], "boss": is_boss, "name": b["defender"],
                "family": b.get("boss_family"), "won": bool(b["won"]), "wp": q["win_pct"], "cp": cp,
                "stats": stats, "passive": passive, "lvl": b["def_level"],
                "my_hp": b["att_max_hp"], "op_hp": b["def_max_hp"],
                "my_base": statistics.mean([h["base_dmg"] for h in atk]) if atk else None,
                "op_base": statistics.mean([h["base_dmg"] for h in dfd]) if dfd else None,
                "my_red": nz(dfd, "reduction"), "op_red": nz(atk, "reduction"),
            })
    return fights, hits


def score(f, my):
    """Kill-race score: >1 means you're expected to outlast them."""
    STR, DEF = f["stats"][0], f["stats"][1]
    if f["boss"]:
        op_base, op_hp = 0.435 * STR + 21, 95 + 5 * f["lvl"]
    else:
        op_base, op_hp = 0.54 * STR - 11, 7.19 * f["lvl"] - 49
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
        if f["cp"]:
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
    season = collections.defaultdict(lambda: collections.defaultdict(list))
    for f in fights:
        s = season[iso_week(f["ts"])]
        if f["my_base"]:
            s["base"].append(f["my_base"])
        if f["my_red"]:
            s["red"].append(f["my_red"])
        s["hp"].append(f["my_hp"])
    my_by_week = {w: {k: statistics.median(v) for k, v in s.items()} for w, s in season.items()}
    for w, m in sorted(my_by_week.items()):
        k_const = m["hp"] * FLOOR_FRACTION * m["base"] / (FLOOR_FRACTION * 0.54)
        boss_str = ((m["hp"] * FLOOR_FRACTION * m["base"] / (625 * FLOOR_FRACTION)) - 21) / 0.435
        print(f"   week {w}: my base {m['base']:.0f}  HP {m['hp']:.0f}  reduction {m['red']:.0f}"
              f"  -> K ≈ {k_const:,.0f}, boss break-even STR ≈ {boss_str:,.0f}")
    scored = [(score(f, my_by_week[iso_week(f["ts"])]), f) for f in fights]
    ok = sum((s >= 1) == f["won"] for s, f in scored)
    q_ok = sum((f["wp"] >= 50) == f["won"] for f in fights)
    print(f"   rule correct {ok}/{len(scored)}   vs quoted>=50 correct {q_ok}/{len(fights)}")
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
    band = [f for s, f in scored if 0.8 <= s < 1.2]
    hi_q = [f for f in band if f["wp"] >= 51]
    print(f"   in-band quoted >= 51%: n={len(hi_q)} won {sum(f['won'] for f in hi_q)}")


if __name__ == "__main__":
    main()
