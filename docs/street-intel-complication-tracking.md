# Street Intel — Complication Choice Tracking

Status: **instrumentation implemented, no decision to make yet — this doc exists to
explain what's being collected and when it's actually safe to act on it.**

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

One concrete alternative hypothesis, **not confirmed, worth testing once data exists**:
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
