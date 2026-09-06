# Street Intel — Partial-Reveal Scouting (2026-09-06 game change)

Status: **investigated and documented; code fixes not yet applied — see "What
needs fixing" at the bottom.**

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

**Confirmed from the account's own attempt history**: every single `attempt`
since the change matches the exact approach that scouting revealed for that
opportunity — checked the whole archive, zero exceptions. You cannot commit
to a hidden approach via the normal scout→attempt flow (see "Go Blind" below
for the one path that *can*).

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

## The substitution formula, and its real backtested accuracy

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
going blind on an already-known-good approach works normally. **It does not
yet tell us whether `scouted=0` applies any real penalty to the odds** — that
needs a sample where the chosen approach was never scouted at all, and
enough of them to see a pattern, not just one data point.

**Why this matters for the substitution formula above**: for a hidden
approach's estimate to be *actionable* (not just informational), the
automation would need to Go Blind on it — the normal scout→attempt flow
cannot select a hidden approach at all, confirmed above. So the formula's
real value depends entirely on how large (if any) the Go Blind penalty turns
out to be.

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
4. **Built** (2026-09-06): `pageHighlights.ts` now shows a muted "~NN%
   estimated" next to any hidden ("Unknown") approach in the scout dialog,
   computed via the substitution formula above. Deliberately never competes
   for the "FF Best Odds" badge, which stays real-numbers-only and otherwise
   completely unchanged — confirmed as the right call directly with the
   account owner (sometimes 2 real approaches are revealed, and Best Odds
   should keep working exactly as it always has).

   Mechanics: `content/features/streetIntel/index.ts` now also feeds every
   `action=scout` response into `pageHighlights.ts`'s `recordScoutResponse()`,
   which looks up the originating card's own `data-approaches` (confirmed
   real: both the Scout and Go Blind buttons carry an identical
   `data-approaches` attribute, matched via the Scout button's
   `onclick="siScout(<id>,...)"`) and caches the combined bundle — only the
   most recent one, same "only one dialog is ever open" assumption
   `refreshApproaches` already relied on. When the approach dialog renders,
   each hidden row is correlated back to its JSON entry by matching the
   row's own rendered text against the entry's `label` (no opportunity ID is
   exposed anywhere in the dialog's own DOM, so this is the correlation
   mechanism — it also naturally fails closed for a Go Blind dialog, since
   there's nothing scouted to match against).

   **Not yet visually confirmed against a live page** — built against the
   selectors `refreshApproaches`'s existing, already-working code uses
   (`.si-approach`, `.scout-pct`), but the label-matching/insertion logic
   itself hasn't been checked live in-game yet. Worth a quick look next time
   a partially-scouted card comes up.
5. **Not yet built**: logging Go Blind outcomes distinctly (so the one real
   sample above starts accumulating into a real dataset) — needed before
   the substitution formula in this doc becomes safe to act on rather than
   just observe.
