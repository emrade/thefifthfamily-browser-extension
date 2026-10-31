#!/usr/bin/env python3
"""Builds the two tables that let the extension predict a Street Intel card's
exact odds before scouting it, then checks the prediction against every scout
in the archives.

- src/shared/data/streetIntelCatalog.json — every tip-off from the game's
  wiki (verification/wiki/wiki.py, section `intel`): base success, category,
  level, legendary, XP, keyed by lowercased title.
- src/shared/data/streetIntelConditions.json — every condition sentence the
  board shows on a card (`data-modifier`, e.g. "Extra guards spotted
  nearby.") mapped to the modifiers a scout reveals for it: `env_global`
  (one value per sentence) and `env_stat` per stat (one value per sentence
  and stat), plus the complication-risk direction from `modifier_intel`.
  Learned from the archives; a sentence is only written once every stat has
  been seen for it.

The check replays every scout since the 2026-08-21 formula change in time
order and predicts each revealed approach's `estimate_pct` from information
available before that scout: wiki base, the card's sentence, and the
player's modifiers from earlier scouts (mastery per category, rank refreshed
from attempts as 2 x rank). It must stay ~99% exact; the misses are moments
a buff, rank or mastery changed between scouts.

Run: python3 verification/street-intel/build_intel_tables.py [--archive PATH ...]
     (fetches/uses the newest wiki copy; see the use-wiki skill)
"""

import argparse
import collections
import json
import os
import re
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from _lib import add_archives_arg, load_endpoint_records, panel_html, parse_panel_cards, resolve_archive_paths

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "wiki"))
import wiki  # noqa: E402

DATA = os.path.join(os.path.dirname(__file__), "..", "..", "src", "shared", "data")
FORMULA_FROM = "2026-08-21T14"  # approach bonus became flat after the multiplier
APPROACH_COLUMN = {"fight": "Fight", "steel_yourself": "Steel Yourself", "run": "Run", "talk": "Talk"}
STATS = ("strength", "defence", "agility", "dexterity")


def round_half_up(x):
    return int(Decimal(repr(x)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def build_catalog():
    path = wiki.latest("intel")
    page = wiki.parse_page(path.read_text(encoding="utf-8"))
    catalog = {}
    for group in page["groups"]:
        for c in group["cards"]:
            ch = c["chips"]
            catalog[c["name"].lower()] = {
                "base": int(ch["Base Success"].rstrip("%")),
                "category": ch["Category"],
                "level": c["level"],
                "legendary": "LEGENDARY" in c["badges"],
                "xp": int(ch["XP"].replace(",", "")),
                # Kept for the check below; the board carries its own copy.
                "approaches": {line[3]: line[2] for line in c["lists"][0]["lines"]},
            }
    if len(catalog) != 240:
        raise SystemExit(f"expected 240 tip-offs in {path.name}, parsed {len(catalog)} — has the wiki layout changed?")
    return catalog, path.name


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_archives_arg(ap)
    args = ap.parse_args()

    catalog, wiki_copy = build_catalog()
    rows = load_endpoint_records(resolve_archive_paths(args), ["street_intel"])
    rows = [r for r in rows if (r.get("isoTime") or "") >= FORMULA_FROM]

    cards = {}
    for row in rows:
        if "type=street_intel" in (row.get("endpoint") or ""):
            cards.update(parse_panel_cards(panel_html(row)))

    # ---- conditions table
    glob, stat_fx, complication, seen = {}, collections.defaultdict(dict), {}, collections.Counter()
    conflicts = []
    scouts, attempts = [], []
    for row in rows:
        body = row.get("requestBody") or ""
        m = re.search(r"opportunity_id=(\d+)", body)
        if not m:
            continue
        try:
            resp = json.loads(row.get("responseBody") or "")
        except json.JSONDecodeError:
            continue
        if not isinstance(resp, dict) or resp.get("ok") is not True:
            continue
        oid = int(m.group(1))
        if "action=attempt" in body:
            attempts.append((row["timestamp"], resp))
            continue
        if "action=scout" not in body:
            continue
        scouts.append((row["timestamp"], oid, resp))
        card = cards.get(oid)
        if not card:
            continue
        sentence = card["modifier"] or ""
        intel = resp.get("modifier_intel") or ""
        if "Lower complication risk" in intel:
            complication.setdefault(sentence, "lower")
        elif "Higher complication risk" in intel:
            complication.setdefault(sentence, "higher")
        for e in resp.get("estimates") or []:
            mods = (e or {}).get("modifiers") or {}
            if not mods:
                continue
            g = mods.get("env_global", 0)
            if glob.setdefault(sentence, g) != g:
                conflicts.append((sentence, "env_global", glob[sentence], g))
            stat, s = e.get("stat"), mods.get("env_stat", 0)
            if stat_fx[sentence].setdefault(stat, s) != s:
                conflicts.append((sentence, stat, stat_fx[sentence][stat], s))
            seen[sentence] += 1
    if conflicts:
        raise SystemExit(f"a sentence mapped to more than one value — the table can't be trusted: {conflicts[:5]}")

    conditions = {}
    incomplete = []
    for sentence in sorted(glob):
        if any(s not in stat_fx[sentence] for s in STATS):
            incomplete.append(sentence)
            continue
        conditions[sentence] = {
            "global": glob[sentence],
            "stats": {s: v for s, v in stat_fx[sentence].items() if v},
            "complication": complication.get(sentence),
        }

    # ---- check: predict each scout from what was known before it
    rank_from_attempts = sorted((t, 2 * r["rank"]) for t, r in attempts if isinstance(r.get("rank"), int))
    player, stat_mod, mastery = None, {}, {}
    ri = 0
    rank_now = None
    hits = misses = skipped = 0
    for t, oid, resp in sorted(scouts, key=lambda s: s[0]):
        while ri < len(rank_from_attempts) and rank_from_attempts[ri][0] < t:
            rank_now = rank_from_attempts[ri][1]
            ri += 1
        card = cards.get(oid)
        entry = catalog.get((card or {}).get("title", "").lower()) if card else None
        cond = conditions.get(card["modifier"] or "") if card else None
        revealed = [e for e in resp.get("estimates") or [] if isinstance(e, dict) and e.get("estimate_pct") is not None and e.get("modifiers")]
        for e in revealed:
            if not (entry and cond and player and e.get("stat") in stat_mod and entry["category"] in mastery):
                skipped += 1
                continue
            bonus = entry["approaches"].get(APPROACH_COLUMN.get(e.get("key")))
            if bonus == "Auto-Fail":
                pred = 0
            else:
                rank = rank_now if rank_now is not None else player["rank"]
                total = (rank + player["prestige"] + player["collection"] + player["recon"] + player["temporary"]
                         + mastery[entry["category"]] + stat_mod[e["stat"]] + cond["global"] + cond["stats"].get(e["stat"], 0))
                pred = min(95, max(0, round_half_up(entry["base"] * (1 + total / 100) + int(bonus))))
            if pred == e["estimate_pct"]:
                hits += 1
            else:
                misses += 1
        for e in revealed:
            mods = e["modifiers"]
            player = {k: mods.get(k, 0) for k in ("rank", "prestige", "collection", "recon", "temporary")}
            rank_now = mods.get("rank", rank_now)
            stat_mod[e.get("stat")] = mods.get("stat", 0)
            if entry:
                mastery[entry["category"]] = mods.get("mastery", 0)

    checked = hits + misses
    print(f"catalog: {len(catalog)} tip-offs from wiki copy {wiki_copy}")
    print(f"conditions: {len(conditions)} sentences ({len(incomplete)} left out, not every stat seen yet: {incomplete})")
    print(f"check: {hits}/{checked} revealed estimates predicted exactly before scouting ({100 * hits / max(checked, 1):.2f}%), {skipped} not checkable")
    if checked == 0 or hits / checked < 0.98:
        raise SystemExit("prediction check below 98% — not writing the tables")

    for entry in catalog.values():
        del entry["approaches"]
    with open(os.path.join(DATA, "streetIntelCatalog.json"), "w") as f:
        json.dump({"source": wiki_copy, "cards": catalog}, f, separators=(",", ":"), sort_keys=True)
    with open(os.path.join(DATA, "streetIntelConditions.json"), "w") as f:
        json.dump({"through": max(r["isoTime"] for r in rows), "conditions": conditions}, f, separators=(",", ":"), sort_keys=True)
    print("wrote src/shared/data/streetIntelCatalog.json and streetIntelConditions.json")


if __name__ == "__main__":
    main()
