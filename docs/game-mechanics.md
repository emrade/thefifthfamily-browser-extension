# Arena Combat — Round-by-Round Dice, Not a Fixed Script

Measured 2026-09-17 against real `POST /actions/arena_v2.php` captures, including one
full round-by-round combat log for a loss and confirmed `win_pct` values for both a
regular opponent and (see below) the boss.

## `win_pct` is *not* a real probability (corrected 2026-09-24)

> **Superseded.** This section originally said `win_pct` "already is the answer
> to what are my real odds" and that there was nothing to predict. 184 real
> fights disprove that: `win_pct` is a curve on the opponent's Combat Power
> alone (`≈ 249 − 24.6·ln(CP)`), so it ignores *which* stat is high. Every
> boss is quoted 37–47% yet bosses won 21/24, and regular opponents act on a
> blunt ~50% cut-off. A kill-race score from the card's STR and level calls
> 160/184 fights. See **[arena-combat-mechanics.md](./arena-combat-mechanics.md)**.

Every regular opponent's card shows its own "N% CHANCE". The boss's card never
renders one, but `open_next_page`'s `boss_data.win_pct` carries it anyway.

## A single fight is genuinely random — `win_pct` is not a guarantee

A real captured loss, round by round, shows both fighters rolling independently against
their own dodge/crit/block chances *every round*:

```
round 1 → attacker: dodge_chance 6,  dodge_roll 14  → no dodge
                     crit_chance  8,  crit_roll  47  → no crit
                     block_chance 9,  block_roll 56  → no block
          defender:  dodge_chance 5.5, dodge_roll 78 → no dodge
                      block_chance 10.5, block_roll 24 → no block
```

Even the base damage per hit isn't fixed for a given weapon/stat pairing — the same
account, same weapon, same opponent produced `base_dmg` values of 322, 256, 289, 305,
307, 261, 322 (that one a crit)... across consecutive rounds of the *same* fight. The
fight resolved over 19 rounds of this compounding independently, ending 0 HP to 221.

**Consequence:** no single fight is certain, but the dice matter less than they
look. Over a fight's 2–35 rounds they mostly average out, so the stat matchup
decides most results; about 10% of fights are genuine coin-flips (see
[arena-combat-mechanics.md](./arena-combat-mechanics.md)). There is no pre-roll or seed exposed anywhere the client (or this extension)
can read before committing to an attack; the dice are rolled server-side at the moment
of the `attack` call itself.

## Total combat power hides *how* it's distributed — and that's what decides fights

Two opponents with near-identical combat power can be very different matchups, because
damage reduction is driven by the opponent's own DEF specifically (see the `reduction`
field subtracted from `base_dmg` in the round log above), not a general "power" scalar:

| | Combat Power | STR | DEF | AGI | DEX | Win% |
|---|---|---|---|---|---|---|
| Regular opponent, defeated | 2,932 | 576 | 627 | 466 | 567 | 48% |
| Boss, same page | 2,916 | 627 | **1,063** | **271** | **355** | **43%** |

Nearly identical totals, but the boss put almost everything into DEF at the cost of
AGI/DEX — making it the *harder* matchup despite matching power, not an equal one. A
"combat power comparison" heuristic (e.g. "I beat someone with slightly more CP, so I'm
favored here too") reliably undersells risk in exactly this shape. (`win_pct` has
the same blind spot, since it's derived from Combat Power; see
[arena-combat-mechanics.md](./arena-combat-mechanics.md). That boss was later found
to be an easy win: DEF only matters when your base damage exceeds it.)

## The player's own combat power is also already computed, not something to estimate

`preview_loadout` (an `arena_v2.php` action) returns the account's exact Arena-locked
`fighting_stats` (strength/defence/agility/dexterity) — confirmed matching the Gym
page's own HUD numbers exactly (554/563/435/522 on the account this was measured
against). These are **frozen for the whole season** the moment it starts — the response
says so directly: *"This is what you fight with — for both attack and defence — until
the season ends. Changing your gear, perks, family, career, or anything else outside
Arena has no effect here."* Gear changed mid-season doesn't touch Arena combat at all.

`preview_loadout`'s own `bonuses` array (50+ entries on the account measured — Bloodline
traits, Career V2, Estate, Family, Pets, V2 Vigilantes) is the full breakdown of *where*
those frozen stats come from. Informative for a player wondering why their numbers are
what they are, but doesn't change any decision on its own — `fighting_stats` already
sums all of it.

## What Agility and Dexterity actually do — the game explains it, on the Gym page

The Arena page itself never says which stat drives which combat roll — only the round
log's raw `dodge_chance`/`crit_chance`/`block_chance` numbers (above). **The Iron Fist
Gym page (`panel.php?type=gym`) does explain it directly**, in its own copy, with a
full tier table. Confirmed from a real captured `type=gym` response:

One stat, one roll, each with its own 12-tier progression (stat total → chance):

| Stat | Combat roll | T1 | T2 | T3 | T4 | ... | T12 |
|---|---|---|---|---|---|---|---|
| Defence | **Block** | 0 → 0% | 364 → 5% | 800 → 10% | 1,334 → 15% | ... | 44,000 → 55% |
| Agility | **Dodge** | 0 → 0% | 455 → 5% | 1,000 → 10% | 1,667 → 15% | ... | 55,000 → 55% |
| Dexterity | **Critical** | 0 → 0% | 318 → 5% | 700 → 10% | 1,167 → 15% | ... | 38,500 → 55% |

The page renders this table (all 12 tiers) but keeps it collapsed behind a toggle by
default — it's real server-sent copy, not something this extension infers.

Two more effects are layered on top of Agility/Dexterity specifically, each in its own
callout box on the same page:

- **First-Strike (Agility)** — *"Higher agility than your opponent grants up to 30%
  chance for a free pre-round jab."*
- **Critical Damage (Dexterity)** — *"Base critical 1.3x. +0.10x per 100 dex over
  opponent (max 2.5x)."*

Strength does two things of its own, shown alongside these (not Agility/Dexterity, but
relevant to the same "what does each stat do" question):

- **DEF Penetration** — `STR ÷ 1000`, capped at 25% (Family/Bloodline cap-breakers raise
  it) — strips that share off the target's DEF *before* damage reduction is applied.
- **DEF Efficiency** — a separate multiplier on whatever DEF survives penetration, not
  stat-derived (Career V2 ranks, Bloodline, Estate, FRS) — pays off most against
  high-STR opponents specifically because it applies after they've already penetrated.

**Not yet reverse-engineered: the interpolation between tiers.** The account measured
here sat at 563 Defence (between T2's 364→5% and T3's 800→10%) and the page showed 8%
Block live — not a hard step at the tier boundary, so *some* smooth function connects
consecutive tiers rather than a flat step function. The exact formula is unconfirmed;
Not chased further: dodge/block/crit only move fights by a few percent (see
[arena-combat-mechanics.md](./arena-combat-mechanics.md)).

---

# Smuggling Mechanics — Measured

Rules recovered from this account's own captured data, not from the community guide.
Everything here is reproducible from a Settings → Export dump; each entry states its
sample size and how to re-derive it, so a future reader can re-run the measurement
rather than trusting a number written down once.

Measured 2026-08-08 against an export spanning 2026-07-22 → 2026-08-08
(200 trades, 9,135 price snapshots, 69 customs events, 1,467 risk observations).

> This file supersedes the community-guide formulas recorded under "What We Know" in
> [trade-assistant-plan.md](./trade-assistant-plan.md). Where the two disagree, this one
> is measured and that one is a prior. Mechanics are documented **here only** — the plan
> doc points at this file rather than repeating it.

---

## Border seizure risk — linear in cargo fullness

```
riskPct = 4.9638 + 0.4477 × fullnessPct
```

Fitted by least squares over 1,467 observations; **R² = 0.9998**. Every fullness level
the game has ever displayed returns a single risk value with zero spread:

| Fullness | Displayed risk |
|---|---|
| 0% | 5% |
| 64.52% (20/31) | 34% |
| 83.33% | 42% |
| 91.67% | 46% |
| 95.65% | 48% |
| 100% | 50% |

Residuals are entirely explained by the game flooring what it prints (83.3% full is
42.5%, shown as "42%"). Read as exact, the rule is `5 + 45 × fullness`.

**This corrects the community guide**, which claims `5% + fullness × 0.6` capped at 95%
and predicts 65% at a full hold. The real slope is 0.45 and the ceiling is 50%. The plan
doc's puzzle — "50% at 22/22 where the formula predicts 65%" — dissolves: fullness is
measured against **effective capacity**, and the slope was simply wrong. No hard-cap
denominator is needed to explain it.

Encoded in `src/shared/analytics/riskModel.ts` as a fit, deliberately not as constants,
so a game-side change corrects itself.

## Bribe — exactly 25% of cargo purchase value

```
bribe = 0.25 × quantity × unitBuyPrice
```

69 of 69 recorded stops, ratio min = max = **0.250000**, across cargo values from
$60,000 to $176,000 and quantities 20/22/24/31. Zero variance — this is a game rule, not
a distribution.

Two consequences that drive the whole strategy:

- Per unit, a stop costs a flat `0.25 × unitCost` no matter how much you carry. Each
  extra unit therefore still nets `margin − 0.25 × unitCost` **even when raided** —
  positive whenever markup clears 25%.
- Averaging past bribe *amounts* is wrong; the rate is what generalises. Doing otherwise
  charged a cheap load and an expensive one the same toll (fixed in 0.9.3).

Encoded in `src/shared/analytics/bribeModel.ts`, measured from events with `0.25` as the
no-history fallback.

## Sell price multiplier — account-specific, and it changes

```
realisedUnitPrice = cardPrice × multiplier
```

The price on the card is **not** what you receive. Across all 200 trades the ratio of
realised to card price is a clean constant that stepped once:

| Period | Multiplier | Trades |
|---|---|---|
| → 2026-08-07 11:40 | **1.17** | 186 |
| 2026-08-07 11:40 → | **1.32** | 11 |

(Trade #80 reads 1.00 and #3 reads 1.165; both predate reliable snapshot coverage.)

The step is almost certainly a perk or upgrade. **Treat this as account state, not a
game constant** — it has already moved once and will move again.

At 1.32, a card reading of 0% is already a **+32% gross markup**:

```
grossMarkup = multiplier × (1 + cardPct) − 1
```

> **Known gap:** nothing in the extension models this. `bestTrade.ts` computes profit
> from raw card prices, so every figure it shows is understated by the multiplier
> (~32% currently). Item *rankings* are unaffected since it scales everything equally.
> Deriving it from trade history the way the bribe rate is derived would close this.

## Market cadence and price band

- Sell prices shift **server-wide on wall-clock 10-minute boundaries**. The poller
  aligns to the panel's own `data-seconds` countdown and fires at `marketShiftAt + 5s`
  (`MARKET_POLL_BUFFER_MS`), which is why snapshot timestamps land on `:00:05`, `:10:06`.
- Within a window the price is fixed; repeated captures return the same value.
- The card's `(±X%) vs wholesale` is exactly `price ÷ wholesaleBase − 1`, where
  wholesaleBase is the item's origin-district buy price. **It is not your profit
  margin** — apply the multiplier above.
- Observed band: **−15% to +43%**, i.e. `0.85× – 1.43×` wholesale. This **confirms the
  community guide's stated band exactly.**
- That also resolves the "internal inconsistency" the plan doc flags in the guide's
  tables: Stolen Artwork's "Best Sell" of $11,440 is simply `1.43 × 8,000`, the top of
  its band — and $11,440 appears verbatim in our own captures. The guide's *Market
  Range* column was truncated, its Best Sell figure was right.

Wholesale bases confirmed against real captures: Counterfeit Passports $3,000,
Uncut Diamonds $5,000, Stolen Artwork $8,000.

### Consecutive windows are independent

Lag-1 correlation across 3,036 consecutive-window pairs: **r = +0.0069**. Conditioning
changes nothing — after a print below 10%, the next window clears 10% with probability
57.2%, against 57.8% unconditionally.

A bad price carries no information about the next one. Waiting is a fixed-odds coin
flip every 10 minutes, never a trend to ride out.

Distribution over 4,884 window-observations (median 14%, p25 −1%, p75 29%, max 43%):

| Card % | Frequency |
|---|---|
| ≥ 0% | 74.4% |
| ≥ 10% | 57.8% |
| ≥ 20% | 41.4% |
| ≥ 30% | 24.3% |
| ≥ 40% | 6.5% |

Sampling covers 12.1% of possible windows but is unbiased: the schedule-driven poller
sample (n=3,054, median 15%) and player-initiated views (n=2,784, median 14%) have
matching distributions.

## Cargo capacity

Currently **31** on this account. The community guide's claimed "hard cap 26 absolute"
is **wrong** — or at least no longer current. Always read capacity from
`ff_last_smuggling_context.cargoCapacity`; never assume a ceiling.

---

## Operating thresholds

Derived from the rules above. All are in **card %**, and all assume a full 31-unit hold.
They shift if the multiplier changes, so re-derive after any upgrade.

| Threshold | Meaning |
|---|---|
| **−2.5%** (diamonds), **−3.5%** (artwork) | Break-even *after* paying a bribe. Below this a bribed trip books a real loss. |
| **−21%** | Break-even on a clean run. |
| **~10%** | Maximises profit *per hour*. See below. |

Quantity, in **gross markup** (not card %):

| Threshold | Meaning |
|---|---|
| **19.7%** | Above this, a full hold beats carrying 20. What `bestTrade.ts` optimises. |
| **25%** | Above this, every extra unit pays even when raided. |
| **70.5%** | Above this, a raided full hold beats a clean 20. |

### Sell sooner than instinct suggests

Because the multiplier makes even a 0% card profitable, the binding constraint is time,
not price. Holding out costs 10-minute cycles at fixed odds:

| Card floor | Frequency | Avg wait | EV/hour (31 diamonds) |
|---|---|---|---|
| 0% | 74.4% | 3m | $267,001 |
| **10%** | 57.8% | 7m | **$245,070** |
| 20% | 41.4% | 14m | $203,270 |
| 30% | 24.3% | 31m | $136,936 |
| 40% | 6.5% | 145m | $41,830 |

A 40% floor earns ~30% more per trade and takes 20× longer. Ranking holds across fixed
trip overheads from 6 to 30 minutes.

### A paid bribe must not change the threshold

It is sunk the moment it's paid: identical whether you sell now or in three hours. Both
terms of the decision — what a better price gains, what waiting costs — are free of it.
Holding out to "earn the bribe back" recovers nothing and forfeits the time. Sell at the
same floor either way; the only number that changes is what you pocket.
