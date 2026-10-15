# Arena Combat Investigation: 2026-10-15

Independent investigation of [the brief](agent-briefs/arena-combat.md), the
[mechanics write-up](arena-combat-mechanics.md), the implementation, and local
request archives. This report supersedes neither the production model nor its
documentation: **no extension code was changed, no game requests were sent,
and no fight automation was added.** Proposed changes are separate below.

## Executive Findings

1. **The minimum-damage ceiling is apparently randomized, not a fixed clip at
   75.** The newest player's observed floor averages 54.919, versus 63.600
   under the corresponding fixed-75 model. A random ceiling from 45 through
   75 explains the distribution very well.
2. **Combat Power exposes an excellent HP estimate:**
   `CP - STR - DEF - AGI - DEX`. It equals actual HP in 473/583 regular fights.
   However, substituting better HP into the existing score creates a wrong
   Beatable call. Better intermediate estimates do not automatically make a
   safer advisor.
3. **Crits, first strikes, and dice priority matter more than the brief
   suggests.** Newest-loadout player crits average 2.0915, not approximately
   1.35. Dice use inclusive comparisons, with block before crit. First strikes
   can deal the full minimum damage, not simply half a normal hit.
4. **Two factual premises are false:** opponent `armory_mult` is often above
   1, and equal locked HP does not guarantee unchanging combat numbers.
   Passive opponents do not skip living turns.
5. **There is a promising, conservative probability improvement.** On 459
   rolling held-out regular fights, keeping existing verdict thresholds and
   using the card HP signal only to refine coin-flip probabilities improves
   Brier score from 0.06791 to 0.05757, with 423 rather than 416 correct calls
   and no additional wrong Beatable calls. **It is worse on the newest
   850-HP loadout**, so this is not a validated deployment recommendation.
6. **The published replay has hindsight and coverage gaps.** Its player
   profile uses later fights, and HTML-escaped boss names silently drop seven
   fights. Both issues can be reproduced without changing the verifier.
7. **Banking advice is incomplete.** The boss threshold is mathematically
   correct, but there is no bank-versus-continue decision before remaining
   regular opponents. Also, advertised risk ordering actually sorts score,
   not estimated loss probability.

## Evidence And Reproduction

Two new, standard-library-only scripts accompany this report:

- [`verification/arena/investigate_combat.py`](../verification/arena/investigate_combat.py):
  chronological replay, missing-fight audit, HP reconstruction, rolling
  probability models, random-ceiling proxy, and lineup-order comparison.
- [`verification/arena/investigate_mechanics.py`](../verification/arena/investigate_mechanics.py):
  minimum-damage distributions, crits, first strikes, dice decision trees,
  armory values, Passive attack opportunities, and fitted stat relationships.

Run from the repository root, using an existing temporary directory:

```bash
python3 verification/arena/investigate_combat.py \
  --cache /tmp/tff-arena-cache.json \
  --output /tmp/tff-arena-investigation.json

python3 verification/arena/investigate_mechanics.py \
  --cache /tmp/tff-arena-cache.json \
  --output /tmp/tff-arena-mechanics.json
```

The first command scans once, using `verification/archive_paths.py`, streaming
and deduplicating through the existing loader. Subsequent commands reuse the
filtered cache. Pass `--rescan` to the first command after adding archives.
**Keep cache and result JSON outside the repository:** they contain private
game data. The scripts do not contact the game.

This run used eight files, totaling 1,886,298,146 compressed bytes:

- Merged `fifth-family-archive-2026-08.ndjson.gz`, `2026-09`, and `2026-10` in
  `~/Downloads/tff archives/merged/`.
- Five exports in `~/Downloads/tff archives/`, named
  `fifth-family-archive-new-2026-10-12T12-57-47-712Z.ndjson.gz`,
  `...2026-10-13T21-17-33-831Z.ndjson.gz`,
  `...2026-10-14T18-13-44-532Z.ndjson.gz`,
  `...2026-10-14T18-25-31-473Z.ndjson.gz`, and
  `...2026-10-15T08-49-42-466Z.ndjson.gz`.

The filtered cache contains 3,426 Arena-related rows. V2 fights span
**2026-09-09 12:47 through 2026-10-15 08:48 UTC**. Six older non-V2 attacks
are excluded. Source paths, sizes, and modification times are retained in the
JSON output. These findings do not incorporate exports acquired afterward.

## Replay Integrity

### The 684-Fight Benchmark Is Reproducible, But Retrospective

`verify_combat_rule.py:304-321` collects all fights for each player max HP,
takes season medians, then scores every fight with those medians. That uses
future samples when scoring earlier fights. The live code instead scores a
result against the preceding profile, then updates it
(`fightAdvisor.ts:193-201`, `arenaCombat.ts:318-331`).

The new replay folds all earlier captured V2 attacks into the player profile,
including attacks the original card matcher drops. It matches the TypeScript
per-fight reduction rule: the upper middle for even-sized samples, rather
than Python's averaged middle. It uses pre-fight card levels, decoding HTML
names; captured boss page-open data is also an allowed earlier level source.
The six first fights without an earlier measured profile are explicitly
excluded, rather than inventing pre-first-fight estimates.

For the 678 comparable fights with an earlier profile, the latest earlier
card/level evidence was at most **94.444 seconds old**, and card levels
disagreed with response levels **zero times**. This checks freshness, but is
not a reconstruction of the exact historical UI verdict: deployed model
versions, browser storage, and missing client-side events can still differ.

| Replay | Regular Beatable | Regular Coin-flip | Regular Avoid | Boss Beatable | Boss Coin-flip | Boss Avoid |
|---|---:|---:|---:|---:|---:|---:|
| Original full-season profiles, 684 fights | 320/320 | 94/171 | 6/92 | 58/60 | 32/36 | 2/5 |
| Earlier profiles only, 678 fights | 318/318 | 93/170 | 5/89 | 60/62 | 30/34 | 2/5 |

Cells are wins/fights. The chronological regular result remains excellent,
but neither replay supports saying all bosses above 1.3 win. The two
chronological wrong Beatable calls are:

- **Rachel Kim**, 2026-10-10 11:29 UTC, player HP 804, score **1.34435**.
- **Priya Nair**, 2026-10-15 08:39 UTC, player HP 850, score **1.31544**.

### Seven Bosses Were Silently Dropped

There are **691 successful V2 attacks**, comprising 583 regular fights and
108 bosses, not just the 684 fights returned by `build_fights()`.

`parse_cards()` keeps HTML entities in names; matching uses the attack
response's decoded name (`verify_combat_rule.py:123-139,181`). Boss names
containing apostrophes can therefore fail to match. If an appropriate page
open was also missing, the fight was discarded. Decoding only card-name text
recovers **all seven missing fights**, without changing their stats or logs.

Recovered fights: Nico Caruso on Sep 25, Oct 9, Oct 11, and Oct 13; Sera
DeLuca on Oct 12; Dominic Ferraro on Oct 13 and Oct 15. All seven were wins.
Their earlier-profile verdicts were six Beatable and one Coin-flip.

With name normalization, 685 fights remain after the same six initial-profile
exclusions: **Beatable 384/386, Coin-flip 124/205, Avoid 7/94**. The comparisons
below deliberately retain the original matched sample for direct comparison
with the brief. Recovered bosses do not change the regular-model experiments.

## Combat Mechanics

### Minimum Damage Has A Random Ceiling

The following descriptive generator matches the observed support and
distribution:

```python
step = floor(effective_strength * randint(3, 7) / 100)
minimum_damage = min(step, randint(45, 75))
```

The largest possible floor is still 75. What changes is the expectation and
the shape: two independent random draws produce intermediate values rather
than clipping two high steps to a repeated 75.

For the newest player's fitted effective strength of 1,400, the uncapped
steps are **42/56/70/84/98**:

| Observation Or Model | Result |
|---|---:|
| Logged nonzero minimum-damage values | 531 |
| Observed mean | 54.919 |
| Random-ceiling expected mean | 55.077 |
| Corresponding fixed-75 expected mean | 63.600 |
| Values impossible under those five fixed-75 steps | 321/531 |
| Values equal to 75 | 7/531 |

The intermediate values include every integer from 45 through 75. Pearson
chi-square for the random-ceiling distribution is **18.51 over 32 support
cells**. The late 804-HP stage provides a separate check: 2,504 values average
40.335 against the random-ceiling expectation of 40.348.

For bosses, using card STR as effective strength puts **1,523/1,523** logged
minimum values in the generator's support. Across player stages, inferred
effective-strength scales explain **10,556/10,556** minimum values.

**Confidence:** strong distributional evidence, not access to server code.
Unlogged RNG draws mean observationally equivalent generators remain possible.
The effective strength is fitted, and cannot simply be replaced with the
preview's STR. Also, boss uncapped floor expectation is approximately
`0.05 * STR`, whereas the production base-damage approximation implies
approximately `0.04245 * STR`. Changing the ceiling alone is not a complete
mechanics correction.

### Dice Are Inclusive And Prioritized

This decision tree explains **22,125/22,125** logged normal actions:

```python
if dodge_roll <= dodge_chance:
    action = "miss"
elif block_roll <= block_chance:
    action = "blocked"
elif crit_roll <= crit_chance:
    action = "critical"
else:
    action = "hit"
```

Using strict `<` instead explains 21,821/22,125, leaving **304 mismatches**.
Comparing each roll independently also misses that a block suppresses a crit.
The mechanics write-up's strict-comparison claim should be corrected before
building any simulator.

### High Crit Multipliers Depend On The Matchup

All **977 fight-side combinations containing a crit** have a single stable
multiplier within that fight. Identical player gear nevertheless produces
different multipliers against different opponents.

In the 850-HP loadout, the player's 93 crits average **2.0915**; 87 exceed 1.5,
57 reach at least 2, and the range is 1.35-2.55. This is common, not a rare
extreme. Examples with the same weapon and gear:

| Opponent | Card DEX | Player Crit Multiplier |
|---|---:|---:|
| Katya Orlov, Oct 13 | 893 | 2.28 |
| Anthony Price, Oct 13 | 955 | 2.22 |
| Rachel Kim, Oct 13 | 593 | 2.55 |
| Pavel Kozlov, Oct 15 | 2,623 | 1.35 |
| Yuki Nakamura, Oct 15 | 2,599 | 1.35 |

A capped positive DEX difference fits boss encounters:

```python
crit_mult = round(
    baseline + min(1.2, max(0, (effective_player_dex - opponent_dex) / 1000)),
    2,
)
```

With baseline 1.35 and one fitted effective DEX per loadout, this matches
14/14 boss crits at HP 710, 36/36 at HP 759, and 12/12 at HP 850. The newest
effective DEX is approximately 1,825, not the preview's 1,997. Captured
`crit_damage` bonuses support the baseline changing with bonuses: 1.3 plus
3% and 1.75% rounds to 1.35.

This is a **descriptive capped-difference fit**, not an exact predictor for
all regular opponents or a demonstrated causal isolation of gear/perks.
Effective stats and their intra-season changes still need reconstruction.

### First Strikes Are Not Half An Expected Normal Hit

Across 11,368 rounds, the player gets **1,118** snap shots versus 1,081.46
expected from the logged chances; opponents get **369** versus 378.06.
Both chances are positive in 850 rounds, and both sides strike in two rounds.
There are no snap shots at zero logged chance.

A capped AGI-ratio candidate is:

```python
chance = min(30, max(0, round(30 * (effective_player_agi / opponent_agi - 1))))
```

After fitting effective player AGI, this exactly matches 13/13, 19/19, 28/28,
and 8/8 boss encounters in the 710, 759, 804, and 850 groups respectively.
Alternative rounding conventions also fit with different latent stats, so
the exact implementation is unresolved.

Damage evidence is stronger:

- In **223/223** player boss snap shots, reduction is `floor(0.6 * card_DEF)`.
- In **955/955** player snap shots whose base is below reduction, damage is
  within the **full ordinary minimum-damage support**, not half that support.
- Snap shots have their own `first_strike` action, without normal dodge,
  block, or crit rolls.
- Newest player snap shots average **68.75 damage**, range 42-255.

A simulator that merely halves expected normal damage would be wrong.

### Armory Is Not Always One

| Side | Logged Normal Hits | `armory_mult > 1` | Range |
|---|---:|---:|---:|
| Player | 11,284 | 0 | 1 |
| Opponent | 10,841 | 4,182 | 1-1.07 |

Examples: RJman on Sep 9 logs 1.04; Jake From State Farm on Oct 13 logs 1.05.
The brief's "always 1" statement is false for opponents. The archives do not
identify which bonus enables it, nor justify multiplying the minimum floor
by the logged armory value. Do not blindly add it again to fitted base damage.

### Passive Does Not Mean Skipping Attacks

| Tag | Rounds | Normal Attacks | Already Down | Empty Defender Entry |
|---|---:|---:|---:|---:|
| Passive | 6,156 | 5,816 | 329 | 11 |
| Active | 3,492 | 3,398 | 91 | 3 |

All 14 empty entries occur when an opponent snap shot kills the player before
the ordinary turn. The other non-attacks are `down`. There is **no evidence
that Passive opponents decline a living turn**. Passive remains a useful
predictive covariate, plausibly representing snapshot/bonus differences, not
a demonstrated turn-skipping mechanic.

### The Floor Also Applies Above The Armour Crossover

There are 301 ordinary hits with `0 < base_dmg - reduction < min_dmg`.
For MissRossi on Sep 10, player base 267 minus reduction 235 gives 32, but
damage is the floor **35**. Another hit gives 245 minus 235 = 10, but deals
the floor **15**.

Thus `max(floor, base - reduction)` is the appropriate crossover model before
subsequent modifiers; the prose's piecewise "any positive residual replaces
the floor" rule is wrong. This is not a claim that every final damage value
equals that expression: opponent logs also show subsequent mitigation.

The UI's breakthrough flag uses only `base > defence`, while its damage
calculation takes the maximum (`arenaCombat.ts:163-165,203-204`). Consequently
it can say "not just minimum damage" when its own expected damage still uses
the minimum. For base 500 versus DEF 490, modeled damage is 44, not 10.

### Equal HP Does Not Guarantee Fixed Combat Numbers

The player's minimum steps change within the same HP group:

- HP 737: 22/30/38/45/53 before Sep 24 10:00 UTC; 21/28/35/42/49 afterward;
  22/29/36/44/51 from Sep 27 onward.
- HP 804: 22/30/37/45/53 before Oct 7 13:00 UTC; 24/33/41/49/58 afterward,
  despite the same captured gear tuple.

These are descriptive observed stages, not exact change timestamps or proof
of a particular cause. Possible causes include mutable bonuses, snapshot
behavior, or server changes. A single full-season median conceals this drift.
Neither fixed HP nor unchanged named gear establishes constant effective stats.

## HP And Card Signals

### Combat Power Almost Reveals HP Directly

Define `card_hp = CP - (STR + DEF + AGI + DEX)` for regular opponents.

- Exactly matches max HP in **473/583** fights, across all six loadouts.
- Overall mean absolute error: **1.945 HP**; largest absolute error: 54 HP.
- Underestimates actual HP in only **8/583** fights; most residuals are zero
  or small positive values, especially +5 and +6.
- Newest loadout: exact in **40/48**, mean absolute error **1.5 HP**.

The errors are not safely dismissed as rounding. For GENICXX on Oct 15,
card HP is 700 but actual HP is 734. For DonDubbalo on Oct 12, card HP is 895
but actual HP is 841. Hidden snapshot/stat differences remain unresolved.

On the 459 held-out regular fights used below:

| HP Method | MAE, HP | RMSE, HP | Beatable Wins/Fights | Wrong Beatable | Brier |
|---|---:|---:|---:|---:|---:|
| Existing level formula | 44.453 | 56.539 | 272/272 | 0 | 0.06791 |
| Earlier opponent HP, otherwise level formula | 22.503 | 39.113 | 274/275 | 1 | 0.06901 |
| Rolling additive card-stat fit | 14.676 | 19.766 | 274/275 | 1 | 0.06554 |
| Rolling multiplicative HP/card-stat fit | 14.555 | 19.165 | 275/276 | 1 | 0.06263 |
| CP minus four stats | **1.767** | **5.622** | 267/268 | 1 | 0.06726 |
| Actual fight HP, hindsight diagnostic only | 0 | 0 | 267/268 | 1 | 0.06735 |

For fitted methods, the target is trained only on preceding loadouts. The
additive and multiplicative fits use level, Passive, the four stats, and CP;
the latter models relative excess over `95 + 5*level`. These are comparisons,
not proposed additional production coefficients.

Even **actual HP** promotes the lost Elizium fight on Oct 13 to approximately
1.264, hence Beatable. This confirms the brief's warning: HP error is not the
only issue. Do not replace the HP formula in production while retaining the
old score calibration. The rejected opponent-memory idea remains unsupported.

### The Quoted Chance Is Still A Useful CP Curve

The existing verifier's ISO-week grouping mixes loadouts. Its week-42
correlation drops to about -0.789, but that is not evidence the curve broke:
separating regular fights by locked HP gives correlations from **-0.9973 to
-0.9991**, with residual SD 0.319-0.655 percentage points. For HP 850 alone,
correlation is -0.9984 and residual SD 0.419 points.

Thus the quote remains a useful low-dimensional card signal within a loadout,
not a calibrated fight probability. AGI/DEX/DEF remain useful candidates too:
descriptive regular fits predict dodge from AGI with residual SD 0.725 points,
crit chance from DEX with SD 1.162, and block from DEF with SD 2.188. These are
not yet exact capped/rounded predictive formulas.

## Probability Model Experiments

### Evaluation Protocol

Use only pre-fight cards and the earlier measured player profile. Initialize
with the 661- and 710-HP loadouts, then fit each model on **preceding loadouts
only**, holding the next loadout completely out of coefficient fitting.
Test blocks are HP 737, 759, 804, and 850: **459 regular fights**, including
129 in the existing 0.8-1.2 band.

Logistic candidates have a fixed L2 penalty of 1 on feature coefficients and
0.1 on the intercept. Neither penalty nor verdict thresholds is tuned on the
test outcomes. Features are added progressively:

- Score only: `4 * log(kill_race_score)`.
- Quote: additionally `(quoted_pct - 50) / 5`.
- Passive: additionally a 0/1 Passive indicator.
- Stat ratios: additionally log ratios of DEF, AGI, and DEX to STR.
- Card HP: instead of stat ratios, additionally
  `4 * log(card_hp / level_based_hp)`.

The conservative candidates change **only coin-flip probabilities and their
0.5 win/loss lean**. Beatable/Avoid labels, their probabilities, and the
existing score thresholds remain unchanged. Therefore preserved safe-label
performance is a design constraint, not a claim that the classifier discovered
a new safety boundary.

**Temporal caveat:** the fixed production `WIN_CHANCE` comparator was calibrated
on Oct 4, so it has calibration hindsight on the earlier test blocks. Results
after Oct 4 are shown separately. All experiments still use today's mechanics
coefficients, and the hypotheses/features were selected during this
investigation. Rolling coefficient fitting is not an untouched external test
of the overall research process.

### Results With Existing Verdicts Preserved

Lower Brier and log loss are better; calls use probability >= 0.5.

| Coin-flip Probability Method | All 459 Brier | All Log Loss | Correct / 459 | Coin-flip Brier | Coin-flip Correct / 129 |
|---|---:|---:|---:|---:|---:|
| Deployed fixed bands | 0.06791 | 0.21383 | 416 | 0.20540 | 91 |
| Rolling smoothed band rates | 0.07131 | 0.22054 | 412 | 0.21687 | 88 |
| Logistic score only | 0.07838 | 0.23678 | 404 | 0.24268 | 79 |
| Score + quote | 0.06468 | 0.20820 | 415 | 0.19391 | 90 |
| Score + quote + Passive | 0.06229 | 0.20128 | 417 | 0.18543 | 92 |
| Above + stat ratios | 0.06181 | 0.19974 | 418 | 0.18372 | 93 |
| **Score + quote + Passive + card HP** | **0.05757** | **0.18746** | **423** | **0.16861** | **98** |

For every row, verdict coverage is identical: **Beatable 272/272 wins,
Coin-flip 74/129, Avoid 5/58; zero wrong Beatable calls**. The last column is
lean accuracy, not the number of actual wins.

For the card-HP candidate, 14 previously wrong coin-flip calls become correct,
while seven correct calls become wrong. A seeded, paired, fight-level
bootstrap gives a 95% interval of approximately **[-0.0640, -0.0075]** for
the coin-flip Brier difference, candidate minus production. This assumes
independent fights; repeated opponents, shared loadouts, and candidate
selection make it optimistic. It is not a season-clustered significance claim.

After Oct 4, on **250** test regular fights, the same candidate gives Brier
**0.06221 versus 0.07619**, and **228 versus 222** correct calls. In the 73
coin-flips within that subset: **54 versus 48** correct, Brier **0.17467 versus
0.22255**.

### Newest-Loadout Warning

The apparent overall gain does not generalize cleanly to HP 850:

| HP 850 Regular Test Sample | Production | Card-HP Candidate |
|---|---:|---:|
| Correct calls, 47 fights | 42 | 42 |
| All-fight Brier | **0.07472** | 0.08216 |
| All-fight log loss | **0.22742** | 0.26273 |
| Coin-flip correct calls, 18 fights | 13 | 13 |
| Coin-flip Brier | **0.19494** | 0.21438 |

The newest sample is small, and its floor/crit regime differs substantially
from the training loadouts. Do not present aggregate improvement as proof of
an improvement for the player's current season.

### Random-Ceiling Proxy: Useful, But Not A Full Simulator

An additional experiment replaces the production floor expectation with:

```python
mean(min(0.088 * base * n / 5, ceiling)
     for n in (3, 4, 5, 6, 7)
     for ceiling in range(45, 76))
```

This retains the existing base-to-floor approximation, rather than claiming
to know effective STR. It also omits crits, first strikes, and other damage
modifiers, so it is explicitly a **proxy**, not the exact generator above.

On the 678 earlier-profile fights, replacing only the floor produces regular
Beatable **315/315** instead of 318/318 and boss Beatable **54/55** instead of
60/62. Priya's loss is demoted; Rachel remains a wrong Beatable call. Overall
Brier becomes slightly worse: **0.07085 versus 0.06959**. A mechanically better
floor does not by itself deliver a uniformly better probability model.

On the same 459 held-out regular fights, combining the proxy with the
card-HP logistic refinement gives:

| Model | Beatable Wins/Fights | Coin-flip Wins/Fights | Avoid Wins/Fights | Wrong Beatable | Correct / 459 | Brier | Log Loss |
|---|---:|---:|---:|---:|---:|---:|---:|
| Production | 272/272 | 74/129 | 5/58 | 0 | 416 | 0.06791 | 0.21383 |
| Proxy + card-HP coin-flip model | 269/269 | 79/145 | 3/45 | 0 | 424 | 0.05447 | 0.17679 |

Its coin-flip band has changed, so its 113/145 lean accuracy is **not** directly
comparable to 91/129 on the old band's membership. The all-459 comparison is
matched. The newest proxy-band coin-flip Brier is still slightly worse with
the logistic refinement than without it: **0.18397 versus 0.17988**, n=20.

**Conclusion:** there are replay improvements without extra wrong Beatable
calls, but none is yet a sufficiently demonstrated current-loadout improvement
to ship unconditionally. An exact Monte Carlo engine has not been validated
here; inferred effective stats, changing profiles, floor scaling, and subsequent
damage modifiers make a naive simulation misleadingly precise.

## Order, Refresh, And Banking

### Existing Pot Arithmetic Is Correct For A Fixed Policy

`expectedPot()` correctly values a fixed sequence when a loss resets the pot
and later fights can rebuild it. `bossPotLimit()` correctly solves the
risk-neutral terminal decision:

```text
fight boss iff p * (pot + bounty) > pot
equivalently pot < p * bounty / (1 - p)
```

Those formulas need calibrated probabilities, not a replacement equation.
They maximize expected points, not the probability of preserving a particular
pot or achieving a target rank. No new risk preference was assumed here.

### Lowest Score Is Not Always Riskiest First

The UI computes win probabilities, but sorts raw score
(`fightAdvisor.ts:384-391`). A score of 0.95 quoted at 50% gets probability
0.71, while a score of 1.05 quoted at 49% gets 0.47. The current order attacks
the less risky one first.

For two equal 40-point bounties, score order expects **32.148** banked regular
points; reversing to probability-risk order expects **41.748**. This is a
constructed mathematical example, not an observed counterfactual outcome.

In **146 deduplicated, complete, unfought lineups** followed by a captured
fight, sorting `(probability, score)` changes the order on **11**. With the
same production probability estimates, mean expected regular pot rises from
**125.344 to 126.283**, or **+0.938 points per lineup**. Two lineups become
worse because bounties differ. These are model-based expectations, not realized
gains or an unbiased sample of refresh offers.

This is separate from the previously rejected bounty-weighted order. The
small measured benefit supports discussing a consistency correction, not
overriding the player's chosen ordering preference.

### Banking Must Also Be Compared Before Regular Fights

The explicit stop decision only exists at the boss
(`fightAdvisor.ts:402-443`). A constructed example using production bands:

- Current pot: 200.
- One remaining regular: Avoid, probability 0.05, bounty 140.
- Boss: Beatable, probability 0.98, bounty 144.

Continuing through both expects
`0.98 * (0.05 * (200 + 140) + 144) = 157.78`, versus banking **200** now.
Showing the regular order plus "fight boss" does not express this stopping
decision.

For the player's existing chosen order, an optional-bank policy is:

```text
Vboss(P) = max(P, pBoss * (P + bossBounty))
Vi(P) = max(P,
            pi * Vi+1(P + bounty_i) + (1 - pi) * Vi+1(0))
```

The loss branch goes to zero, not a terminal page failure. That detail is
essential. This is a proposed advisory calculation, never permission to
automate attacks or banking.

### Refresh Needs Page Value And A Cost Policy

The current check compares regular-only EV with a fixed 87-point threshold
(`fightAdvisor.ts:450-469`). It ignores the option to fight or skip the boss
after seeing the resulting pot. Equal expected regular pots can have unequal
page value: with boss probability 0.4 and bounty 120, a certain pot of 80 has
value 80, but equal chances of pot 0 or 160 have value
`0.5 * 48 + 0.5 * 160 = 104`.

The 146 played-lineup mean above must **not** replace 87: it is conditioned on
what was eventually played, rather than a representative sample of available
rerolls. A new threshold needs free-refresh offer pairs, the stopping policy,
and loadout-aware calibration. No fresh unbiased refresh-benefit estimate was
established in this investigation.

Paid refresh currently uses the same "Worth it" rule as free refresh; the MG
price is displayed but not valued. Without an approved MG budget or points-to-MG
tradeoff, the extension can say "higher expected points," not categorically
recommend the purchase.

## Remaining Brief Questions

| Question | Finding Or Limit |
|---|---|
| Crit multiplier up to 2.55 | Common in the newest loadout; capped positive DEX-difference fit is strongly supported for bosses. Effective stats remain latent. |
| Opponent HP | CP minus the four stats is substantially better than level, but a direct score substitution is unsafe. Earlier HP memory still does not help verdict safety. |
| Dice / expected damage / simulation | Inclusive dodge -> block -> crit tree is exact on logged actions. Card-to-chance fits remain approximate; a complete prospective simulator is unproven. |
| First strike | AGI-ratio candidate, special armour reduction, and full minimum floor. Not merely a half-damage ordinary hit. |
| Passive | No turn skipping. Predictive signal remains after score/quote, but causal source is not settled. |
| Armory | Opponent multipliers above 1 are common. Their source and point of application remain unresolved. |
| Minimum steps / cap | Five strength-derived steps plus random 45-75 ceiling fits the distribution. Maximum 75 holds; an exact server implementation is not proven. |
| Boss families | Original sample: Kito-gumi 26/28, Volkskaya 23/25, SBP 22/24, Viola 19/19, Iron River 2/5. STR, dice, and unequal sampling confound family; no held-out family-specific coefficient improvement was established. |
| Stale `WIN_CHANCE` | Current records differ, but rolling smoothed band refits alone did not beat the fixed table overall. Do not replace constants with unsmoothed empirical 0/1 rates. |
| Median player profile / full distribution | Same-HP stage drift is real, and max-of-damage expectation cannot generally be evaluated by substituting a mean. No validated prospective full-distribution/weapon-range improvement was demonstrated. |

The boss family table deliberately uses the original 101 matched bosses for
comparability. Seven recovered wins change coverage; fit family effects only
after repairing extraction and controlling for score/tier/loadout. Boss Avoid
still has only five observations, and the original 0.8-1.1 boss band is empty.
Assigning its entire width the observed higher-band probability is extrapolation.

## Proposed Changes, Not Implemented

The following are recommendations requiring separate approval, in priority order.

1. **Repair evidence extraction and replay first.** Decode card-name HTML,
   track encounter identity and card timestamps, parse pre-fight levels, fold
   earlier samples only, match TypeScript medians, and report exclusions.
   Targets: `verification/arena/verify_combat_rule.py:123-139,161-231,304-321`.
2. **Correct documented mechanics.** Replace the fixed-ceiling distribution
   claim with the supported random-ceiling generator and its uncertainty;
   document inclusive ordered dice, high crit multipliers, special first
   strikes, and nonconstant opponent armory values. Keep measured mechanics
   separate from base-to-floor scoring approximations.
3. **Treat profile identity and drift explicitly.** HP alone currently joins
   samples and tallies (`arenaCombat.ts:318-330,388-393`). Equal-HP future
   seasons can retain old data, and within-HP changes already occur. Use an
   explicit season/loadout identity and investigate change-aware sampling.
   Suppress actionable stale-profile advice rather than only appending the
   current late warning (`fightAdvisor.ts:483-492`).
4. **Capture Combat Power for research and optional coin-flip refinement.**
   Extend `ArenaOpponentCard` and the DOM parser with CP, derive card HP, and
   evaluate a frozen score/quote/Passive/card-HP model on newly arriving
   fights before changing live advice. Do not promote coin-flips to Beatable
   solely because reconstructed HP is smaller.
5. **Validate a joint mechanics correction before changing the score.**
   Infer effective strength/dexterity/agility from earlier evidence only;
   model random floors, crit/block priority, first strikes, and any subsequent
   mitigation together. Do not mistake the proxy experiment for that model.
   If approved later, keep `arenaCombat.ts` and the verifier synchronized.
6. **Add a bank-versus-continue comparison before regular fights**, preserving
   the player's chosen order. Use the stopping recurrence above and show
   expected points plus uncertainty, not a safety guarantee.
7. **Discuss risk-order consistency separately from bounty optimization.**
   Sorting probability rather than raw score would match the advertised
   policy; observed estimated gain is small. Do not revive the rejected
   bounty-weighted algorithm without approval.
8. **Revisit refresh with boss option value and free/paid distinctions.**
   Keep MG tradeoffs explicit rather than inventing a currency valuation.
9. **Bind live track records to encounters and model versions.** The current
   cache is keyed by name and can survive refresh/page transitions
   (`fightAdvisor.ts:121-161,308`), so it does not establish which encounter's
   verdict was displayed before a later attack. This is a provenance risk,
   not proof that every historical tally is wrong.
10. **Repair stale explanatory copy.** `fightDetails.ts:152-154` still claims
    every 1.3+ boss wins; its legend omits the boss 1.2-1.3 Coin-flip range.
    Breakthrough copy disagrees with the modeled floor. Avoid-surprise text
    says about 1 in 20 without distinguishing the much less certain boss
    Avoid sample. Keep empirical counts, model probabilities, and guarantees
    clearly separate.

No recommendation restores Auto-Attack, invents pre-first-fight stats, or
revives opponent-HP memory or bounty-weighted ordering as an approved feature.

## Validation

- Reproduced the existing verifier's 684-fight tables from the shared cache.
- Executed the chronological replay, rolling model and HP comparisons,
  entity-normalized recovery, random-ceiling proxy, and 146-lineup comparison.
- Executed the independent mechanics script against the same cache.
- Python compilation passed for both new scripts; synthetic helper checks
  passed for the solver, probability fallback, thresholds, and ceiling mean.
- `npm run type-check` and `npm run build` passed. Extension source was not
  modified, and build artifacts are not part of this investigation's changes.

**Bottom line:** preserve the current regular Beatable boundary while fixing
the evidence pipeline and mechanics description. The CP-derived HP signal and
joint floor/dice model are the most useful next leads, but current-loadout
validation is still needed before changing production advice.
