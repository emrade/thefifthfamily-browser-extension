# Street Intel — Complication Choice Tracking

Status: **answered (2026-10-04) — see "Findings" directly below.** The
per-scenario question this tracker was built to eventually answer now has a
real answer: most scenarios have one choice that never wins, and avoiding it
is worth far more than any per-choice or raw-stat signal. Acted on through the
opt-in **Smart complication choices** toggle (`complicationMode:
'avoidBlocked'`). The original reuse/fallback rule is unchanged and still the
default.

## Findings (2026-10-04)

Every archive combined (480 resolved complications, 2026-08-10..10-04 —
`verification/street-intel/verify_complication_blocked_choices.py`):

- **14 of 24 scenarios have one *blocked* choice** that went 0-for-everything:
  0/91 combined (talk 0/55, run 0/20, fight 0/16). Strongest single cells:
  talk on "You hear footsteps behind the door." 0/12 (p≈1e-10 at the pooled
  rate), run on "The evidence is heavier than expected." 0/11, talk on
  "booby-trapped" 0/9, run on "reinforced case" 0/9, talk on "lockdown" 0/8,
  fight on "fake credentials" 0/7. Stable across 1-6 weeks and many different
  cards; the card's own `autofail` flags don't explain it (autofail-card
  choices still won 26/31).
- **Every non-blocked choice wins about the same:** fight 85%, run 83%, talk
  90% pooled. So the raw-stat hypothesis below (Strength is this account's
  best stat, so maybe `fight` wins more) is **not supported** — once blocked
  picks are removed, the choice itself barely matters.
- **Blocked picks cost $26.4M of the $30.7M lost to complications (86%).**
  The original rule kept making them (74 of 91 in a chronological replay)
  because it never looked at the scenario.
- **Chronological replay** (only data available before each event): "avoid
  any choice that's 0-for-2+ in this scenario, otherwise reuse" cuts expected
  losses from $30.7M to ~$10M, starting from zero knowledge.
- **Ceiling: about 85%.** Nothing else separates non-blocked wins from losses
  — outcome band, risk tier, odds, reward size, direct vs fallback, the card's
  favoured/hindered-stat intel, level, rank, stamina were all flat. Difficulty
  is always 40 and `comp_score` has been hidden since 2026-08-11 (it briefly
  showed 65-82 against difficulties 30-50, consistent with a hidden stat
  roll). The card's "Lower/Higher complication risk" intel changes how *often*
  a complication happens (22% vs 32% of successful attempts), not the result.
- **Fourth choice, `stand_ground`: tested 2026-10-11/12, not adopted.** See
  "Stand Your Ground test" below.

How it's used (`src/shared/streetIntelComplications.ts`): the full
scenario × choice table above is seeded into the code, and for each cell the
code uses whichever has more attempts — that seed or the live
`complicationTypeStats`. A choice with 0 wins in 2+ tries is *blocked*. Two
consumers share this one rule, so they never disagree:

- **Auto-runner, opt-in** (`complicationMode: 'avoidBlocked'`, the **Smart
  complication choices** toggle in the popup and overlay): keeps the original
  rule's pick unless it's blocked, then uses the best unblocked choice for
  that scenario (win rate shrunk toward the pooled rate). The popup shows
  "(avoided X)" on the last attempt whenever it overrode a pick.
- **On-page hint for manual play** (`content/features/streetIntel/complicationHint.ts`,
  Settings → "Street Intel Complication Hint", on by default like every page
  feature): marks the game's own choice buttons "FF AVOID" / "FF PICK" with
  each choice's record, plus a one-line summary under the scenario text. Built
  against the game's stylesheet classes (`.si-comp`, `.si-comp-choice`); not
  yet confirmed against a live complication dialog.

Among *unblocked* choices the ranking differences are small (all ~85-90%) —
the pick there is a mild preference, not a strong signal.

### Live results and open question (2026-10-07)

First three days with Smart complication choices on (2026-10-05..07):
34/39 complications won, $1.14M lost in total. Four of the five losses cost
nothing. The one costly loss shows a gap in the rule:

- "An off-duty cop recognized your face.", approach `fight`. The runner
  reused `fight` (record 2/4, 50%) because it isn't *blocked* (it has wins),
  while `talk` was 5/5. Lost $1,138,993.

**Open question:** should the rule also switch away from a choice that's
merely much worse than another, e.g. 50% vs 100%, not only from 0-win
choices? Not built yet. These cells are tiny (4-5 tries each), so a "much
worse" rule could chase noise as easily as fix this. Revisit after about a
week more of live data. Check whether non-blocked-but-weak picks keep losing
and what they cost, then replay the candidate rule chronologically the way
the blocked rule was (`verify_complication_blocked_choices.py`). Tracked in
`todos.md`.

**Replay run 2026-10-11** (`verify_complication_weak_choices.py`, 559
complications, 2026-08-10..10-11). The rule "switch when the reused choice
won ≤50% in 3+ tries and another won ≥80% in 4+" cut expected losses
$14.9M → $12.8M and fired 17 times. The hard evidence is weak, though.
Before 10-05 the weak choice, when actually played, still won 10 of 12, so
switching was about break-even. In 10-05..11 it went 0 of 3 and lost $2.1M.
Every threshold variant tried gave about the same result. Decision: not
built; keep gathering data and re-run in a week or two.

**Resolved 2026-10-11: those "weak" cells were blocked all along.** The
first 7 complications in the archive (2026-08-10/11, all manual `fight`
wins) still returned a `comp_score`, before the game hid it and fixed
difficulty at 40. Four of them landed in the getaway-driver, off-duty-cop
and police-spotted-you scenarios and made `fight` look like 1/4-2/4 there.
Without them, `fight` is 0 for 11 in those three scenarios. All 7 rows were
removed from `SEED_RECORDS`, so the existing blocked rule now avoids them; no
weak-choice rule needed. Since 08-11, a choice already at 0-for-2+ won 1 of
its next 69 plays. Details: `street-intel-complication-findings.md`,
`verification/street-intel/verify_complication_post_patch_blocked.py`.

**Fourth choice, `stand_ground` (Defence).** The game's own dialog
code (in the `panel.php?type=street_intel` response) renders "Stand Your
Ground: Uses Defence" whenever `window.SI_V2` is true, and every panel
since 2026-08-16 sets `window.SI_V2 = true` (08-10..15 panels didn't, so it
was hidden then). So it's offered on *every*
complication, not only after `steel_yourself`. It has been played once in
the whole archive (2026-08-29, manual, a win in the scenario where `run`
is 0/11). The runner and the hint only know fight/run/talk. The same dialog
code confirms the buttons carry `data-choice=fight|run|talk|stand_ground`,
which is what `complicationHint.ts` reads. The attempt response gives
nothing else per complication: only `type` and `difficulty` (always 40).

### Stand Your Ground test (2026-10-11/12): no better, not adopted

0.41.0 added a temporary opt-in toggle that answered complications with
`stand_ground` instead of the normal pick (removed afterwards). It ran from
10-11 22:07 to about 10-12 13:00 UTC, with the reward cap raised to
effectively unlimited. Archive:
`fifth-family-archive-new-2026-10-12T12-57-47-712Z.ndjson.gz`.

Result: **9 wins in 12 tries (75%)**, $1,380,155 lost on $7.77M of card
rewards. The choices' own records in the same scenario (since 08-16) for
comparison:

| Scenario | Card | Result | Lost | Best other choice |
|---|---|---|---|---|
| The drop site is surrounded. | $143k | win | – | fight 5/6 |
| Someone triggered a silent distress signal. | $6k | loss | $0 | run 10/14 |
| The mark had backup you didn't see coming. | $548k | win | – | run 9/11 |
| The evidence is heavier than expected. | $233k | win | – | fight 7/7 |
| You hear footsteps behind the door. | $1.46M | win | – | run 12/13 |
| Your contact is late and the area is getting hot. | $921k | win | – | run 11/13 |
| An off-duty cop recognized your face. | $1.50M | loss | $1.20M | talk 6/6 |
| The informant demands more money. | $177k | loss | $177k (all) | fight 4/4, talk 4/4 |
| Police spotted you leaving the scene. | $1.02M | win | – | run 12/14 |
| The client starts panicking. (×2) | $640k, $615k | win, win | – | talk 6/7 |
| The target building went into lockdown. | $516k | win | – | fight 6/6 |

(Plus the 08-29 manual win in "The evidence is heavier than expected.",
so 2/2 there, where `run` is 0/11.)

- It wins about as often as a good existing choice (~75-85%), not more.
- Every scenario it was tried in already has a choice winning ~80-100%, so
  it fills no gap. It won in six scenarios where another choice is blocked,
  but a working choice already exists in each.
- Nearly all the loss came from two scenarios where the normal pick has a
  perfect record (off-duty cop, informant), so the test cost roughly the
  full $1.38M over the normal picks.
- One try per scenario at most: enough to rule out "much better" or
  "broken", not to rank it per scenario. Not worth paying for more.

The runner and the on-page hint stay on fight/run/talk.

## Why this exists

A Street Intel `attempt` can come back with `has_complication: true`, which requires a
follow-up `complication` call choosing one of `fight`/`run`/`talk` (strength/agility/
dexterity respectively). Unlike an `attempt`'s own approach, **the game gives no odds
for any complication choice at all** — no `scout`-style estimate, nothing in the
response before you commit to one. `docs/street-intel-plan.md` already noted this gap
when the feature was first explored; the auto-runner (`docs/street-intel-plan.md`'s
"Auto-Attempt" section) picked a reasoned-but-unconfirmed heuristic to handle it anyway:
reuse whichever approach just won the attempt (`fight`→fight, `run`→run, `talk`→talk —
a direct 1:1 mapping for three of the four), falling back to the second-best scouted
approach for the one case with no direct equivalent (`steel_yourself`/defence).

The first real complication this heuristic hit, in live play, went badly: a clean
$209,959 success immediately followed by a failed `talk` complication that took the
entire amount back (`cash_lost_from_hand: 209959`). One data point proves nothing on
its own, but it raised a real question worth checking with actual data instead of
guessing again: **is "reuse the winning approach" even the right heuristic, or would a
different signal do better?**

One concrete alternative hypothesis (**tested 2026-10-04 — not supported**; see Findings
above: non-blocked choices win 83-90% regardless of stat), originally worth testing once data existed:
this account's raw stats (from `stats.php`) are `strength: 82, defence: 62, agility: 58,
dexterity: 58` — strength is this account's clearly strongest stat. But `fight`-flavored
*attempt* approaches score the **worst** of the four in scouted `estimate_pct` (~36%
average vs 51–56% for the others, confirmed across the archive in
`docs/street-intel-plan.md`'s auto-attempt research). That's a real tension: either
strength genuinely underperforms here for some game-specific reason, or an attempt's
`estimate_pct` is dominated by approach-specific flavor/mastery/rank bonuses that don't
apply to the simpler complication mechanic at all — in which case raw stat could
actually be the *better* complication signal despite scoring worst on attempts. Nobody
knows yet. This tracker is how we'd find out.

## What's actually being collected

`StreetIntelAutoStatus.complicationStats` (`src/shared/types.ts`) — a running tally per
choice, split into two sub-tallies:

```ts
export interface ComplicationChoiceStats {
  attempts: number;
  successes: number;
}

export interface ComplicationTrackingBucket {
  /** The choice matched the attempt's own winning approach (fight→fight,
   *  run→run, talk→talk). */
  direct: ComplicationChoiceStats;
  /** The choice came from the steel_yourself→second-best-scouted fallback —
   *  a weaker bet by construction, since it wasn't the approach that actually
   *  won the attempt. */
  fallback: ComplicationChoiceStats;
}

complicationStats: Record<'fight' | 'run' | 'talk', ComplicationTrackingBucket>;
```

The split exists because a `direct` pick and a `fallback` pick for the same choice key
are different-strength signals — reusing `talk` because it just won the attempt is not
the same bet as reaching for `talk` only because `steel_yourself` (which has no
complication equivalent) won and `talk` happened to scout second-best. Folding both into
one tally would hide that difference; asking "does `talk` win more when direct vs. when
fallback" needs them kept apart.

- Updated in `background/features/streetIntel/actionRunner.ts`, in the same status
  write that records every attempt — `bumpComplicationStats()` takes a `wasFallback`
  flag (`true` exactly when the attempt's winning approach was `steel_yourself`, matching
  `pickComplicationChoice()`'s own branch) and increments the chosen key's `direct` or
  `fallback` sub-bucket's `attempts`, and `successes` too if `comp_success` was `true`.
  Each attempt's own record (`StreetIntelAttemptResult.complicationWasFallback`) also
  keeps this flag directly, `null` when there was no complication at all.
- **Only counted when the complication call itself came back a real, resolved
  `ok:true`** — a rejected or malformed complication response leaves
  `complicationSuccess` as `null` on that attempt's own record and is *not* folded into
  the tally, since there's no real outcome to count either way.
- This is the one piece of Street Intel auto-runner state that **accumulates across
  every cycle for as long as the automation runs**, unlike `lastCycleScouted` (last
  cycle only) or `lastAttempt` (most recent only) — by design, since the whole point is
  building a sample over time.
- Visible directly in the popup's Street Intel Auto tab, under **"Complication
  History"** — a per-choice line showing both the `direct` and `fallback` win/loss
  counts side by side, shown once at least one complication has resolved.

The full raw detail behind every one of these — the exact `complication.type` text, its
`difficulty` value, the account's stats at the time — isn't duplicated into this tally;
it's already captured in the HTTP Archive (background-origin rows, since the
`loggedFetch` fix documented in this session) for whenever a deeper analysis is worth
doing. This tracker is deliberately just the lightweight aggregate for at-a-glance
visibility.

## How to use this data later

*Kept for history — point 3 below (stratify by `complication.type`) is what
actually answered it, on 2026-10-04; see Findings above.*

**Don't touch the selection heuristic on a small sample.** A single choice's win rate
needs a real sample before it means anything — treat anything under roughly 15–20
resolved complications *for that specific choice* as noise, not signal. Complications
are confirmed to follow only `success`/`partial_success` outcomes, at roughly 15–20% of
real attempts historically — so reaching a usable sample size will take a while, not one
sitting.

Once there's a real sample, worth checking (in this order):

1. **Does one choice's win rate clearly beat the others?** If so, that's a strong
   candidate to make the *default* choice going forward, overriding "reuse the winning
   approach" — especially if it doesn't match whichever approach the attempt-selection
   logic tends to favor (which would support the "attempt odds and complication odds
   aren't the same mechanic" theory above).
2. **Cross-check against the raw-stat hypothesis.** If `fight` (this account's highest
   raw stat, strength) turns out to win more than its attempt-approach performance would
   predict, that's real evidence for switching the heuristic to "pick by raw stat"
   instead of "reuse the attempt's approach" — pull the account's current stats from a
   fresh `stats.php` capture in the archive to compare against.
3. **Only if the aggregate signal isn't clean**, consider pulling the full archive and
   stratifying by `complication.type`/`difficulty` instead of just choice — the
   possibility being that different named complications have different real answers, and
   the aggregate is averaging distinct situations together. This needs meaningfully more
   data than the aggregate check above, since per-type samples will be far sparser.
4. **Read `direct` and `fallback` separately before combining them.** The tracker
   already keeps these apart per choice (see above) precisely so this comparison doesn't
   need a full data re-pull: check whether a choice's `fallback` win rate meaningfully
   trails its own `direct` win rate. If it does, that's evidence the *steel_yourself*
   fallback heuristic itself is the weak link, not the choice — worth fixing by picking a
   better fallback (e.g. raw stat instead of second-best-scouted) rather than changing
   the direct-reuse mapping, which would otherwise look fine on its own. If `fallback`
   and `direct` track closely for a given choice, it's safe to combine them for a bigger
   combined sample when checking point 1 above.

## Where to look right now

- Popup → Street Intel Auto tab → "Complication History" (per-choice win/loss, updates
  live as cycles resolve).
- `chrome.storage.local.get('ff_street_intel_auto_status')` from the extension's
  background service worker console, for the raw current tally.
- The HTTP Archive, filtered to `POST /actions/street_intel.php`, for the full detail
  behind any specific resolved complication (once it's `origin: "background"` — see the
  `loggedFetch` fix note above for why older exports won't have this).
