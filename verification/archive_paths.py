"""Where the request archives live — the one place every verification script
looks them up, so a move means editing this file (or setting an env var),
not every script.

Searched, in order:
  1. <archive dir>/merged/fifth-family-archive-YYYY-MM.ndjson.gz — the long-run
     history, built by scripts/merge-archives.py
  2. <archive dir>/fifth-family-archive-*.ndjson.gz — exports not merged yet
  3. <downloads>/fifth-family-archive-*.ndjson.gz — fresh downloads

Overrides, no code change needed:
  TFF_ARCHIVE_DIR  — default ~/Downloads/tff archives
  TFF_DOWNLOADS_DIR — default ~/Downloads

Merged months overlap the raw exports they were built from until those are
deleted, so scripts combining several archives must de-duplicate rows (they
already do — each export overlaps the previous one anyway).
"""

import os
from glob import glob
from pathlib import Path

PATTERN = "fifth-family-archive-*.ndjson.gz"

DOWNLOADS_DIR = Path(os.environ.get("TFF_DOWNLOADS_DIR", Path.home() / "Downloads")).expanduser()
ARCHIVE_DIR = Path(os.environ.get("TFF_ARCHIVE_DIR", DOWNLOADS_DIR / "tff archives")).expanduser()
MERGED_DIR = ARCHIVE_DIR / "merged"

ARCHIVE_GLOBS = [
    str(MERGED_DIR / PATTERN),
    str(ARCHIVE_DIR / PATTERN),
    str(DOWNLOADS_DIR / PATTERN),
]


def _not_found(repeatable: bool) -> SystemExit:
    return SystemExit(
        "No archive found. Pass --archive /path/to/fifth-family-archive-*.ndjson.gz"
        + (" (repeatable)" if repeatable else "")
        + f"\n(looked in: {', '.join(ARCHIVE_GLOBS)})"
    )


def find_archives() -> list:
    """Every archive in the searched locations, sorted by path."""
    candidates = sorted({p for pattern in ARCHIVE_GLOBS for p in glob(pattern)})
    if not candidates:
        raise _not_found(repeatable=True)
    return candidates


def find_newest_archive() -> str:
    """The single archive with the latest data, judged by filename (exports embed
    their ISO export time, monthly files their YYYY-MM, so the max name is the
    newest). Note a fresh one-day export outranks the merged month it isn't
    folded into yet."""
    candidates = [p for pattern in ARCHIVE_GLOBS for p in glob(pattern)]
    if not candidates:
        raise _not_found(repeatable=False)
    return max(candidates, key=lambda p: Path(p).name)
