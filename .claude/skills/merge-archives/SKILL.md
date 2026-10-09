---
name: merge-archives
description: Use when the user wants to merge, fold in, consolidate, or clean up their HTTP-archive exports (fifth-family-archive-*.ndjson.gz) — e.g. "merge my archives", "I just downloaded a new archive, add it", "clean up the archive folder". Gathers new exports into ~/Downloads/tff archives, runs scripts/merge-archives.py to fold them into the de-duplicated monthly files in merged/, and deletes the merged source exports only after the script's own verification passes.
user-invocable: true
---

# Merging HTTP-archive exports

The player's long-run request history lives in **`~/Downloads/tff archives/merged/`**
as one file per month (`fifth-family-archive-YYYY-MM.ndjson.gz`). New exports from the
extension's HTTP Archive page ("Download New Since Last Export", or "Download Full
Archive") get folded into those monthly files by `scripts/merge-archives.py`. See
`docs/http-archive.md` → "Keeping a long-run history" for what the script does.

After the sources are deleted, **`merged/` is the only copy of that history** — every
step below exists to make sure it is only ever extended, never damaged.

## 1. Find new exports

- `~/Downloads/tff archives/` — exports the user already moved in.
- `~/Downloads/` itself — fresh downloads land here. Only pick up
  `fifth-family-archive-*.ndjson.gz` (full/"new" exports). Leave
  `fifth-family-selection-*` and `fifth-family-shapes-*` alone: those are working
  files for feature work, not history.

List what you found (name, size, and the time span from each header — line 1's
`archiveStats.oldestTimestamp`/`newestTimestamp`, or `filter.afterId`/`gapBefore` for a
"new since last export" file) and **move** the ones from `~/Downloads/` into
`~/Downloads/tff archives/`. Moving is fine without asking; it's the user's own
standing workflow. If there is nothing new anywhere, say so and stop.

## 2. Run the merge

```bash
python3 -I scripts/merge-archives.py "$HOME/Downloads/tff archives" --delete-sources
```

- Run it with `run_in_background` — it re-reads the whole history (~1.5 GB+ and
  growing) and takes several minutes. Don't poll; wait for the completion notice.
- `--delete-sources` is the user's stated preference (2026-10-09: "you can delete them
  yourself, since you are sure everything checks out"). The script only deletes after
  re-reading its output and confirming every input row is accounted for, and only the
  files it actually merged — never anything in `merged/`.
- Repeat background reads are dropped by default, matching the extension's capture
  rule. Only pass `--keep-repeats` if the user asks to keep them.
- While it runs, `merged/ff-merge-*` is its scratch folder. It removes it itself,
  even on failure. Tell the user not to touch it if they ask.

## 3. Report

Quote the summary lines (`inputs`, `merged`, `removed`, `verify`, `coverage`) and
spell out:

- How many rows/how much space the new exports added.
- **Any `gap:` lines that are new since the last merge.** A gap means rows were evicted
  from the extension before they were exported — the archive only holds ~2 days, so
  the fix is exporting at least daily. Also mention any source whose header had
  `"gapBefore": true` (the script prints these).
- That the sources were deleted (or why not).

If the output says **`VERIFY FAILED`**, nothing was replaced or deleted: report the
line verbatim, leave every file where it is, and investigate before re-running —
never retry with flags changed to "get past" the check.
