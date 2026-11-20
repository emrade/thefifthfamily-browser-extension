#!/usr/bin/env python3
"""Pulls every Street Intel board card, scout and stats reading from all
archives into one compact JSON for the companion checks.

Run: python3 -I verification/street-intel/companion/extract_scouts.py verification OUT.json
(first argument: the folder holding archive_paths.py)
"""
import concurrent.futures, html, json, re, subprocess, sys
sys.path.insert(0, sys.argv[1])
from archive_paths import find_archives

BTN = re.compile(r'siScout\((\d+),this\)"\s+data-title="([^"]*)"\s+data-desc="[^"]*"\s+data-approaches="([^"]*)"\s+data-modifier="([^"]*)"')

def scan(path):
    boards, scouts, stats = {}, [], []
    cmd = f"gzip -dc {json.dumps(path)} | grep -F -e street_intel -e '\"endpoint\":\"GET /api/stats.php\"'"
    p = subprocess.Popen(["/bin/sh", "-c", cmd], stdout=subprocess.PIPE, text=True, errors="replace")
    for line in p.stdout:
        try: r = json.loads(line)
        except json.JSONDecodeError: continue
        ep, ts, body = r.get("endpoint", ""), r.get("timestamp") or 0, r.get("responseBody") or ""
        try:
            if ep == "GET /api/stats.php":
                s = json.loads(body)["stats"]
                stats.append([ts, s["strength"], s["defence"], s["agility"], s["dexterity"]])
            elif ep == "GET /api/panel.php?type=street_intel":
                for m in BTN.finditer(json.loads(body)["html"]):
                    boards[m.group(1)] = [html.unescape(m.group(2)), json.loads(html.unescape(m.group(3))), html.unescape(m.group(4))]
            elif ep == "POST /actions/street_intel.php" and "action=scout" in (r.get("requestBody") or ""):
                resp = json.loads(body)
                if resp.get("ok") is True and isinstance(resp.get("estimates"), list):
                    opp = re.search(r"opportunity_id=(\d+)", r["requestBody"])
                    scouts.append([ts, opp.group(1) if opp else None, resp["estimates"]])
        except (json.JSONDecodeError, KeyError, TypeError):
            continue
    p.wait()
    return boards, scouts, stats

if __name__ == "__main__":
    B, S, T = {}, {}, {}
    with concurrent.futures.ProcessPoolExecutor(6) as pool:
        for b, s, t in pool.map(scan, find_archives()):
            B.update(b)
            for x in s: S[(x[0], x[1])] = x
            for x in t: T[x[0]] = x
    json.dump({"boards": B, "scouts": sorted(S.values()), "stats": sorted(T.values())}, open(sys.argv[2], "w"))
    print(len(B), "board cards,", len(S), "scouts,", len(T), "stats readings")
