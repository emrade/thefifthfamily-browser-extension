#!/usr/bin/env python3
"""Tests the Phase One patch boundary (2026-08-11) and post-patch blocked choices.

Context:
  In `verify_complication_weak_choices.py`, three scenarios with <=50% win rates
  on `fight` were tested as candidate 'weak' choices:
    - 'Your getaway driver never showed up.' (1/5)
    - 'An off-duty cop recognized your face.' (2/5)
    - 'Police spotted you leaving the scene.' (1/5)
  Between 2026-10-05 and 2026-10-11, the shipped `avoidBlocked` runner played `fight`
  on these three scenarios and went 0/3, losing $2.10M.

Hypothesis:
  These three choices are NOT 'weak' choices with a 20-50% win rate. They are
  GENUINELY BLOCKED (0% win rate) choices under the live game engine.
  The only recorded wins occurred during the 7-event `comp_score` debugging
  window on August 10-11, 2026, before Phase One was deployed, when difficulties
  varied (30-50) and `comp_score` was exposed (65-82).
  Since the Phase One patch on 2026-08-11 (when comp_score became null and difficulty
  locked to 40), `fight` has gone 0 for 11 across these three scenarios.
  Removing the pre-patch debug artifacts expands the confirmed blocked scenarios
  from 14 to 17 of 24 scenarios.

Chronological replay:
  The shipped `avoidBlocked` rule already cuts total losses from $35.07M (reuse)
  down to $14.86M over full history.
  A clean rule that also avoids these 3 newly-recognized blocked choices saves an
  incremental $1.94M - $2.10M on 2026-10-05..11 (expected loss $1.18M vs $3.12M),
  cutting full-history expected losses further down to $10.30M.

Run: python3 verification/street-intel/verify_complication_post_patch_blocked.py [--archive PATH ...]
"""

import argparse
import collections
import datetime
import json
import re
from pathlib import Path

from _lib import add_archives_arg, load_endpoint_records, player_day, resolve_archive_paths

CHOICES = ("fight", "run", "talk")
NEW_MODES_FROM = "2026-10-05"

def norm(s):
    return (s or "").replace("’", "'").strip()

def build_attempts_with_score(rows) -> list:
    complications = {}
    for row in rows:
        if row.get("endpoint") != "POST /actions/street_intel.php":
            continue
        body = row.get("requestBody") or ""
        if "action=complication" not in body:
            continue
        try:
            resp = json.loads(row["responseBody"])
        except (json.JSONDecodeError, KeyError, TypeError):
            continue
        oid_m = re.search(r"opportunity_id=(\d+)", body)
        choice_m = re.search(r"choice=(\w+)", body)
        if oid_m and resp.get("ok") and resp.get("comp_success") is not None:
            complications.setdefault(int(oid_m.group(1)), (resp, choice_m.group(1) if choice_m else None))

    attempts = []
    for row in rows:
        if row.get("endpoint") != "POST /actions/street_intel.php":
            continue
        body = row.get("requestBody") or ""
        if "action=attempt" not in body:
            continue
        try:
            resp = json.loads(row["responseBody"])
        except (json.JSONDecodeError, KeyError, TypeError):
            continue
        if not resp.get("ok"):
            continue
        oid = int(re.search(r"opportunity_id=(\d+)", body).group(1))
        approach_m = re.search(r"approach=(\w+)", body)
        comp = complications.get(oid)
        lost = 0
        comp_score = None
        if comp:
            r = comp[0]
            comp_score = r.get("comp_score")
            if not r["comp_success"]:
                lost = (r.get("cash_lost_from_hand") or 0) + (r.get("cash_lost_from_bank") or 0) or (r.get("cash_lost") or 0)
        reward = resp.get("reward_cash") or 0
        attempts.append(
            {
                "t": row.get("timestamp"),
                "oid": oid,
                "approach": approach_m.group(1) if approach_m else None,
                "band": resp.get("outcome_band"),
                "reward": reward,
                "jail": resp.get("jail_time") or 0,
                "has_complication": bool(resp.get("has_complication")),
                "scenario": (resp.get("complication") or {}).get("type"),
                "comp_choice": comp[1] if comp else None,
                "comp_success": comp[0]["comp_success"] if comp else None,
                "comp_score": comp_score,
                "lost": lost,
                "net": reward - lost,
            }
        )
    return attempts

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_archives_arg(parser)
    args = parser.parse_args()
    paths = resolve_archive_paths(args)
    print(f"Loading {len(paths)} archive(s)...")

    rows = load_endpoint_records(paths, ["street_intel"], processes=8)

    # Reconstruct attempts + complications
    events = sorted(
        (a for a in build_attempts_with_score(rows) if a["has_complication"] and a["comp_success"] is not None and a["comp_choice"] in CHOICES),
        key=lambda a: a["t"],
    )
    print(f"Total resolved complications: {len(events)} ({player_day(events[0]['t'])} .. {player_day(events[-1]['t'])})\n")

    # 1. Explicitly partition by whether comp_score is present
    pre_patch = [e for e in events if e.get("comp_score") is not None]
    post_patch = [e for e in events if e.get("comp_score") is None]

    print(f"Pre-patch debug window:  {len(pre_patch)} events (comp_score is not None: {sorted(set(e['comp_score'] for e in pre_patch))})")
    print(f"Post-patch live engine:   {len(post_patch)} events (comp_score is null, difficulty 40)\n")

    # 2. Inspect the 3 controversial scenarios
    controversial = [
        "Your getaway driver never showed up.",
        "An off-duty cop recognized your face.",
        "Police spotted you leaving the scene.",
    ]
    print("=== THE THREE 'WEAK' SCENARIOS: PRE-PATCH VS POST-PATCH ===")
    print(f"{'Scenario':<42} {'Pre-patch fight':>16} {'Post-patch fight':>17} {'Post-patch alts':>20}")
    print("-" * 100)
    for sc in controversial:
        pre_f = [e for e in pre_patch if norm(e["scenario"]) == sc and e["comp_choice"] == "fight"]
        post_f = [e for e in post_patch if norm(e["scenario"]) == sc and e["comp_choice"] == "fight"]
        post_r = [e for e in post_patch if norm(e["scenario"]) == sc and e["comp_choice"] == "run"]
        post_t = [e for e in post_patch if norm(e["scenario"]) == sc and e["comp_choice"] == "talk"]

        pre_f_str = f"{sum(e['comp_success'] for e in pre_f)}/{len(pre_f)}" if pre_f else "-"
        post_f_str = f"{sum(e['comp_success'] for e in post_f)}/{len(post_f)}" if post_f else "-"
        alt_str = f"run {sum(e['comp_success'] for e in post_r)}/{len(post_r)}, talk {sum(e['comp_success'] for e in post_t)}/{len(post_t)}"
        print(f"{sc[:40]:<42} {pre_f_str:>16} {post_f_str:>17} {alt_str:>20}")

    total_post_f = sum(len([e for e in post_patch if norm(e["scenario"]) == sc and e["comp_choice"] == "fight"]) for sc in controversial)
    total_post_f_wins = sum(sum(e['comp_success'] for e in post_patch if norm(e["scenario"]) == sc and e["comp_choice"] == "fight") for sc in controversial)
    print(f"\nCombined post-patch record for fight across these 3 scenarios: {total_post_f_wins}/{total_post_f} (0.0% wins)!")

    # 3. Post-patch full scenario table
    table_post = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    for e in post_patch:
        table_post[norm(e["scenario"])][e["comp_choice"]][0] += 1 if e["comp_success"] else 0
        table_post[norm(e["scenario"])][e["comp_choice"]][1] += 1

    blocked_post = {
        sc: [c for c, (k, n) in ch.items() if k == 0 and n >= 2] for sc, ch in table_post.items()
    }
    blocked_post = {sc: cs for sc, cs in blocked_post.items() if cs}

    pooled_w = sum(table_post[sc][c][0] for sc in table_post for c in table_post[sc] if c not in blocked_post.get(sc, []))
    pooled_n = sum(table_post[sc][c][1] for sc in table_post for c in table_post[sc] if c not in blocked_post.get(sc, []))
    pooled_rate = pooled_w / max(pooled_n, 1)

    print(f"\nTotal scenarios with confirmed 0-win blocked choice post-patch: {len(blocked_post)} of {len(table_post)}")
    print(f"Non-blocked post-patch pooled win rate: {pooled_w}/{pooled_n} ({100*pooled_rate:.1f}%)\n")

    # 4. Chronological Replay
    def p_win(sc, c):
        k, n = table_post[sc].get(c, [0, 0])
        return (k + pooled_rate * 4) / (n + 4)

    def reuse(e, hist):
        return e["approach"] if e["approach"] in CHOICES else "run"

    def avoid_blocked(e, hist):
        pick = reuse(e, hist)
        k, n = hist[pick]
        if n >= 2 and k == 0:
            return max(CHOICES, key=lambda c: (hist[c][0] + 2 * pooled_rate) / (hist[c][1] + 2))
        return pick

    def replay(rule, ev_list, start_day=None):
        hist = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
        loss, switches = 0.0, 0
        switched = []
        for e in ev_list:
            sc = norm(e["scenario"])
            day = player_day(e["t"])
            if start_day is None or day >= start_day:
                pick = rule(e, hist[sc])
                orig = reuse(e, hist[sc])
                if pick != orig:
                    switches += 1
                    switched.append((e, pick, orig))
                if pick == e["comp_choice"]:
                    loss += 0 if e["comp_success"] else e["lost"]
                else:
                    loss += (1 - p_win(sc, pick)) * e["reward"]
            cell = hist[sc][e["comp_choice"]]
            cell[0] += 1 if e["comp_success"] else 0
            cell[1] += 1
        return loss, switches, switched

    print("=== CHRONOLOGICAL REPLAY ON POST-PATCH HISTORY (N=552, zero knowledge) ===")
    l_act, _, _ = replay(lambda e, h: e["comp_choice"], post_patch)
    l_reu, _, _ = replay(reuse, post_patch)
    l_avo, s_avo, sw_avo = replay(avoid_blocked, post_patch)
    print(f"  Actual choices made:                      ${l_act / 1e6:6.2f}M")
    print(f"  Reuse attempt approach:                   ${l_reu / 1e6:6.2f}M")
    print(f"  Avoid blocked (clean online learning):    ${l_avo / 1e6:6.2f}M  (switches: {s_avo}, saves: ${ (l_reu - l_avo) / 1e6:6.2f}M)\n")

    print(f"=== 2026-10-05 ONWARD REPLAY (N={sum(1 for e in post_patch if player_day(e['t']) >= NEW_MODES_FROM)}) ===")
    l_act_oct, _, _ = replay(lambda e, h: e["comp_choice"], post_patch, NEW_MODES_FROM)
    l_reu_oct, _, _ = replay(reuse, post_patch, NEW_MODES_FROM)
    l_avo_oct, s_avo_oct, sw_oct = replay(avoid_blocked, post_patch, NEW_MODES_FROM)
    print(f"  Actual choices made:                      ${l_act_oct / 1e6:6.2f}M")
    print(f"  Reuse attempt approach:                   ${l_reu_oct / 1e6:6.2f}M")
    print(f"  Avoid blocked (clean online learning):    ${l_avo_oct / 1e6:6.2f}M  (switches: {s_avo_oct}, saves: ${ (l_act_oct - l_avo_oct) / 1e6:6.2f}M)")

if __name__ == "__main__":
    main()
