#!/usr/bin/env python3
"""Can a member's hidden Street Intel bonuses be worked out from one scout?

Backs "Calibrating a member's bonuses" in docs/companion-tool-plan.md.

The game never shows a player's bonuses (rank, prestige, collection, recon,
mastery) — after a scout it only shows each revealed approach's final odds. The
companion tool works the shared bonus back out from those odds, the card's
base odds and condition, and the member's stats. This replays every archived
scout to check:

1. the formula with the true bonuses reproduces the shown odds;
2. how tightly one scout pins the shared bonus, and that the truth is inside;
3. how well bonuses calibrated from 1-3 scouts predict later scouts (same card
   type, and all types) over 6 and 24 hours, against the extension's own way
   (true bonuses carried forward).

Input: the JSON written by extract_scouts.py.
Run: python3 -I verification/street-intel/companion/verify_calibration.py REPO_DIR SCOUTS_JSON
"""

import bisect
import json
import math
import sys

repo, data = sys.argv[1], json.load(open(sys.argv[2]))
CAT = json.load(open(repo + "/src/shared/data/streetIntelCatalog.json"))["cards"]
COND = json.load(open(repo + "/src/shared/data/streetIntelConditions.json"))["conditions"]
STATS = data["stats"]
STAT_TS = [s[0] for s in STATS]
IDX = {"strength": 1, "defence": 2, "agility": 3, "dexterity": 4}
SHARED = ("rank", "prestige", "collection", "recon", "mastery")


def rnd(x):  # JS Math.round, as the extension and the game use
    return math.floor(x + 0.5)


def stats_at(ts):
    i = bisect.bisect_right(STAT_TS, ts) - 1
    return STATS[i] if i >= 0 and ts - STATS[i][0] <= 3600_000 else None


recs = []
for ts, opp, ests in data["scouts"]:
    b = data["boards"].get(opp)
    if not b:
        continue
    title, apps, modifier = b
    card, cond, st = CAT.get(title.strip().lower()), COND.get(modifier), stats_at(ts)
    if not card or cond is None or not st:
        continue
    by_key = {a["key"]: a for a in apps}
    rev = []
    for e in ests:
        if not (isinstance(e, dict) and e.get("revealed") and isinstance(e.get("estimate_pct"), (int, float))
                and isinstance(e.get("modifiers"), dict)):
            continue
        a = by_key.get(e.get("key"))
        if not a or a.get("autofail"):
            continue
        m = e["modifiers"]
        rev.append({"stat": a["stat"], "bonus": a.get("bonus") or 0, "shown": e["estimate_pct"],
                    "S_true": sum(m.get(k, 0) for k in SHARED), "temp": m.get("temporary", 0)})
    if rev:
        recs.append({"ts": ts, "cat": card["category"], "base": card["base"], "cond": cond, "st": st, "rev": rev})
clean = [r for r in recs if not any(a["temp"] for a in r["rev"])]
print(f"usable scouts: {len(recs)} ({len(recs) - len(clean)} during a short buff, left out)")


def other(r, a):
    return r["cond"]["global"] + r["st"][IDX[a["stat"]]] / 5 + r["cond"]["stats"].get(a["stat"], 0)


def pred(r, a, S):
    return max(0, min(95, rnd(r["base"] * (1 + (S + other(r, a)) / 100) + a["bonus"])))


def interval(r, a):
    if not 0 < a["shown"] < 95:
        return None
    return (((a["shown"] - 0.5 - a["bonus"]) / r["base"] - 1) * 100 - other(r, a),
            ((a["shown"] + 0.5 - a["bonus"]) / r["base"] - 1) * 100 - other(r, a))


ok = n = 0
for r in clean:
    for a in r["rev"]:
        n += 1
        ok += pred(r, a, a["S_true"]) == a["shown"]
print(f"\n1. formula with the true bonuses matches the shown odds: {ok}/{n} ({100 * ok / n:.1f}%)")

widths, inside = [], 0
for r in clean:
    iv = interval(r, r["rev"][0])
    if iv:
        widths.append(iv[1] - iv[0])
        inside += iv[0] - 1e-9 <= r["rev"][0]["S_true"] < iv[1] + 1e-9
widths.sort()
print(f"\n2. one scout pins the shared bonus to a window of median {widths[len(widths) // 2]:.1f} points "
      f"(90%: {widths[9 * len(widths) // 10]:.1f}); truth inside {inside}/{len(widths)}")


def run(hours, k, same_type, truth):
    errs = []
    for i in range(0, len(clean) - k, 3):
        cal = [clean[i]]
        for r in clean[i + 1:]:
            if len(cal) == k:
                break
            if r["cat"] == clean[i]["cat"] and r["ts"] - clean[i]["ts"] < 6 * 3600_000:
                cal.append(r)
        if len(cal) < k:
            continue
        if truth:
            S = cal[-1]["rev"][0]["S_true"]
        else:
            lo, hi = -1e9, 1e9
            for r in cal:
                for a in r["rev"]:
                    iv = interval(r, a)
                    if iv:
                        lo, hi = max(lo, iv[0]), min(hi, iv[1])
            if lo > hi or lo < -1e8:
                continue
            S = (lo + hi) / 2
        t0 = cal[-1]["ts"]
        for r in clean:
            if r["ts"] <= t0:
                continue
            if r["ts"] - t0 > hours * 3600_000:
                break
            if same_type and r["cat"] != cal[0]["cat"]:
                continue
            errs.extend(abs(pred(r, a, S) - a["shown"]) for a in r["rev"])
    errs.sort()
    m = len(errs)
    return (f"n={m:>7}  exact {100 * sum(e == 0 for e in errs) / m:3.0f}%  within 1 {100 * sum(e <= 1 for e in errs) / m:3.0f}%"
            f"  within 2 {100 * sum(e <= 2 for e in errs) / m:3.0f}%  95th pct {errs[int(.95 * m)]}")


print("\n3. predicting later scouts")
for hours in (6, 24):
    for same in (True, False):
        print(f"--- next {hours}h, {'same card type' if same else 'all card types'} ---")
        print("  true bonuses (extension):", run(hours, 1, same, True))
        for k in ((1, 2, 3) if same else (1,)):
            print(f"  calibrated, {k} scout(s):   ", run(hours, k, same, False))
