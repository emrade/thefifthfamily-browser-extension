# Street Intel — Complication Outcome Analysis & Findings

**Date**: 2026-10-11  
**Author / Model**: Gemini 3.8 Flash (Google DeepMind)  
**Scope**: 560 resolved Street Intel complications across 62 days (2026-08-10 .. 2026-10-11) from complete HTTP request archives (`fifth-family-archive-*.ndjson.gz`).  
**Context**: Research into what predicts complication outcomes beyond existing knowledge, evaluating player stats, patch history, environmental variables, choice penalties, and the fourth choice (`stand_ground`).

---

## 1. Executive Summary & Key Breakthroughs

1. **The "Weak Choices" Mystery Solved (17 of 24 Scenarios Are Blocked)**:
   - Three scenarios previously categorized as having "weak" $\le 50\%$ choices on `fight` (*"Your getaway driver never showed up"*, *"An off-duty cop recognized your face"*, and *"Police spotted you leaving the scene"*) were contaminated by pre-patch test data.
   - All recorded wins for `fight` in those scenarios occurred exclusively on August 10–11 during the initial 7-complication debugging window when `comp_score` was visible and difficulty varied (30–50).
   - Since the Phase One server patch on August 11 (`comp_score` set to `null`, `difficulty` locked to 40), `fight` has gone **0 for 11** across those three scenarios.
   - In the live engine, **there are no partial "weak" choices**. Complication mechanics are strictly binary: either a choice is **blocked** ($0\%$ win rate, **0/102 post-patch across 17 scenarios**) or **unblocked** ($\sim 86\%$ pooled win rate, **388/450**).
   - In live play (2026-10-05..11), the shipped runner reused `fight` in these three scenarios and lost **$2,099,543**. A clean blocked rule avoids all three losses.

2. **Severe Penalty Asymmetry on Failure (`run` is ~55% cheaper than `talk`/`fight`)**:
   - When a complication fails, the cash penalty depends heavily on the choice made, matching the server's `result_text`:
     - **`run` failure** (*"You got clear, but not cleanly. Part of the take is gone."*): **39.1% lose $0**, **31.9% lose partial take**, only **29.0% lose full take**. Mean penalty is **41.0%** of the reward.
     - **`talk` failure** (*"They didn't buy it. You gave up a cut to walk away."*): **85.9% full wipeout**. Mean penalty is **87.6%** of the reward.
     - **`fight` failure** (*"The fight cost you. You got out, but the job suffered for it."*): **90.3% full wipeout**. Mean penalty is **92.9%** of the reward.
   - Even though `talk` has a slightly higher raw win rate ($90.6\%$ vs $82.9\%$), **`run` has a lower expected loss per attempt** ($\mathbf{7.0\%}$ of reward vs $\mathbf{8.2\%}$ for `talk` and $\mathbf{16.4\%}$ for `fight`).

3. **Loss Downside is Strictly Bounded**:
   - Across all 164 losses in the archive, **no complication ever took more than 100% of the attempt reward**.
   - Bank balance was touched only twice (when cash-on-hand was under the reward amount).

4. **All Other Candidate Variables Are Completely Flat**:
   - Raw player stats, relative stat ratios, crime heat, scout weather (`env_global`), time of day, position in day, streaks (pity / anti-streak), card autofail flags, and event windows have **zero correlation** with complication outcomes.

---

## 2. Findings Ranked by Strength

### Finding 1: The Three "Weak" Scenarios Are 100% Blocked Post-Patch

In previous analyses (`verify_complication_weak_choices.py`), candidate rules switching away from $\le 50\%$ choices appeared inconclusive because before 10-05, "weak" choices seemed to win 10 of 12 times.

Inspecting timestamps relative to server changes reveals why:
- On **2026-08-11** (timestamp `1786487328612`), the game server deployed Phase One of Street Intel:
  - `comp_score` was removed (changed from visible integers 65–82 to `null`).
  - `difficulty` was permanently locked to 40 (previously 30–50).
- The first 7 complications in the archive (August 10–11) were all manual `fight` attempts with visible `comp_score` $> \text{difficulty}$, and all 7 won.
- Three of those early debug wins contaminated `SEED_RECORDS`:
  - *"Your getaway driver never showed up."*: recorded as `[1, 4]` (1 win on 08-11 with `comp_score: 66`, diff 35).
  - *"An off-duty cop recognized your face."*: recorded as `[2, 4]` (2 wins on 08-10 with `comp_score: 72, 74`, diff 40).
  - *"Police spotted you leaving the scene."*: recorded as `[1, 4]` (1 win on 08-11 with `comp_score: 73`, diff 40).

#### Post-Patch Record (August 11 onwards, $N=552$):
```
Scenario                                  Pre-Patch fight   Post-Patch fight   Post-Patch Alternatives
------------------------------------------------------------------------------------------------------
Your getaway driver never showed up.                  1/1                0/4   run 13/16, talk 8/9
An off-duty cop recognized your face.                 2/2                0/3   run  8/10, talk 6/6
Police spotted you leaving the scene.                 1/1                0/4   run 12/14, talk 4/4
------------------------------------------------------------------------------------------------------
Total                                                 4/4               0/11   Unblocked alts win 88.7%
```

Every single post-patch attempt on `fight` in these three scenarios was a complete loss (**0 for 11**, costing $3.7M over history).

#### Updated Blocked Scenario Master Table (Post-Patch, 17 Scenarios):
| # | Scenario | Choice | Post-Patch Record | Unblocked Alternatives Record |
| :-: | :--- | :---: | :---: | :--- |
| 1 | **A camera catches your face.** | `fight` | **0/4** | run 4/5, talk 8/8 |
| 2 | **A patrol car slows down beside you.** | `fight` | **0/2** | run 12/14, talk 6/6 |
| 3 | **An off-duty cop recognized your face.** | `fight` | **0/3** | run 8/10, talk 6/6 |
| 4 | **Police spotted you leaving the scene.** | `fight` | **0/4** | run 12/14, talk 4/4 |
| 5 | **Your contact is late and the area is getting hot.** | `fight` | **0/3** | run 11/13, talk 1/2 |
| 6 | **Your fake credentials are questioned.** | `fight` | **0/7** | run 13/14, talk 4/6 |
| 7 | **Your getaway driver never showed up.** | `fight` | **0/4** | run 13/16, talk 8/9 |
| 8 | **Silent alarm was tripped. Security is closing in.** | `talk` | **0/5** | fight 2/3, run 12/15 |
| 9 | **Someone triggered a silent distress signal.** | `talk` | **0/4** | fight 5/6, run 10/14 |
| 10 | **The drop site is surrounded.** | `talk` | **0/6** | fight 7/8, run 8/15 |
| 11 | **The mark had backup you didn't see coming.** | `talk` | **0/6** | fight 2/2, run 9/11 |
| 12 | **The package is booby-trapped. You need to act fast.** | `talk` | **0/9** | fight 1/1, run 12/14 |
| 13 | **The room is filling with smoke.** | `talk` | **0/5** | fight 4/4, run 17/19 |
| 14 | **The target building went into lockdown.** | `talk` | **0/8** | fight 6/6, run 7/9 |
| 15 | **You hear footsteps behind the door.** | `talk` | **0/12** | fight 3/3, run 12/13 |
| 16 | **The evidence is heavier than expected.** | `run` | **0/11** | fight 7/7, talk 4/5 |
| 17 | **The item is locked in a reinforced case.** | `run` | **0/9** | fight 5/5, talk 7/7 |

**Total Blocked Record**: **0 / 102 wins (0.0%)**. Single strongest cell: $p \approx 2 \times 10^{-10}$.

#### The Remaining 7 Scenarios:
- **`The meeting location changed last minute.`**: fight 0/1, run 13/14, talk 8/9 (fight likely blocked, 1 sample so far).
- **`The client starts panicking.`**: fight 0 tries, run 8/10, talk 6/7.
- **5 Safe Scenarios** (all tested choices win $\ge 70\%$):
  - *A rival crew followed you and wants a cut.* (fight 4/4, run 8/12, talk 6/7)
  - *A rival informant recognizes you.* (fight 3/3, run 16/17, talk 4/4)
  - *A security guard asks to check your bag.* (fight 5/5, run 11/13, talk 7/7)
  - *A witness is threatening to call the cops.* (fight 6/6, run 9/9, talk 4/5)
  - *The informant demands more money.* (fight 3/3, run 13/16, talk 4/4)

#### Chronological Replay & Valuation:
- **Live Period (2026-10-05 .. 2026-10-11, $N=80$)**:
  - Actual choices made: lost **$3.12M**.
  - Shipped `avoidBlocked`: lost **$3.12M** (reused `fight` 3 times on the contaminated scenarios).
  - Clean `avoidBlocked` (17 scenarios): expected loss **$1.18M** (**saves $1.94M**, avoiding all 3 costly wipeouts).
- **Full History Replay (from zero knowledge, $N=552$)**:
  - Reuse default: **$35.07M**.
  - Actual choices: **$33.82M**.
  - Clean `avoidBlocked`: **$10.30M** (**cuts losses by $24.77M**).

---

### Finding 2: Failure Penalty Asymmetry & Expected Value of `run`

When complications fail, the cash loss is not uniformly distributed:

```
Choice     Failures   $0 Penalty    Partial Penalty   Full Wipeout (100%)   Mean Loss Ratio
--------------------------------------------------------------------------------------------
run              69   27 (39.1%)         22 (31.9%)            20 (29.0%)             41.0%
talk             64    6 ( 9.4%)          3 ( 4.7%)            55 (85.9%)             87.6%
fight            31    1 ( 3.2%)          2 ( 6.5%)            28 (90.3%)             92.9%
```

#### Flavor Text Correlation:
- `run`: *"You got clear, but not cleanly. Part of the take is gone."* $\to$ 71.0% of failures preserve all or part of the reward.
- `talk`: *"They didn't buy it. You gave up a cut to walk away."* $\to$ 85.9% wipe out 100% of the take.
- `fight`: *"The fight cost you. You got out, but the job suffered for it."* $\to$ 90.3% wipe out 100% of the take.

#### Expected Loss Ratio Formula:
$$\mathbb{E}[\text{Loss Ratio}] = (1 - P(\text{win})) \times \mathbb{E}[\text{Penalty} \mid \text{failure}]$$

Plugging in empirical win rates and mean penalty ratios for unblocked choices:
- **`run`**: $(1 - 0.829) \times 0.410 = \mathbf{7.01\% \text{ of reward}}$
- **`talk`**: $(1 - 0.906) \times 0.876 = \mathbf{8.24\% \text{ of reward}}$
- **`fight`**: $(1 - 0.824) \times 0.929 = \mathbf{16.36\% \text{ of reward}}$

**Decision Rule Takeaway**: Whenever both `run` and `talk` are unblocked (or when selecting a fallback for `steel_yourself`), **`run` has higher expected value (lower expected loss)** than `talk` or `fight`.

---

## 3. Tested Hypotheses That Turned Out Flat

All of the following were evaluated on unblocked complications ($N=450$, pooled win rate $86.2\%$):

| Variable Tested | Hypothesis | Observed Result | Statistical Test | Conclusion |
| :--- | :--- | :--- | :--- | :--- |
| **Raw Stat Levels** | Higher Strength/Agility/Dexterity increases win rate | Wins: mean $68.1$, Losses: mean $65.7$ | Welch $t=0.844$, $p=0.3988$ | **Flat**. No stat scaling above baseline. |
| **Relative Stats** | Higher stat relative to account max increases odds | Wins: $0.767$, Losses: $0.778$ | Welch $t=-0.804$, $p=0.4215$ | **Flat**. No relative stat benefit. |
| **Crime Heat** | High heat triggers harder police complications | Heat 0–20: $87.1\%$, Heat 81–100: $87.5\%$ | Welch $t=-0.511$, $p=0.6094$ | **Flat**. Heat affects attempt success, not complications. |
| **Env Global** | Weather/district modifiers affect complication rolls | Wins: mean $-0.52$, Losses: mean $+0.36$ | Welch $t=-0.821$, $p=0.4117$ | **Flat**. Scout weather does not alter complications. |
| **Card Autofail** | Cards with approach autofail leak into complications | Autofail card: $87.5\%$, Non-autofail: $86.1\%$ | Fisher exact $p=0.85$ | **Flat**. Card autofails do not carry over. |
| **Daily Fatigue** | More complications in a day causes diminishing odds | Index 1–5: $87.4\%$, Index 11–20: $85.4\%$ | Welch $t=-0.141$, $p=0.8876$ | **Flat**. No daily fatigue mechanic. |
| **Streaks / Pity** | Losses trigger pity wins; win streaks trigger losses | Win rate immediately after a loss: $88.9\%$ | Baseline $86.2\%$ ($p=0.58$) | **Flat**. Independent Bernoulli trials. |
| **Halloween Event** | 2026-10-01 event altered complication difficulty | Baseline: $88.0\%$, Halloween: $84.5\%$ | Two-prop $z=0.85$, $p=0.39$ | **Flat**. No event difficulty change. |
| **Attempt Anomaly** | 09-21..30 attempt failure anomaly hit complications | Baseline: $88.0\%$, Anomaly window: $81.2\%$ | Two-prop $z=1.34$, $p=0.18$ | **Flat**. Complications stayed at normal baseline. |

---

## 4. `stand_ground` (Defence) Analysis

### What the Code Reveals
The game's HTML in `panel.php?type=street_intel` builds choices as follows:
```javascript
h += '<div class=si-comp-choice data-choice=fight><div class=ch-copy><div class=ch-name>Fight Your Way Out</div><div class=ch-stat>Uses Strength</div></div><div class=ch-icon><i class="fa-solid fa-fist-raised"></i></div></div>';
if (window.SI_V2) {
    h += '<div class=si-comp-choice data-choice=stand_ground><div class=ch-copy><div class=ch-name>Stand Your Ground</div><div class=ch-stat>Uses Defence</div></div><div class=ch-icon><i class="fa-solid fa-shield-halved"></i></div></div>';
}
h += '<div class=si-comp-choice data-choice=run><div class=ch-copy><div class=ch-name>Run For It</div><div class=ch-stat>Uses Agility</div></div><div class=ch-icon><i class="fa-solid fa-person-running"></i></div></div>';
h += '<div class=si-comp-choice data-choice=talk><div class=ch-copy><div class=ch-name>Talk Your Way Out</div><div class=ch-stat>Uses Dexterity</div></div><div class=ch-icon><i class="fa-solid fa-comments"></i></div></div>';
```
- `window.SI_V2` is hardcoded to `true` on every panel response since Phase One (August 11).
- **`stand_ground` is offered on every complication**, not only after `steel_yourself`.
- The extension's TypeScript types (`ComplicationChoiceKey = 'fight' | 'run' | 'talk'`) and auto-runner omit it completely.

### Historical Performance
- Played once manually on 2026-08-29 on *"The evidence is heavier than expected."* (where `run` is 0/11 blocked).
- Outcome: Won clean ($comp\_success = true$), result text: *"You held firm and let it pass. They moved on."*

### Low-Risk Data Gathering Protocol
Because complication loss cannot exceed the opportunity's reward:
1. Target **Low Risk** opportunities (or cards with reward $< \$25,000$).
2. On Low Risk cards, median loss on failure is only **$30,586**.
3. A sample of $n = 15$ trials on low-reward cards caps worst-case counterfactual loss at $< \$90,000$, cheaply proving whether `stand_ground` operates at the $\sim 85\%$ baseline or whether specific scenarios block Defence.

---

## 5. Verification Scripts & How to Re-Run

All scripts are standalone, use standard-library Python 3, take `--archive` arguments, and live in `verification/street-intel/`:

1. **Post-Patch Blocked Choices & Replay**:
   ```bash
   python3 verification/street-intel/verify_complication_post_patch_blocked.py
   ```
   *Verifies the August 11 Phase One boundary, shows that `fight` is 0/11 post-patch across the 3 controversial scenarios, confirms 17 blocked scenarios, and prices the clean replay.*

2. **Choice Penalty Asymmetry**:
   ```bash
   python3 verification/street-intel/verify_complication_loss_penalty.py
   ```
   *Calculates failure loss distributions ($0 vs partial vs full loss), result texts, and expected loss ratio per choice.*

3. **Flat Predictor Verification**:
   ```bash
   python3 verification/street-intel/verify_complication_predictors.py
   ```
   *Runs Welch t-tests and contingency analyses on player stats, relative stats, crime heat, weather, streaks, and card autofail.*
