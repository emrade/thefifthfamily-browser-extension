#!/usr/bin/env python3
"""Builds the data for the Street Intel phone guide (an Artifact page) from
every archive, and writes the finished page.

The page works out a card's odds before scouting with the same formula as
`src/shared/streetIntelPredict.ts`, from:
- the wiki base odds and condition table the extension ships
  (`src/shared/data/streetIntelCatalog.json`, `streetIntelConditions.json`);
- each card title's approaches (stat, bonus, autofail), from archived boards;
- the player's own bonuses, replayed the way
  `src/background/features/streetIntel/playerMods.ts` keeps them: every
  scout updates rank/prestige/collection/recon and that card type's mastery,
  every attempt's `rank` updates the rank bonus (2 x rank), and every Street
  Intel page updates rank/prestige/recon/mastery from the bonuses it shows
  (Python twin of `src/shared/streetIntelPageBonuses.ts`; collection is only
  ever from scouts);
- the latest strength/defence/agility/dexterity from stats.php;
- every resolved complication, paired with its attempt's scenario the same
  way as build_complication_seed.py (pre-Phase-One rows skipped).

Run: python3 -I verification/street-intel/build_mobile_guide.py OUT.html
"""

import concurrent.futures
import html
import json
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE.parent))
from archive_paths import find_archives  # noqa: E402

TEMPLATE = HERE / "mobile_guide.html"
CHOICES = ("fight", "run", "talk")

BUTTON_RE = re.compile(
    r'siScout\((\d+),this\)"\s+data-title="([^"]*)"\s+data-desc="[^"]*"\s+data-approaches="([^"]*)"\s+data-modifier="([^"]*)"'
)


PAGE_CATEGORIES = ("Robbery", "Interception", "Extortion", "Exploitation", "Leverage")


def _page_text(h):
    h = re.sub(r"<(script|style)\b.*?</\1>", " ", h, flags=re.S | re.I)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h)))


def page_bonuses(h):
    """The bonuses the Street Intel page shows, or None: same rules as
    parsePageBonuses in src/shared/streetIntelPageBonuses.ts."""
    # The Active Bonuses row itself, not the page's CSS rule for it (which comes first).
    m = re.search(r'class="[^"]*\bsi-bonuses\b', h)
    if not m:
        return None
    i = m.start()
    t = _page_text(h)
    rank = re.search(r"\+([\d.]+)% rank bonus", t)
    recon = re.search(r"\+([\d.]+)% recon\b", t)
    if not (rank and recon):
        return None
    pills = _page_text(h[i:i + 6000])
    prestige = re.search(r"\+([\d.]+)% Prestige(?! Loot)", pills)
    mastery = {}
    for c in PAGE_CATEGORIES:
        m = re.search(r"\+([\d.]+)% " + c + r"\b", pills)
        if m:
            mastery[c] = float(m.group(1))
    num = lambda s: int(float(s)) if float(s).is_integer() else float(s)
    return {"rank": num(rank.group(1)), "recon": num(recon.group(1)), "prestige": num(prestige.group(1)) if prestige else None,
            "mastery": {k: num(str(v)) for k, v in mastery.items()}}


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("’", "'")).strip()


def scan(path):
    """One archive -> compact events. Filters text with grep before parsing."""
    events = []
    stats = None
    cmd = f"gzip -dc {json.dumps(path)} | grep -F -e street_intel -e '\"endpoint\":\"GET /api/stats.php\"'"
    proc = subprocess.Popen(["/bin/sh", "-c", cmd], stdout=subprocess.PIPE, text=True, errors="replace")
    for line in proc.stdout:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        ep = row.get("endpoint", "")
        ts = row.get("timestamp") or 0
        body = row.get("responseBody") or ""
        if ep == "GET /api/stats.php":
            if stats is None or ts > stats[0]:
                try:
                    s = json.loads(body)["stats"]
                    stats = (ts, {k: s[k] for k in ("strength", "defence", "agility", "dexterity", "level")})
                except (json.JSONDecodeError, KeyError, TypeError):
                    pass
            continue
        if ep == "GET /api/panel.php?type=street_intel":
            try:
                h = json.loads(body)["html"]
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
            cards = []
            for m in BUTTON_RE.finditer(h):
                try:
                    approaches = json.loads(html.unescape(m.group(3)))
                except json.JSONDecodeError:
                    continue
                cards.append((int(m.group(1)), html.unescape(m.group(2)), approaches))
            if cards:
                events.append((ts, "board", cards))
            bonuses = page_bonuses(h)
            if bonuses:
                events.append((ts, "pagebonus", bonuses))
            continue
        if ep != "POST /actions/street_intel.php":
            continue
        req = row.get("requestBody") or ""
        try:
            resp = json.loads(body)
        except json.JSONDecodeError:
            continue
        if not isinstance(resp, dict) or resp.get("ok") is not True:
            continue
        opp = re.search(r"opportunity_id=(\d+)", req)
        opp = int(opp.group(1)) if opp else None
        if "action=scout" in req:
            for e in resp.get("estimates") or []:
                if isinstance(e, dict) and isinstance(e.get("modifiers"), dict) and isinstance(e.get("estimate_pct"), (int, float)):
                    events.append((ts, "scout", (opp, e["modifiers"])))
                    break
        elif "action=attempt" in req:
            comp = resp.get("complication") or {}
            scen = norm(comp.get("type")) if resp.get("has_complication") and isinstance(comp, dict) and isinstance(comp.get("type"), str) else None
            events.append((ts, "attempt", (opp, resp.get("rank"), scen)))
        elif "action=complication" in req:
            if isinstance(resp.get("comp_success"), bool):
                choice = re.search(r"choice=(\w+)", req)
                events.append((ts, "comp", (opp, choice.group(1) if choice else None, resp["comp_success"], resp.get("comp_score") is not None)))
    proc.wait()
    return events, stats


def collect():
    """Every archive's events, de-duplicated and in time order, plus the
    newest stats. Shared with scripts/consigliere/build_pack.py."""
    files = find_archives()
    events, stats = [], None
    with concurrent.futures.ProcessPoolExecutor(max_workers=6) as pool:
        for path, (ev, st) in zip(files, pool.map(scan, files)):
            events.extend(ev)
            if st and (stats is None or st[0] > stats[0]):
                stats = st
            print(f"  {Path(path).name}: {len(ev)} events", file=sys.stderr)

    # Raw exports overlap each other and the merged months.
    seen, uniq = set(), []
    for e in events:
        key = (e[0], e[1], json.dumps(e[2], sort_keys=True, default=str)[:200])
        if key not in seen:
            seen.add(key)
            uniq.append(e)
    uniq.sort(key=lambda e: e[0])
    return uniq, stats


def complication_tally(uniq, choices=CHOICES):
    """{scenario: {choice: [wins, attempts]}}: every resolved complication,
    paired with its attempt's scenario by opportunity id, as
    build_complication_seed.py does. The first resolution per opportunity
    counts; pre-Phase-One rows (still returning comp_score) are skipped."""
    scen_by_opp, done_opp = {}, set()
    tally = defaultdict(lambda: {c: [0, 0] for c in choices})
    for _ts, kind, data in uniq:
        if kind == "attempt":
            opp, _rank, scen = data
            if scen and opp is not None:
                scen_by_opp[opp] = scen
        elif kind == "comp":
            opp, choice, success, pre_patch = data
            if opp is None or opp in done_opp:
                continue
            done_opp.add(opp)
            if pre_patch or choice not in choices or opp not in scen_by_opp:
                continue
            cell = tally[scen_by_opp[opp]][choice]
            cell[1] += 1
            cell[0] += 1 if success else 0
    return tally


def main():
    out = Path(sys.argv[1])
    uniq, stats = collect()

    catalog = json.loads((REPO / "src/shared/data/streetIntelCatalog.json").read_text())["cards"]
    conditions = json.loads((REPO / "src/shared/data/streetIntelConditions.json").read_text())["conditions"]

    title_by_id = {}
    approaches_by_title = {}
    variants = defaultdict(set)
    # The game served different approach sets per title before 2026-09-06;
    # only boards from the last 45 days decide whether a title still varies.
    recent_from = uniq[-1][0] - 45 * 86_400_000
    mods = None  # rank, prestige, collection, recon, mastery{category: (value, ts)}, scoutAt, rankAt
    tally = complication_tally(uniq)
    last_attempt = 0

    for ts, kind, data in uniq:
        if kind == "board":
            for opp, title, approaches in data:
                title_by_id[opp] = title
                shape = tuple((a.get("key"), a.get("stat"), a.get("bonus"), bool(a.get("autofail"))) for a in approaches)
                if ts >= recent_from:
                    variants[title.lower()].add(shape)
                approaches_by_title[title.lower()] = [
                    {"key": a.get("key"), "label": a.get("label"), "stat": a.get("stat"), "bonus": a.get("bonus") or 0, "autofail": bool(a.get("autofail"))}
                    for a in approaches
                ]
        elif kind == "scout":
            opp, m = data
            title = title_by_id.get(opp)
            category = catalog.get(title.lower(), {}).get("category") if title else None
            prev = mods or {"mastery": {}}
            mastery = dict(prev["mastery"])
            if category and isinstance(m.get("mastery"), (int, float)):
                mastery[category] = [m["mastery"], ts]
            mods = {
                "rank": m.get("rank", prev.get("rank", 0)),
                "prestige": m.get("prestige", prev.get("prestige", 0)),
                "collection": m.get("collection", prev.get("collection", 0)),
                "recon": m.get("recon", prev.get("recon", 0)),
                "mastery": mastery,
                "scoutAt": ts,
                "rankAt": ts,
            }
        elif kind == "pagebonus":
            # Needs a scout first (collection is only ever from scouts).
            if mods:
                mods["rank"] = data["rank"]
                mods["recon"] = data["recon"]
                if data["prestige"] is not None:
                    mods["prestige"] = data["prestige"]
                for c, v in data["mastery"].items():
                    mods["mastery"][c] = [v, ts]
                mods["rankAt"] = ts
                mods["pageAt"] = ts
        elif kind == "attempt":
            _opp, rank, _scen = data
            last_attempt = ts
            if mods and isinstance(rank, int) and rank * 2 != mods["rank"]:
                mods["rank"] = rank * 2
                mods["rankAt"] = ts

    if not mods or not stats:
        raise SystemExit("No scout or stats found in the archives — nothing to build from.")

    changing = sorted(t for t, v in variants.items() if len(v) > 1)
    cards = {}
    for key, entry in catalog.items():
        if key not in approaches_by_title:
            continue
        cards[key] = {**entry, "approaches": approaches_by_title[key], "varies": key in changing}

    newest = uniq[-1][0]
    data = {
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataUntil": newest,
        "cards": cards,
        "catalogTitles": len(catalog),
        "conditions": conditions,
        "mods": mods,
        "stats": {"at": stats[0], **stats[1]},
        "lastAttemptAt": last_attempt,
        "complications": {s: {c: v for c, v in cells.items() if v[1]} for s, cells in tally.items()},
    }
    # Display names: the board's own capitalisation.
    names = {}
    for title in title_by_id.values():
        names.setdefault(title.lower(), title)
    data["names"] = {k: names.get(k, k.title()) for k in cards}

    page = TEMPLATE.read_text().replace("/*GUIDE_DATA*/null", json.dumps(data, separators=(",", ":")))
    out.write_text(page)

    def when(ms):
        return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    print(f"cards with known approaches: {len(cards)} of {len(catalog)}", file=sys.stderr)
    print(f"titles whose approaches changed in the last 45 days: {len(changing)} {changing[:8]}", file=sys.stderr)
    print(f"bonuses: {json.dumps({k: v for k, v in mods.items() if k != 'mastery'})}", file=sys.stderr)
    print(f"mastery: {json.dumps(mods['mastery'])}", file=sys.stderr)
    page_at = when(mods["pageAt"]) if mods.get("pageAt") else "never"
    print(f"last scout {when(mods['scoutAt'])}, last Street Intel page {page_at}, rank updated {when(mods['rankAt'])}, stats {when(stats[0])}: {stats[1]}", file=sys.stderr)
    print(f"complications: {sum(c[1] for s in tally.values() for c in s.values())} across {len(tally)} scenarios", file=sys.stderr)
    print(f"data until {when(newest)} -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
