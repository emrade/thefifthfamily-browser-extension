#!/usr/bin/env python3
"""Checks the Analytics tab's suggested minimum card value against real
history: runs the extension's own `buildStreetIntelAnalytics` (bundled from
src/ with esbuild) as it would have looked on past days, for several current
minimums, and prints what it suggests and why.

What to look for:
- From a low minimum it should raise while the cards it cuts paid clearly
  less per Stamina than the next ones up (October: cards under ~$800k).
- From $800k in November it should say keep: the only card between $800k and
  $850k (the $849,850 high-risk one) paid the same per Stamina as $850k-1M.
- From a minimum too high for the board it should lower.

Each date and minimum prints two lines: "cash" judges on cash alone,
"+drop" on cash plus the drops' estimated sale value ($/S columns follow).

Steps: build_analytics_seed.py --out into a temp dir (attempts from --since,
every card), bundle verify_min_card_suggestion.harness.ts, run it.

Run: python3 verification/street-intel/verify_min_card_suggestion.py
       [--archive PATH ...] [--since YYYY-MM-DD] [--dates D1,D2,...]
       [--minimums 0,500000,...] [--extreme-min 1000000] [--src DIR]
`--src` bundles another copy of src/ (e.g. an older version) instead.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))


def money(v):
    if v is None:
        return "-"
    return f"${v / 1e6:.4g}M" if v >= 1e6 else f"${v / 1e3:.5g}k"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--archive", action="append", default=[])
    parser.add_argument("--since", default="2026-09-15", help="first game day of attempts to load")
    parser.add_argument("--dates", default="2026-10-15,2026-10-22,2026-10-29,2026-11-01,2026-11-05,2026-11-08")
    parser.add_argument("--minimums", default="0,500000,750000,800000,850000,1000000,1500000")
    parser.add_argument("--extreme-min", default="0", help="extreme card minimum, 0 = rule off")
    parser.add_argument("--src", default=os.path.join(REPO, "src"))
    parser.add_argument("--seed", help="reuse a seed file built earlier instead of reading the archives")
    args = parser.parse_args()

    tmp = tempfile.mkdtemp(prefix="si-min-check-")
    seed = args.seed
    if not seed:
        seed = os.path.join(tmp, "seed.json")
        cmd = [sys.executable, os.path.join(HERE, "build_analytics_seed.py"), "--since", args.since, "--card-days", "400", "--out", seed]
        for a in args.archive:
            cmd += ["--archive", a]
        subprocess.run(cmd, check=True, cwd=HERE)
    bundle = os.path.join(tmp, "harness.cjs")
    subprocess.run(
        ["npx", "esbuild", os.path.join(HERE, "verify_min_card_suggestion.harness.ts"), "--bundle", "--platform=node",
         "--format=cjs", f"--alias:@={args.src}", f"--outfile={bundle}", "--log-level=warning"],
        check=True, cwd=REPO,
    )
    out = subprocess.run(["node", bundle, seed, args.dates, args.minimums, args.extreme_min], check=True, cwd=tmp, capture_output=True, text=True).stdout

    print(f"\nseed: {seed}\n")
    print(f"{'as of':10} {'basis':5} {'yours':>8} -> {'suggests':>8} {'verdict':7} {'limit':8} cut cards ($/S, n)            next cards up ($/S, n)          supply/spent")
    for line in out.splitlines():
        r = json.loads(line)
        s = r["suggestion"]
        if not s:
            print(f"{r['date']:10} {'':5} {money(r['minimum']):>8}    {r['note']}")
            continue
        def grp(g):
            if not g:
                return ""
            per = g["cashPerStamina"] + (g["dropsPerStamina"] if s["countsDrops"] else 0)
            return f"{money(g['from'])}-{money(g['to'])} {money(per)} n={g['attempts']}"
        c = s.get("compare") or {}
        extra = s.get("verdict") and f"{s['verdict']:7} {(s.get('limit') or '-'):8} {grp(c.get('cut')):31} {grp(c.get('next')):31}" or ""
        blocked = s.get("blockedAt")
        tail = f"{s['supply']:.0f}/{s['spent']:.0f}" + (f"  (at {money(blocked['value'])}: {blocked['supply']:.0f})" if blocked else "")
        basis = "+drop" if s["countsDrops"] else "cash"
        print(f"{r['date']:10} {basis:5} {money(r['minimum']):>8} -> {money(s['value']):>8} {extra} {tail}")


if __name__ == "__main__":
    main()
