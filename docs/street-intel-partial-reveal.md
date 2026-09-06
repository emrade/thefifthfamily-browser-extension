# Street Intel — Partial-Reveal Scouting (2026-09-06 game change)

Status: **investigated, documented, and fixed — see "What needs fixing" at
the bottom for what shipped.** The substitution formula this doc originally
proposed (see "The substitution formula" below) has been **superseded** by
the game's actual exact formula, reverse-engineered and verified to
100.0000% accuracy — see `docs/street-intel-estimate-calculation.md`. That
doc is now the authoritative source for how `estimate_pct` is computed; this
one keeps its own section below only as a record of the interim approach.

## The game change

Per the game devs' own announcement (2026-09-06): Scouting no longer reveals
every approach's odds. A scout now reveals **one approach at random** (rarely
two — see "Recon Accuracy" below); every other approach on the card stays
hidden. Recon Accuracy perks (Bloodlines, Mansion Estate Surveillance Wall,
Careers) were simultaneously buffed, since they'd been "broken by design"
under the old always-reveal-everything behavior.

This invalidates the core assumption `actionRunner.ts`'s `findScoutedCandidate()`
was built on: that one `scout` call returns the complete approach set for a
card, so `sorted[0]`/`sorted[1]` (highest/second-highest `estimate_pct`) were
"this card's best/second-best approach." They're not, anymore — see "What
needs fixing."

## The new `scout` response shape (confirmed real, 2026-09-06)

`estimates[]` still lists all 3-4 approaches, but only the revealed one(s)
carry real numbers:

```json
{"key":"fight","estimate_pct":null,"base_pct":null,"modifiers":null,
 "rating":"Unknown","stat_tip":"Your scout got no read on this one...",
 "revealed":false}
```
```json
{"key":"steel_yourself","estimate_pct":90,"base_pct":43,
 "modifiers":{"stat":13,"approach":25,"rank":10,"prestige":4,"mastery":8,
              "collection":4.5,"recon":12},
 "rating":"Excellent","revealed":true}
```

Two new top-level fields: `recon_pct` (this account's current Recon Accuracy
bonus — `12` throughout this investigation) and `revealed_count` (almost
always `1`, occasionally `2`). Re-scouting the same `opportunity_id` never
reveals a different approach — it returns the identical result with
`"cached":true`. The reveal is permanent per-opportunity, not something you
can retry into.

**Correction (2026-09-06, per account owner)**: an earlier version of this
doc claimed the normal scout→attempt flow "cannot select a hidden approach at
all," based only on every real attempt in the archive happening to match the
approach that scouting had revealed. That was a correlation, not a real
restriction — confirmed false. `attempt` accepts any approach key for the
opportunity regardless of whether it was scouted or which one was revealed;
`scouted`/`scout` is informational for the player, not a permission gate on
the server side. This is also just how Go Blind already works: it skips
scouting entirely and lets the player pick any approach — there's no separate
mechanism being unlocked, just no scout call made first. Practically, this
also means a "computed estimate" mode for the auto-runner would have no
reason to scout at all before attempting a hidden approach — scouting would
only ever cost Stamina for no benefit in that path.

## Confirmed exact relationships (verified against ~2,600 historical fully-revealed samples, pre-change)

These held with **zero exceptions** across thousands of checked samples —
not approximations:

- **`modifiers.stat` = the account's own raw stat (from `stats.php`) ÷ 5.**
  Checked 2,000 samples spanning multiple level-ups; 0 mismatches. Whatever
  `stats.php` reports for strength/defence/agility/dexterity already includes
  equipment — there's no separate gear component to track.
- **`modifiers.approach` = the card's own pre-scout `data-approaches[].bonus`**
  for that same approach, exactly. This is already parsed today
  (`StreetIntelApproach.bonus` in `streetIntelPanelRegexParser.ts`) and
  available for *every* approach on a card, hidden or not, before ever
  scouting.
- **`base_pct`, `rank`, `prestige`, `mastery`, `collection`, `recon`, and any
  `env_global`/`env_stat`/`temporary` modifiers are identical across every
  approach on the same card at the same scouting moment.** Only `stat` and
  `approach` vary approach-to-approach.
- **Autofail approaches are hard-forced to `estimate_pct: 0`**, overriding
  whatever the formula would otherwise produce. Detected via the pre-scout
  `autofail` flag — already parsed, no computation needed. (913/3,498 sampled
  estimates were exactly this case.)

## The substitution formula, and its real backtested accuracy (superseded)

**Superseded by the exact formula in `docs/street-intel-estimate-calculation.md`
— kept here only as a record of the interim approach used before that was
found.** The additive assumption below turned out to be wrong (the real
formula is multiplicative — `base_pct × (1 + other_mods/100) + approach`,
not a flat sum), which is exactly why this substitution trick topped out at
~1.4pt median / ~22pt worst-case error instead of being exact.

Since only `stat` and `approach` vary per-approach on one card, a hidden
approach's odds can be estimated from **any one revealed approach on the same
card** by substitution — the shared unknown terms cancel out algebraically:

```
predicted_pct(hidden) = revealed_pct
                        − stat_mod(revealed) + stat_mod(hidden)
                        − approach_bonus(revealed) + approach_bonus(hidden)
```

Where `stat_mod(x) = player's raw stat for x.stat ÷ 5` and
`approach_bonus(x)` = the pre-scout `bonus` field — both already known without
scouting.

**This was backtested directly, not just theorized**: using ~1,166 historical
cards where 2+ approaches were fully revealed (pre-change data), each
revealed approach was used as a "seed" to predict every other revealed
approach on the same card via the formula above, then compared against the
real, known actual value.

3,344 real predictions checked (excluding the 1,826 trivially-correct autofail
cases, which are flag-based, not formula-based):

| Error tolerance | % of predictions within it |
|---|---|
| ±1 point | 41.3% |
| ±2 points | 63.0% |
| ±3 points | 77.3% |
| ±5 points | 85.6% |
| ±10 points | 93.4% |

**Mean absolute error: 2.65 points. Median: 1.4 points. Worst case: 21.8
points.** The worst misses cluster specifically around high true values
(e.g. predicting 116.8% against an actual 95%) — the relationship isn't
perfectly linear near the ceiling, likely some diminishing-returns/clamping
behavior the simple subtraction doesn't capture. In the normal 30-70% range
it's noticeably tighter than the worst cases suggest.

**Conclusion: estimates well, not perfectly.** Good enough to treat as a real
signal ("this hidden approach is probably in the 60s"), not good enough to
treat as interchangeable with a real scouted number, especially for anything
already estimated above ~80%.

A full linear regression across all modifier fields (not just the
same-card-substitution trick) was also fit and cross-validated on held-out
data: R² = 0.985, mean abs error 1.6 points out-of-sample — consistent with
the backtest above, confirming this is a genuine predictive relationship, not
overfitting to collinear inputs.

## Go Blind — confirmed mechanics (real capture, 2026-09-06)

There's a second, separate action path that does **not** require scouting at
all: the "Go Blind" button (`si-btn si-btn-go`, calling
`siShowApproaches(id, this, false, null)` — a different function than
`siScout`), present and enabled on the majority of cards (~69% in a sample of
3,875 button instances checked). Its label says plainly: **"No intel. Higher
risk."** Clicking it opens the same "Choose Your Approach" dialog, but with
no odds shown for any approach — the player picks blind.

The resulting `attempt` call is identical in shape to a normal one, just with
`scouted=0` instead of `scouted=1`:

```
action=attempt&opportunity_id=94483&approach=steel_yourself&scouted=0
→ {"ok":true,"outcome_band":"success","success_score":80,"reward_cash":46152,...}
```

**One real sample exists so far** (captured 2026-09-06): the account owner
scouted opportunity 94483 ("Clocked Out") first, revealing `steel_yourself`
at a real 87% (Excellent), then separately chose Go Blind on the *same* card
and picked `steel_yourself` again (same approach, this time with
`scouted=0`) — result: success, `success_score: 80`. This sample doesn't test
"picking a truly unknown approach blind" (the account owner already had real
data on this exact approach from the earlier scout) — it only shows that
going blind on an already-known-good approach works normally.

**Important correction on what `scouted` actually means** (confirmed
2026-09-06, from the game's own client-side JS, `siShowApproaches`/`siAttempt`
in the `panel.php?type=street_intel` response): `scouted` is a **per-dialog**
flag, not a per-approach one. `siScout` opens the approach dialog with
`scouted=true`; the *separate* Go Blind button (`siShowApproaches(id, this,
false, null)`) opens it with `scouted=false`. Whichever approach row the
player then clicks inside that dialog inherits the dialog's own flag —
`d.getAttribute('data-scouted')` is set once when the dialog is built, not
recomputed per row. So `scouted=1` on an `attempt` call means only "this
dialog came from the Scout button," not "the approach I picked was the one
that got revealed."

**Real sample of a genuinely-unknown approach, attempted with `scouted=1`**
(captured 2026-09-06): scouted opportunity 94702 ("The Last Pot") — only
`steel_yourself` was revealed (56%, base_pct 30); `fight` and `talk` came back
`"revealed":false`/`"estimate_pct":null`/`"rating":"Unknown"`, no odds shown
anywhere in the dialog. Clicked the `talk` row directly (not Go Blind) →
`action=attempt&approach=talk&scouted=1` → resolved completely normally:
`partial_success`, real `reward_cash`, a real complication that itself
resolved through the ordinary complication flow. Nothing about the response
shape, the outcome distribution, or the complication step suggests any
distinct code path or penalty for having picked an approach the scout never
actually read. This is the sample the earlier "does not yet tell us" note
above was waiting on — via the normal Scout dialog rather than Go Blind, but
it answers the same underlying question: acting on a hidden approach is not
a distinct, penalized mechanic. `scouted=0` (Go Blind) still has only the one
same-approach sample and remains separately untested for its own penalty, if
any — but that's now a narrower, lower-stakes question than "can a hidden
approach be acted on at all," which is settled.

## What needs fixing

1. **Fixed** (2026-09-06): `findScoutedCandidate()` now filters `estimates[]`
   to genuinely revealed entries (`revealed !== false`, which also keeps the
   old pre-change shape working, since that never had the field at all) before
   sorting for `bestPct`/`bestKey`. `secondBestApproach` itself was removed
   entirely rather than fixed — see point 2, its replacement made it
   unnecessary.
2. **Fixed** (2026-09-06): `StreetIntelAutoStatus.complicationStats` (see
   `docs/street-intel-complication-tracking.md`) already had a real,
   sufficient sample for the `fallback` bucket specifically — the exact
   scenario the broken heuristic above was trying to serve:
   - `fight`: 9/15 (60%)
   - `run`: 18/26 (69%)
   - `talk`: 19/36 (53%)

   All three clear the doc's own "~15-20+" noise threshold. Since the game's
   new behavior makes a genuine second-best-scouted-approach largely
   unavailable anyway, `pickComplicationChoice()` now picks whichever choice
   has the best historical `fallback` win rate so far (`run`, currently) —
   a real, data-backed decision instead of a broken pseudo-guess. Falls back
   to the old hardcoded `'talk'` default only while a choice has zero
   recorded fallback attempts.
3. **Doc corrections applied** (2026-09-06): `findScoutedCandidate()`'s and
   `pickComplicationChoice()`'s doc comments in `actionRunner.ts`, and
   `StreetIntelAttemptResult.complicationWasFallback`'s comment in
   `shared/types.ts`, all updated. `docs/street-intel-plan.md`'s "Confirmed
   API details" `scout` shape description and its "What the archive showed"
   `autofail` bullet still describe the pre-change always-reveal-everything
   shape as historical context for why the auto-runner was originally built
   that way — not corrected line-by-line, since this doc (linked from the top
   of that section) is the actual current reference now.
4. **Built** (2026-09-06, upgraded same day to the exact formula): `pageHighlights.ts`
   shows a muted "~NN% estimated" next to any hidden ("Unknown") approach in
   the scout dialog — now computed via the exact multiplicative formula from
   `docs/street-intel-estimate-calculation.md` (`env_stat` defaulted to 0;
   worst-case ~3pt, down from the original substitution's ~22pt), not the
   superseded additive substitution above. Deliberately never competes for
   the "FF Best Odds" badge, which stays real-numbers-only and otherwise
   completely unchanged — confirmed as the right call directly with the
   account owner (sometimes 2 real approaches are revealed, and Best Odds
   should keep working exactly as it always has).

   **Also now covers the Go Blind dialog** — previously this had no estimate
   or badge at all. `findOwningCard()` matches the currently-open dialog back
   to its `.si-card` by content (every one of a card's own approach labels
   must appear somewhere in the dialog's rows — no opportunity ID is exposed
   anywhere in the dialog's own DOM, so there's nothing more direct to match
   on), which works identically for a partial-reveal dialog and a Go Blind
   one. Two confidence levels: if this exact card was already scouted this
   session, its real `base_pct` is used (same accuracy as the scouted case);
   otherwise `base_pct` falls back to this card's risk-tier band mean (see
   `docs/street-intel-estimate-calculation.md`'s base_pct section) —
   labeled "est. (unscouted)" rather than plain "estimated" so the lower
   confidence is visible. A fully-unscored Go Blind dialog gets its own
   highest estimate marked with a new, visually distinct "FF BEST GUESS"
   badge (blue, not gold) rather than reusing "FF Best Odds" — there's no
   real number anywhere in that dialog to protect, but a computed guess
   still shouldn't be presented as if it were one.

   Mechanics: `content/features/streetIntel/index.ts` feeds every
   `action=scout` response into `pageHighlights.ts`'s `recordScoutResponse()`,
   which keeps only the one real revealed estimate (`base_pct` + modifiers) —
   everything else (which approach is hidden, its pre-scout `bonus`/`autofail`,
   the card's risk tier) is read fresh from the live DOM via `findOwningCard`
   at render time instead, since that lookup works the same regardless of
   whether the current dialog came from Scout or Go Blind.

   **Not yet visually confirmed against a live page** — built against the
   selectors `refreshApproaches`'s existing, already-working code uses
   (`.si-approach`, `.scout-pct`), but the label-matching/insertion logic
   itself hasn't been checked live in-game yet. Worth a quick look next time
   a partially-scouted or Go Blind card comes up.
5. **Not yet built**: logging outcomes by `scouted` flag distinctly (so the
   one real `scouted=0` sample above starts accumulating into a real
   dataset) — worth having before leaning on the exact formula in
   `docs/street-intel-estimate-calculation.md` to actually attempt a hidden
   approach, since it's still unconfirmed whether `scouted=0` itself carries
   any real server-side odds penalty versus `scouted=1` (separate question
   from whether the *action* is allowed at all, which it is — see the
   correction above). Proposed test design: have the runner occasionally
   submit the *same already-revealed* approach through `scouted=0` instead of
   `scouted=1` — since nothing is being guessed (the exact approach and its
   exact odds are already known), this isolates whether the `scouted` flag
   itself correlates with any real penalty, cleanly separate from formula
   error.
