#!/usr/bin/env python3
"""Can members teach the companion tool a card it doesn't know?

Backs "Cards the pack doesn't know" in docs/companion-tool-plan.md. Every card
since 2026-09-06 has the same four approach bonuses (+25, +10, -10, always
fails), so an unknown card only needs each approach's role. This treats each
scout as an unknown card, calibrates the bonuses from a *different* card of the
same type scouted in the previous 6 hours, works out each revealed approach's
role, and compares with the real roles from the board.

Input: extract_scouts.py's JSON.
Run: python3 -I verification/street-intel/companion/verify_unknown_cards.py REPO_DIR SCOUTS_JSON
"""
import bisect, json, math, sys, collections
repo, data = sys.argv[1], json.load(open(sys.argv[2]))
CAT = json.load(open(repo + "/src/shared/data/streetIntelCatalog.json"))["cards"]
COND = json.load(open(repo + "/src/shared/data/streetIntelConditions.json"))["conditions"]
STATS = data["stats"]; sts = [s[0] for s in STATS]
IDX = {"strength": 1, "defence": 2, "agility": 3, "dexterity": 4}
ROLES = {25: "+25", 10: "+10", -10: "-10"}
def stats_at(ts):
    i = bisect.bisect_right(sts, ts) - 1
    return STATS[i] if i >= 0 and ts - STATS[i][0] <= 3600_000 else None
def role_of(a): return "AF" if a.get("autofail") else ROLES.get(a.get("bonus"))

recs = []
af_shown = collections.Counter()
for ts, opp, ests in data["scouts"]:
    b = data["boards"].get(opp)
    if not b: continue
    title, apps, modifier = b
    card = CAT.get(title.strip().lower()); cond = COND.get(modifier); st = stats_at(ts)
    if not card or cond is None or not st: continue
    by_key = {a["key"]: a for a in apps}
    if any(role_of(a) is None for a in apps): continue      # pre-September layouts
    rev, temp = [], False
    for e in ests:
        if not (isinstance(e, dict) and e.get("revealed") and isinstance(e.get("estimate_pct"), (int, float))): continue
        a = by_key.get(e.get("key"))
        if not a: continue
        m = e.get("modifiers") or {}
        if m.get("temporary"): temp = True
        if a.get("autofail"): af_shown[e["estimate_pct"]] += 1
        rev.append({"key": a["key"], "stat": a["stat"], "role": role_of(a), "bonus": a.get("bonus") or 0, "shown": e["estimate_pct"],
                    "S": sum(m.get(k, 0) for k in ("rank", "prestige", "collection", "recon", "mastery")) if m else None})
    if rev and not temp:
        recs.append({"ts": ts, "title": title, "cat": card["category"], "base": card["base"], "cond": cond, "st": st, "rev": rev, "n_app": len(apps)})
print(f"usable scouts with the current layout: {len(recs)}; what an always-fails approach shows when revealed: {dict(af_shown)}")

def other(r, a): return r["cond"]["global"] + r["st"][IDX[a["stat"]]] / 5 + r["cond"]["stats"].get(a["stat"], 0)
def s_window(r):
    lo, hi = -1e9, 1e9
    for a in r["rev"]:
        if a["role"] == "AF" or not (0 < a["shown"] < 95): continue
        lo = max(lo, ((a["shown"] - .5 - a["bonus"]) / r["base"] - 1) * 100 - other(r, a))
        hi = min(hi, ((a["shown"] + .5 - a["bonus"]) / r["base"] - 1) * 100 - other(r, a))
    return (lo, hi) if lo <= hi and lo > -1e8 else None

def infer(r, a, win):
    """Which roles fit what the game showed, given the member's calibrated window."""
    if a["shown"] == 0: return {"AF"}       # checked below: always-fails shows 0
    fits = set()
    for bonus, name in ROLES.items():
        lo = max(0, min(95, math.floor(r["base"] * (1 + (win[0] + other(r, a)) / 100) + bonus + .5)))
        hi = max(0, min(95, math.floor(r["base"] * (1 + (win[1] + other(r, a)) / 100) + bonus + .5)))
        if lo - 1 <= a["shown"] <= hi + 1: fits.add(name)   # 1 point slack for drift
    return fits

right = wrong = ambiguous = none = 0
last_cal = {}      # category -> (ts, window, title)
per_title = collections.defaultdict(list)
for r in recs:
    cal = last_cal.get(r["cat"])
    if cal and r["ts"] - cal[0] <= 6 * 3600_000 and cal[2] != r["title"]:
        known = []
        for a in r["rev"]:
            f = infer(r, a, cal[1])
            if f == {a["role"]}: right += 1; known.append((a["key"], a["role"]))
            elif a["role"] in f: ambiguous += 1
            elif not f: none += 1
            else: wrong += 1
        per_title[r["title"]].append((r["ts"], known, r["n_app"]))
    w = s_window(r)
    if w: last_cal[r["cat"]] = (r["ts"], w, r["title"])
tot = right + wrong + ambiguous + none
print(f"\nrevealed approaches judged: {tot}")
print(f"  role worked out correctly and uniquely: {right} ({100*right/tot:.1f}%)")
print(f"  two roles still possible (truth among them): {ambiguous} ({100*ambiguous/tot:.1f}%)")
print(f"  wrong role: {wrong} ({100*wrong/tot:.2f}%)   no role fits: {none} ({100*none/tot:.2f}%)")

# How many scouts until a card's four roles are all known (3 known -> the 4th follows).
needed = collections.Counter()
for t, seq in per_title.items():
    seq.sort(); known = {}
    for i, (ts, k, n) in enumerate(seq, 1):
        known.update(dict(k))
        if len(known) >= n - 1: needed[i] += 1; break
    else: needed["not yet"] += 1
print("\nscouts of a card until all its roles are known:", dict(sorted(needed.items(), key=lambda x: str(x[0]))))
rc = collections.Counter(len(r["rev"]) for r in recs)
print("approaches revealed per scout:", dict(sorted(rc.items())))
