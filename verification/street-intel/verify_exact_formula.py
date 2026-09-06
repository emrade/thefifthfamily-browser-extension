#!/usr/bin/env python3
"""Verifies docs/street-intel-estimate-calculation.md, Section 1-2: the exact
server formula for `estimate_pct`.

    estimate_pct = min(95, max(0, round_half_up(
        base_pct * (1 + other_modifiers_sum / 100) + approach_bonus
    )))
    (0 if the approach is autofail — flag comes from data-approaches, not
    the scout response itself)

Run: python3 verification/verify_exact_formula.py [--archive PATH]
Expected: 100.0000% exact match across every real scout estimate in the
archive, plus a report of any raw value that landed exactly on X.5 (where
Python's default round() would disagree with the game's half-up rounding).
"""

import argparse

from _lib import add_archive_arg, extract_card_autofail, load_records, resolve_archive_path, round_half_up, scout_estimates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_archive_arg(parser)
    args = parser.parse_args()
    archive_path = resolve_archive_path(args)
    print(f"Archive: {archive_path}\n")

    records = list(load_records(archive_path))
    card_autofail = extract_card_autofail(records)

    rows = list(scout_estimates(records))
    print(f"Total revealed scout estimates: {len(rows)}")

    exact = 0
    mismatches = []
    half_cases = []
    for oid, est, _mi in rows:
        base = est["base_pct"]
        mods = est["modifiers"]
        other = sum(v for k, v in mods.items() if k != "approach")
        approach_bonus = mods.get("approach", 0)
        raw = base * (1.0 + other / 100.0) + approach_bonus

        frac = raw - (raw // 1)
        if abs(frac - 0.5) < 1e-9:
            half_cases.append((oid, est["key"], raw))

        af = card_autofail.get(oid, {}).get(est["key"])
        pred = 0 if af == 1 else min(95, max(0, round_half_up(raw)))
        actual = est["estimate_pct"]

        if pred == actual:
            exact += 1
        else:
            mismatches.append((oid, est["key"], raw, pred, actual))

    print(f"\nExact matches: {exact}/{len(rows)} = {exact / len(rows) * 100:.4f}%")
    if mismatches:
        print(f"Mismatches ({len(mismatches)}):")
        for m in mismatches[:20]:
            print("  ", m)

    print(f"\nRaw values landing exactly on X.5: {len(half_cases)}")
    for oid, key, raw in half_cases:
        print(f"   oid={oid} key={key} raw={raw}")


if __name__ == "__main__":
    main()
