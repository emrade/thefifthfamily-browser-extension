#!/usr/bin/env python3
"""Tests the "blocked choice per scenario" hypothesis for Street Intel
complications, across every archive combined.

Hypothesis (2026-10-04): most complication scenarios (`complication.type`)
have exactly one choice (fight/run/talk) that essentially never wins, while
the other two win at roughly the same ~85% pooled rate. If true, the right
complication rule is "avoid the blocked choice for this scenario", not
"reuse the attempt's own approach" (actionRunner.ts's pickComplicationChoice),
and docs/street-intel-estimate-calculation.md Section 7C's per-scenario
advice was directionally right but under-sampled at the time (n=1-2).

For every scenario this prints the fight/run/talk win counts, flags any
choice that is 0-for-N (N >= MIN_BLOCKED_N) as blocked, and gives the
probability of seeing 0/N by chance if that choice actually won at the pooled
non-blocked rate. It then prices the hypothesis: cash lost on blocked picks
vs everything else, and a chronological replay of rules that only use data
available *before* each complication (so the result isn't hindsight-fitted).

Run: python3 verification/street-intel/verify_complication_blocked_choices.py [--archive PATH ...]
Last run (2026-10-04, all 62 archives, 2026-08-10 .. 2026-10-04): 480
resolved complications across 24 scenarios. 14 scenarios have a blocked
choice; blocked picks went 0/91 (talk 0/55, run 0/20, fight 0/16) vs 83-90%
for every non-blocked choice, with the strongest single cell at p~1e-10.
Blocked picks cost $26.4M of $30.7M total complication losses (86%). Online
replay: "avoid any choice that's 0-for-2+ in this scenario so far, otherwise
reuse" would have cut expected losses from $30.7M to ~$9.9M even starting
from zero knowledge.
"""

import argparse
import collections
import datetime

from _lib import add_archives_arg, build_attempts, load_endpoint_records, resolve_archive_paths

MIN_BLOCKED_N = 2
CHOICES = ("fight", "run", "talk")


def norm(scenario: str) -> str:
    # The game has served both a curly and a straight apostrophe for the
    # same scenario ("The mark had backup you didn’t/didn't see coming").
    return scenario.replace("’", "'")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_archives_arg(parser)
    args = parser.parse_args()
    paths = resolve_archive_paths(args)
    print(f"Loading {len(paths)} archive(s)...")
    rows = load_endpoint_records(paths, ["street_intel"])
    events = sorted(
        (a for a in build_attempts(rows) if a["has_complication"] and a["comp_success"] is not None),
        key=lambda a: a["t"],
    )
    print(f"Resolved complications: {len(events)}\n")

    table = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    for e in events:
        cell = table[norm(e["scenario"])][e["comp_choice"]]
        cell[0] += 1 if e["comp_success"] else 0
        cell[1] += 1

    blocked = {
        sc: [c for c, (k, n) in ch.items() if k == 0 and n >= MIN_BLOCKED_N] for sc, ch in table.items()
    }
    blocked = {sc: cs for sc, cs in blocked.items() if cs}

    pooled = collections.Counter()
    pooled_n = collections.Counter()
    for sc, ch in table.items():
        for c, (k, n) in ch.items():
            if c not in blocked.get(sc, []):
                pooled[c] += k
                pooled_n[c] += n
    pooled_rate = sum(pooled.values()) / max(sum(pooled_n.values()), 1)

    print(f"{'scenario':55s} {'fight':>7s} {'run':>7s} {'talk':>7s}   blocked")
    for sc, ch in sorted(table.items(), key=lambda kv: -sum(v[1] for v in kv[1].values())):
        cells = [f"{ch[c][0]}/{ch[c][1]}" if c in ch else "-" for c in CHOICES]
        bl = ", ".join(f"{c} (p={(1 - pooled_rate) ** ch[c][1]:.0e})" for c in blocked.get(sc, []))
        print(f"{sc[:55]:55s} {cells[0]:>7s} {cells[1]:>7s} {cells[2]:>7s}   {bl}")

    print("\nNon-blocked pooled win rate per choice:")
    for c in CHOICES:
        print(f"  {c}: {pooled[c]}/{pooled_n[c]} ({100 * pooled[c] / max(pooled_n[c], 1):.0f}%)")
    on_blocked = [e for e in events if e["comp_choice"] in blocked.get(norm(e["scenario"]), [])]
    print(f"Blocked picks: {sum(e['comp_success'] for e in on_blocked)}/{len(on_blocked)} wins")

    total_lost = sum(e["lost"] for e in events)
    blocked_lost = sum(e["lost"] for e in on_blocked)
    print(f"\nCash lost to complications: ${total_lost:,.0f}; on blocked picks: ${blocked_lost:,.0f} ({100 * blocked_lost / max(total_lost, 1):.0f}%)")

    # Chronological replay. A rule's counterfactual pick is scored by the
    # real outcome when it matches what was actually chosen, otherwise by
    # that scenario+choice cell's full-history rate shrunk toward the pooled
    # rate (so a 1/1 cell doesn't count as a guaranteed win).
    def p_win(sc, c):
        k, n = table[sc].get(c, [0, 0])
        return (k + pooled_rate * 4) / (n + 4)

    def reuse(e, hist):
        return e["approach"] if e["approach"] in CHOICES else "run"

    def avoid_then_reuse(e, hist):
        pick = reuse(e, hist)
        k, n = hist[pick]
        if n >= MIN_BLOCKED_N and k == 0:
            return max(CHOICES, key=lambda c: (hist[c][0] + 2 * pooled_rate) / (hist[c][1] + 2))
        return pick

    def replay(rule):
        hist = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
        loss = 0.0
        for e in events:
            sc = norm(e["scenario"])
            pick = rule(e, hist[sc])
            if pick == e["comp_choice"]:
                loss += 0 if e["comp_success"] else e["lost"]
            else:
                loss += (1 - p_win(sc, pick)) * e["reward"]
            cell = hist[sc][e["comp_choice"]]
            cell[0] += 1 if e["comp_success"] else 0
            cell[1] += 1
        return loss

    print("\nChronological replay (expected complication losses):")
    print(f"  actual choices made:                     ${replay(lambda e, h: e['comp_choice']) / 1e6:6.2f}M")
    print(f"  reuse attempt approach (run fallback):   ${replay(reuse) / 1e6:6.2f}M")
    print(f"  avoid 0-for-{MIN_BLOCKED_N}+ choice, else reuse:      ${replay(avoid_then_reuse) / 1e6:6.2f}M")

    if events:
        span = (events[-1]["t"] - events[0]["t"]) / 86400e3
        first = datetime.datetime.utcfromtimestamp(events[0]["t"] / 1000).date()
        print(f"\n(span: {span:.0f} days from {first})")


if __name__ == "__main__":
    main()
