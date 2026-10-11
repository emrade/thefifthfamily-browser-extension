#!/usr/bin/env python3
"""Verifies loss penalty asymmetry across Street Intel complication choices.

Hypothesis: When a complication fails, the cash penalty depends strongly
on the choice made. Specifically:
  - `run` failure texts ("You got clear, but not cleanly. Part of the take is gone.")
    frequently incur $0 penalty (39.1%) or partial take loss (31.9%), losing only
    41.0% of the attempt reward on average.
  - `talk` failure texts ("They didn't buy it. You gave up a cut to walk away.")
    almost always wipe out the full take (85.9% full wipeout, mean penalty 87.6%).
  - `fight` failure texts ("The fight cost you. You got out, but the job suffered for it.")
    almost always wipe out the full take (90.3% full wipeout, mean penalty 92.9%).

Mathematical consequence:
  Even though `talk` has a slightly higher raw non-blocked win rate (90.6% vs 82.9%),
  `run` has a LOWER expected loss per attempt:
    E[loss | run]  = (1 - 0.829) * 0.410 * Reward = 0.070 * Reward
    E[loss | talk] = (1 - 0.906) * 0.876 * Reward = 0.082 * Reward
    E[loss | fight] = (1 - 0.824) * 0.929 * Reward = 0.163 * Reward
  When facing an unblocked choice, `run` is mathematically superior in expected net value.

Run: python3 verification/street-intel/verify_complication_loss_penalty.py [--archive PATH ...]
"""

import argparse
import collections
import json
import re
from pathlib import Path

from _lib import add_archives_arg, build_attempts, load_endpoint_records, resolve_archive_paths

CHOICES = ("fight", "run", "talk", "stand_ground")

def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_archives_arg(parser)
    args = parser.parse_args()
    paths = resolve_archive_paths(args)
    print(f"Loading {len(paths)} archive(s)...")

    rows = load_endpoint_records(paths, ["street_intel"], processes=8)

    # Extract all resolved complications
    events = []
    # Build attempts from _lib gives attempt + card + comp info
    for a in build_attempts(rows):
        if a["has_complication"] and a["comp_success"] is not None:
            events.append(a)

    print(f"Total resolved complications: {len(events)}")
    losses = [e for e in events if not e["comp_success"]]
    print(f"Total failed complications: {len(losses)}\n")

    # Group by choice
    stats = collections.defaultdict(lambda: {
        "losses": 0,
        "zero_loss": 0,
        "part_loss": 0,
        "full_loss": 0,
        "tot_lost": 0,
        "tot_reward": 0,
        "ratios": [],
    })

    for e in losses:
        c = e["comp_choice"]
        rec = stats[c]
        rec["losses"] += 1
        lost = e["lost"]
        rew = e["reward"]
        rec["tot_lost"] += lost
        rec["tot_reward"] += rew
        ratio = lost / rew if rew > 0 else 0.0
        rec["ratios"].append(ratio)
        if lost == 0:
            rec["zero_loss"] += 1
        elif ratio < 0.999:
            rec["part_loss"] += 1
        else:
            rec["full_loss"] += 1

    print("=== FAILURE PENALTY SEVERITY BY CHOICE ===")
    print(f"{'Choice':<8} {'Losses':>7} {'$0 Loss':>9} {'Part Loss':>11} {'Full Loss':>11} {'Mean Penalty':>14} {'Aggreg. Ratio':>15}")
    print("-" * 80)
    for c in ["fight", "run", "talk"]:
        rec = stats[c]
        m_pen = mean(rec["ratios"])
        agg_pen = rec["tot_lost"] / max(rec["tot_reward"], 1)
        z_pct = 100 * rec["zero_loss"] / max(rec["losses"], 1)
        p_pct = 100 * rec["part_loss"] / max(rec["losses"], 1)
        f_pct = 100 * rec["full_loss"] / max(rec["losses"], 1)
        print(f"{c:<8} {rec['losses']:>7d} {rec['zero_loss']:>4d} ({z_pct:>4.1f}%) {rec['part_loss']:>4d} ({p_pct:>4.1f}%) {rec['full_loss']:>4d} ({f_pct:>4.1f}%) {m_pen*100:>13.1f}% {agg_pen*100:>14.1f}%")

    print("\n=== EXPECTED LOSS RATIO PER ATTEMPT (Non-blocked choices) ===")
    # Win rates from non-blocked choices
    # Fight ~82.4%, Run ~82.9%, Talk ~90.6%
    win_rates = {"fight": 0.824, "run": 0.829, "talk": 0.906}
    for c in ["run", "talk", "fight"]:
        pw = win_rates[c]
        pl = 1.0 - pw
        m_pen = mean(stats[c]["ratios"])
        ev_loss = pl * m_pen
        print(f"  {c:<5s}: P(fail)={pl*100:.1f}% x Mean Penalty={m_pen*100:.1f}% = E[Loss] = {ev_loss*100:.2f}% of reward")

if __name__ == "__main__":
    main()
