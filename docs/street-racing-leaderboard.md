# Street Racing — Street Kings leaderboard & weather

How the V2 Street Racing leaderboard ("Street Kings") ranks players, how its
**Avg** speed column is calculated, and the weather schedule that drives it.
Derived 2026-09-24 from every archive export on hand (2026-08-11 → 2026-09-24:
309 `attempt_race` results, 209 `get_all` snapshots). Re-check with
[`verification/street-racing/verify_leaderboard_speed.py`](../verification/street-racing/verify_leaderboard_speed.py).

---

## TL;DR

```
race_speed = round2( effective_top_speed × (0.7 + 0.3 × accuracy / 100) )
avg_speed  = round1( mean(race_speed over today's board-day races) )     // half-up
rank       = total_wins DESC, then avg_speed DESC
```

- **Weather is the biggest speed lever**, and it only changes at **11:00 and
  23:00 UTC**. Between the best and worst weather the gap is ~27%. Between
  accuracy 85 and 97 the gap is ~3.6%.
- **Wins beat speed.** Speed only breaks ties between players on the same
  number of wins.

---

## Where the data comes from

`GET /actions/races_v2.php?action=get_all` returns:

| Field | Meaning |
|---|---|
| `leaderboard[]` | Top 10: `{id, username, total_wins, best_streak, avg_speed}` |
| `you_id` | Your user id (the board highlights your row with it) |
| `weather`, `weather_pct` | Current global weather and its stat modifier |
| `car.derived` | Your equipped car's `top_speed` / `handling` / `acceleration` (before weather) |

The panel (`panel.php?type=racing`) renders it as "Street Kings · Top 10
racers · V2 preview · Pays daily at midnight". Payouts by rank are $5M, 3M,
2M, 1.5M, 1M, 750k, 500k, 400k, 300k, 250k. The panel's own source comment
explains why the Avg column exists: with a fixed number of attempts per day
everyone caps out on wins, so speed separates them.

The board is **not** on the main Leaderboards panel (`panel.php?type=leaderboards`).

---

## The avg_speed formula

Each `attempt_race` response carries everything needed:

```json
"accuracy": 93,
"player_stats":           {"top_speed": 275, ...},   // car, before weather
"player_stats_effective": {"top_speed": 289, ...},   // after weather, rounded to int
"weather": "overcast", "weather_pct": 5
```

1. **Effective top speed** = `round(car_top_speed × (1 + weather_pct/100))`,
   an integer (half-up: 275 × 0.9 = 247.5 → 248, 275 × 1.1 = 302.5 → 303).
   The formula uses this **rounded integer**. Using the unrounded 288.75
   fails on every snapshot.
2. **Race speed** = `effective_top_speed × (0.7 + 0.3 × accuracy/100)`,
   stored at **2 decimals**. Accuracy 50 scores 85% of top speed and
   accuracy 100 scores 100%. It's the same `accuracy` that drives
   `accuracy_adj` (`(accuracy − 50) / 10`).
3. **avg_speed** = the mean of those race speeds for the current board day,
   shown **half-up to 1 decimal** (221.85 → 221.9).

Handling, acceleration, the opponent, which race it is, and the win roll
have **no effect** on the score.

### Evidence

- 41 distinct snapshots of the account's own row, 2026-09-11 → 09-23, across
  four weathers (248 / 261 / 289 / 303) and accuracy 50–97. All match to the
  0.1, apart from the losses question below.
- The clearest day is 2026-09-15: the car was at 289 all day, and the first
  race was at accuracy 82 → board shows **273.4** (289 × 0.946). Fifteen
  more races at accuracy 50 (289 × 0.85 = 245.65 each) walk it down through
  254.9, 252.6, 249.6 … **247.4**, exactly as predicted at every step.
- **2-decimal per-race storage**: on 2026-09-20 23:08, four races at
  accuracies 93/94/85/95 have an exact mean of 281.847, which would show as
  281.8. The board showed **281.9**. Rounding each race to 2 dp first
  (282.93 / 283.80 / 276.00 / 284.67) gives 281.85 → 281.9. Rounding per
  race to 1 dp instead breaks the 09-15 snapshots, and not rounding at all
  breaks 09-20. That suggests a `DECIMAL(…,2)` column averaged with
  `ROUND(AVG(…),1)`.

### Speed table (Zenith One, car top speed 275)

| Weather | pct | Eff. top | acc 85 | acc 90 | acc 93 | acc 97 | acc 100 |
|---|---|---|---|---|---|---|---|
| Clear | +15% | 316 | 301.8 | 306.5 | 309.4 | 313.2 | 316.0 |
| Sunny | +10% | 303 | 289.4 | 293.9 | 296.6 | 300.3 | 303.0 |
| Overcast | +5% | 289 | 276.0 | 280.3 | 282.9 | 286.4 | 289.0 |
| Rainy | −5% | 261 | 249.3 | 253.2 | 255.5 | 258.7 | 261.0 |
| Snowy | −10% | 248 | 236.8 | 240.6 | 242.8 | 245.8 | 248.0 |

Moving up one weather band is worth more than any realistic change in
accuracy.

---

## Weather schedule

**Weather is global and changes only at 11:00 UTC and 23:00 UTC** (noon and
midnight WAT). Each board day (23:00 → 23:00 UTC) therefore has exactly
**two weather slots**:

| Slot | UTC | WAT |
|---|---|---|
| A | 23:00 → 11:00 | 00:00 → 12:00 |
| B | 11:00 → 23:00 | 12:00 → 00:00 |

Evidence: every weather observation (`get_all`, `can_race` and `attempt_race`
all return `weather`) was bucketed into 12-hour slots on those boundaries.
Over 50 slots there were **0 conflicts** (no slot ever showed two weathers).
Several changes are bracketed tightly: 09-14 10:24 → 11:04, 09-15 22:49 →
23:01, 09-22 22:30 → 23:02, 09-23 22:21 → 23:04. The same weather can repeat
in consecutive slots (6 of 24 observed adjacent pairs).

Nothing in the API or panel exposes a forecast or the next change time.

**Observed frequency (50 slots):** rainy 14, clear 11, overcast 11,
sunny 9, snowy 5. The mean modifier across slots is about **+3.8%**.

### What that means for racing

All of a day's races score the same way, so the whole day should be run in
whichever slot has the better weather. The game gives no forecast, but the
slot frequency above suggests:

- **Slot A is clear / sunny / overcast (+5% or better):** race now. Overcast
  (+5%) already beats the ~+3.8% you'd expect from slot B.
- **Slot A is rainy / snowy:** waiting for slot B at 11:00 UTC is expected to
  gain ~+9–14% top speed (~+22–34 points on the average). You risk landing
  on another bad slot, but by frequency that's rarely worse.

All races must finish before 23:00 UTC. That's both the payout and the
reset, so a slot-B run can't be pushed past it.

The automation currently races right after the 23:00 reset, i.e. always
slot A. There is no forecast, so waiting for slot B is a bet on the slot
frequencies above, not a prediction. It hasn't been automated.

---

## Ranking: wins first

The board sorts by `total_wins` (today) descending, then by `avg_speed`
descending (confirmed in every snapshot, e.g. 2026-09-24: 25, 24, 22/284.9,
22/283.3, 22/281.9, 19/285.5, 19/285.0, 19/283.7, 19/282.9, 19/282.3).

**Maximum wins per day** = 3 × each unlocked district race + 1 for your own
family's challenge. As of 2026-09-24 the account has districts 1–6 unlocked
plus Iron River Gauntlet, so the cap is **19**. Players showing 22–25 have
more districts unlocked:

- **Districts 7–10** (Carats and Curves, Skyline Sprint, Tidewater Dash,
  First Light) are gated behind beating the boss **Mara "Mother Ledger"
  Voss**. That's **+12 wins/day**, enough to clear the 19-win tie group
  entirely whatever the speed. Base odds with the current car: 100 / 100 /
  100 / 86%.
- The other four family challenges (races 12–15) show as `unlocked` with 1
  attempt each, but the client disables them ("Not Your Family") unless
  `allegiance` matches that family. They aren't available as extra wins.

---

## Car ceiling

Top speed comes entirely from fitted parts (Chop Shop V2: engine,
transmission, tires, suspension, and a clutch that the API calls
`aerodynamics`). Every model splits its top speed the same way: **engine
45%, clutch 40%, transmission 15%**. Tires and suspension add none. Mixing
parts from a faster model into a slower one can lift the slower one above
its stock speed (e.g. a 78 Redline Compact fitted to 82.35). For that same
reason, though, the fastest model's own parts are the best in every slot.

The **Zenith One (275)** is the fastest car in the dealer. The equipped one
is complete (5/5 parts, 275) and at 100 durability, so **car top speed is
already maxed**. A 285.9 on an overcast day (the 2026-09-24 leader) is
consistent with the same car at ~96–97 average accuracy.

---

## Open question: do losses count toward avg_speed?

`total_wins` counts wins only, but only two days so far have a loss whose
speed differs from that day's wins, and they disagree:

| Day | Loss | Losses excluded | Losses included | Board |
|---|---|---|---|---|
| 2026-09-11 | race 12 (family), acc 90 | **236.2** ✓ | 236.8 | 236.2 |
| 2026-09-20 | 2 × race 6 (district), acc 74 / 89 | 253.5 | **252.8** ✓ | 252.8 |

Either family-race losses are excluded but district-race losses count, or the
rule changed between the two dates. Every other loss on record was at
accuracy 50 at the same speed as that day's wins, so it can't tell the
hypotheses apart. To settle it, check the board after a loss (district and
family) at an accuracy well away from that day's other races. The
verification script prints both hypotheses side by side.

---

## Related: the run_token incident shows up here too

From 2026-09-14 ~23:00 to 2026-09-17, automated races were sent without
`can_race`'s `run_token` (fixed in `9f4714d`, 2026-09-18). The server
silently treated each one as accuracy 50 (see `CLAUDE.md`). On this board
that meant every race scored 85% of top speed. Those are the flat **221.9**
days (261 × 0.85) and the 247.4 day, far below what the same weather
would have scored at the automation's normal accuracy.

## Automation accuracy (2026-09-24)

To compete on the speed tiebreak, the automation's accuracy was raised from
mean 93 / range 85–97 (realized ~92.7) to **mean 96.5 / stddev 1.5 / range
92–99** (realized ~96.5, ~285.9 on an overcast day). Hard races were raised
to mean 97. The ceiling went above the account's manual all-time high of 97
because other players' averages prove the game accepts, and players reach,
accuracy above 97. Taking the fastest dealer car and the best weather
available that day, TheCouchPotato needed ≥97.1 average over 19 wins, and
ZeeZee averaged exactly 248.0 over 10 wins in snow (accuracy 100 on every
race). See `STREET_RACING_ACCURACY_*` in `src/shared/constants.ts`.
