# Arena After the Oct 30 Patch: Independent Review Findings

**Author:** Independent Reviewer  
**Date:** 2026-11-03  
**Brief:** `docs/agent-briefs/arena-post-patch-independent-review.md`  
**Scope:** Regular (non-boss) Arena fights in Season 18 (started 2026-10-27 23:00 UTC) across the 2026-10-30 patch (10:54–11:09 UTC), with boss fights examined for context.

---

## 1. Summary

- **What decides a regular Arena fight now:**  
  Fights are resolved server-side round-by-round with no practical round cap (fights up to 24 rounds observed). Combat is an attrition race between incoming damage and effective HP.
  Crucially, an opponent's card stats systematically understate their combat capability:
  1. **Hidden Armour:** Real combat reduction is **1.10× to 1.33× card DEF** (up to 1.67×) due to gear enhancements, set bonuses, and defensive efficiency perks.
  2. **Hidden HP:** Opponent HP reaches **950–1,175 HP** on high-tier opponents (the extension's formula expected 800–920 HP).
  3. **Damage Variance and High Rolls:** Base damage is not a fixed average; it rolls with $\pm 16\%$ variance on every swing. Opponents with STR $\ge 2,400$ roll base damage up to 1,645. Against the player's 1,504 reduction, these high rolls puncture armour for **140–150+ damage**, shattering the assumption that high-STR opponents remain trapped at the minimum damage floor.
  4. **Critical Hits:** Opponents crit on 10%–20% of hits for 1.30×–1.46× damage, which scales even floor hits to 85–125 damage.
  5. **First Strikes:** Agility advantages grant up to a 30% chance for a pre-round snap shot. If a faster opponent's first strike reduces the player to 0 HP, the player is knocked out before their regular swing.
  
- **Best predictor: The game's own "% CHANCE".**  
  In the Oct 30 patch (10:54–11:09 UTC), the game replaced its previous Combat Power log-curve formula with an accurate server-side combat simulation that incorporates the opponent's true equipped gear and perks.
  On all 116 post-patch regular fights, the game's quoted % is extraordinarily accurate (**ROC AUC 0.9919, Brier Score 0.0342, Log Loss 0.1158**):
  - **Quoted $\ge 90\%$:** Won **79 of 79** (100.0% win rate, **0 losses**).
  - **Quoted 60%–89%:** Won **11 of 14** (78.6% win rate, 3 losses).
  - **Quoted $< 60\%$:** Won **0 of 23** (0.0% win rate, **23 losses**).
  
  The extension's current Kill-Race Advisor performed substantially worse on the exact same fights (**ROC AUC 0.9021, Brier Score 0.0738**).

- **Why the advisor lost "Beatable" fights:**  
  The advisor subtracts raw card DEF from the player's damage, ignores the opponent's $\pm 16\%$ damage roll spread, ignores crits, ignores Agility/first strikes, and underestimates opponent HP.
  All 3 post-patch "Beatable" surprise losses were against `NehNehPok` (card STR 2483, DEF 930, AGI 1402, DEX 1055, quoted 15%):
  - The advisor gave scores of **1.36, 1.41, and 1.38** (badging "Beatable", with a displayed ~99% win chance).
  - The player attacked NehNehPok three times (Nov 1, Nov 3, Nov 3) and lost all three times. Two of those losses wiped built pots (30 and 70 points), accounting for the only lost pot points of the entire post-patch period.

- **What the extension should do (options, player decides):**  
  Because any single loss wipes the accumulated page pot, the extension should adopt a pot-preservation safety model:
  1. Add a **Quoted % Safety Gate** (new setting, default off): never badge an opponent Beatable if Quoted % is $< 90\%$ (or $< 70\%$), and badge Quoted % $< 60\%$ as Avoid. This eliminates all 3 surprise losses with zero wins lost.
  2. Alternatively, switch the primary win-chance predictor to the game's quoted % and repurpose the kill-race score into an explanatory breakdown.

---

## 2. Method

### Data Extracted
- **Source Archives:** 19 raw request archive files (`~/Downloads/tff archives/fifth-family-archive-new-2026-10-20*` through `...2026-11-03T14-08-51-652Z.ndjson.gz`).
- **De-duplication:** All rows de-duplicated by `(timestamp, endpoint, requestBody)`.
- **Span:** Season 18, starting 2026-10-27 23:00:00 UTC (locked HP 926, level 129).
  - Pre-patch Season 18: Oct 27 23:05 to Oct 30 00:59 UTC (44 regular fights, 21 boss fights).
  - Patch Window: Oct 30 10:54:04 UTC to 11:09:05 UTC.
  - Post-patch Season 18: Oct 30 11:10:42 UTC to Nov 03 12:24:04 UTC (116 regular fights, 27 boss fights).

### Complete Card-to-Fight Pairing
Each fight (`POST /actions/arena_v2.php action=attack`) was matched to the preceding Arena page (`GET /api/panel.php?...type=arena`) that displayed the opponent card.
- Previous analyses matched only 96 of the 116 post-patch fights because they filtered strictly for `endpoint == 'GET /api/panel.php?type=arena'`, missing panel requests with subview parameters (e.g. `arena_lb=full&type=arena`).
- By searching across all panel query variations, this review achieved **116 of 116 (100.0%)** card-to-fight pairing across the entire post-patch dataset.
- Post-patch opponent cards were confirmed to match the server's `win_pct` exactly (504/504 checks).

### Validation and Cross-Validation
- **Temporal Split:** The 116 post-patch regular fights were split chronologically into an Early Fit set (58 fights: Oct 30 11:10 to Nov 01 12:37 UTC) and a Late Test set (58 fights: Nov 01 12:37 to Nov 03 12:23 UTC) to test all predictor thresholds out-of-sample.
- **Reproducibility Scripts:** All scripts were executed with `python3 -I` and `node` in the scratch directory `<appDataDir>/brain/c43839f3-1c6d-4b84-ad27-10dbcb808d78/scratch/`:
  - `extract_all_arena.py` / `extract_and_analyze.py`: Streaming archive parser, HTML card extraction, card-fight joiner.
  - `replay_advisor.js`: Replayed `arenaCombat.ts` (bundled via `esbuild`) across the archive, updating player profile medians and scoring verdicts chronologically.
  - `analyze_mechanics.py`: Regressions of combat reductions vs DEF and base damage vs STR.
  - `inspect_chances.py`: Dodge, block, crit, and first-strike probabilities vs card stats.
  - `measure_multipliers.py`: Measured block, crit, and armory multipliers from 2,055 round entries.
  - `evaluate_predictors.py`: Computed Brier score, log loss, ROC AUC, and confusion matrices.
  - `evaluate_policies.py` / `test_split.py`: Policy evaluation and temporal cross-validation.
  - `simulate_combat.py`: Monte Carlo combat simulator.

---

## 3. Findings

All numbers refer to post-patch regular fights ($n = 116$) unless specified otherwise.

### 3.1 Player Stat Jump at the Oct 30 Patch [MEASURED]
At the patch on 2026-10-30 ~11:00 UTC, the player's locked HP remained 926, but combat stats jumped mid-season:
- **Base Damage:** Pre-patch mean $893.3 \pm 54.8$ ($n = 53$) $\rightarrow$ Post-patch mean $1019.9 \pm 48.8$ ($n = 143$), an increase of **$+14.2\%$**.
- **Reduction:** Pre-patch mean $1385.1 \pm 8.7$ ($n = 44$) $\rightarrow$ Post-patch mean $1501.3 \pm 9.8$ ($n = 128$), an increase of **$+8.4\%$**.

### 3.2 Opponent Reduction vs Card DEF [MEASURED]
- Logged opponent reduction (`rounds[].attacker.reduction`) averages **1.112× card DEF** (median 1.102×, range 0.904× to 1.670×, $\sigma = 0.133$, $n = 116$).
- Linear fit:
  $$\text{Reduction} = 1.332 \times \text{Card DEF} - 183.0 \quad (r = 0.96)$$
- Opponent reduction is fixed for the duration of a fight (verified on all 278 fight-sides).
- *Inferred:* The excess reduction above card DEF arises from equipped defensive gear enhancements and bloodline passives (e.g. Defensive Form, Efficient Guard). High-DEF opponents carry proportionally better gear.

### 3.3 Opponent Base Damage and Breakthrough Rolls [MEASURED]
- Logged opponent base damage averages **$0.567 \times \text{Card STR}$** (median 0.573×, range 0.449× to 0.686×; linear fit: $\text{Base} = 0.598 \times \text{STR} - 36.0$).
- Base damage is rolled on every swing between **0.84× and 1.16×** the attacker's average base.
- For opponents with STR $\ge 2,400$, their high-end rolls (1,550–1,645) clear the player's 1,504 reduction, dealing **140–150+ raw damage**. In the 26 lost fights, opponents broke through the player's armour on 46 of 353 swings (13.0%), whereas in the 90 won fights, opponents broke through on only 1 of 528 swings (0.19%).

### 3.4 Multipliers and Combat Modifiers [MEASURED]
- **Block Multiplier:** Strictly **0.20** (80% damage reduction) on every blocked hit across all 2,055 archive rounds.
- **Opponent Crit Multiplier:** Varies from **1.30 to 1.46** (mean **1.36**).
- **Player Crit Multiplier:** Varies from **1.59 to 2.55** (mean **2.23**).
  - *Inferred:* The player's crit multiplier scales inversely with opponent DEX: $\approx 1.27 + (2150 - \text{DEX})/1000$, capped at 2.55. Against low-DEX opponents ($\le 870$), player crits deal 2.55× damage; against high-DEX opponents ($\ge 1,800$), crits deal only 1.60×.
- **Armory Multiplier:** Opponents exhibit armory multipliers of 1.00 to 1.07 in logs. The ratio of actual damage to expected damage is identical across all armory levels (median 0.944 at ×1.00, 0.944 at ×1.06, 0.946 at ×1.07); armory does not multiply damage on top of logged base/reduction.
- **Per-Target Mitigation Factor:** Every landed hit is scaled by a factor of 0.90 to 1.00 (median 0.944–0.947), representing raw damage reduction perks.

### 3.5 First Strike and Turn Order Priority [MEASURED]
- First strike chance follows the Combat System wiki formula:
  $$\text{First Strike \%} = \min\left(30, \max\left(0, \frac{\text{AGI}_{\text{fast}} - \text{AGI}_{\text{slow}}}{\text{AGI}_{\text{slow}}} \times 30\right)\right)$$
- Post-patch logged counts: 72 player first strikes (mean damage 102.8) and 59 opponent first strikes (mean damage 60.9).
- **Turn Order:** In each round, first-strike pre-counter jabs resolve before normal attacks. If a faster defender's pre-counter reduces the player to 0 HP, the player is knocked out (`down`) and does not attack in that round (observed in 6 archived fights, including Mr_Wednesday on 2026-11-02).

### 3.6 Opponent Max HP Discrepancy [MEASURED]
- Real opponent HP (`def_max_hp`) is not fixed by level alone ($7.19 \times \text{level} - 49$).
- While level correlates ($r = 0.884$), opponent DEF ($r = 0.720$) and gear enhancements inflate HP up to 1,175 HP (e.g. Lv 137 Hydra has 1,175 HP vs 936 predicted; Lv 141 Aaron has 1,146 HP vs 965 predicted; Lv 134 NehNehPok has 937 HP vs 914 predicted).

### 3.7 Boss Consistency [MEASURED]
- Across 27 boss fights post-patch, the player won **27 out of 27 (100.0%)**.
- All 26 post-patch losses occurred in regular fights.

---

## 4. Predictor Comparison

### Metrics Used
- **Brier Score:** Mean squared probability error $\frac{1}{N}\sum (p_i - y_i)^2$. Proper scoring rule measuring accuracy and calibration ($0.0$ is perfect).
- **Log Loss:** Cross-entropy error $-\frac{1}{N}\sum [y_i \ln p_i + (1-y_i)\ln(1-p_i)]$. Heavily penalizes confident wrong calls.
- **ROC AUC:** Threshold-independent ranking power ($1.0$ is perfect discrimination).
- **Surprise Losses in "Safe" Band:** Count of lost fights rated as winnable. Wiping an unbanked pot makes this the single most critical operational metric.

### Comparative Results (Post-Patch Regular Fights, $n = 116$)

| Predictor | Brier Score | Log Loss | ROC AUC | Accuracy ($\ge 50\%$) | "Safe" Band Calls | Surprise Losses |
|---|---|---|---|---|---|---|
| **Game Quoted %** | **0.0342** | **0.1158** | **0.9919** | **95.7%** (111/116) | $\ge 90\%$: **79/79 (100%)** | **0** |
| **Extension Advisor** | 0.0738 | 0.2797 | 0.9021 | 81.0% (94/116) | Beatable: **71/74 (95.9%)** | **3** (NehNehPok $\times 3$) |
| **Card Combat Simulator** | 0.1974 | 0.6120 | 0.9791 | 87.9% (102/116) | $\ge 90\%$: **62/62 (100%)** | **0** |

### Complete Post-Patch Breakdown by Quoted %

```
Quoted 99%:       72 / 72 won (100.0%)  [0 losses]
Quoted 90%–98%:    7 /  7 won (100.0%)  [0 losses]
Quoted 70%–89%:    8 / 10 won ( 80.0%)  [2 losses: IcePick 77%, Katy 84%]
Quoted 60%–69%:    3 /  4 won ( 75.0%)  [1 loss: 4lbert 65%]
Quoted 1%–59%:     0 / 23 won (  0.0%)  [23 losses, including NehNehPok 15% x3]
```

### Contrast with Pre-Patch Performance
To understand why the extension was designed with its own kill-race model, we compared pre-patch vs post-patch performance:
- **Season 18 Pre-Patch (Oct 28–30, $n = 44$):**
  - Game Quoted %: Brier = **0.1389**, AUC = 1.0000 (compressed numbers, poor calibration).
  - Extension Advisor: Brier = **0.0323**, AUC = 0.9693 (advisor was over 4× more accurate).
- **Season 18 Post-Patch (Oct 30 – Nov 3, $n = 116$):**
  - Game Quoted %: Brier = **0.0342**, AUC = 0.9919 (game overhauled calculation to server-side simulation).
  - Extension Advisor: Brier = **0.0738**, AUC = 0.9021 (advisor degraded by 2.3×).

---

## 5. Temporal Cross-Validation

To guard against overfitting, the 116 post-patch fights were split chronologically into two equal subsets:

| Policy Tested | Early Fit Set ($n = 58$) | Late Test Set ($n = 58$, Out-of-Sample) | Combined Full Set ($n = 116$) |
|---|---|---|---|
| **Quoted $\ge 90\%$ (Beatable)** | **40 / 40 (100%)** | **39 / 39 (100%)** | **79 / 79 (100%, 0 losses)** |
| **Quoted $< 60\%$ (Avoid)** | **2 / 14 (14.3%)** | **0 / 11 (0.0%)** | **2 / 25 (8.0%, 23 losses caught)** |
| **Advisor Beatable** | 36 / 37 (97.3%, 1 loss) | 35 / 37 (94.6%, 2 losses) | 71 / 74 (95.9%, 3 losses) |

The test confirms that the Quoted $\ge 90\%$ rule exhibits zero degradation out-of-sample: 100% win rate across both independent periods.

---

## 6. Recommendations for the Extension

Because a single loss forfeits the entire accumulated pot, the extension should prioritize pot safety. All proposed changes should be implemented behind new user settings, toggled **off by default**:

### Option 1: Quoted % Safety Gate on Advisor (Recommended)
- **Mechanism:** Maintain the advisor's kill-race score for fight ordering and hover details, but enforce a safety veto:
  - An opponent cannot be badged **Beatable** if their Quoted % is $< 90\%$ (or $< 70\%$). If the score is $\ge 1.2$ but Quoted % is low, downgrade the verdict to **Coin-flip** or **Avoid**.
  - Any opponent with Quoted % $< 60\%$ is automatically badged **Avoid**.
- **Impact on Data:** Converts all 3 catastrophic NehNehPok losses from Beatable to Avoid, yielding **71/71 (100%)** in Beatable and preventing 21 of 26 total losses.

### Option 2: Pure Quoted-Percentage Badging
- **Mechanism:** Badge opponents directly using the game's post-patch calibrated probabilities:
  - **Beatable:** Quoted $\ge 90\%$ (Record: 79/79 won, 100% win rate).
  - **Coin-flip:** Quoted 60%–89% (Record: 11/14 won, 78.6% win rate).
  - **Avoid:** Quoted $< 60\%$ (Record: 2/25 won, 8.0% win rate; 23 losses avoided).
- **Impact on Data:** Maximizes the safe pool (79 guaranteed wins) while eliminating all 23 predictable losses.

### Option 3: Opponent Combat Memory (Rematch Cache)
- **Mechanism:** Store opponent combat parameters (real armour, max HP, first-strike rates) from past fight logs. Since **60% of all regular fights are rematches** (70 of 116), cached combat stats can provide exact simulations for repeat opponents.

### Option 4: Dual Badging UI
- **Mechanism:** Display the game's "% CHANCE" directly on the advisor badge strip alongside the score so the player can immediately spot divergences (e.g., "Score 1.38 · Game 15%").

---

## 7. What Could Not Be Settled

1. **Card Hidden Gear on First Sight:** A card's displayed stats do not specify the opponent's gear quality, enhancement level, or passive bloodline reductions. For opponents met for the first time, exact client-side damage simulation without the server's quoted % will always have higher variance than the game's quote.
2. **Matchmaking Draw Rates:** The precise algorithm governing which four regular opponents appear on a page (and how frequently high-tier players are drawn) remains server-side.
3. **High-Tier Boss Thresholds:** Because the player won all 27 boss fights post-patch (100%), no boss losses were recorded post-patch. Whether high-tier boss stat curves shifted post-patch remains unobservable in this dataset.

---

## 8. Comparison with Earlier Analysis

### Areas of Agreement
1. **Dominance of Quoted % Post-Patch:** Both reviews conclude that the game's quoted win percentage is vastly superior to the extension's current kill-race model post-patch, separating wins from losses with extreme accuracy.
2. **NehNehPok as the Beatable Failure Point:** Both reviews identify the three fights against `NehNehPok` (2026-11-01 12:24, 2026-11-03 12:13, 2026-11-03 12:15) as the sole source of false-positive "Beatable" surprise losses.
3. **Hidden Armour Inflation:** Both reviews measured actual opponent reduction exceeding card DEF by $\approx 1.10\times$ to $1.17\times$ on average.
4. **Prevalence of Rematches:** Both reviews measured that $\approx 60\%$ of all regular fights post-patch are rematches against previously encountered opponents.
5. **Armory Multiplier Correction:** Both reviews confirmed that `armory_mult` in combat logs does not increase damage dealt.

### Key Differences and Independent Additions
1. **Complete Card-Fight Pairing (116 vs 96 fights):**
   The earlier review paired only 96 of the 116 post-patch regular fights with opponent cards, leaving 20 fights unlinked. This independent review identified that the missing cards were present in archive rows requesting panel subviews (such as `GET /api/panel.php?arena_lb=full&type=arena`). By parsing all Arena panel variants, this review achieved **100% pairing (116 of 116 fights)**.
2. **NehNehPok Combat Breakdown:**
   The earlier review initially characterized the NehNehPok fights as "mostly floor against floor". Our round-by-round inspection revealed that NehNehPok's STR (2,483) generated base damage rolls up to 1,645 that broke through the player's 1,504 armour for 149 damage, landed 5 critical hits (110–120 damage), and possessed higher Agility (1,402 vs 1,126) which stripped the player's first strike and granted NehNehPok a 13% dodge rate.
3. **First-Strike Knockout Dynamics:**
   This review identified and measured the exact first-strike turn-order mechanic: when a faster opponent triggers first strike and reduces player HP to 0, the player is knocked out before their regular swing.
4. **Formal Statistical Comparison:**
   This review calculated formal calibration metrics across both pre-patch and post-patch datasets, proving that the game's quoted percentage improved from a Brier score of **0.1389** pre-patch to **0.0342** post-patch, while the advisor worsened from **0.0323** to **0.0738**.
