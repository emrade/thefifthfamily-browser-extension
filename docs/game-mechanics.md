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
