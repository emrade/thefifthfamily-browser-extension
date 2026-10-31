#!/usr/bin/env python3
"""Builds src/shared/data/arenaRoster.json — the Arena boss roster and Arena
Mastery bonuses, from the game's own wiki (section `arena`, in-game only: read
with `verification/wiki/wiki.py ingame arena`, see the use-wiki skill).

The extension's Arena Mastery tab and the Fight Advisor's "Needed for
Mastery" note use it for what the Ticket Exchange page doesn't state: each
boss's tier (the Exchange shows the *item's* rarity, not the boss's) and its
draw %. Which bosses are beaten comes from the Exchange itself.

Run: python3 verification/arena/build_arena_roster.py
"""

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "wiki"))
import wiki  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "src", "shared", "data", "arenaRoster.json")
TIERS = ("common", "uncommon", "rare", "legendary")
TIER_CHIP = {"common": "Commons", "uncommon": "Uncommons", "rare": "Rares", "legendary": "Legendary"}


def pct(text):
    return float(text.strip().lstrip("+").rstrip("%"))


def main():
    path = wiki.latest("arena", fetch_if_missing=False)
    page = wiki.parse_page(path.read_text(encoding="utf-8"))
    mastery_group, *family_groups = page["groups"]
    if mastery_group["title"] != "Arena Mastery" or len(family_groups) != 5:
        raise SystemExit(f"unexpected Arena Bosses layout in {path.name} — groups: {[g['title'] for g in page['groups']]}")

    families = []
    for c in mastery_group["cards"]:
        m = re.match(r"(.+?) \+([\d.]+)%$", c["tag"] or "")
        if not m:
            raise SystemExit(f"can't read the Mastery stat for {c['name']}: {c['tag']!r}")
        families.append({
            "name": c["name"],
            "stat": m.group(1),          # "STR", "DEF", "AGI", "DEX", "All Combat"
            "max": float(m.group(2)),
            "tierBonus": {t: pct(c["chips"][TIER_CHIP[t]]) for t in TIERS},
        })

    bosses = []
    for g in family_groups:
        for c in g["cards"]:
            ch = c["chips"]
            if c["tag"] not in TIERS:
                raise SystemExit(f"unknown boss tier {c['tag']!r} for {c['name']}")
            bosses.append({
                "name": c["name"],
                "family": g["title"],
                "tier": c["tag"],
                "item": c["labels"][0] if c["labels"] else None,
                "slot": ch["Slot"],
                "rarity": ch["Rarity"],
                "stats": {k.lower(): int(ch[k]) for k in ("STR", "DEF", "AGI", "DEX")},
                "tickets": int(ch["Tickets"]),
                "draw": pct(ch["Draw"]),
            })
    if len(bosses) != 95 or {f["name"] for f in families} != {g["title"] for g in family_groups}:
        raise SystemExit(f"expected 95 bosses in 5 families, got {len(bosses)}")

    with open(OUT, "w") as f:
        json.dump({"source": path.name, "families": families, "bosses": bosses}, f, separators=(",", ":"))
    print(f"{len(bosses)} bosses, {len(families)} families from {path.name} -> {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
