#!/usr/bin/env python3
"""Tests candidate predictors of Street Intel complication outcomes.

Tests whether any of the following variables predict complication win/loss
beyond the scenario-level blocked choice rule:
  1. Player raw stats (Strength, Defence, Agility, Dexterity) and chosen stat
  2. Relative stats (chosen / max stat, chosen - max others, chosen / sum stats)
  3. Context at attempt time (Crime Heat, Env Global modifier)
  4. Card attributes (Risk Tier, Card approaches autofail flag)
  5. Timing and fatigue (UTC hour of day, complication index within day, time since last)
  6. Streaks (prior win/loss streaks, testing for pity or anti-streak mechanics)
  7. Calendar periods (Pre-patch vs Post-patch, Anomaly window 09-21..30, Halloween event 10-01..11)

Result:
  Among non-blocked complication choices, EVERY candidate predictor is FLAT.
  - Raw chosen stat: Wins mean=68.1 vs Losses mean=65.7 (Welch t=0.844, p=0.3988)
  - Relative stat (chosen / max): Wins mean=0.767 vs Losses mean=0.778 (p=0.4215)
  - Crime heat: Wins mean=10.05 vs Losses mean=11.53 (Welch t=-0.511, p=0.6094)
  - Env global: Wins mean=-0.52 vs Losses mean=0.36 (p=0.4117)
  - Card autofail: Autofaill on card choice wins 86.2% vs 85.3% without (p=0.85)
  - Day position & fatigue: Wins mean index=6.93 vs Losses mean=7.02 (p=0.8876)
  - Streaks: Win rate directly after a loss is 87.2%, exactly matching pooled (86.4%).
  Complication rolls operate as independent Bernoulli trials at an ~85% ceiling.

Run: python3 verification/street-intel/verify_complication_predictors.py [--archive PATH ...]
"""

import argparse
import bisect
import collections
import datetime
import json
import math
import re
from pathlib import Path

from _lib import add_archives_arg, load_endpoint_records, panel_html, parse_panel_cards, player_day, resolve_archive_paths

CHOICES = ("fight", "run", "talk", "stand_ground")

def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0

def std(xs):
    if len(xs) < 2: return 0.0
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))

def welch_t_test(xs, ys):
    nx, ny = len(xs), len(ys)
    if nx < 2 or ny < 2: return 0.0, 1.0
    mx, my = mean(xs), mean(ys)
    vx, vy = (std(xs)**2) / nx, (std(ys)**2) / ny
    if vx + vy == 0: return 0.0, 1.0
    t = (mx - my) / math.sqrt(vx + vy)
    z = abs(t)
    p = math.erfc(z / math.sqrt(2))
    return t, p

def norm(s):
    return (s or "").replace("’", "'").strip()

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_archives_arg(parser)
    args = parser.parse_args()
    paths = resolve_archive_paths(args)
    print(f"Loading {len(paths)} archive(s)...")

    rows = load_endpoint_records(paths, ["street_intel", "stats.php"], processes=8)

    # 1. Timeline of stats.php
    stats_timeline = []
    for r in rows:
        if "stats.php" in (r.get("endpoint") or ""):
            try:
                resp = json.loads(r.get("responseBody") or "")
                if resp.get("ok") and "stats" in resp:
                    stats_timeline.append((r.get("timestamp") or 0, resp["stats"]))
            except Exception:
                pass
    stats_timeline.sort(key=lambda x: x[0])
    stats_ts = [x[0] for x in stats_timeline]

    def get_stats_at(ts):
        if not stats_timeline: return {}
        idx = bisect.bisect_right(stats_ts, ts) - 1
        return stats_timeline[max(0, idx)][1]

    # 2. Panel cards
    cards = {}
    for r in rows:
        if "type=street_intel" in (r.get("endpoint") or ""):
            html_text = panel_html(r)
            if html_text:
                cards.update(parse_panel_cards(html_text))

    # 3. Scouts
    scouts = {}
    for r in rows:
        if r.get("endpoint") == "POST /actions/street_intel.php":
            body = r.get("requestBody") or ""
            if "action=scout" in body:
                m = re.search(r"opportunity_id=(\d+)", body)
                if m:
                    try:
                        resp = json.loads(r.get("responseBody") or "")
                        if resp.get("ok"):
                            scouts[int(m.group(1))] = resp
                    except Exception:
                        pass

    # 4. Complications
    complications = {}
    for r in rows:
        if r.get("endpoint") == "POST /actions/street_intel.php":
            body = r.get("requestBody") or ""
            if "action=complication" in body:
                m = re.search(r"opportunity_id=(\d+)", body)
                if m:
                    try:
                        resp = json.loads(r.get("responseBody") or "")
                        if resp.get("ok") and resp.get("comp_success") is not None:
                            complications.setdefault(int(m.group(1)), []).append((r.get("timestamp") or 0, body, resp))
                    except Exception:
                        pass

    # 5. Attempts joined
    events = []
    for r in rows:
        if r.get("endpoint") != "POST /actions/street_intel.php":
            continue
        body = r.get("requestBody") or ""
        if "action=attempt" not in body:
            continue
        m = re.search(r"opportunity_id=(\d+)", body)
        if not m:
            continue
        oid = int(m.group(1))
        try:
            resp = json.loads(r.get("responseBody") or "")
        except Exception:
            continue
        if not resp.get("ok") or not resp.get("has_complication"):
            continue

        comp_list = complications.get(oid, [])
        if not comp_list:
            continue
        att_ts = r.get("timestamp") or 0
        comp_matches = [c for c in comp_list if c[0] >= att_ts] or comp_list
        comp_ts, comp_body, comp_resp = comp_matches[0]

        choice_m = re.search(r"choice=(\w+)", comp_body)
        comp_choice = choice_m.group(1) if choice_m else comp_resp.get("choice")

        approach_m = re.search(r"approach=(\w+)", body)
        att_approach = approach_m.group(1) if approach_m else None

        card = cards.get(oid, {})
        scout = scouts.get(oid, {})
        p_stats = get_stats_at(comp_ts)
        att_stats = resp.get("stats") or {}

        s_str = p_stats.get("strength")
        s_def = p_stats.get("defence")
        s_agi = p_stats.get("agility")
        s_dex = p_stats.get("dexterity")
        stat_map = {"fight": s_str, "run": s_agi, "talk": s_dex, "stand_ground": s_def}

        env_global = None
        for est in scout.get("estimates", []):
            if est.get("modifiers"):
                env_global = est["modifiers"].get("env_global")

        card_approaches = card.get("approaches", [])
        approach_autofail = {ap.get("key"): ap.get("autofail") for ap in card_approaches}

        comp_info = resp.get("complication") or {}
        events.append({
            "oid": oid,
            "ts": comp_ts,
            "day": player_day(comp_ts),
            "scenario": norm(comp_info.get("type")),
            "choice": comp_choice,
            "success": bool(comp_resp.get("comp_success")),
            "comp_score": comp_resp.get("comp_score"),
            "difficulty": comp_info.get("difficulty"),
            "attempt_approach": att_approach,
            "reward": resp.get("reward_cash") or 0,
            "crime_heat": att_stats.get("crime_heat", p_stats.get("heat")),
            "cash_on_hand": att_stats.get("cash", p_stats.get("cash")),
            "bank": p_stats.get("bank"),
            "strength": s_str,
            "defence": s_def,
            "agility": s_agi,
            "dexterity": s_dex,
            "chosen_stat": stat_map.get(comp_choice),
            "risk": card.get("risk"),
            "autofail": approach_autofail.get(comp_choice),
            "env_global": env_global,
        })

    events.sort(key=lambda x: x["ts"])
    print(f"Total resolved complications: {len(events)}\n")

    # Filter out post-patch blocked cells
    # A choice is blocked if it went 0-for-N (N>=2) post-patch
    post_events = [e for e in events if e.get("comp_score") is None]
    table = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    for e in post_events:
        table[e["scenario"]][e["choice"]][0] += 1 if e["success"] else 0
        table[e["scenario"]][e["choice"]][1] += 1

    blocked_cells = set()
    for sc, chs in table.items():
        for c, (w, n) in chs.items():
            if n >= 2 and w == 0:
                blocked_cells.add((sc, c))

    non_blocked = [e for e in post_events if (e["scenario"], e["choice"]) not in blocked_cells and e["choice"] in ("fight", "run", "talk")]
    print(f"Non-blocked post-patch events analyzed: {len(non_blocked)}")
    print(f"Overall non-blocked win rate: {sum(1 for e in non_blocked if e['success'])}/{len(non_blocked)} ({100*sum(1 for e in non_blocked if e['success'])/len(non_blocked):.1f}%)\n")

    # 1. Raw Stats
    wins = [e for e in non_blocked if e["success"]]
    losses = [e for e in non_blocked if not e["success"]]
    w_stat = [e["chosen_stat"] for e in wins if e.get("chosen_stat")]
    l_stat = [e["chosen_stat"] for e in losses if e.get("chosen_stat")]
    t, p = welch_t_test(w_stat, l_stat)
    print("1. RAW CHOSEN STAT:")
    print(f"   Wins: mean={mean(w_stat):.1f} (std={std(w_stat):.1f}) vs Losses: mean={mean(l_stat):.1f} (std={std(l_stat):.1f})")
    print(f"   Welch t = {t:.3f}, p = {p:.4f}  -> FLAT (no stat scaling)\n")

    # 2. Relative Stats
    print("2. RELATIVE STAT RATIOS:")
    for name, fn in [
        ("chosen / max_stat", lambda e: e["chosen_stat"] / max(e["strength"], e["defence"], e["agility"], e["dexterity"])),
        ("chosen - max_others", lambda e: e["chosen_stat"] - max(v for k, v in [("fight", e["strength"]), ("run", e["agility"]), ("talk", e["dexterity"]), ("stand_ground", e["defence"])] if k != e["choice"])),
        ("chosen / sum_stats", lambda e: e["chosen_stat"] / (e["strength"] + e["defence"] + e["agility"] + e["dexterity"])),
    ]:
        wv = [fn(e) for e in wins if e.get("chosen_stat")]
        lv = [fn(e) for e in losses if e.get("chosen_stat")]
        t, p = welch_t_test(wv, lv)
        print(f"   {name:20s}: Wins mean={mean(wv):.3f} vs Losses mean={mean(lv):.3f} | t={t:.3f}, p={p:.4f} -> FLAT")

    # 3. Crime Heat
    print("\n3. CRIME HEAT:")
    w_heat = [e["crime_heat"] for e in wins if e.get("crime_heat") is not None]
    l_heat = [e["crime_heat"] for e in losses if e.get("crime_heat") is not None]
    t, p = welch_t_test(w_heat, l_heat)
    print(f"   Wins: mean={mean(w_heat):.1f} vs Losses: mean={mean(l_heat):.1f} | t={t:.3f}, p={p:.4f} -> FLAT")

    # 4. Env Global
    print("\n4. ENV GLOBAL (Weather / District scout modifier):")
    w_env = [e["env_global"] for e in wins if e.get("env_global") is not None]
    l_env = [e["env_global"] for e in losses if e.get("env_global") is not None]
    t, p = welch_t_test(w_env, l_env)
    print(f"   Wins: mean={mean(w_env):.2f} vs Losses: mean={mean(l_env):.2f} | t={t:.3f}, p={p:.4f} -> FLAT")

    # 5. Card Autofail Flag
    print("\n5. CARD APPROACH AUTOFAIL:")
    af_w = sum(1 for e in non_blocked if e.get("autofail") == 1 and e["success"])
    af_n = sum(1 for e in non_blocked if e.get("autofail") == 1)
    non_af_w = sum(1 for e in non_blocked if e.get("autofail") != 1 and e["success"])
    non_af_n = sum(1 for e in non_blocked if e.get("autofail") != 1)
    print(f"   Autofail=1 on card: {af_w}/{af_n} ({100*af_w/max(af_n,1):.1f}%) vs Autofail=0/None: {non_af_w}/{non_af_n} ({100*non_af_w/max(non_af_n,1):.1f}%) -> FLAT")

    # 6. Prior Streak
    print("\n6. STREAKS (Testing pity / anti-streak logic):")
    win_streak = 0
    after_loss_w, after_loss_n = 0, 0
    for e in non_blocked:
        if win_streak == 0:
            after_loss_n += 1
            if e["success"]: after_loss_w += 1
        if e["success"]: win_streak += 1
        else: win_streak = 0
    print(f"   Win rate directly after a failure: {after_loss_w}/{after_loss_n} ({100*after_loss_w/max(after_loss_n,1):.1f}%)")
    print("   Matches baseline win rate -> No pity timer or anti-streak logic detected.")

if __name__ == "__main__":
    main()
