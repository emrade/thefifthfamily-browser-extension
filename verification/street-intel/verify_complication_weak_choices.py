#!/usr/bin/env python3
"""Should Smart complication choices also switch away from a *weak* choice,
not only a blocked (0-win) one?

Context (2026-10-11): in the first week of `complicationMode: 'avoidBlocked'`,
three complications lost $2.1M of the $3.1M total, all the same shape: the
runner reused `fight` (record 1/4-2/4 in that scenario) while another choice
was ~90%+. The blocked rule never fires there because the choice has a win.

This replays candidate rules chronologically — each decision uses only the
complications resolved *before* it, starting from zero knowledge — the same
way verify_complication_blocked_choices.py priced the blocked rule.

Two views, because neither alone is enough:

- **Expected losses (replay).** When a rule's pick matches what was actually
  chosen, the real outcome counts. When it differs, the pick is scored by that
  scenario+choice cell's full-history rate shrunk toward the pooled rate (the
  only way to price a choice that wasn't made — mild hindsight, same for
  every rule).
- **Hard evidence (no model).** Every time a rule *would have* switched away,
  and the runner actually played the original choice: how often did that
  original choice win? If the rule is right those should mostly lose; if
  they mostly won, the rule is chasing noise.

Also replays the 2026-10-05.. period starting from everything known by
2026-10-04 — what the shipped seed table plus a stricter rule would have done.

Run: python3 verification/street-intel/verify_complication_weak_choices.py [--archive PATH ...]

First run (2026-10-11, merged archives 2026-08-10..10-11, 559 complications):
"weak <=50% in 3+, alt >=80% in 4+" cut expected losses $14.86M -> $12.78M
over the full history, firing 17 times. But the hard evidence is mixed:
before 2026-10-05 the weak choice, when actually played, still won 10 of 12
(regression to the mean, so roughly neutral to switch), and in the
2026-10-05..11 period it went 0 of 3 ($2.10M). Every threshold variant tried
gave about the same result. Always taking the best-scoring choice
was much worse ($22.4M; it abandons good reuse picks over noise).
"""

import argparse
import collections

from _lib import add_archives_arg, build_attempts, load_endpoint_records, player_day, resolve_archive_paths

CHOICES = ("fight", "run", "talk")
NEW_MODES_FROM = "2026-10-05"


def norm(scenario: str) -> str:
    return scenario.replace("’", "'")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_archives_arg(parser)
    args = parser.parse_args()
    paths = resolve_archive_paths(args)
    print(f"Loading {len(paths)} archive(s)...")
    rows = load_endpoint_records(paths, ["street_intel"])
    events = sorted(
        (a for a in build_attempts(rows) if a["has_complication"] and a["comp_success"] is not None and a["comp_choice"] in CHOICES),
        key=lambda a: a["t"],
    )
    print(f"Resolved complications: {len(events)} ({player_day(events[0]['t'])} .. {player_day(events[-1]['t'])})\n")

    table = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    for e in events:
        cell = table[norm(e["scenario"])][e["comp_choice"]]
        cell[0] += 1 if e["comp_success"] else 0
        cell[1] += 1
    k_all = sum(c[0] for ch in table.values() for c in ch.values())
    n_all = sum(c[1] for ch in table.values() for c in ch.values())
    pooled = k_all / n_all

    def p_win(sc, c):
        k, n = table[sc].get(c, [0, 0])
        return (k + pooled * 4) / (n + 4)

    def score(hist, c):
        k, n = hist[c]
        return 0 if (n >= 2 and k == 0) else (k + 2 * pooled) / (n + 2)

    def reuse(e, hist):
        return e["approach"] if e["approach"] in CHOICES else "run"

    def best(hist):
        return max(CHOICES, key=lambda c: score(hist, c))

    def avoid_blocked(e, hist):
        pick = reuse(e, hist)
        k, n = hist[pick]
        return best(hist) if n >= 2 and k == 0 else pick

    def weak_rule(max_rate, min_n, best_rate, best_n):
        def rule(e, hist):
            pick = avoid_blocked(e, hist)
            k, n = hist[pick]
            if n >= min_n and k / n <= max_rate:
                alts = [c for c in CHOICES if c != pick and hist[c][1] >= best_n and hist[c][0] / hist[c][1] >= best_rate]
                if alts:
                    return max(alts, key=lambda c: score(hist, c))
            return pick

        rule.__name__ = f"weak <={max_rate:.0%} in {min_n}+, alt >={best_rate:.0%} in {best_n}+"
        return rule

    def always_best(e, hist):
        return best(hist)

    rules = [
        ("actual choices made", lambda e, h: e["comp_choice"]),
        ("reuse (original default)", reuse),
        ("avoid blocked (shipped)", avoid_blocked),
        ("always best shrunk score", always_best),
    ] + [
        (r.__name__, r)
        for r in (
            weak_rule(0.5, 3, 0.8, 4),  # the proposed rule
            weak_rule(0.5, 2, 0.8, 4),
            weak_rule(0.5, 4, 0.8, 4),
            weak_rule(0.6, 3, 0.8, 4),
            weak_rule(0.5, 3, 0.75, 3),
            weak_rule(0.5, 3, 0.85, 5),
        )
    ]

    def replay(rule, start_from=None):
        hist = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
        loss, switches, evidence = 0.0, 0, [0, 0, 0]  # evidence: original choice actually played: wins, n, $lost
        base = avoid_blocked
        for e in events:
            sc = norm(e["scenario"])
            if start_from is None or player_day(e["t"]) >= start_from:
                pick = rule(e, hist[sc])
                orig = base(e, hist[sc])
                if pick != orig:
                    switches += 1
                    if e["comp_choice"] == orig:
                        evidence[0] += 1 if e["comp_success"] else 0
                        evidence[1] += 1
                        evidence[2] += 0 if e["comp_success"] else e["lost"]
                if pick == e["comp_choice"]:
                    loss += 0 if e["comp_success"] else e["lost"]
                else:
                    loss += (1 - p_win(sc, pick)) * e["reward"]
            cell = hist[sc][e["comp_choice"]]
            cell[0] += 1 if e["comp_success"] else 0
            cell[1] += 1
        return loss, switches, evidence

    for title, start in (("Full history, from zero knowledge", None), (f"{NEW_MODES_FROM} onward, knowing everything before it", NEW_MODES_FROM)):
        n = sum(1 for e in events if start is None or player_day(e["t"]) >= start)
        print(f"{title} ({n} complications):")
        print(f"  {'rule':44s} {'exp. loss':>10s}  {'switches vs shipped':>19s}  original choice when it was played")
        for name, rule in rules:
            loss, sw, (k, m, lost) = replay(rule, start)
            ev = f"won {k}/{m}, lost ${lost / 1e6:.2f}M" if m else "-"
            print(f"  {name:44s} ${loss / 1e6:8.2f}M  {sw:19d}  {ev}")
        print()

    print(f"(pooled complication win rate {pooled:.0%}; counterfactual picks priced at the cell rate shrunk 4 tries toward it)")


if __name__ == "__main__":
    main()
