# Street Intel: Stand Your Ground test (temporary)

**Added:** 2026-10-11 (0.41.0). **Temporary.** Remove it once the question
below is answered (see "When to remove it").

## Why it exists

Street Intel complications offer four choices: Fight (Strength), Stand Your
Ground (Defence), Run (Agility) and Talk (Dexterity). The extension has only
ever used three of them.

- The fourth button, `stand_ground`, sits behind a `window.SI_V2` flag in the
  game's own dialog code. `docs/street-intel-plan.md` was written on
  2026-07-31, when the flag was off. The game turned the flag on on
  2026-08-16, and every Street Intel panel since then shows the button.
  Nobody went back to that note, so the auto-runner (2026-08-26) was
  built for three choices.
- So `stand_ground` has been played **once** in the whole archive:
  2026-08-29, by hand, a win in "The evidence is heavier than expected.",
  where `run` is 0 for 11.
- Everything else about complications is well understood: in 17 of 24
  scenarios one choice never wins, and the others win about 85%. See
  `docs/street-intel-complication-tracking.md` and
  `docs/street-intel-complication-findings.md`. `stand_ground` is the only
  real unknown left.
- Complications are too rare to test by hand quickly. The runner sees about
  11 a day, so letting it test on smaller cards gets a usable sample in
  about a week.

## What it does

A toggle in the popup and the in-page Street Intel panel: **"Test Stand Your
Ground"**, off by default, with a reward cap (default $200k).

When it's on, the runner answers a complication with `stand_ground` instead
of its normal pick only if:

1. the attempt's reward is at or under the cap,
2. `stand_ground` hasn't gone 0 wins in 2+ tries **in this scenario** (the
   same rule as the blocked-choice rule), and
3. the test hasn't failed overall: after its first 6 tries it needs at least
   3 wins, or it stops on its own and the popup says so.

Otherwise the normal pick (reuse / Smart complication choices) is used.

Results are kept in their own tally (wins, tries, cash lost, overall and per
scenario), shown in the popup. They're kept out of the fight/run/talk stats
and the per-mode comparison, so the test doesn't skew either.

**Cost.** With a $200k cap, last week's data gives about 2.7 tests a day
(15-20 in about a week). If `stand_ground` wins like the others (~85%), it
costs about nothing extra. If it never won, the stop rules end the test after
a handful of losses, each at most the card's reward (a lost complication has
never taken more than that).

## What we're trying to learn

- Does `stand_ground` win about as often as the others (~85%)?
- Is it blocked in some scenarios the way the other choices are? If so,
  which ones?
- Does it win in scenarios where another choice is blocked? Most useful of
  all would be scenarios where it beats the current best choice.
- How much does it lose when it fails (none, part or all of the reward)? Run
  loses much less than Fight or Talk when it fails.

## When to remove it

Once the test has about **15-20 resolved tries** across a mix of scenarios,
or has stopped itself:

1. Export an archive and analyse the `stand_ground` results (every pick is in
   the archive as `choice=stand_ground` on
   `POST /actions/street_intel.php`, `origin: background`).
2. Decide:
   - **It's as good or better somewhere:** add `stand_ground` as a real
     fourth choice in `src/shared/streetIntelComplications.ts` (seed records,
     `ComplicationChoiceKey`, the on-page hint), then remove this test.
   - **It's no better or it's blocked:** record the result in
     `docs/street-intel-complication-tracking.md` and remove this test.
3. Remove it: delete `src/shared/standGroundTest.ts`, the
   `standGroundTest*` config and status fields in `src/shared/types.ts` and
   their defaults in `src/shared/storage.ts`, and the lines marked
   `stand_ground test` in `actionRunner.ts`, the popup
   (`StreetIntelAutoHome.tsx`) and the in-page panel (`statusPanel.ts`).
   Then delete this doc, or keep it with the result added.
