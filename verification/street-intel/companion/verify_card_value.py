#!/usr/bin/env python3
"""Do "Worth it / OK / Skip" card labels from this player's drops hold up?

Backs "Card value check" in docs/companion-tool-plan.md (result: no — left out
of version 1). Drops valued as analyze_drops_by_card.py does.

Inputs: a seed from build_analytics_seed.py (run with `python3 -E -s` from
verification/street-intel, `--since 2026-08-10 --card-days 1`), extract_scouts.py's
JSON (for card titles), extract_levels.py's JSON.
Run: python3 -I verification/street-intel/companion/verify_card_value.py SEED_JSON SCOUTS_JSON LEVELS_JSON
"""
import bisect, json, sys, collections, math
seed = json.load(open(sys.argv[1])); boards = json.load(open(sys.argv[2]))["boards"]
lv = json.load(open(sys.argv[3])); lv_h = [x[0] for x in lv]
RISKS = ["low", "medium", "high", "extreme"]
Q = {"gold": 33_300_000, "underworld_epic": 15_625_000, "purple": 1_890_000, "infamous_rare": 550_000, "blue": 240_000, "green": 18_400, "grey": 21_000}
NON = {"consumable", "cash_box", "platinum", "mafia_gold"}; GOLDP = {"gold", "crowned_legendary"}
prices = seed["prices"]
def val(x):
    name, q, typ, header = x
    return 0 if header or typ in NON else prices.get(name.lower(), Q.get(q or "", 0))
def level(ts):
    i = bisect.bisect_right(lv_h, ts // 3600_000) - 1
    return lv[i][1] if i >= 0 else None
rows = []
for a in seed["attempts"]:
    if a[12] is None or not a[14]: continue
    b = boards.get(str(a[0]))
    rows.append({"title": b[0] if b else None, "tier": RISKS[a[10]] + (" LEG" if a[11] else ""), "lvl": level(a[1]),
                 "S": a[14], "cash": a[4] - (a[8] or 0), "drop": sum(val(x) for x in a[9]),
                 "gold": sum(1 for x in a[9] if x[1] in GOLDP and not x[3]), "mid": (a[12] + a[13]) / 2, "ts": a[1]})
lvls = [r["lvl"] for r in rows if r["lvl"]]
print(f"{len(rows)} attempts, levels {min(lvls)}–{max(lvls)}, titles known for {sum(1 for r in rows if r['title'])}")

def table(rs, key):
    g = collections.defaultdict(lambda: [0, 0, 0.0, 0.0, 0])
    for r in rs:
        x = g[key(r)]; x[0] += 1; x[1] += r["S"]; x[2] += r["cash"]; x[3] += r["drop"]; x[4] += r["gold"]
    return g

# 1. Does the card's title matter beyond its risk tier? Gold+ drop rate per title within each tier vs pure chance.
print("\n1. gold-or-better drops per try: spread between titles of the same tier, vs what chance alone gives")
for tier in sorted({r["tier"] for r in rows}):
    rs = [r for r in rows if r["tier"] == tier and r["title"]]
    g = table(rs, lambda r: r["title"])
    big = {t: x for t, x in g.items() if x[0] >= 15}
    if len(big) < 3: continue
    n = sum(x[0] for x in big.values()); k = sum(x[4] for x in big.values()); p = k / n
    chi = sum((x[4] - x[0] * p) ** 2 / (x[0] * p * (1 - p)) for x in big.values()) if 0 < p < 1 else 0
    df = len(big) - 1
    rates = sorted(x[4] / x[0] for x in big.values())
    print(f"   {tier:13} {len(big):3} titles, {n:5} tries, avg {p:.3f}/try, title range {rates[0]:.3f}–{rates[-1]:.3f}; spread vs chance: chi2 {chi:.0f} on {df} df ({'MORE than chance' if chi > df + 3 * math.sqrt(2 * df) else 'within chance'})")

# 2. Value per Stamina by tier, split by player level band.
bands = [(0, 109), (110, 129), (130, 999)]
print("\n2. per Stamina by tier and player level (cash / drops / total, $k per Stamina; tries)")
for lo, hi in bands:
    rs = [r for r in rows if r["lvl"] and lo <= r["lvl"] <= hi]
    if not rs: continue
    g = table(rs, lambda r: r["tier"])
    order = sorted(g.items(), key=lambda kv: -(kv[1][2] + kv[1][3]) / kv[1][1])
    print(f"   levels {lo}–{min(hi, max(lvls))} ({len(rs)} tries): " + " | ".join(
        f"{t} {x[2]/x[1]/1e3:.0f}/{x[3]/x[1]/1e3:.0f}/{(x[2]+x[3])/x[1]/1e3:.0f} ({x[0]})" for t, x in order if x[0] >= 20))

# 3. Are per-card labels stable? Split recent play (level 130+) into two halves in time and compare each title's value per Stamina.
rs = sorted([r for r in rows if r["lvl"] and r["lvl"] >= 130], key=lambda r: r["ts"])
half = len(rs) // 2
A = table(rs[:half], lambda r: r["title"]); B = table(rs[half:], lambda r: r["title"])
both = [t for t in A if t in B and A[t][0] >= 10 and B[t][0] >= 10]
def tot(x): return (x[2] + x[3]) / x[1]
def ranks(v):
    o = sorted(range(len(v)), key=lambda i: v[i]); r = [0] * len(v)
    for k, i in enumerate(o): r[i] = k
    return r
if len(both) >= 5:
    ra, rb = ranks([tot(A[t]) for t in both]), ranks([tot(B[t]) for t in both])
    n = len(both); rho = 1 - 6 * sum((x - y) ** 2 for x, y in zip(ra, rb)) / (n * (n * n - 1))
    third = lambda r: 0 if r < n / 3 else (1 if r < 2 * n / 3 else 2)
    same = sum(third(x) == third(y) for x, y in zip(ra, rb))
    print(f"\n3. level 130+, {n} titles with 10+ tries in both halves: rank correlation between halves {rho:.2f}; "
          f"same Worth it/OK/Skip third in both halves: {same}/{n}")
    lo_t = min(r['lvl'] for r in rs); print(f"   halves: {rs[0]['lvl']}–{rs[half-1]['lvl']} and {rs[half]['lvl']}–{rs[-1]['lvl']}")
