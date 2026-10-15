#!/usr/bin/env python3
"""Read-only mechanics analysis of an existing Arena row cache; no requests."""

import argparse
import collections
import json
import math
import statistics
from pathlib import Path

from verify_combat_rule import body, build_fights, linfit


def mechanistic_checks(entries):
    dice = {rule: collections.Counter() for rule in ("strict", "inclusive")}
    floor_models = {}
    profiles = {}
    for row, b, f in entries:
        for side in ("attacker", "defender"):
            for r in b["rounds"]:
                h = r.get(side)
                if not isinstance(h, dict) or "dodge_roll" not in h:
                    continue
                for rule, compare in (("strict", lambda a, c: a < c), ("inclusive", lambda a, c: a <= c)):
                    action = "hit"
                    if compare(h["dodge_roll"], h["dodge_chance"]):
                        action = "miss"
                    elif compare(h["block_roll"], h["block_chance"]):
                        action = "blocked"
                    elif compare(h["crit_roll"], h["crit_chance"]):
                        action = "critical"
                    dice[rule]["n"] += 1
                    dice[rule]["matched"] += action == h["action"]
    # These units are inferred from the player's atoms, not used prospectively.
    # A single max-HP season can contain several underlying combat profiles.
    stages = [(661, "", "", 500), (710, "", "", 500),
              (737, "", "2026-09-24T10", 760),
              (737, "2026-09-24T10", "2026-09-27", 700),
              (737, "2026-09-27", "", 735),
              (759, "", "", 745),
              (804, "", "2026-10-07T13", 758),
              (804, "2026-10-07T13", "", 830), (850, "", "", 1400)]
    for hp, start, end, strength in stages:
        values = [h["min_dmg"] for row, b, f in entries if b["att_max_hp"] == hp
                  and (not start or row.get("isoTime", "") >= start)
                  and (not end or row.get("isoTime", "") < end)
                  for r in b["rounds"] if isinstance((h := r.get("attacker")), dict)
                  and h.get("min_dmg") is not None and h.get("base_dmg", 0) > 0]
        steps = [math.floor(strength * k / 100) for k in range(3, 8)]
        probs = collections.Counter(min(s, cap) for s in steps for cap in range(45, 76))
        obs = collections.Counter(values)
        chi2 = sum((obs[v] - len(values) * c / 155) ** 2 / (len(values) * c / 155) for v, c in probs.items())
        floor_models[f"{hp}:{start or 'start'}"] = {
            "n": len(values), "steps": steps, "observed_mean": statistics.mean(values),
            "fixed_75_mean": statistics.mean(min(s, 75) for s in steps),
            "random_cap_mean": sum(v * c for v, c in probs.items()) / 155,
            "fixed_75_outside_support": sum(v not in {min(s, 75) for s in steps} for v in values),
            "random_cap_outside_support": sum(v not in probs for v in values),
            "chi_squared": chi2, "support_size": len(probs), "observed": dict(sorted(obs.items())),
        }
    for hp in (661, 710, 737, 759, 804, 850):
        subset = [(row, b, f) for row, b, f in entries if b["att_max_hp"] == hp and f["boss"]]
        crit_targets = [(f["stats"][3], h["crit_mult"]) for row, b, f in subset for r in b["rounds"]
                        if isinstance((h := r.get("attacker")), dict) and h.get("crit_mult") is not None]
        chance_targets = [(f["stats"][2], b["rounds"][0]["first_strike"]["att_chance"]) for row, b, f in subset]
        baseline = 1.33 if hp == 661 else 1.35
        if crit_targets:
            errors = [(sum((round(baseline + min(1.2, max(0, (dex - x) / 1000)), 2) - y) ** 2 for x, y in crit_targets), dex)
                      for dex in range(250, 2201)]
            loss, dex = min(errors)
            profiles[f"{hp}:crit_difference"] = {"n_hits": len(crit_targets), "inferred_dex": dex,
                "rmse": math.sqrt(loss / len(crit_targets)),
                "exact": sum(round(baseline + min(1.2, max(0, (dex - x) / 1000)), 2) == y for x, y in crit_targets)}
        if chance_targets:
            for rounding, fn in (("round", round), ("floor", math.floor)):
                errors = [(sum((min(30, max(0, fn(30 * (agi / x - 1)))) - y) ** 2 for x, y in chance_targets), agi)
                          for agi in range(200, 1401)]
                loss, agi = min(errors)
                profiles[f"{hp}:first_ratio_{rounding}"] = {"n_fights": len(chance_targets), "inferred_agi": agi,
                    "rmse": math.sqrt(loss / len(chance_targets)),
                    "exact": sum(min(30, max(0, fn(30 * (agi / x - 1)))) == y for x, y in chance_targets)}
    boss_floors = []
    boss_dice = collections.defaultdict(list)
    crit_stability = collections.Counter()
    for row, b, f in entries:
        for side in ("attacker", "defender"):
            multipliers = {h["crit_mult"] for r in b["rounds"] if isinstance((h := r.get(side)), dict) and h.get("crit_mult") is not None}
            if multipliers:
                crit_stability["fights_with_crit"] += 1
                crit_stability["one_multiplier"] += len(multipliers) == 1
        if f["boss"]:
            steps = [math.floor(f["stats"][0] * k / 100) for k in range(3, 8)]
            allowed = {min(s, cap) for s in steps for cap in range(45, 76)}
            vals = [h["min_dmg"] for r in b["rounds"] if isinstance((h := r.get("defender")), dict) and h.get("min_dmg") is not None]
            boss_floors.append({"name": f["name"], "time": row.get("isoTime"), "hp": f["my_hp"],
                                "strength": f["stats"][0], "n": len(vals), "outside": sum(v not in allowed for v in vals),
                                "values": sorted(set(vals)), "steps": steps})
            for field, side, idx in (("dodge_chance", "attacker", 2), ("block_chance", "attacker", 1), ("crit_chance", "defender", 3)):
                h = next((h for r in b["rounds"] if isinstance((h := r.get(side)), dict) and field in h), None)
                if h:
                    boss_dice[field].append((f["stats"][idx], h[field]))
    threshold_fits = {}
    for field, pairs in boss_dice.items():
        best = None
        for minimum in (0, 2, 3, 5):
            for cap in (20, 25, 30, 35, 40):
                for offset in (i / 2 for i in range(-4, 11)):
                    for rounding, fn in (("round_half", lambda v: round(v * 2) / 2), ("floor_half", lambda v: math.floor(v * 2) / 2)):
                        preds = [min(cap, max(minimum, fn(x / 100) + offset)) for x, y in pairs]
                        err = sum((pred - y) ** 2 for pred, (x, y) in zip(preds, pairs))
                        if best is None or err < best[0]:
                            best = (err, {"minimum": minimum, "cap": cap, "offset": offset, "rounding": rounding,
                                          "n": len(pairs), "rmse": math.sqrt(err / len(pairs)),
                                          "exact": sum(pred == y for pred, (x, y) in zip(preds, pairs))})
        threshold_fits[field] = best[1]
    pre_checks = collections.Counter()
    pre_ratios = []
    for row, b, f in entries:
        for r in b["rounds"]:
            h = r.get("pre_attacker")
            if f["boss"] and isinstance(h, dict):
                pre_checks["boss_player_snapshots"] += 1
                pre_checks["reduction_equals_floor_0_6_def"] += h.get("reduction") == math.floor(.6 * f["stats"][1])
                pre_ratios.append(h.get("reduction", 0) / f["stats"][1])
            if isinstance(h, dict) and h.get("base_dmg", 0) < h.get("reduction", 0):
                stage = next(s for hp, start, end, s in stages if hp == b["att_max_hp"]
                             and (not start or row.get("isoTime", "") >= start)
                             and (not end or row.get("isoTime", "") < end))
                support = {min(math.floor(stage * k / 100), cap) for k in range(3, 8) for cap in range(45, 76)}
                pre_checks["player_minimum_shots"] += 1
                pre_checks["player_damage_in_unmitigated_regular_floor_support"] += h["damage"] in support
    return {"dice": {k: dict(v) for k, v in dice.items()}, "player_floor_models": floor_models,
            "crit_stability": dict(crit_stability), "boss_dice_threshold_fits": threshold_fits,
            "first_strike_damage_checks": dict(pre_checks),
            "boss_first_strike_reduction_ratios": [min(pre_ratios), max(pre_ratios)],
            "inferred_profiles": profiles, "boss_floor_support": {
                "n": sum(f["n"] for f in boss_floors), "outside": sum(f["outside"] for f in boss_floors),
                "mismatched_examples": [f for f in boss_floors if f["outside"]][:5]}}


def detailed_checks(entries):
    armory = collections.defaultdict(collections.Counter)
    first = collections.defaultdict(collections.Counter)
    critical = collections.defaultdict(list)
    crit_fights, first_fights = [], []
    floors = collections.defaultdict(collections.Counter)
    crossover, passive_checks = [], collections.defaultdict(collections.Counter)
    first_damage = collections.defaultdict(list)
    first_examples = []
    chance_fit = collections.defaultdict(list)
    for row, b, f in entries:
        crit_fights.append({"time": row.get("isoTime"), "name": f["name"], "hp": f["my_hp"],
                            "stats": f["stats"], "boss": f["boss"], "passive": f["passive"],
                            "crit_mult": sorted({h["crit_mult"] for r in b["rounds"] if isinstance((h := r.get("attacker")), dict) and h.get("crit_mult") is not None})})
        first_fights.append({"time": row.get("isoTime"), "name": f["name"], "hp": f["my_hp"],
                            "stats": f["stats"], "chance": b["rounds"][0].get("first_strike")})
        for side in ("attacker", "defender"):
            hs = [r[side] for r in b["rounds"] if isinstance(r.get(side), dict)]
            for h in hs:
                if "armory_mult" in h:
                    armory[side][str(h["armory_mult"])] += 1
                if h.get("action") == "critical":
                    critical[(b["att_max_hp"], side)].append(h["crit_mult"])
                if h.get("min_dmg") is not None and h.get("base_dmg", 0) > 0:
                    floors[(b["att_max_hp"], side)][h["min_dmg"]] += 1
                if h.get("action") == "hit" and 0 < h.get("base_dmg", 0) - h.get("reduction", 0) < h.get("min_dmg", 0):
                    crossover.append({"time": row.get("isoTime"), "name": b["defender"], "side": side, "hit": h})
            if hs:
                h = next((h for h in hs if "crit_chance" in h), None)
                if h and f:
                    chance_fit[(f["boss"], side)].append((f, h))
        for r in b["rounds"]:
            s = r.get("first_strike")
            if s:
                ac, dc = s["att_chance"], s["def_chance"]
                p_att = isinstance(r.get("pre_attacker"), dict)
                p_def = isinstance(r.get("pre_defender"), dict)
                for side, c, pre in (("attacker", ac, p_att), ("defender", dc, p_def)):
                    key = (b["att_max_hp"], side)
                    first[key]["rounds"] += 1
                    first[key]["chance_sum"] += c
                    first[key]["shots"] += pre
                    first[key]["zero_chance_shots"] += c == 0 and pre
                    shot = r.get("pre_" + side)
                    if isinstance(shot, dict):
                        first_damage[key].append(shot.get("damage", 0))
                        if len(first_examples) < 5:
                            first_examples.append({"time": row.get("isoTime"), "name": f["name"], "side": side, "shot": shot})
                first["joint"]["both_positive_chances"] += ac > 0 and dc > 0
                first["joint"]["both_shots"] += p_att and p_def
            if not f["boss"]:
                a, d = r.get("attacker"), r.get("defender")
                c = passive_checks[f["passive"]]
                c["rounds"] += 1
                c["actions"] += isinstance(d, dict) and d.get("action") != "down"
                c["down"] += isinstance(d, dict) and d.get("action") == "down"
                c["empty"] += not isinstance(d, dict)
                if not isinstance(d, dict):
                    c["empty_after_pre_defender"] += isinstance(r.get("pre_defender"), dict)
                    c["empty_player_dead"] += r.get("att_hp") == 0
    fits = {}
    for (boss, side), xs in chance_fit.items():
        if side != "attacker":
            continue
        for field, index in (("dodge_chance", 2), ("block_chance", 1)):
            if len(xs) > 3:
                a, slope, corr, sd = linfit([f["stats"][index] for f, h in xs], [h[field] for f, h in xs])
                fits[f"{'boss' if boss else 'regular'}:{field}"] = {"n": len(xs), "intercept": a, "slope": slope, "r": corr, "residual_sd": sd}
    for boss in (False, True):
        xs = chance_fit[(boss, "defender")]
        a, slope, corr, sd = linfit([f["stats"][3] for f, h in xs], [h["crit_chance"] for f, h in xs])
        fits[f"{'boss' if boss else 'regular'}:crit_chance"] = {"n": len(xs), "intercept": a, "slope": slope, "r": corr, "residual_sd": sd}
    crit_summary = {str(k): {"n": len(v), "mean": statistics.mean(v), "range": [min(v), max(v)],
                             "above_1_5": sum(x > 1.5 for x in v), "at_least_2": sum(x >= 2 for x in v)}
                    for k, v in sorted(critical.items())}
    ratio_fits = {}
    for hp in (661, 710, 737, 759, 804, 850):
        # Use the fight's logged multiplier only as the mechanics target, not a predictor.
        subset = [(f, next((h for r in b["rounds"] if isinstance((h := r.get("attacker")), dict) and h.get("crit_mult") is not None), None))
                  for row, b, f in entries if f["my_hp"] == hp]
        subset = [(f, h) for f, h in subset if h is not None and h["crit_mult"] > 1.36]
        if len(subset) >= 5:
            for i, stat in enumerate(("str", "def", "agi", "dex")):
                a, slope, corr, sd = linfit([1 / f["stats"][i] for f, h in subset], [h["crit_mult"] for f, h in subset])
                ratio_fits[f"{hp}:inverse_{stat}"] = {"n": len(subset), "intercept": a, "slope": slope, "r": corr, "residual_sd": sd}
    return {"armory": {k: dict(v) for k, v in armory.items()},
            "first_strike": {str(k): dict(v) for k, v in first.items()},
            "first_strike_damage": {str(k): {"n": len(v), "mean": statistics.mean(v), "range": [min(v), max(v)]}
                                    for k, v in sorted(first_damage.items())},
            "first_strike_examples": first_examples,
            "crits": crit_summary, "crossover": {"n": len(crossover), "examples": crossover[:12]},
            "passive_opportunities": {str(k): dict(v) for k, v in passive_checks.items()},
            "chance_fits": fits, "crit_ratio_fits": ratio_fits,
            "crit_fights_850": [f for f in crit_fights if f["hp"] == 850],
            "first_fights_examples": [f for f in first_fights if f["hp"] in (661, 710, 850)][:5] + [f for f in first_fights if f["hp"] == 850][:10]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.cache.resolve() == args.output.resolve():
        parser.error("cache and output must differ")
    data = json.loads(args.cache.read_text())
    fights, _ = build_fights(data["rows"])
    by_ts = {f["ts"]: f for f in fights}
    entries, previews = [], []
    for row in data["rows"]:
        req = row.get("requestBody") or ""
        b = body(row)
        if not b:
            continue
        if "action=preview_loadout" in req:
            previews.append({"time": row.get("isoTime"), "response": b})
        if "action=attack" in req and b.get("ok") and b.get("rounds") and row["timestamp"] in by_ts:
            entries.append((row, b, by_ts.get(row["timestamp"])))
    groups = collections.defaultdict(list)
    crits = collections.defaultdict(list)
    fs = collections.defaultdict(collections.Counter)
    passive = collections.defaultdict(collections.Counter)
    samples, per_fight, high_crits = [], [], []
    gear_groups = collections.defaultdict(list)
    for row, b, f in entries:
        per_fight.append({"time": row.get("isoTime"), "name": b["defender"],
                          "hp": b["att_max_hp"], "stats": f["stats"],
                          "boss": f["boss"], "passive": f["passive"],
                          "first_strike": [r.get("first_strike") for r in b["rounds"]],
                          "sides": {}})
        for side in ("attacker", "defender", "pre_attacker", "pre_defender"):
            hs = [r[side] for r in b["rounds"] if isinstance(r.get(side), dict)]
            groups[(b["att_max_hp"], side)].extend(hs)
            if not side.startswith("pre_"):
                prefix = "att" if side == "attacker" else "def"
                gear = tuple((g["slot"], g["name"], g.get("enhancement_level", 0)) for g in b.get(prefix + "_gear", []))
                gear_groups[(side, b.get(prefix + "_weapon"), gear)].extend(hs)
            per_fight[-1]["sides"][side] = {
                "min_values": sorted({h["min_dmg"] for h in hs if h.get("min_dmg") is not None}),
                "mean_base": statistics.mean([h["base_dmg"] for h in hs if h.get("base_dmg", 0) > 0]) if any(h.get("base_dmg", 0) > 0 for h in hs) else None,
                "chances": {k: sorted({h[k] for h in hs if isinstance(h.get(k), (int, float))}) for k in ("dodge_chance", "crit_chance", "block_chance", "crit_mult")},
            }
            for h in hs:
                if h.get("action") == "critical":
                    prefix = "att" if side.endswith("attacker") else "def"
                    crits[(side, h.get("crit_mult"))].append({
                        "time": row.get("isoTime"), "name": b.get("defender"),
                        "hp": b["att_max_hp"], "gear": b.get(prefix + "_gear"),
                        "weapon": b.get(prefix + "_weapon"), "boss": b.get("is_boss"),
                        "damage": h.get("damage"), "min_dmg": h.get("min_dmg"),
                        "base_dmg": h.get("base_dmg"), "reduction": h.get("reduction"),
                    })
                    if h.get("crit_mult", 0) >= 2:
                        high_crits.append({"time": row.get("isoTime"), "name": b["defender"],
                                           "side": side, "weapon": b.get(prefix + "_weapon"), "hit": h})
        for r in b["rounds"]:
            first = r.get("first_strike")
            if first:
                for prefix, side in (("att", "attacker"), ("def", "defender")):
                    key = (b["att_max_hp"], prefix, first.get(prefix + "_chance"))
                    fs[key]["rounds"] += 1
                    pre = r.get("pre_" + side)
                    fs[key]["shots"] += isinstance(pre, dict) and pre.get("action") != "down"
                    if isinstance(pre, dict):
                        fs[key][pre.get("action", "unknown")] += 1
            if f and not f["boss"]:
                p = passive[f["passive"]]
                p["rounds"] += 1
                h = r.get("defender")
                p["present"] += isinstance(h, dict)
                if isinstance(h, dict):
                    p[h.get("action", "unknown")] += 1
                p["empty_with_positive_def_hp"] += not isinstance(h, dict) and r.get("def_hp", 0) > 0
        if len(samples) < 1 or b["att_max_hp"] == 850 and len(samples) < 2:
            samples.append({"time": row.get("isoTime"), "response": b})
    group_out = {}
    for (hp, side), hs in sorted(groups.items()):
        floor = [h for h in hs if h.get("min_dmg") is not None and h.get("base_dmg", 0) > 0]
        group_out[f"{hp}:{side}"] = {
            "n": len(hs), "actions": dict(collections.Counter(h.get("action") for h in hs)),
            "armory": dict(collections.Counter(str(h.get("armory_mult")) for h in hs)),
            "min_damage": dict(sorted(collections.Counter(h["min_dmg"] for h in floor).items())),
            "min_by_action": {act: dict(sorted(collections.Counter(h["min_dmg"] for h in floor if h["action"] == act).items()))
                              for act in ("hit", "critical", "blocked")},
            "base_range": [min((h["base_dmg"] for h in floor), default=0),
                           max((h["base_dmg"] for h in floor), default=0)],
            "chance_values": {k: dict(sorted(collections.Counter(h[k] for h in hs if k in h).items()))
                              for k in ("dodge_chance", "crit_chance", "block_chance")},
        }
    out = {"sources": data["sources"], "rows": len(data["rows"]), "checks": detailed_checks(entries),
           "mechanistic": mechanistic_checks(entries),
           "raw_fights": len(entries), "matched_fights": len(fights),
           "groups": group_out, "critical": {
               f"{side}:{mult}": {"n": len(v), "fights": len({x['time'] for x in v}),
                                  "examples": v[:3]} for (side, mult), v in sorted(crits.items())},
           "first_strike": {str(k): dict(v) for k, v in sorted(fs.items())},
           "passive": {str(k): dict(v) for k, v in passive.items()},
           "sample": samples, "previews": previews, "per_fight": per_fight,
           "high_crits": high_crits, "gear_summary": [
               {"side": side, "weapon": weapon, "gear": gear, "n": len(hs),
                "armory": dict(collections.Counter(str(h.get("armory_mult")) for h in hs)),
                "crit_range": [min((h["crit_mult"] for h in hs if h.get("crit_mult") is not None), default=None),
                               max((h["crit_mult"] for h in hs if h.get("crit_mult") is not None), default=None)]}
               for (side, weapon, gear), hs in gear_groups.items()]}
    args.output.write_text(json.dumps(out, indent=2))
    print("Fights:", len(entries))
    print(json.dumps(out["mechanistic"], indent=2))


if __name__ == "__main__":
    main()
