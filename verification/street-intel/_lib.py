"""Shared helpers for the street-intel verification scripts in this folder.

Reads directly from the gzipped `fifth-family-archive-*.ndjson.gz` request
archive exported by the extension's own archive feature — no need to
decompress it to disk first. Every script in this folder takes `--archive`;
if omitted, we glob common locations for the newest matching file.
"""

import argparse
import gzip
import html
import json
import math
import re
from glob import glob
from pathlib import Path

ARCHIVE_GLOBS = [
    str(Path.home() / "Downloads" / "fifth-family-archive-*.ndjson.gz"),
    str(Path.home() / "Downloads" / "tff archives" / "fifth-family-archive-*.ndjson.gz"),
]


def find_default_archive() -> str:
    candidates = [p for pattern in ARCHIVE_GLOBS for p in glob(pattern)]
    if not candidates:
        raise SystemExit(
            "No archive found. Pass --archive /path/to/fifth-family-archive-*.ndjson.gz\n"
            f"(looked in: {', '.join(ARCHIVE_GLOBS)})"
        )
    # Filenames embed an ISO timestamp, so lexicographic max == newest.
    return max(candidates)


def add_archive_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--archive",
        default=None,
        help="Path to fifth-family-archive-*.ndjson.gz (default: newest match under ~/Downloads "
        "or its 'tff archives' subfolder)",
    )


def resolve_archive_path(args) -> str:
    return args.archive or find_default_archive()


def add_archives_arg(parser: argparse.ArgumentParser) -> None:
    """Plural counterpart to add_archive_arg, for scripts that benefit from
    combining more than one export (a single archive's window often doesn't
    hold enough events for a per-bucket check to mean anything — see
    verify_complication_type_stats.py). Repeatable: `--archive a.gz --archive
    b.gz`. Defaults to *every* matching file found, not just the newest."""
    parser.add_argument(
        "--archive",
        dest="archives",
        action="append",
        default=None,
        help="Path to a fifth-family-archive-*.ndjson.gz (repeatable to combine several; "
        "default: every match under ~/Downloads or its 'tff archives' subfolder)",
    )


def resolve_archive_paths(args) -> list:
    if args.archives:
        return args.archives
    candidates = sorted(p for pattern in ARCHIVE_GLOBS for p in glob(pattern))
    if not candidates:
        raise SystemExit(
            "No archive found. Pass --archive /path/to/fifth-family-archive-*.ndjson.gz "
            "(repeatable)\n"
            f"(looked in: {', '.join(ARCHIVE_GLOBS)})"
        )
    return candidates


def load_records_deduped(archive_paths):
    """Same as load_records, but across several archives whose time windows
    may overlap (each export is a rolling window off the same underlying
    IndexedDB, so re-running this later against a fresh export plus an old
    one will see the same request twice). De-duplicates by (timestamp,
    requestBody) — good enough since a genuine re-send of the identical body
    in the identical millisecond has never been observed and isn't
    meaningfully different from a duplicate anyway."""
    seen = set()
    for path in archive_paths:
        for row in load_records(path):
            key = (row.get("timestamp"), row.get("requestBody"))
            if key in seen:
                continue
            seen.add(key)
            yield row


def load_records(archive_path: str):
    """Yields each parsed JSON line except the header (first line)."""
    opener = gzip.open if archive_path.endswith(".gz") else open
    with opener(archive_path, "rt", encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i == 0:
                continue  # header row (export metadata), not a request record
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def round_half_up(x: float) -> int:
    """PHP/JS-style half-up rounding — Python's round() is banker's rounding
    (round-half-to-even) and disagrees with the game on exact X.5 values."""
    return math.floor(x + 0.5) if x >= 0 else math.ceil(x - 0.5)


_APPROACHES_RE = re.compile(
    r'siScout\((\d+),this\)"\s+data-title="[^"]*"\s+data-desc="[^"]*"\s+data-approaches="([^"]*)"'
)


def extract_card_autofail(records) -> dict:
    """Maps opportunity_id (str) -> {approach_key: autofail(0/1)}, parsed from
    the pre-scout `data-approaches` attribute in `GET panel.php?type=street_intel`
    responses. This is the ONLY place the autofail flag is exposed — it is not
    present anywhere in the street_intel.php scout response itself."""
    card_autofail: dict = {}
    for row in records:
        ep = row.get("endpoint", "")
        if "panel.php" not in ep or "street_intel" not in ep:
            continue
        raw = row.get("responseBody")
        if not raw:
            continue
        try:
            resp = json.loads(raw)
        except json.JSONDecodeError:
            continue
        html_body = resp.get("html", "")
        if not html_body:
            continue
        for m in _APPROACHES_RE.finditer(html_body):
            oid, approaches_raw = m.group(1), m.group(2)
            try:
                approaches = json.loads(html.unescape(approaches_raw))
            except json.JSONDecodeError:
                continue
            card_autofail[oid] = {a["key"]: a.get("autofail") for a in approaches}
    return card_autofail


def scout_estimates(records):
    """Yields (opportunity_id, estimate_dict, modifier_intel) for every
    scout-response estimate that has real modifiers (i.e. was actually
    revealed — excludes partial-reveal placeholder rows)."""
    for row in records:
        if row.get("endpoint") != "POST /actions/street_intel.php":
            continue
        req_body = row.get("requestBody", "") or ""
        m = re.search(r"opportunity_id=(\d+)", req_body)
        oid = m.group(1) if m else None
        try:
            resp = json.loads(row["responseBody"])
        except (json.JSONDecodeError, KeyError, TypeError):
            continue
        if not resp.get("ok") or "estimates" not in resp:
            continue
        mi = resp.get("modifier_intel")
        for est in resp["estimates"]:
            if est.get("modifiers"):
                yield oid, est, mi


# ---------------------------------------------------------------------------
# Multi-archive helpers for the profit / stamina / target-selection scripts
# (added 2026-10-04). Those questions need the whole combined history, and
# the combined `tff archives` folder is several GB of gzip — loading it
# single-threaded through load_records_deduped takes minutes, so this reads
# each archive in parallel and keeps only the endpoints a script asks for.
# ---------------------------------------------------------------------------

def _load_filtered(args):
    path, needles = args
    out = []
    for row in load_records(path):
        ep = row.get("endpoint", "") or ""
        if any(n in ep for n in needles):
            out.append(row)
    return out


def load_endpoint_records(archive_paths, endpoint_substrings, processes: int = 8) -> list:
    """Rows from every archive whose `endpoint` contains any of
    `endpoint_substrings`, de-duplicated by (timestamp, endpoint, requestBody)
    and sorted by timestamp. Panel endpoints carry a unique `_t=` cache-buster
    in the URL but the archive's `endpoint` field strips it, which is why the
    endpoint is part of the key but the URL isn't."""
    from multiprocessing import Pool

    seen = set()
    rows = []
    with Pool(processes) as pool:
        for chunk in pool.imap_unordered(_load_filtered, [(p, tuple(endpoint_substrings)) for p in archive_paths]):
            for row in chunk:
                key = (row.get("timestamp"), row.get("endpoint"), row.get("requestBody"), row.get("url"))
                if key in seen:
                    continue
                seen.add(key)
                rows.append(row)
    rows.sort(key=lambda r: r.get("timestamp") or 0)
    return rows


def _money(text: str):
    m = re.match(r"\$?\s*([\d.,]+)\s*([kKmMbB]?)", text.strip())
    if not m:
        return None
    return float(m.group(1).replace(",", "")) * {"": 1, "k": 1e3, "m": 1e6, "b": 1e9}[m.group(2).lower()]


def parse_panel_cards(panel_html: str) -> dict:
    """Python port of streetIntelPanelRegexParser.ts — opportunity_id ->
    {title, risk, legendary, reward_min, reward_max, stamina, scout_cost,
    approaches}. Only workable cards (ones with a siScout handler) are
    returned, same as the extension's own parser."""
    end = panel_html.find("Operation Dossier")
    if end != -1:
        panel_html = panel_html[:end]
    cards = {}
    for chunk in panel_html.split('<div class="si-card ')[1:]:
        id_m = re.search(r"siScout\((\d+),", chunk)
        if not id_m:
            continue
        cls_m = re.match(r'^([^"]*)"', chunk)
        cls = cls_m.group(1) if cls_m else ""
        risk = next((r for r in ("extreme", "high", "medium") if f"risk-{r}" in cls), "low")
        title_m = re.search(r'cat-icon"[\s\S]*?</div>\s*<span>([^<]+)', chunk)
        reward_m = re.search(r'class="val"[^>]*>(\$[^<]+)<', chunk)
        lo = hi = None
        if reward_m:
            parts = re.split(r"[–-]", reward_m.group(1))
            lo, hi = _money(parts[0]), _money(parts[-1])
        stam_m = re.search(r'class="val"[^>]*>(\d+)</div><div class="lbl">Stamina</div>', chunk)
        scout_m = re.search(r"Scout \((\d+)S\)", chunk)
        approaches = []
        ap_m = re.search(r'data-approaches="([^"]+)"', chunk)
        if ap_m:
            try:
                approaches = json.loads(html.unescape(ap_m.group(1)))
            except json.JSONDecodeError:
                pass
        cards[int(id_m.group(1))] = {
            "title": html.unescape(title_m.group(1).strip()) if title_m else None,
            "risk": risk,
            "legendary": "legendary" in cls,
            "reward_min": lo,
            "reward_max": hi,
            "stamina": int(stam_m.group(1)) if stam_m else None,
            "scout_cost": int(scout_m.group(1)) if scout_m else 1,
            "approaches": approaches,
        }
    return cards


def panel_html(row):
    try:
        return json.loads(row.get("responseBody") or "").get("html", "") or ""
    except (json.JSONDecodeError, AttributeError):
        return ""


def build_attempts(rows) -> list:
    """Every `ok:true` Street Intel attempt, joined with its card (from the
    latest panel snapshot that showed it) and its resolved complication (if
    any). `net` = reward_cash minus whatever the complication took back."""
    cards = {}
    for row in rows:
        if "type=street_intel" in (row.get("endpoint") or ""):
            cards.update(parse_panel_cards(panel_html(row)))

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
        card = cards.get(oid, {})
        comp = complications.get(oid)
        lost = 0
        if comp and not comp[0]["comp_success"]:
            r = comp[0]
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
                "lost": lost,
                "net": reward - lost,
                "risk": card.get("risk"),
                "legendary": card.get("legendary"),
                "reward_min": card.get("reward_min"),
                "reward_max": card.get("reward_max"),
                "stamina": card.get("stamina"),
            }
        )
    return attempts


def player_day(ts_ms: int) -> str:
    """Calendar day in the player's own timezone (WAT, UTC+1) — the game's
    daily reset is 23:00 UTC, i.e. player midnight."""
    import datetime

    return (datetime.datetime.utcfromtimestamp(ts_ms / 1000) + datetime.timedelta(hours=1)).strftime("%Y-%m-%d")
