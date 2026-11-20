#!/usr/bin/env python3
"""Uploads a Street Intel pack to TFF Consigliere and makes it the active one.

Uses the restricted `pack_uploader` login from .env.consigliere (git-ignored;
it can only read and write the packs table). In one transaction: the old
active pack is switched off and the new one inserted as active, so members
never see none or two. The pack is tagged with the rules version it was
checked against (read from the app's generated rules file), and the app only
uses a pack whose rules version matches its own.

Run: python3 -I scripts/consigliere/upload_pack.py PACK_JSON main|dev [APP_DIR]
"""

import json
import re
import secrets
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent


def main():
    pack_path, branch = Path(sys.argv[1]), sys.argv[2]
    app = Path(sys.argv[3]) if len(sys.argv) > 3 else Path("/Users/emrade/Dev/Apps/nextjs/tff-consigliere")
    if branch not in ("main", "dev"):
        raise SystemExit("branch must be main or dev")

    env = {}
    for line in (REPO / ".env.consigliere").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    url = env.get(f"PACK_UPLOAD_URL_{branch.upper()}")
    if not url or not url.startswith("postgresql://"):
        raise SystemExit(f"PACK_UPLOAD_URL_{branch.upper()} missing from .env.consigliere")

    generated = (app / "src/lib/rules/street-intel.generated.js").read_text()
    m = re.search(r'RULES_VERSION = "([0-9a-f]+)"', generated)
    if not m:
        raise SystemExit("No RULES_VERSION in the app's generated rules: run build_rules.mjs first")
    rules_version = m.group(1)

    raw = pack_path.read_text()
    pack = json.loads(raw)
    summary = {
        "cards": len(pack["cards"]),
        "known": sum(1 for c in pack["cards"].values() if c["approaches"]),
        "conditions": len(pack["conditions"]),
    }
    tag = "p" + secrets.token_hex(8)
    if f"${tag}$" in raw:
        raise SystemExit("quoting clash, run again")

    def lit(s):
        return f"${tag}${s}${tag}$"

    sql = f"""
\\set ON_ERROR_STOP on
BEGIN;
UPDATE street_intel_packs SET is_active = false WHERE is_active;
INSERT INTO street_intel_packs (version, data_until, rules_version, pack, summary, is_active)
VALUES ({lit(pack["version"])}, {lit(pack["dataUntil"])}::timestamptz, {lit(rules_version)},
        {lit(raw)}::jsonb, {lit(json.dumps(summary))}::jsonb, true);
COMMIT;
SELECT version, rules_version, summary FROM street_intel_packs WHERE is_active;
"""
    res = subprocess.run(["psql", url, "-X", "-q", "-t", "-A"], input=sql, text=True, capture_output=True)
    if res.returncode != 0:
        err = re.sub(r"postgres(ql)?://\S+", "<url>", res.stderr)
        raise SystemExit(f"upload failed: {err.strip()[:400]}")
    print(f"{branch}: active pack is now {res.stdout.strip()}")


if __name__ == "__main__":
    main()
