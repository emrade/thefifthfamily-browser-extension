#!/usr/bin/env python3
"""The player's level per hour, from every archived stats.php reading.

Run: python3 -I verification/street-intel/companion/extract_levels.py verification OUT.json
"""
import concurrent.futures, json, subprocess, sys
sys.path.insert(0, sys.argv[1])
from archive_paths import find_archives
def scan(path):
    out = {}
    p = subprocess.Popen(["/bin/sh", "-c", f"gzip -dc {json.dumps(path)} | grep -F '\"endpoint\":\"GET /api/stats.php\"'"], stdout=subprocess.PIPE, text=True, errors="replace")
    for line in p.stdout:
        try:
            r = json.loads(line); lv = json.loads(r["responseBody"])["stats"]["level"]
            day = r["timestamp"] // 3600_000
            out[day] = lv
        except Exception: pass
    p.wait(); return out
if __name__ == "__main__":
    m = {}
    with concurrent.futures.ProcessPoolExecutor(6) as pool:
        for o in pool.map(scan, find_archives()): m.update(o)
    json.dump(sorted(m.items()), open(sys.argv[2], "w")); print(len(m), "hourly level readings")
