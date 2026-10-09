#!/usr/bin/env python3
"""Merge HTTP-archive exports into one de-duplicated file per month.

Every "Download Full Archive" export repeats whatever the extension still held
at that moment, so a folder of exports is mostly the same rows over and over.
This folds any number of them (full, "new since last export", or selection
exports — anything with the `ff-request-archive` header) into
`<out>/fifth-family-archive-YYYY-MM.ndjson.gz`, one row per captured request,
sorted by time, in the exact row format the exports use — so every jq/grep
recipe in docs/http-archive.md works on the merged files unchanged.

Re-runnable: monthly files already in <out> are read back in as inputs, so
dropping new exports into the folder and running this again extends them.

  python3 scripts/merge-archives.py "~/Downloads/tff archives"            # merge + verify, keep sources
  python3 scripts/merge-archives.py "~/Downloads/tff archives" --delete-sources
  python3 scripts/merge-archives.py "~/Downloads/tff archives" --keep-repeats    # keep every repeat read

By default it also drops *repeat reads*, using the same rule the extension
applies at capture time since 2026-10-09 (`skipsIdenticalRepeat` in
src/shared/requestLog/policy.ts): in time order, a background GET whose status
and response body match the newest kept row for the same endpoint is dropped.
Page traffic and every POST are always kept; only the timestamp of a repeated
read is lost, its content is still in the earlier identical row.

Sources are only ever deleted with --delete-sources, and only after the merged
output has been re-read and every distinct input row confirmed present.

Two rows are the same capture when timestamp, method, url, origin, request
body and response body all match. The extension's row `id` isn't used: exports
made before 2026-10-09 don't carry it, and ids restart if the archive database is ever
recreated. When the same capture appears in several exports, the copy from the
newest export wins (newer extension versions may add fields).
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

MERGED_PREFIX = "fifth-family-archive-"
HOUR_MS = 3_600_000
# Every export row serializes `timestamp` within its first few fields — read it
# straight off the line instead of parsing a body that can run to 512 KB.
TIMESTAMP_RE = re.compile(r'"timestamp":(\d+)')


def utc(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")


def row_key(row: dict) -> bytes:
    h = hashlib.blake2b(digest_size=16)
    for part in (row.get("timestamp"), row.get("method"), row.get("url"), row.get("origin"), row.get("requestBody"), row.get("responseBody")):
        h.update(json.dumps(part, ensure_ascii=False).encode())
        h.update(b"\x00")
    return h.digest()


def content_hash(row: dict) -> bytes:
    """Same input as the extension's `contentHash`: status, newline, stored body."""
    status = row.get("status")
    text = f"{'' if status is None else status}\n{row.get('responseBody') or ''}"
    return hashlib.blake2b(text.encode("utf-8"), digest_size=16).digest()


def is_repeat_candidate(row: dict) -> bool:
    return row.get("origin") == "background" and str(row.get("method", "")).upper() == "GET"


def is_merged_file(path: Path) -> bool:
    stem = path.name.removesuffix(".ndjson.gz")
    return stem.startswith(MERGED_PREFIX) and len(stem) == len(MERGED_PREFIX) + 7  # ...-YYYY-MM


def read_export(path: Path):
    """Yields (header, None) once, then (None, raw_line) per row."""
    with gzip.open(path, "rt", encoding="utf-8") as f:
        first = f.readline()
        header = json.loads(first) if first.strip() else {}
        if header.get("kind") != "ff-request-archive":
            raise ValueError(f"{path.name}: not an ff-request-archive export")
        yield header, None
        for line in f:
            if line.strip():
                yield None, line


def coverage_of(header: dict) -> tuple[int, int] | None:
    """Time span an export is known to fully cover, or None when it can't
    vouch for one (endpoint-filtered selections, or merged files, whose own
    coverage list is carried separately)."""
    flt = header.get("filter") or {}
    if header.get("merged"):
        return None
    if flt.get("endpoints") not in (None, "all"):
        return None
    stats = header.get("archiveStats") or {}
    lo, hi = stats.get("oldestTimestamp"), stats.get("newestTimestamp")
    if lo is None or hi is None:
        return None
    since = flt.get("since")
    if since and since != "all time":
        lo = max(lo, int(datetime.fromisoformat(since.replace("Z", "+00:00")).timestamp() * 1000))
    return (lo, hi)


def union(spans: list[tuple[int, int]], slack_ms: int = 0) -> list[tuple[int, int]]:
    out: list[list[int]] = []
    for lo, hi in sorted(spans):
        if out and lo <= out[-1][1] + slack_ms:
            out[-1][1] = max(out[-1][1], hi)
        else:
            out.append([lo, hi])
    return [(a, b) for a, b in out]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("folder", type=Path, help="folder holding *.ndjson.gz exports")
    ap.add_argument("--out", type=Path, help="where monthly files go (default: <folder>/merged)")
    ap.add_argument("--keep-repeats", action="store_true", help="keep background GETs that repeat the previous stored response for their endpoint")
    ap.add_argument("--delete-sources", action="store_true", help="delete the merged source exports after verification passes")
    args = ap.parse_args()

    folder = args.folder.expanduser().resolve()
    out_dir = (args.out.expanduser().resolve() if args.out else folder / "merged")
    out_dir.mkdir(parents=True, exist_ok=True)

    # A monthly file is never a source (it's re-read below as prior output), so
    # --delete-sources can't remove one even when --out points at <folder>.
    sources = sorted(p for p in folder.glob("*.ndjson.gz") if p.is_file() and not is_merged_file(p))
    previous = sorted(p for p in out_dir.glob("*.ndjson.gz") if is_merged_file(p))
    if not sources and not previous:
        print(f"no *.ndjson.gz exports in {folder}")
        return 1

    # Newest export first, so its copy of a duplicated row is the one kept.
    def exported_at(p: Path) -> str:
        with gzip.open(p, "rt", encoding="utf-8") as f:
            return json.loads(f.readline()).get("exportedAt", "")

    inputs = sorted(sources, key=exported_at, reverse=True) + previous
    work = Path(tempfile.mkdtemp(prefix="ff-merge-", dir=out_dir))
    seen: set[bytes] = set()
    day_files: dict[str, gzip.GzipFile] = {}
    spans: list[tuple[int, int]] = []
    carried_coverage: list[tuple[int, int]] = []
    gap_notes: list[str] = []
    total_rows = 0
    in_bytes = 0

    try:
        for i, path in enumerate(inputs, 1):
            in_bytes += path.stat().st_size
            rows = new = 0
            for header, line in read_export(path):
                if header is not None:
                    span = coverage_of(header)
                    if span:
                        spans.append(span)
                    for lo, hi in header.get("coverage", []):
                        carried_coverage.append((lo, hi))
                    if (header.get("filter") or {}).get("gapBefore"):
                        gap_notes.append(f"{path.name}: rows were evicted before this export's first row (exported too late after the previous one)")
                    continue
                rows += 1
                row = json.loads(line)
                key = row_key(row)
                if key in seen:
                    continue
                seen.add(key)
                new += 1
                day = datetime.fromtimestamp(int(TIMESTAMP_RE.search(line, 0, 200).group(1)) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
                fh = day_files.get(day)
                if fh is None:
                    fh = day_files[day] = gzip.open(work / f"{day}.ndjson.gz", "wt", encoding="utf-8", compresslevel=1)
                fh.write(line if line.endswith("\n") else line + "\n")
            total_rows += rows
            print(f"[{i}/{len(inputs)}] {path.name}: {rows:,} rows, {new:,} new", flush=True)

        for fh in day_files.values():
            fh.close()

        # One sorted file per month, written beside the finals then swapped in.
        coverage = union(spans + carried_coverage, slack_ms=0)
        months: dict[str, list[str]] = {}
        for day in sorted(day_files):
            months.setdefault(day[:7], []).append(day)

        written: list[Path] = []
        # Newest kept content per endpoint, carried across day and month
        # boundaries so a repeat straddling midnight is still caught.
        latest: dict[str, bytes] = {}
        # Dropped repeats: row key -> (endpoint, content hash), checked below
        # against what was actually written.
        repeats: dict[bytes, tuple[str, bytes]] = {}
        for month, days in months.items():
            tmp_out = work / f"{MERGED_PREFIX}{month}.ndjson.gz"
            count = 0
            lo = hi = None
            with gzip.open(tmp_out, "wt", encoding="utf-8", compresslevel=6) as out:
                month_start = int(datetime.strptime(month, "%Y-%m").replace(tzinfo=timezone.utc).timestamp() * 1000)
                nxt = datetime.strptime(month, "%Y-%m").replace(tzinfo=timezone.utc)
                nxt = nxt.replace(year=nxt.year + (nxt.month == 12), month=nxt.month % 12 + 1)
                month_end = int(nxt.timestamp() * 1000)
                month_cov = [(max(a, month_start), min(b, month_end)) for a, b in coverage if b > month_start and a < month_end]
                # Rows go to a scratch body first: the header carries the row
                # count and bounds, which aren't known until they're written.
                body = work / f"{month}.body"
                with open(body, "w", encoding="utf-8") as bf:
                    for day in days:
                        with gzip.open(work / f"{day}.ndjson.gz", "rt", encoding="utf-8") as f:
                            lines = [(int(TIMESTAMP_RE.search(l, 0, 200).group(1)), l) for l in f]
                        lines.sort(key=lambda t: t[0])
                        for ts, l in lines:
                            row = json.loads(l)
                            endpoint = row.get("endpoint") or ""
                            chash = content_hash(row)
                            if not args.keep_repeats and is_repeat_candidate(row) and latest.get(endpoint) == chash:
                                repeats[row_key(row)] = (endpoint, chash)
                                continue
                            latest[endpoint] = chash
                            bf.write(l)
                            count += 1
                            lo = ts if lo is None else lo
                            hi = ts
                header = {
                    "kind": "ff-request-archive",
                    "version": 1,
                    "merged": True,
                    "mergedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "note": "Merged by scripts/merge-archives.py. One JSON object per line; first line is this header. Rows are de-duplicated and sorted by timestamp. `coverage` lists the spans where full exports vouch for complete capture; time outside them may be missing rows.",
                    "repeatsDropped": not args.keep_repeats,
                    "rows": count,
                    "oldestTimestamp": lo,
                    "newestTimestamp": hi,
                    "coverage": month_cov,
                }
                out.write(json.dumps(header) + "\n")
                with open(body, "r", encoding="utf-8") as bf:
                    shutil.copyfileobj(bf, out, 1 << 20)
                body.unlink()
            written.append(tmp_out)

        # Verify: every distinct input row is either written exactly once, or
        # was dropped as a repeat whose identical content (same endpoint, same
        # status + body) was written.
        found: set[bytes] = set()
        written_content: set[tuple[str, bytes]] = set()
        out_rows = 0
        for p in written:
            for header, line in read_export(p):
                if header is not None:
                    continue
                out_rows += 1
                row = json.loads(line)
                found.add(row_key(row))
                written_content.add((row.get("endpoint") or "", content_hash(row)))
        repeat_keys = set(repeats)
        orphaned = sum(1 for c in repeats.values() if c not in written_content)
        if found | repeat_keys != seen or found & repeat_keys or out_rows != len(found) or orphaned:
            print(
                f"VERIFY FAILED: {len(seen):,} distinct input rows, {out_rows:,} written, {len(repeat_keys):,} dropped as repeats, "
                f"{len((found | repeat_keys) ^ seen):,} unaccounted, {orphaned:,} repeats with no written copy — nothing replaced or deleted"
            )
            return 2

        for p in written:
            os.replace(p, out_dir / p.name)
    finally:
        shutil.rmtree(work, ignore_errors=True)

    out_bytes = sum((out_dir / p.name).stat().st_size for p in written)
    print()
    print(f"inputs:  {len(inputs)} files, {in_bytes / 1e9:.2f} GB, {total_rows:,} rows")
    print(f"merged:  {len(written)} monthly files in {out_dir}, {out_bytes / 1e9:.2f} GB, {out_rows:,} rows")
    print(f"removed: {total_rows - len(seen):,} duplicate rows across exports ({(1 - len(seen) / max(total_rows, 1)) * 100:.0f}%)")
    if not args.keep_repeats:
        print(f"         {len(repeats):,} repeat background reads ({len(repeats) / max(len(seen), 1) * 100:.0f}% of distinct rows)")
    print("verify:  OK — every distinct input row is written once" + ("" if args.keep_repeats else ", or is a repeat whose identical copy is written"))

    cov = union(spans + carried_coverage)
    holes = [(a[1], b[0]) for a, b in zip(cov, cov[1:]) if b[0] - a[1] > HOUR_MS]
    if cov:
        print(f"coverage: {utc(cov[0][0])} → {utc(cov[-1][1])} UTC")
    for a, b in holes:
        print(f"  gap: {utc(a)} → {utc(b)} UTC ({(b - a) / HOUR_MS:.0f}h with no full export covering it)")
    for note in gap_notes:
        print(f"  {note}")

    if args.delete_sources:
        for p in sources:
            p.unlink()
        print(f"deleted {len(sources)} source exports")
    else:
        print(f"sources kept — re-run with --delete-sources to remove the {len(sources)} merged exports")
    return 0


if __name__ == "__main__":
    sys.exit(main())
