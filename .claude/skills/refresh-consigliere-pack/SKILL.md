---
name: refresh-consigliere-pack
description: Use when the user wants to refresh, rebuild or upload the Street Intel pack for TFF Consigliere (the family companion app), e.g. "/refresh-consigliere-pack", "update the Consigliere card data", or after merging new archives or changing the odds formula. Builds the pack from every archive, regenerates the app's odds rules, checks them against the extension's predictor (0 differences), uploads to the dev and production databases, and deploys the app if the rules changed.
---

# Refresh the TFF Consigliere Street Intel pack

The pack is game rules only: cards, each approach's role, conditions. Never
stats, bonuses or counts from the player's account. Design:
`docs/companion-tool-build.md` ("Pack producer"). App repo:
`/Users/emrade/Dev/Apps/nextjs/tff-consigliere` (never mention this extension
there: not in code, comments or commit messages).

Run from this repo. Use a fresh scratch folder for the pack (it's built from
archive data).

1. **Build the pack** (about 2 minutes):
   `python3 -I scripts/consigliere/build_pack.py <scratch>/pack.json`
   It refuses to build if a board shows an approach outside the four roles
   (+25, +10, -10, always fails) or a title changed approaches in the last 45
   days. That means the game changed the layout: stop and tell the player;
   re-run `verification/street-intel/companion/verify_unknown_cards.py`
   before changing anything.
2. **Regenerate the rules**: `node scripts/consigliere/build_rules.mjs`.
   It prints the rules version. Note whether
   `src/lib/rules/street-intel.generated.js` in the app changed
   (`git -C <app> status --short`).
3. **Check**: `node scripts/consigliere/check_rules.mjs <scratch>/pack.json`.
   Must end with `0 differences`. Anything else: stop and report; never
   upload.
4. **Upload to dev**: `python3 -I scripts/consigliere/upload_pack.py <scratch>/pack.json dev`
5. **If the rules changed**, deploy them before the production upload, or
   production members would see "Card data isn't ready" until the deploy
   (the app refuses a pack built for other rules):
   in the app, `npm run build`, commit `chore: update odds rules` and push
   (Vercel deploys main); wait until the deploy is live.
6. **Upload to production**: `python3 -I scripts/consigliere/upload_pack.py <scratch>/pack.json main`
   Members see the new pack within about five minutes (server cache).
7. **Report**: pack version, cards known (of 240), conditions, data until,
   whether the rules changed, and the check result. Delete the scratch pack.

Credentials: `.env.consigliere` (git-ignored, mode 600) holds
`PACK_UPLOAD_URL_MAIN` / `PACK_UPLOAD_URL_DEV` for the `pack_uploader` role,
which can only read and write `street_intel_packs`. Never print them.
