#!/usr/bin/env python3
"""Builds the Street Intel pack for TFF Consigliere from every archive.

The pack is game rules only, the same for every player:
- every catalogue card (wiki base odds, category, level), from
  src/shared/data/streetIntelCatalog.json;
- for cards seen on an archived board: each approach's key, label, stat and
  role (+25 / +10 / -10 / always fails), from the newest board showing it;
- the conditions table (src/shared/data/streetIntelConditions.json).

Never in it: stats, bonuses, cash, history or counts of any kind from the
player's account (docs/companion-tool-plan.md, "The Street Intel pack").

Fails rather than guessing when a board shows an approach outside the four
known roles (the game changed the layout) or a title changed approaches in
the last 45 days.

Run: python3 -I scripts/consigliere/build_pack.py OUT.json
"""

import concurrent.futures
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO / "verification"))
sys.path.insert(0, str(REPO / "verification/street-intel"))
from archive_paths import find_archives  # noqa: E402
from build_mobile_guide import scan  # noqa: E402

ROLES = {25: "+25", 10: "+10", -10: "-10"}
STATS = {"strength", "defence", "agility", "dexterity"}
RECENT_MS = 45 * 86_400_000


def role_of(a):
    if a.get("autofail"):
        return "always_fails"
    return ROLES.get(a.get("bonus") or 0)


def main():
    out = Path(sys.argv[1])
    files = find_archives()
    boards = []
    with concurrent.futures.ProcessPoolExecutor(max_workers=6) as pool:
        for path, (events, _stats) in zip(files, pool.map(scan, files)):
            boards.extend((ts, data) for ts, kind, data in events if kind == "board")
            print(f"  {Path(path).name}: {sum(1 for e in events if e[1] == 'board')} boards", file=sys.stderr)
    if not boards:
        raise SystemExit("No Street Intel boards in the archives: nothing to build from.")
    boards.sort(key=lambda b: b[0])
    newest = boards[-1][0]

    catalog = json.loads((REPO / "src/shared/data/streetIntelCatalog.json").read_text())["cards"]
    conditions = json.loads((REPO / "src/shared/data/streetIntelConditions.json").read_text())["conditions"]

    latest, names, recent_shapes = {}, {}, defaultdict(set)
    for ts, cards in boards:
        for _opp, title, approaches in cards:
            key = title.strip().lower()
            names[key] = title.strip()
            latest[key] = approaches
            if ts >= newest - RECENT_MS:
                recent_shapes[key].add(tuple((a.get("key"), a.get("stat"), a.get("bonus"), bool(a.get("autofail"))) for a in approaches))

    problems = [f"{k}: approaches changed in the last 45 days" for k, s in recent_shapes.items() if len(s) > 1]
    pack_cards = {}
    for key, entry in sorted(catalog.items()):
        card = {
            "name": names.get(key, key.title()),
            "base": entry["base"],
            "category": entry["category"],
            "level": entry["level"],
            "legendary": bool(entry.get("legendary")),
            "approaches": None,
        }
        if key in latest and key in recent_shapes:
            apps = []
            for a in latest[key]:
                role = role_of(a)
                if role is None or a.get("stat") not in STATS or not a.get("key") or not a.get("label"):
                    problems.append(f"{key}: unexpected approach {json.dumps(a)[:120]}")
                    continue
                apps.append({"key": a["key"], "label": a["label"].strip(), "stat": a["stat"], "role": role})
            roles = sorted(a["role"] for a in apps)
            if roles != sorted(["+25", "+10", "-10", "always_fails"]):
                problems.append(f"{key}: roles {roles}, expected one of each")
            card["approaches"] = apps
        pack_cards[key] = card

    if problems:
        print("\n".join(problems[:20]), file=sys.stderr)
        raise SystemExit(f"{len(problems)} problem(s): the game may have changed the card layout. Not building.")

    version = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M")
    pack = {
        "version": version,
        "dataUntil": datetime.fromtimestamp(newest / 1000, timezone.utc).isoformat(timespec="seconds"),
        "cards": pack_cards,
        "conditions": {
            sentence: {"global": c["global"], "stats": c["stats"], "complication": c.get("complication")}
            for sentence, c in sorted(conditions.items())
        },
    }
    out.write_text(json.dumps(pack, separators=(",", ":"), ensure_ascii=False))
    known = sum(1 for c in pack_cards.values() if c["approaches"])
    print(f"pack {version}: {len(pack_cards)} cards ({known} with approaches), {len(pack['conditions'])} conditions, "
          f"data until {pack['dataUntil']} -> {out} ({out.stat().st_size // 1024} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
