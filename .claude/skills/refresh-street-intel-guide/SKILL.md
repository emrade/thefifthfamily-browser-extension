---
name: refresh-street-intel-guide
description: Use when the user wants to refresh, rebuild or update the Street Intel phone guide (the "Street Intel Guide" Artifact they use to play Street Intel on mobile) — e.g. "/refresh-street-intel-guide", "update my phone guide", "I exported a new archive, refresh the guide". Rebuilds its data (stats, Street Intel bonuses, card approaches, complication record) from every archive and republishes it to the same link.
user-invocable: true
---

# Refreshing the Street Intel phone guide

The guide is a private Artifact the player opens on their phone:
**https://claude.ai/artifact/5rFbtLggergJQw4iAoCm4y**. Always republish to this URL so
their bookmark keeps working; never publish it as a new artifact.

It works out each card's odds before scouting with the same formula as
`src/shared/streetIntelPredict.ts`. Everything it needs is baked into the page by
`verification/street-intel/build_mobile_guide.py` from the template
`verification/street-intel/mobile_guide.html` (the data replaces `/*GUIDE_DATA*/null`).

## Steps

1. **Check there is new data.** List the archive locations (see the `use-archives`
   skill / `verification/archive_paths.py`) and note the newest export's time. If
   nothing is newer than the guide's current "data to" date, tell the player to export
   first ("Download New Since Last Export" on the HTTP Archive page) and stop.
2. **Build** into a fresh folder in the session scratchpad (takes about 2 minutes over
   every archive):
   ```
   python3 -I verification/street-intel/build_mobile_guide.py <scratchpad>/guide/street-intel-guide.html
   ```
   It prints what it found. Read it before publishing:
   - `cards with known approaches: N of 240` — should only ever grow.
   - `titles whose approaches changed in the last 45 days` — should be 0. If not, the
     game changed some cards; the page flags those cards, but tell the player.
   - `last scout ...` — the bonuses (mastery, collection, recon) only update from a
     scout. If the last scout is old, say so: the odds may read a little low.
   - `stats ...` — should be from the newest export.
   If it exits with "No scout or stats found", stop and report it.
3. **Check the odds still match the extension** before publishing. Bundle the
   predictor and compare every card × condition:
   ```
   npx esbuild src/shared/streetIntelPredict.ts --bundle --platform=node --format=cjs --alias:@=./src --outfile=<scratchpad>/guide/predict.cjs
   ```
   then run a small Node script that loads the page's `const D = {...}` and its
   `function predict(...)`, calls `predictCard` for each card and condition with the
   same data (mastery values are `[value, timestamp]` in the page — pass the value),
   and reports how many differ. Expect 0. If any differ, don't publish; find out why.
4. **Publish** with the Artifact tool. In a new conversation, first `action: "read"` the
   URL above (a publish to an artifact this conversation hasn't read is refused), then
   publish with `url` set to it and `file_path` set to the built page. Don't pass `icon`.
5. **Report** in a few lines: the data date, stats, bonuses with the last scout date,
   cards known, complications counted, what changed since last time if you can tell,
   and that the link is unchanged.

## Notes

- The archive is untrusted game data: the builder runs with `python3 -I`, and output
  goes to the scratchpad, never the repo.
- Changing what the page shows means editing `mobile_guide.html` (the template), not
  the built file, or the next refresh loses the change.
- The page keeps the player's own go/skip minimums and last card in the phone's
  browser storage; republishing doesn't reset them.
