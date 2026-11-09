#!/usr/bin/env python3
"""Builds the wiki-derived catalogues behind Dashboard → Stats → Advisor:

- src/shared/data/petCatalog.json: every pet's base stats, price, carry,
  travel and group (district or "Exclusive"), from the wiki's Menagerie page.
- src/shared/data/bloodlineCatalog.json: every Bloodline node (tree, path,
  tier, name, effect, LP, level), from the wiki's Bloodlines page. The
  in-game Bloodline page doesn't name nodes in tiers above the player's
  level, so their names and effects come from here.

Rerun whenever `wiki.py diff pets` or `wiki.py diff bloodlines` shows a change.

Run: python3 -I verification/wiki/build_stat_catalogs.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import wiki  # noqa: E402

OUT = os.path.join(REPO, "src", "shared", "data")


def num(s):
    s = (s or "").replace("$", "").replace(",", "").replace("x", "").strip()
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return None


def pets():
    page = wiki.parse_page(wiki.latest("pets").read_text())
    out = []
    for g in page["groups"]:
        group = re.sub(r"\s*\(\d+\).*$", "", g["title"]).strip()
        for c in g["cards"]:
            ch = c["chips"]
            out.append({
                "name": c["name"],
                "rarity": (c.get("tag") or "").title(),
                "group": group,
                "price": num(ch.get("Price")),
                "stats": {k.lower(): num(ch.get(k)) or 0 for k in ("STR", "DEF", "AGI", "DEX")},
                "carries": num(ch.get("Carries")),
                "travel": num(ch.get("Travel")),
            })
    return out


CATEGORY = re.compile(r"(?:CAPSTONE\s*)?(Combat|Chance|Survivability|Gear Scaling|Pet Scaling|Cap Increase|Economy|Income|Crime|Logistics|Stealth|Utility|Recovery|Progression|Operations|Influence|Steal|Career|Casino|Travel|Heist|Smuggling|Racket|Property|Bank|Luck|Recon|Jail|Heat|Gym|XP|Favor|Vitality)$")


def bloodlines():
    out = []
    unknown = set()
    groups = []
    for tree, section in (("Warlord", "bloodlines"), ("Shadow", "bloodlines-shadow"), ("Empire", "bloodlines-empire")):
        wiki.fetch(section)
        page = wiki.parse_page(wiki.latest(section).read_text())
        groups += [(tree, g) for g in page["groups"] if g.get("tables")]
    for tree, g in groups:
        path = re.sub(r"\s*\(.*$", "", g["title"]).strip()
        for row in g["tables"][0]["rows"]:
            raw = row["Node"]
            m = CATEGORY.search(raw)
            name = raw[: m.start()].strip() if m else raw
            if not m:
                unknown.add(raw)
            out.append({
                "tree": tree, "path": path, "tier": int(row["Tier"]), "name": name,
                "category": m.group(1) if m else "", "capstone": "CAPSTONE" in raw,
                "effect": row["Effect"], "lp": int(row["LP"]), "level": int(row["Level"]),
            })
    if unknown:
        print("WARNING: node names without a known category suffix:", sorted(unknown)[:10], file=sys.stderr)
    return out


def main():
    p, b = pets(), bloodlines()
    for name, data in (("petCatalog.json", p), ("bloodlineCatalog.json", b)):
        with open(os.path.join(OUT, name), "w") as f:
            json.dump(data, f, indent=1, ensure_ascii=False)
            f.write("\n")
    print(f"{len(p)} pets, {len(b)} bloodline nodes")
    print("trees/paths:", sorted({(n['tree'], n['path']) for n in b}))
    print("sample:", b[0], b[-1])


if __name__ == "__main__":
    main()
