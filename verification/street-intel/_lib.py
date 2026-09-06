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
    str(Path.home() / "Desktop" / "fifth-family-archive-*.ndjson.gz"),
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
        help="Path to fifth-family-archive-*.ndjson.gz (default: newest match under ~/Downloads or ~/Desktop)",
    )


def resolve_archive_path(args) -> str:
    return args.archive or find_default_archive()


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
