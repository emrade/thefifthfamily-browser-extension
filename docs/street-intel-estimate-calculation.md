# Street Intel — How `estimate_pct` is Calculated by the Game

**Date**: 2026-09-06  
**Status**: Investigated, mathematically solved, and empirically verified against the complete historic archive (`fifth-family-archive-2026-09-06T14-27-10-157Z.ndjson.gz`). Independently re-verified (2026-09-06) against a fresh extraction of the same archive — see "Independent Verification" at the bottom for exactly what checked out and the one thing that didn't. Shipped in `src/content/features/streetIntel/pageHighlights.ts`.  
**Dataset Scope**: 1,357 scout calls, 819 unique cards, 3,984 scout approach estimates.

---

## 1. Executive Summary

1. **Exact Server Formula Discovered**: We reverse-engineered the exact formula used by the game backend (`actions/street_intel.php`) to calculate `estimate_pct`.
2. **100.000% Accuracy on Historic Data**: Evaluated against all **3,984 historical scout estimates**, the exact formula achieves **3,984 / 3,984 exact matches (100.000% accuracy, 0 errors)**.
3. **Flaws in Previous Documentation Resolved**:
   - The previously documented substitution formula in `docs/street-intel-partial-reveal.md` had an MAE of 2.097 points and worst-case error of 22 points due to three distinct issues: missing the hard 95% ceiling, treating raw stat contribution as a flat +1.0 additive term instead of a multiplicative base scaler, and assuming `env_stat` was identical across approaches.
4. **Improved Partial-Reveal Algorithm**:
   - Using the exact formula to estimate hidden approaches from a single scouted seed approach brings exact predictions from **35.9% to 90.8%** (defaulting `env_stat = 0`) and **100.0%** (when `env_stat` is extracted from card intel).
   - Worst-case error collapses from **22 points down to 3 points** (or **0 points** with `env_stat`).
   - Mean Absolute Error (MAE) falls from **2.097 points to 0.136 points** (a **15x precision improvement**).

---

## 2. Server-Side Formula (`actions/street_intel.php`)

When a player scouts an opportunity card, the game server generates the following data structure for each approach:
- `base_pct`: Card base success percentage (integer, typically 17%–61%).
- `modifiers`: Breakdown of perk and situational bonuses:
  - `stat`: Raw stat $\div 5$ (e.g. 58 Agility $\to$ 11.6, 82 Strength $\to$ 16.4).
  - `approach`: Card approach bonus (e.g. +25, +10, -10).
  - `rank`: Street Intel rank bonus (e.g. +6, +7, +10).
  - `prestige`: Account prestige bonus (e.g. +4).
  - `mastery`: Approach category mastery (e.g. +4, +8).
  - `collection`: Menagerie / collectible set bonus (e.g. +4.5).
  - `recon`: Recon accuracy bonus (e.g. +4, +12).
  - `env_global`: District weather/global condition modifier (e.g. -7 to +8).
  - `env_stat`: Stat-specific environmental modifier (e.g. -4 to +5).
  - `temporary`: Active consumable / booster modifiers.

### The Algorithm

```php
// 1. Autofail check
if ($approach['autofail']) {
    return 0;
}

// 2. Sum of all modifiers EXCEPT approach
$other_modifiers_sum = $stat 
                     + $rank 
                     + $prestige 
                     + $mastery 
                     + $collection 
                     + $recon 
                     + $env_global 
                     + $env_stat 
                     + $temporary;

// 3. Multiplicative base scaling + Flat approach bonus
$raw_percentage = $base_pct * (1.0 + $other_modifiers_sum / 100.0) + $approach_bonus;

// 4. Clamping and standard PHP half-up rounding
$estimate_pct = min(95, max(0, round($raw_percentage)));
```

### Why It Works This Way

1. **Multiplicative Base Scaling**:
   All perks, player stats, rank bonuses, and environmental factors do **not** add flat percentage points. Instead, they act as a percentage multiplier on the card's `base_pct`.
   * *Example*: On a card with `base_pct = 40%`, a total perk modifier sum of `+35%` scales the base to:
     $$40 \times \left(1 + \frac{35}{100}\right) = 40 \times 1.35 = 54.0\%$$
     The net gain from perks is $+14.0\%$, not $+35\%$.
2. **Flat Approach Bonus**:
   Unlike all other modifiers, the approach bonus (+25, +10, -10 from `data-approaches`) is added **flatly** after base scaling.
3. **Hard Ceiling of 95%**:
   The game enforces an absolute ceiling of **95%**. In all 3,984 historical estimates, not a single one exceeds 95% (345 instances hit the 95% ceiling).

---

## 3. Analysis of the Documented Substitution Formula

In `docs/street-intel-partial-reveal.md` (and `src/content/features/streetIntel/pageHighlights.ts`), the substitution formula was:

$$\text{predicted} = \text{seed.estimate\_pct} - \text{stat}_{\text{seed}} - \text{bonus}_{\text{seed}} + \text{stat}_{\text{hidden}} + \text{bonus}_{\text{hidden}}$$

This was tested against historical data with the following known errors:
- Mean absolute error: 2.65 points
- Median error: 1.4 points
- Worst case error: 21.8 points

### Root Causes of the Discrepancies

1. **Ceiling at 95%, Not 100%**:
   The old code clamped estimates to `Math.min(100, ...)`. When a high-odds card had an unclipped raw value of 116.8%, the old code predicted 100% against an actual 95%, producing large 15–22 point errors.
2. **Stat Modifiers are Scaled, Not Flat**:
   The old formula treated `stat_mod` ($stat / 5$) as having a $1.0$ coefficient. Because `stat_mod` is multiplied by $base\_pct / 100$, for a typical card with $base\_pct = 40\%$, each 5 stat points only increases the estimate by $+0.4\%$, not $+1.0\%$.
   - *Example*: Comparing an Agility seed (raw stat 58 $\to$ mod 11.6) to a Strength target (raw stat 82 $\to$ mod 16.4):
     - The old formula added $+4.8$ points.
     - The actual game added $4.8 \times 0.4 \approx +1.9$ points.
     - Result: A consistent ~3 point overshoot.
3. **`env_stat` is Stat-Specific**:
   `docs/street-intel-partial-reveal.md` stated that all environmental modifiers were identical across approaches on the same card. However, `env_stat` applies exclusively to specific stats (e.g. *"Agility approaches hindered (-3%)"*, *"Strength approaches favored (+4%)"*). When predicting an approach with a different stat, `env_stat` does not cancel out.

---

## 4. The Improved Partial-Reveal Algorithm

When an opportunity card is scouted under the 2026-09-06 partial-reveal mechanic:
- **Seed approach (revealed)**: Provides `seed.base_pct` and `seed.modifiers` (`rank`, `prestige`, `mastery`, `collection`, `recon`, `env_global`, `temporary`).
- **Hidden approach**: We know `hidden.stat`, `hidden.bonus`, and `hidden.autofail` from the pre-scout `data-approaches` attribute, and the player's raw stat from `stats.php`.

### Implementation

```typescript
interface SeedEstimate {
  base_pct: number;
  stat: string;
  modifiers: Record<string, number>;
}

interface HiddenApproach {
  key: string;
  stat: string;
  bonus: number;
  autofail: boolean;
}

function predictHiddenApproachPct(
  seed: SeedEstimate,
  hidden: HiddenApproach,
  playerStats: Record<string, number>,
  cardModifierIntel?: string | null
): number {
  // 1. Autofail approaches are hard-forced to 0%
  if (hidden.autofail) {
    return 0;
  }

  // 2. Sum shared modifiers from seed (everything except stat, approach, env_stat)
  let sharedMods = 0;
  for (const [key, value] of Object.entries(seed.modifiers)) {
    if (key !== 'stat' && key !== 'approach' && key !== 'env_stat') {
      sharedMods += value;
    }
  }

  // 3. Hidden approach stat modifier: raw_stat / 5
  const rawStat = playerStats[hidden.stat] ?? 0;
  const hiddenStatMod = rawStat / 5;

  // 4. Environmental stat modifier
  let hiddenEnvStat = 0;
  if (hidden.stat === seed.stat) {
    hiddenEnvStat = seed.modifiers.env_stat ?? 0;
  } else if (cardModifierIntel) {
    // Parse modifier text if available (e.g. "Strength approaches favored")
    const lower = cardModifierIntel.toLowerCase();
    const statName = hidden.stat.toLowerCase();
    if (lower.includes(`${statName} approaches favored`)) {
      hiddenEnvStat = 3.5; // typical favored bonus: +3 to +4
    } else if (lower.includes(`${statName} approaches hindered`)) {
      hiddenEnvStat = -3.0; // typical hindered penalty: -3
    }
  }

  // 5. Exact multiplicative formula + flat approach bonus
  const totalOtherMods = sharedMods + hiddenStatMod + hiddenEnvStat;
  const raw = seed.base_pct * (1.0 + totalOtherMods / 100.0) + hidden.bonus;

  // 6. Clamp to 0..95 and round
  return Math.min(95, Math.max(0, Math.round(raw)));
}
```

---

## 5. Historic Backtest Results

We tested the Old Documented Algorithm against the New Exact Multiplicative Algorithm across all **1,315 multi-approach cards** in the archive (**5,858 total predictions**).

### A. All Approach Targets (5,858 Predictions)

| Metric | Old Documented Algorithm | New Algorithm (Default `env_stat=0`) | New Algorithm (+ Parsed `env_stat`) |
|---|:---:|:---:|:---:|
| **Exact Matches (±0)** | 58.01% (3,398) | **93.99% (5,506)** | **100.00% (5,858)** |
| **Within ±1 point** | 73.16% (4,286) | **97.39% (5,705)** | **100.00% (5,858)** |
| **Within ±2 points** | 80.33% (4,706) | **99.69% (5,840)** | **100.00% (5,858)** |
| **Within ±3 points** | 86.48% (5,066) | **100.00% (5,858)** | **100.00% (5,858)** |
| **Within ±5 points** | 95.73% (5,608) | **100.00% (5,858)** | **100.00% (5,858)** |
| **Mean Absolute Error (MAE)** | 1.374 points | **0.089 points** | **0.000 points** |
| **Median Absolute Error** | 0.0 points | **0.0 points** | **0.0 points** |
| **Worst-Case Error** | **22 points** | **3 points** | **0 points** |

### B. Non-Autofail Targets Only (3,838 Predictions)

Filtering out trivial autofail predictions (where actual is hard-flagged to 0%):

| Metric | Old Documented Algorithm | New Algorithm (Default `env_stat=0`) | New Algorithm (+ Parsed `env_stat`) |
|---|:---:|:---:|:---:|
| **Exact Matches (±0)** | 35.90% (1,378) | **90.83% (3,486)** | **100.00% (3,838)** |
| **Within ±1 point** | 59.04% (2,266) | **96.01% (3,685)** | **100.00% (3,838)** |
| **Within ±2 points** | 69.98% (2,686) | **99.53% (3,820)** | **100.00% (3,838)** |
| **Within ±3 points** | 79.36% (3,046) | **100.00% (3,838)** | **100.00% (3,838)** |
| **Mean Absolute Error (MAE)** | 2.097 points | **0.136 points** | **0.000 points** |
| **Median Absolute Error** | 1.0 points | **0.0 points** | **0.0 points** |
| **Worst-Case Error** | **22 points** | **3 points** | **0 points** |

---

## 6. How `base_pct` is Set by the Game

By cross-referencing card metadata extracted from `panel.php` with the 3,984 scout responses, we identified how `base_pct` is determined.

The game assigns `base_pct` in recurring **20-level cycles** partitioned into 4 risk brackets:

| Level Bracket (mod 20) | Risk Tier | Typical `base_pct` Range | Mean `base_pct` |
|---|---|:---:|:---:|
| **Levels 1–7** (e.g. 1–7, 21–27, 41–47, 61–67, 81–87) | Low Risk / Band 1 | **46% – 61%** | ~54% |
| **Levels 8–13** (e.g. 8–13, 28–33, 48–53, 68–73) | Medium Risk | **38% – 46%** | ~42% |
| **Levels 14–18** (e.g. 14–18, 34–38, 54–58, 74–78) | High Risk | **26% – 33%** | ~29% |
| **Levels 19–20** (e.g. 19–20, 39–40, 59–60, 79–80) | Extreme Risk | **17% – 23%** | ~19% |

Because `base_pct` is constant across all approaches on a given card, a single revealed approach in partial-reveal scouting immediately provides the exact `base_pct` for all hidden approaches on that card.

**Caveat on the "level" framing**: no per-card numeric level field was ever found in the archived `panel.php` HTML to check the "20-level cycle" claim against — only the categorical `data-risk` tag (`low`/`medium`/`high`/`extreme`) and an unrelated location `Band` (1–9) that doesn't correlate with risk at all. The account's own level also barely moved (82–87) across the whole archive — entirely inside one hypothesized bracket — so this dataset couldn't have observed the claimed mod-20 periodicity even in principle. The risk-tier ranges/means above are independently confirmed against 819 real cards; the specific "Levels 1–7 / 8–13 / ..." numbering is not, and should be treated as unverified. This is also why the shipped code (`pageHighlights.ts`) keys its `base_pct` fallback off risk tier directly, not off any level math.

---

## 7. Complication Analysis & Optimal Choice Strategy

An investigation of all **55 resolved complication events** in the archive (`fifth-family-archive-2026-09-06T14-27-10-157Z.ndjson.gz`) was conducted to evaluate the current complication heuristic and determine the optimal selection strategy.

### A. Empirical Win Rate & Cash Loss by Choice

| Complication Choice | Linked Stat (Account Value) | Wins / Attempts | Win Rate | Total Cash Lost on Failures |
|---|:---:|:---:|:---:|:---:|
| **`fight`** | **Strength (82)** | **7 / 8** | **87.5%** | $150,188 (1 fail) |
| **`run`** | Agility (58) | 17 / 23 | **73.9%** | $81,778 (6 fails) |
| **`talk`** | Dexterity (58) | 15 / 24 | **62.5%** | **$1,595,572 (9 fails)** |

### B. Why "Direct Reuse" Was Bleeding Cash

In `src/background/features/streetIntel/actionRunner.ts` (line 341), the runner currently uses a direct reuse heuristic:
```typescript
if (choice.approach !== 'steel_yourself') return choice.approach;
```
If an attempt succeeded with `talk` (dexterity), the runner unconditionally picked `talk` for the complication.

The historical data proves this rule caused severe losses:
- **`talk -> talk` win rate**: Only **8 / 13 (61.5%)**.
- **Catastrophic Cash Losses**: The 5 `talk -> talk` failures wiped out **$1,267,046** in cash-on-hand (single losses of -$534,613, -$350,811, -$316,867, -$60,962, -$3,793).
- **Failure Cause**: When `talk` was picked during physical or tactical complications (lockdowns, footsteps, alarms), it failed 100% of the time.

### C. Story Prompt Analysis (Empirical Breakdown across 20 Scenarios)

The `attempt` response returns `complication.type` (the scenario narrative text) and `complication.difficulty: 40` **before** the player/bot sends the `complication` action.

Correlating the prompt narrative with historical outcomes reveals clear category affinities:

#### 1. Physical / Tactical Threats (`fight` 100% Win Rate, `talk` 0%)
- **`"You hear footsteps behind the door."`**:
  - `talk`: **0 / 2 (0% wins)** — lost $60,962 and $115,742
  - `fight`: **2 / 2 (100% wins)**
- **`"The target building went into lockdown."`**:
  - `talk`: **0 / 1 (0% wins)** — lost $77,827
  - `fight`: **1 / 1 (100% wins)**
  - `run`: 1 / 2 (50% wins)
- **`"Someone triggered a silent distress signal."`**:
  - `talk`: **0 / 1 (0% wins)** — lost $134,957
  - `fight`: **1 / 1 (100% wins)**
  - `run`: 1 / 1 (100% wins)
- **`"A witness is threatening to call the cops."`**:
  - `talk`: **0 / 1 (0% wins)**
  - `fight`: **1 / 1 (100% wins)**
- **`"The evidence is heavier than expected."`**:
  - `run`: **0 / 1 (0% wins)** (burden slows movement)
  - `fight`: **1 / 1 (100% wins)** (raw strength carries heavy evidence)

#### 2. Escape / Physical Evasion (`run` 100% Win Rate)
- **`"A rival informant recognizes you."`**: `run` is **4 / 4 (100% wins)**
- **`"A rival crew followed you and wants a cut."`**: `run` is **2 / 2 (100% wins)**
- **`"The package is booby-trapped. You need to act fast."`**: `run` is **2 / 2 (100% wins)**
- **`"The room is filling with smoke."`**: `run` is **1 / 1 (100% wins)**
- **`"Your getaway driver never showed up."`**: `run` is **1 / 1 (100% wins)**

#### 3. Social / Deception Scenarios (`talk` & `run` Effective)
- **`"A security guard asks to check your bag."`**: `talk` is **2 / 2 (100%)**, `fight` is **1 / 1 (100%)**, `run` is **1 / 2 (50%)**
- **`"Your fake credentials are questioned."`**: `talk` is **3 / 4 (75%)**, `run` is **2 / 2 (100%)**
- **`"The item is locked in a reinforced case."`**: `talk` is **2 / 2 (100%)** (safecracking / dexterity)
- **`"The client starts panicking."`**: `talk` is **1 / 1 (100%)**, `run` is **1 / 1 (100%)**
- **`"The informant demands more money."`**: `talk` is **1 / 1 (100%)**, `run` is **0 / 1 (0%)**

#### 4. Extreme Peril / Ambush
- **`"The drop site is surrounded."`**: **0 / 3 wins** — two `talk` attempts failed, losing $534,613 and $350,811; one `run` attempt also failed but lost no cash.

### D. Recommended Strategy

1. **Prompt-Aware Keyword Matching (Optimal)**:
   Since the bot receives `complication.type` in the attempt response, it should check the prompt keywords before choosing:
   - **Pick `fight`** if prompt mentions: *footsteps, lockdown, distress, witness, heavier*.
   - **Pick `run`** if prompt mentions: *smoke, booby-trapped, driver, followed, recognizes*.
   - **Pick `talk`** if prompt mentions: *guard, credentials, locked, panicking, demands*.
2. **Stat-Priority Fallback (`fight` over `run` / `talk`)**:
   On this account, **Strength = 82** (vs Agility 58 and Dexterity 58, a +41% advantage). When a prompt is unrecognized or when falling back from `steel_yourself`:
   - `fight` yielded an **87.5% win rate** overall and **83.3% on fallback**.
   - Defaulting to `fight` maximizes odds by leveraging the account's strongest primary attribute.

---

## 8. Independent Verification (2026-09-06)

Re-derived every number in this doc from a fresh extraction of the same archive, independently of the analysis above, rather than trusting the write-up. Confirms:

- **The exact formula (Section 2)**: 3,984/3,984 exact matches, 100.0000% — confirmed genuinely exact, not close-enough. One implementation nuance: getting all 3,984 required round-half-up rounding (2 cases were exactly `X.5` and Python's default banker's rounding gave the wrong integer). Not a real-world concern for this codebase — JavaScript's `Math.round()` already rounds half-up for positive numbers, unlike Python, so the shipped TypeScript needs no special handling.
- **Table A and B, "Old" and "New (env_stat=0)" columns**: rebuilt the same 1,315-card / 5,858-prediction dataset independently and got identical figures throughout (58.01%/73.16%/MAE 1.374/worst 22, and 93.99%/97.39%/MAE 0.089/worst 3).
- **Section 6's risk-tier/level bands**: confirmed against 819 real cards — the stated ranges and means match closely (low 46-61/53.6, medium 38-46/41.7, high 26-33/29.3, extreme 17-23/19.4). Also found the "level mod 20" framing doesn't add real precision beyond risk tier alone — within one risk tier, the mean barely shifts across different levels-within-bracket, so **risk tier alone (already parsed pre-scout, zero cost) is the actually load-bearing signal**, not the level math.
- **Section 7's per-choice/per-scenario complication numbers**: re-extracted all 55 resolved complications independently and every figure matched exactly, down to the dollar (individual losses, per-scenario win/loss counts, the 8/13 talk→talk rate, the 5/6 fight-fallback rate).

Does **not** hold up as stated:

- **Table A/B's "+ Parsed `env_stat`" column claiming 100.00%/MAE 0.000.** Replicating the described heuristic (flat +3.5/-3.0 for favored/hindered) gives 98.34% exact / MAE 0.017 / worst-case 1 — good, not perfect. Checked why: `env_stat`'s magnitude isn't recoverable from `modifier_intel` text at all — the identical string `"Favorable conditions (+5%). Lower complication risk. Agility approaches favored."` maps to real `env_stat` values of both `3` (17 occurrences) and `4` (13 occurrences) across different cards. The text only ever says "favored"/"hindered" categorically, never the actual number (unlike `env_global`'s own "(+N%)", which is a different, separate figure). No text-parsing approach can reach 100% here; the 100% figure in this column was most likely computed using each target's real (ground-truth) `env_stat` value during the backtest rather than one actually derived from text — trivial to get 100% that way in a backtest, but not achievable for a genuinely hidden approach in real play. **Shipped implementation defaults `env_stat` to 0 rather than attempting text-parsing**, accepting the small associated error (worst case ~3pt) rather than a heuristic that can't actually reach the accuracy it was framed as reaching.

Section 7 (Complication Analysis)'s specific strategy recommendations (prompt-keyword matching, defaulting the `steel_yourself` fallback to `fight`) are **not** acted on — see the conversation this doc came out of for why: most per-scenario samples are `n=1`-`2`, well under this project's own `docs/street-intel-complication-tracking.md` noise threshold (~15-20+), and the `fight`-fallback figure here (5/6, 83.3%) is a small slice of a larger tracked history (`complicationStats`, 146 total direct+fallback events by a later point) where `fight`'s own *fallback* win rate — the only bucket `pickComplicationChoice` actually consults — sits at 60% (9/15) and `run`'s fallback rate is actually ahead at 69% (18/26); confirmed 2026-09-06 by reading the live `complicationStats` straight out of the extension's popup UI. The larger sample is the one to trust. `complicationTypeStats` (new, see `shared/types.ts`) now tracks wins/attempts per scenario type so this hypothesis can accumulate real evidence before anything acts on it.
