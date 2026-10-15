#!/usr/bin/env python3
"""Read-only Arena investigation. No game requests; standard library only.

Run with --cache /absolute/path/to/arena-cache.json to scan the archive once
and reuse the filtered rows. The cache contains private game data; keep it
outside the repository. Delete it or use --rescan after adding archives.
"""

import argparse
import bisect
import collections
import json
import html
import math
import re
import random
import statistics
from pathlib import Path

from verify_combat_rule import (
    CARD_RE, body, build_fights, find_default_archives, load_arena_rows,
    linfit, parse_cards, score,
)


def load_data(cache, rescan=False):
    if cache.exists() and not rescan:
        data = json.loads(cache.read_text())
    else:
        paths = find_default_archives()
        data = {"sources": [{"path": p, "bytes": Path(p).stat().st_size,
                              "mtime_ns": Path(p).stat().st_mtime_ns} for p in paths],
                "rows": load_arena_rows(paths)}
        cache.write_text(json.dumps(data, separators=(",", ":")))
    return data


def rate(items):
    return {"n": len(items), "wins": sum(f["won"] for f in items)}


def band(f, s):
    if s >= (1.3 if f["boss"] else 1.2):
        return "beatable"
    if s < 0.8:
        return "avoid"
    return "coinflip"


def probability(f, s):
    kind = band(f, s)
    if f["boss"]:
        return {"beatable": .98, "coinflip": .85, "avoid": .4}[kind]
    if kind != "coinflip":
        return {"beatable": .99, "avoid": .05}[kind]
    leans_win = f["wp"] >= 50 if f["wp"] is not None else f["passive"]
    return ((.71, .21) if s < 1 else (.76, .47))[0 if leans_win else 1]


def metrics(predictions):
    if not predictions:
        return {"n": 0}
    out = {"n": len(predictions)}
    out["brier"] = statistics.mean((p - f["won"]) ** 2 for f, s, p in predictions)
    out["log_loss"] = -statistics.mean(math.log(max(1e-9, p if f["won"] else 1-p))
                                       for f, s, p in predictions)
    out["correct"] = sum((p >= .5) == f["won"] for f, s, p in predictions)
    out["bands"] = {b: rate([f for f, s, p in predictions if band(f, s) == b])
                    for b in ("beatable", "coinflip", "avoid")}
    out["wrong_beatable"] = [{"name": f["name"], "time": f["t"], "hp": f["my_hp"],
                               "boss": f["boss"], "score": s}
                              for f, s, p in predictions
                              if band(f, s) == "beatable" and not f["won"]]
    return out


def replay(fights, rows):
    samples = collections.defaultdict(lambda: {"base": [], "red": []})
    full = collections.defaultdict(lambda: {"base": [], "red": []})
    attacks = {r["timestamp"]: body(r) for r in rows if "action=attack" in (r.get("requestBody") or "")}
    for f in fights:
        for k, field in (("base", "my_base"), ("red", "my_red")):
            if f[field]:
                full[f["my_hp"]][k].append(f[field])
    medians = {hp: {"hp": hp, **{k: statistics.median(v) for k, v in d.items()}}
               for hp, d in full.items()}
    cards, card_at_attack, profile_at_attack = {}, {}, {}
    for row in rows:
        b = body(row)
        if not b:
            continue
        if "type=arena" in row["url"] and b.get("html"):
            for m in CARD_RE.finditer(b["html"]):
                parsed = parse_cards(m.group(0))
                level = re.search(r'ar-opp-lvl">Lv\.\s*(\d+)', m.group(1), re.I)
                if parsed and level:
                    cards[html.unescape(parsed[0]["name"])] = (int(level.group(1)), row["timestamp"])
        elif "action=open_next_page" in (row.get("requestBody") or "") and b.get("ok"):
            boss = (b.get("new_page") or {}).get("boss_data") or {}
            if boss.get("name") and boss.get("level"):
                cards[boss["name"]] = (boss["level"], row["timestamp"])
        elif "arena_v2.php" in row["url"] and "action=attack" in (row.get("requestBody") or ""):
            if b.get("defender") in cards:
                card_at_attack[row["timestamp"]] = cards[b["defender"]]
            if not b.get("ok") or not b.get("rounds"):
                continue
            hp = b["att_max_hp"]
            d = samples[hp]
            if d["base"] and d["red"]:
                profile_at_attack[row["timestamp"]] = {"hp": hp, **{k: statistics.median(v[-250:]) for k, v in d.items()}}
            bases = [r["attacker"]["base_dmg"] for r in b["rounds"]
                     if isinstance(r.get("attacker"), dict) and r["attacker"].get("base_dmg", 0) > 0]
            reductions = sorted(r["defender"]["reduction"] for r in b["rounds"]
                                if isinstance(r.get("defender"), dict) and r["defender"].get("reduction", 0) > 0)
            if bases and reductions:
                d["base"].append(statistics.mean(bases))
                d["red"].append(reductions[len(reductions)//2])
    chronological, hindsight, skipped = [], [], []
    # This intentionally excludes the first fight of each loadout rather than
    # inventing a preview or learning from the fight being scored.
    for f in fights:
        hp = f["my_hp"]
        h = score(f, medians[hp])
        hindsight.append((f, h, probability(f, h)))
        my = profile_at_attack.get(f["ts"])
        card = card_at_attack.get(f["ts"])
        if my and card:
            prospective = dict(f, lvl=card[0], prior_profile=my,
                               card_age_seconds=(f["ts"]-card[1])/1000,
                               response=attacks.get(f["ts"]))
            s = score(prospective, my)
            chronological.append((prospective,
                                  s, probability(f, s)))
        else:
            skipped.append({"name": f["name"], "time": f["t"], "hp": hp,
                            "reason": "missing_prior_profile" if not my else "missing_prior_level"})
    return chronological, hindsight, skipped, medians


def solve(matrix, rhs):
    """Small dense linear system, with partial pivoting."""
    a = [list(row) + [value] for row, value in zip(matrix, rhs)]
    n = len(rhs)
    for i in range(n):
        pivot = max(range(i, n), key=lambda j: abs(a[j][i]))
        a[i], a[pivot] = a[pivot], a[i]
        if abs(a[i][i]) < 1e-12:
            raise ValueError("singular design")
        divisor = a[i][i]
        a[i] = [v/divisor for v in a[i]]
        for j in range(n):
            if j != i:
                multiplier = a[j][i]
                a[j] = [x-multiplier*y for x, y in zip(a[j], a[i])]
    return [row[-1] for row in a]


def sigmoid(x):
    return 1/(1+math.exp(-max(-35, min(35, x))))


def features(f, s, mode):
    x = [1, math.log(max(.01, s))*4]
    if mode in ("quote", "passive", "stats", "cp_hp"):
        x.append(((f["wp"] if f["wp"] is not None else 50)-50)/5)
    if mode in ("passive", "stats", "cp_hp"):
        x.append(float(f["passive"]))
    if mode == "stats":
        x.extend(math.log(max(1, v)/max(1, f["stats"][0])) for v in f["stats"][1:])
    if mode == "cp_hp":
        x.append(math.log(max(100, (f["cp"] or 0)-sum(f["stats"]))/max(100, 7.19*f["lvl"]-49))*4)
    return x


def fit_logistic(train, mode):
    samples = [(features(f, s, mode), float(f["won"])) for f, s, p in train]
    n = len(samples[0][0])
    coef = [0.] * n
    # Fixed L2 penalty, not selected against held-out outcomes.
    penalties = [.1] + [1.] * (n-1)
    for _ in range(30):
        grad = [-penalties[i]*coef[i] for i in range(n)]
        hess = [[penalties[i] if i == j else 0 for j in range(n)] for i in range(n)]
        for x, y in samples:
            p = sigmoid(sum(a*b for a, b in zip(x, coef)))
            for i in range(n):
                grad[i] += x[i]*(y-p)
                for j in range(n):
                    hess[i][j] += x[i]*x[j]*p*(1-p)
        step = solve(hess, grad)
        coef = [v+d for v, d in zip(coef, step)]
        if max(abs(v) for v in step) < 1e-7:
            break
    return coef


def model_comparison(chronological):
    regular = [x for x in chronological if not x[0]["boss"] and x[0]["wp"] is not None]
    seasons = sorted({f["my_hp"] for f, s, p in regular})
    # The first two observed loadouts initialize all candidates. Each later
    # loadout is a completely untouched chronological test block.
    tests = seasons[2:]
    predictions = collections.defaultdict(list)
    coefficients = {}
    for hp in tests:
        train = [x for x in regular if x[0]["my_hp"] in seasons[:seasons.index(hp)]]
        test = [x for x in regular if x[0]["my_hp"] == hp]
        coefficients[hp] = {}
        for mode in ("score", "quote", "passive", "stats", "cp_hp"):
            coef = fit_logistic(train, mode)
            coefficients[hp][mode] = coef
            for f, s, p in test:
                fitted = sigmoid(sum(a*b for a, b in zip(coef, features(f, s, mode))))
                predictions[mode].append((f, s, fitted))
                # The conservative proposal only changes coin-flip probabilities
                # and their lean. Existing safe/avoid score thresholds stay put.
                predictions[mode+"_coinflip_only"].append((f, s, fitted if .8 <= s < 1.2 else p))
        predictions["current"].extend(test)
        counts = collections.defaultdict(list)
        for f, s, p in train:
            counts[(band(f, s), s >= 1, (f["wp"] or 0) >= 50)].append(f["won"])
        for f, s, p in test:
            values = counts[(band(f, s), s >= 1, (f["wp"] or 0) >= 50)]
            # Beta(1,1), same predeclared prior in every band.
            smoothed = (sum(values)+1)/(len(values)+2)
            predictions["rolling_bands"].append((f, s, smoothed))
    paired = {}
    rng = random.Random(20261015)
    for name in ("quote_coinflip_only", "passive_coinflip_only", "stats_coinflip_only", "cp_hp_coinflip_only"):
        for label, condition in (("coinflip", lambda f, s: .8 <= s < 1.2),
                                 ("post_calibration_coinflip", lambda f, s: .8 <= s < 1.2 and f["t"] >= "2026-10-05")):
            differences, better, worse = [], 0, 0
            for old, new in zip(predictions["current"], predictions[name]):
                f, s, p = old
                q = new[2]
                if not condition(f, s):
                    continue
                differences.append((q-f["won"])**2-(p-f["won"])**2)
                better += ((p >= .5) != f["won"]) and ((q >= .5) == f["won"])
                worse += ((p >= .5) == f["won"]) and ((q >= .5) != f["won"])
            draws = sorted(statistics.mean(rng.choices(differences, k=len(differences))) for _ in range(2000))
            paired[name+":"+label] = {"n": len(differences), "brier_difference": statistics.mean(differences),
                                       "iid_bootstrap_95": [draws[50], draws[1949]],
                                       "corrected_calls": better, "new_wrong_calls": worse}
    return {"test_seasons": tests, "coefficients": coefficients, "paired": paired,
            "models": {name: {"all": metrics(pred),
                              "coinflip": metrics([x for x in pred if .8 <= x[1] < 1.2]),
                              "post_calibration": metrics([x for x in pred if x[0]["t"] >= "2026-10-05"]),
                              "post_calibration_coinflip": metrics([x for x in pred if x[0]["t"] >= "2026-10-05" and .8 <= x[1] < 1.2]),
                              "seasons": {hp: metrics([x for x in pred if x[0]["my_hp"] == hp]) for hp in tests},
                              "season_coinflips": {hp: metrics([x for x in pred if x[0]["my_hp"] == hp and .8 <= x[1] < 1.2]) for hp in tests}}
                       for name, pred in predictions.items()}}


def hp_comparison(chronological):
    regular = [x for x in chronological if not x[0]["boss"]]
    seasons = sorted({f["my_hp"] for f, s, p in regular})
    results = collections.defaultdict(list)
    errors = collections.defaultdict(list)
    previous = {}
    for f, s, p in regular:
        if f["my_hp"] not in seasons[2:]:
            previous[f["name"]] = f["op_hp"]
            continue
        train = [a for a, b, c in regular if a["my_hp"] in seasons[:seasons.index(f["my_hp"])]]
        profile = f["prior_profile"]
        level_hp = 7.19*f["lvl"]-49
        estimates = {"level": level_hp, "previous_opponent_hp": previous.get(f["name"], level_hp)}
        estimates["cp_minus_stats"] = max(100, (f["cp"] or 0)-sum(f["stats"]))
        for mode in ("passive", "stats", "multiplicative"):
            def vector(g):
                x = [1, (g["lvl"]-100)/20, float(g["passive"])]
                if mode != "passive":
                    x += [v/1000 for v in g["stats"]]
                    x += [(g["cp"] or sum(g["stats"]))/4000]
                return x
            dim = len(vector(f))
            mat = [[.01 if i == j else 0 for j in range(dim)] for i in range(dim)]
            rhs = [0.]*dim
            for g in train:
                x = vector(g)
                y = (g["op_hp"]/(95+5*g["lvl"])-1 if mode == "multiplicative"
                     else (g["op_hp"]-(7.19*g["lvl"]-49))/100)
                for i in range(dim):
                    rhs[i] += x[i]*y
                    for j in range(dim):
                        mat[i][j] += x[i]*x[j]
            coef = solve(mat, rhs)
            residual = sum(a*b for a, b in zip(coef, vector(f)))
            estimates[mode] = max(100, ((95+5*f["lvl"])*(1+residual) if mode == "multiplicative"
                                        else level_hp+100*residual))
        estimates["oracle"] = f["op_hp"]
        for mode, estimate in estimates.items():
            adjusted = s*level_hp/estimate
            results[mode].append((f, adjusted, probability(f, adjusted)))
            errors[mode].append(estimate-f["op_hp"])
        previous[f["name"]] = f["op_hp"]
    return {mode: {"metrics": metrics(pred),
                   "mae_hp": statistics.mean(abs(e) for e in errors[mode]),
                   "rmse_hp": math.sqrt(statistics.mean(e*e for e in errors[mode]))}
            for mode, pred in results.items()}


def hp_signal(fights):
    regular = [f for f in fights if not f["boss"] and f["cp"]]
    def summarize(group):
        errors = [f["cp"]-sum(f["stats"])-f["op_hp"] for f in group]
        return {"n": len(group), "exact": sum(e == 0 for e in errors),
                "mae": statistics.mean(abs(e) for e in errors),
                "max_absolute_error": max(abs(e) for e in errors),
                "underestimates": sum(e < 0 for e in errors),
                "error_counts": dict(collections.Counter(errors))}
    return {"all": summarize(regular),
            "seasons": {hp: summarize([f for f in regular if f["my_hp"] == hp])
                        for hp in sorted({f["my_hp"] for f in regular})},
            "largest_errors": [{"name": f["name"], "time": f["t"], "level": f["lvl"],
                                "hp": f["op_hp"], "card_hp": f["cp"]-sum(f["stats"]),
                                "passive": f["passive"]}
                               for f in sorted(regular, key=lambda f: abs(f["cp"]-sum(f["stats"])-f["op_hp"]), reverse=True)[:10]]}


def stochastic_min_damage(base):
    """Candidate only: five steps, bounded by an independent uniform 45..75."""
    return sum(min(.088*n*base/5, cap) for n in (3, 4, 5, 6, 7)
               for cap in range(45, 76))/155


def floor_candidate_predictions(chronological):
    predictions = []
    for f, s, p in chronological:
        my = f["prior_profile"]
        op_base = (.4824*f["stats"][0]+9.85 if f["boss"] else .5546*f["stats"][0]-6.77)
        op_hp = (95+5*f["lvl"] if f["boss"] else 7.19*f["lvl"]-49)
        mine = max(stochastic_min_damage(my["base"]), my["base"]-f["stats"][1])
        theirs = max(stochastic_min_damage(op_base), op_base-my["red"])
        adjusted = (my["hp"]/theirs)/(op_hp/mine)
        predictions.append((f, adjusted, probability(f, adjusted)))
    return predictions


def floor_candidates(predictions):
    return {"all": metrics(predictions), "regular": metrics([x for x in predictions if not x[0]["boss"]]),
            "boss": metrics([x for x in predictions if x[0]["boss"]]),
            "seasons": {hp: metrics([x for x in predictions if x[0]["my_hp"] == hp])
                        for hp in sorted({x[0]["my_hp"] for x in predictions})}}


def lineup_order_comparison(rows, chronological):
    """Compare orders on complete, unfought snapshots with an earlier profile.

    Values are model-based expected regular pots, not realized policy outcomes.
    Both orders use the SAME deployed band probabilities; no bounty weighting.
    """
    raw_times = sorted(r["timestamp"] for r in rows
                       if "arena_v2.php" in r["url"] and "action=attack" in (r.get("requestBody") or "")
                       and body(r) and body(r).get("ok") and body(r).get("rounds"))
    by_ts = {f["ts"]: f for f, s, p in chronological}
    seen, values = set(), []
    for row in rows:
        b = body(row)
        if "type=arena" not in row["url"] or not b or not b.get("html"):
            continue
        cards = []
        for m in CARD_RE.finditer(b["html"]):
            if "ar-opp-boss" in m.group(0) or "fought-btn" in m.group(0):
                continue
            level = re.search(r'ar-opp-lvl">Lv\.\s*(\d+)', m.group(1), re.I)
            parsed = parse_cards(m.group(0))
            if not level or not parsed or parsed[0]["bounty"] is None:
                continue
            c = parsed[0]
            cards.append(dict(c, name=html.unescape(c["name"]), lvl=int(level[1]), boss=False))
        if len(cards) != 4:
            continue
        i = bisect.bisect_right(raw_times, row["timestamp"])
        next_fight = by_ts.get(raw_times[i]) if i < len(raw_times) else None
        if not next_fight or next_fight["name"] not in {c["name"] for c in cards}:
            continue
        my = next_fight["prior_profile"]
        identity = (my["hp"], tuple(sorted((c["name"], c["lvl"], tuple(c["stats"]), c["bounty"]) for c in cards)))
        if identity in seen:
            continue
        seen.add(identity)
        items = [(c, score(c, my), probability(c, score(c, my))) for c in cards]
        def ev(ordered):
            pot = 0.
            for c, s, p in ordered:
                pot = p*(pot+c["bounty"])
            return pot
        score_order = sorted(items, key=lambda x: x[1])
        probability_order = sorted(items, key=lambda x: (x[2], x[1]))
        values.append({"time": row.get("isoTime"), "hp": my["hp"],
                       "score_ev": ev(score_order), "probability_ev": ev(probability_order),
                       "different_order": [x[0]["name"] for x in score_order] != [x[0]["name"] for x in probability_order]})
    return {"n": len(values), "different_order": sum(v["different_order"] for v in values),
            "mean_score_ev": statistics.mean(v["score_ev"] for v in values),
            "mean_probability_ev": statistics.mean(v["probability_ev"] for v in values),
            "mean_difference": statistics.mean(v["probability_ev"]-v["score_ev"] for v in values),
            "worse_probability_order": sum(v["probability_ev"] < v["score_ev"]-1e-8 for v in values)}


def mechanics(fights, rows):
    by_ts = {f["ts"]: f for f in fights}
    hit_groups = collections.defaultdict(list)
    per_fight = []
    for row in rows:
        if "action=attack" not in (row.get("requestBody") or ""):
            continue
        b = body(row)
        if not b or not b.get("ok") or not b.get("rounds"):
            continue
        f = by_ts.get(row["timestamp"])
        summary = {"ts": row["timestamp"], "name": b.get("defender"), "hp": b.get("att_max_hp"),
                   "boss": b.get("is_boss"), "gear": b.get("def_gear"), "sides": {}}
        for side in ("attacker", "defender", "pre_attacker", "pre_defender"):
            hs = [r[side] for r in b["rounds"] if isinstance(r.get(side), dict)]
            if not hs:
                continue
            regular = not side.startswith("pre_")
            key = f'{b.get("att_max_hp")}:{side}'
            hit_groups[key].extend(hs)
            chances = {k: sorted({h[k] for h in hs if isinstance(h.get(k), (int, float))})
                       for k in ("dodge_chance", "crit_chance", "block_chance", "crit_mult")}
            summary["sides"][side] = {**chances, "n": len(hs),
                                       "actions": dict(collections.Counter(h.get("action") for h in hs))}
            if regular and f:
                summary["stats"] = f["stats"]
                summary["passive"] = f["passive"]
                summary["op_hp"] = f["op_hp"]
                summary["lvl"] = f["lvl"]
        summary["first_strike"] = [r["first_strike"] for r in b["rounds"] if r.get("first_strike")]
        per_fight.append(summary)
    groups = {}
    for key, hs in sorted(hit_groups.items()):
        floor = [h for h in hs if h.get("min_dmg") is not None and h.get("base_dmg", 0) > 0]
        groups[key] = {"n": len(hs), "armory": dict(collections.Counter(str(h.get("armory_mult")) for h in hs)),
                       "min_damage_values": dict(collections.Counter(str(h["min_dmg"]) for h in floor)),
                       "crit_mult": dict(collections.Counter(str(h.get("crit_mult")) for h in hs if h.get("action") == "critical")),
                       "max_min_damage": max((h["min_dmg"] for h in floor), default=None)}
    return {"groups": groups, "fights": per_fight}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cache", type=Path, required=True)
    ap.add_argument("--rescan", action="store_true")
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    if args.cache.resolve() == args.output.resolve():
        ap.error("--cache and --output must be different paths")
    data = load_data(args.cache, args.rescan)
    fights, hits = build_fights(data["rows"])
    chronological, hindsight, skipped, medians = replay(fights, data["rows"])
    out = {"sources": data["sources"], "rows": len(data["rows"]), "fights": len(fights),
           "range": [fights[0]["t"], fights[-1]["t"]], "season_profiles": medians,
           "hindsight": metrics(hindsight), "chronological": metrics(chronological),
           "skipped": skipped, "mechanics": mechanics(fights, data["rows"])}
    out["model_comparison"] = model_comparison(chronological)
    out["hp_comparison"] = hp_comparison(chronological)
    out["hp_signal"] = hp_signal(fights)
    out["quote_by_loadout"] = {}
    for hp in sorted(medians):
        g = [f for f in fights if f["my_hp"] == hp and not f["boss"] and f["cp"] and f["wp"] is not None]
        intercept, slope, correlation, residual = linfit([math.log(f["cp"]) for f in g], [f["wp"] for f in g])
        out["quote_by_loadout"][hp] = {"n": len(g), "intercept": intercept, "slope": slope,
                                       "correlation": correlation, "residual_sd": residual}
    raw = [(r, body(r)) for r in data["rows"] if "arena_v2.php" in r["url"] and "action=attack" in (r.get("requestBody") or "")]
    raw = [(r, b) for r, b in raw if b and b.get("ok") and b.get("rounds")]
    included = {f["ts"] for f in fights}
    out["unpaired_attacks"] = [{"time": r.get("isoTime"), "name": b.get("defender"),
                                "boss": b.get("is_boss"), "hp": b.get("att_max_hp")}
                               for r, b in raw if r["timestamp"] not in included]
    out["raw_attacks"] = len(raw)
    normalized_rows = []
    for r in data["rows"]:
        b = body(r)
        if b and b.get("html"):
            normalized = re.sub(r'(ar-opp-name">)([^<]*)(<)',
                                lambda m: m[1]+html.unescape(m[2])+m[3], b["html"])
            if normalized != b["html"]:
                r = dict(r, responseBody=json.dumps(dict(b, html=normalized)))
        normalized_rows.append(r)
    normalized_fights, _ = build_fights(normalized_rows)
    normalized_chrono, _, _, _ = replay(normalized_fights, normalized_rows)
    out["entity_normalized_replay"] = {"fights": len(normalized_fights), "chronological": metrics(normalized_chrono),
                                        "recovered_only": metrics([x for x in normalized_chrono if x[0]["ts"] not in included])}
    floor_predictions = floor_candidate_predictions(chronological)
    out["stochastic_cap_candidate"] = floor_candidates(floor_predictions)
    out["stochastic_cap_model_comparison"] = model_comparison(floor_predictions)
    out["lineup_order_comparison"] = lineup_order_comparison(data["rows"], chronological)
    out["card_audit"] = {"max_age_seconds": max(f["card_age_seconds"] for f, s, p in chronological),
                         "older_than_day": sum(f["card_age_seconds"] > 86400 for f, s, p in chronological),
                         "response_level_disagreements": sum(f["lvl"] != f["response"]["def_level"]
                                                              for f, s, p in chronological)}
    for name, pred in (("hindsight", hindsight), ("chronological", chronological)):
        out[name]["regular"] = metrics([x for x in pred if not x[0]["boss"]])
        out[name]["boss"] = metrics([x for x in pred if x[0]["boss"]])
        out[name]["seasons"] = {hp: metrics([x for x in pred if x[0]["my_hp"] == hp])
                                for hp in sorted(medians)}
    args.output.write_text(json.dumps(out, indent=2))
    print(json.dumps({"range": out["range"], "fights": len(fights), "card_audit": out["card_audit"],
                      "chronological": out["chronological"],
                      "comparison": {name: {part: v[part] for part in ("all", "coinflip")}
                                     for name, v in out["model_comparison"]["models"].items()},
                      "hp_comparison": out["hp_comparison"]}, indent=2))


if __name__ == "__main__":
    main()
