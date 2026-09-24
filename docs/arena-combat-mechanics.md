# Arena V2 — combat mechanics & predicting fights

How Arena V2 fights are actually decided, why the page's "% CHANCE" badge is
misleading, and a rule that predicts wins from what the opponent card already
shows. Derived 2026-09-24 from every archive export on hand: **179 real V2
fights** (156 regular opponents, 23 bosses, 2026-09-09 → 09-24), each with its
full round-by-round combat log. Re-check with
[`verification/arena/verify_combat_rule.py`](../verification/arena/verify_combat_rule.py).
The earlier boss-only check is `verification/arena/verify_boss_odds.py`.

---

## TL;DR

- The **% CHANCE badge is just the opponent's Combat Power** on a log curve
  (`≈ 249 − 24.5·ln(CP)`, within ±2). CP is roughly the sum of the four
  stats, but the stats don't matter equally in a fight.
- A fight is a **race between damage and HP**. What matters is the
  opponent's **STR** (how hard they hit) against their **level** (their HP).
  DEF only matters when it's low; AGI and DEX barely matter.
- The **kill-race score** below calls **155/179** fights correctly. Quoted
  ≥ 50% gets 138/179. Score ≥ 1.2 has won **81/81**; score < 0.8 has won
  **1/39**.
- **Bosses:** family decides it. Iron River bosses are built on STR and
  caused every boss loss. Kito-gumi, Viola, SBP and Volkskaya bosses have
  won **18/18** at quoted odds of 37–46%.
- **Passive** opponents fight weaker than their card shows; **active** ones
  stronger.
- About **10% of fights are genuine coin-flips**. Even a simulator fed each
  fight's real in-fight numbers only calls 159/179.

---

## Where the data comes from

| Source | What it gives |
|---|---|
| `GET panel.php?type=arena&arena_tab=v2&av2_view=arena` | Opponent cards (HTML): name, level, rank, bounty, **% CHANCE**, **Passive** tag, **Combat Power**, **STR / DEF / AGI / DEX**; the boss card; your locked loadout and every locked bonus |
| `POST arena_v2.php action=open_next_page` | `opponent_bounties{id: win_pct, bounty, threat_ratio, tier, …}` and full `boss_data` (family, tier, level, `snapshot_*` stats, gear, `combat_power`, `win_pct`) |
| `POST arena_v2.php action=attack` | Result plus the full combat log: `rounds[]` with per-hit `base_dmg`, `reduction`, `min_dmg`, `damage`, dodge / crit / block chances and rolls, crit / block multipliers, first strikes; both sides' max HP, level, gear |

Your own loadout is **locked for the season** (7 days). It's re-captured
from your current gear at your first attack of the week, so your side of
every fight is fixed all week.

---

## How a fight works

Each round, either side may get a **first strike** (a "snap shot" at about
half base damage; chance based on AGI). Then you hit, then they hit. Fights
always go to the death: 2–35 rounds observed, and the loser is always at
0 HP.

### Damage per hit

1. **Base damage** is rolled around the attacker's mean (about 0.86–1.17×).
2. **If base > the defender's reduction:** damage ≈ `base − reduction`.
3. **Otherwise** damage is a random **minimum damage** drawn from 5 steps at
   about 5%, 7%, 9%, 10.5% and 12% of the attacker's mean base (mean
   **~8.8%**). For you right now that's 21 / 28 / 35 / 42 / 49.
4. **Dodge** → 0. **Block** → × **0.2**. **Crit** → × 1.3–1.5 (usually 1.35).
   Each happens when its roll is below the stated chance (dodge 99.6%,
   block 99.4%, crit 98.5% of logged hits).

**95% of all hits (5,134 of 5,404) fall in case 3.** Reduction is
usually far above base damage, so most fights are minimum-damage against
minimum-damage. Whoever has the higher base damage relative to the other
side's HP wins. That's why STR (base damage) and level (HP) decide nearly
everything.

### Card stats → combat numbers

| Card | Combat value | Regular | Boss |
|---|---|---|---|
| STR | mean base damage | `0.54·STR − 11` (r 0.98) | `0.435·STR + 21` (r 0.995) |
| DEF | reduction | `1.15·DEF − 49` (r 0.98) | `≈ DEF` (r 1.00) |
| Level | max HP | `7.19·level − 49` (r 0.91, ±44) | `95 + 5·level` (exact; 625 at lvl 106) |
| AGI | chance to dodge your hits | ≈ `0.6 + 0.010·AGI` % | ≈ `0.7 + 0.009·AGI` % |
| DEX | their crit chance | ≈ `0.7 + 0.014·DEX` % | ≈ `2.0 + 0.011·DEX` % |

A high-AGI or high-DEX opponent adds only a few percentage points of dodge
or crit, but inflates Combat Power, and so the badge, just as much as STR.

### Your side (week 39 locked loadout)

| | Value |
|---|---|
| Max HP | 737 |
| Mean base damage | ~419 |
| Reduction (your armour) | ~773 (varies slightly by opponent, 750–777) |
| Minimum damage | 21–49, mean ~37 |

With 773 reduction, only regular opponents with **STR ≳ 1,450** (bosses
**STR ≳ 1,730**) can hit past your armour for big damage. Your ~419 base
damage gets past anyone with **DEF ≲ 400** (regular) and tears through
DEF < ~350 (e.g. DEF 206 died in 3 rounds, DEF 124 in 2).

Earlier weeks were much weaker (week 37: base 281, HP 661, reduction 472;
week 38: base 283, HP 710, reduction 592). Every threshold here moves when
the loadout re-locks.

---

## Why the % CHANCE badge is wrong

It's a curve on the opponent's Combat Power only:

| Week | Fit | r | Residual |
|---|---|---|---|
| 37 | `244.1 − 25.2·ln(CP)` | −0.98 | 1.3 |
| 38 | `242.2 − 24.4·ln(CP)` | −0.98 | 2.0 |
| 39 | `249.0 − 24.5·ln(CP)` | −0.99 | 1.6 |

It ignores *which* stat is high, so it misjudges both ways:

| Quoted | Regular: won | Boss: won |
|---|---|---|
| 30–39% | 0/11 | 3/3 |
| 40–49% | 11/54 (20%) | 17/20 (85%) |
| 50–59% | 51/61 (84%) | — |
| 60–69% | 23/23 | — |
| 70–79% | 7/7 | — |

For regular opponents it acts like a blunt **~50% cut-off** rather than a
probability. For bosses it's useless: every boss is quoted 37–47%, because
bosses carry one huge stat that inflates CP.

---

## The kill-race score

```
their_hit = max(0.088 × their_base, their_base − your_reduction)
your_hit  = max(0.088 × your_base,  your_base − their_DEF)
score     = (your_HP / their_hit) ÷ (their_HP / your_hit)      // > 1 ⇒ you outlast them
```

using `their_base` and `their_HP` from the card table above.

| Score | Record |
|---|---|
| ≥ 1.2 | **81/81 won** |
| 1.0 – 1.2 | 21/35 won (60%) |
| 0.8 – 1.0 | 9/24 won (38%) |
| < 0.8 | 1/39 won |

Overall: **155/179** correct at score ≥ 1 ⇒ win. Quoted ≥ 50% gets 138/179.

### Shortcut for regular opponents

For the usual case (their DEF above ~450, their STR under ~1,450), both
sides deal minimum damage and the score reduces to:

```
score ≈ K ÷ (STR × (7.19 × level − 49))        K ≈ 571,500 this week
```

`K = your_HP × your_base / 0.54`. It changes with your loadout: 343,700 in
week 37, 371,900 in week 38.

**Maximum STR you can beat (score = 1), by opponent level, week 39:**

| Level | 80 | 85 | 90 | 95 | 100 | 105 | 107 | 110 | 115 | 118 | 120 | 125 | 130 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Max STR | 1,086 | 1,017 | 956 | 901 | 853 | 810 | 793 | 770 | 735 | 715 | 702 | 673 | 645 |

Stay about 20% under the line (score ≥ 1.2) for a near-certain win. DEF
under ~350 is an easy win at any STR within reason.

### Tie-breakers in the coin-flip band (0.8 ≤ score < 1.2)

| | Score 0.8–1.0 | Score 1.0–1.2 |
|---|---|---|
| **Passive** opponent | 8/13 won | 13/20 won |
| **Active** opponent | 0/10 won | 5/12 won |

Also within the band, **quoted ≥ 51%** won 11/13. The badge adds a little
information once the stats are close.

**What "Passive" means:** the game's own banner says a player's loadout is
"auto-locked at week start" until they attack, at which point it is
"re-snapshotted from your current gear". Passive players haven't fought
this season, so they fight on the auto-locked snapshot. The combat logs
bear this out. Compared with active players of the same card stats,
passive players have lower reduction per DEF (1.03× vs 1.11×) and less HP
than their level suggests (−7 vs +20). You also get the first strike
against them twice as often (9.9% vs 4.5%), and they block you less
(9.0% vs 12.3%).

---

## Bosses

Boss HP is fixed by level (625 at lvl 106), and the boss card and
`boss_data` show the full stats. Each family builds its bosses around one
stat:

| Family | Main stat | Fights | Won | Boss STR |
|---|---|---|---|---|
| Kito-gumi | DEX (~1,000–1,430) | 7 | **7** | 546–787 |
| Viola | AGI (~1,100–1,520) | 7 | **7** | 323–605 |
| SBP | DEF (~1,040–1,170) | 2 | **2** | 605–627 |
| Volkskaya | DEX (~1,000–1,430) | 2 | **2** | 615–771 |
| **Iron River** | **STR (~900–1,630)** | 5 | **2** | 898, 1,114 L, 1,125 L, 1,523 L, 1,627 |

So:

- **Non–Iron River boss:** a near-certain win at current stats. Their STR
  sits well under the break-even point.
- **Iron River boss:** decide by STR. **Break-even ≈ 1,090 STR** this week
  (week 38: ~690; week 37: ~630). Under ~900 has always been a win; the one
  win above 1,500 was luck.

Boss stats have grown over time: `band` went 5 → 6 on ~2026-09-16, and
stats rose again ~2026-09-22. Always read the current card rather than
assuming.

---

## Other things on the page worth knowing

- **Refresh:** each page has a free refresh, locked once you've attacked
  anyone on it ("Combat has begun — refresh locked"); later refreshes cost
  MG (`action=refresh&page_number=N`, response `cost_mg`). **Unverified**
  whether it also re-rolls the boss, since no refresh exists in the
  archives yet. If it does, it's a free way out of a high-STR Iron River
  boss.
- **Weekly loadout snapshot:** your loadout is re-captured from your
  current gear at your first attack each week. Equip your best gear and
  bonuses before that first attack.
- **Pot risk:** a loss forfeits the page's unbanked pot
  (`page_banked_due_to_loss`, "Pot Forfeited"; see `docs/arena-auto-plan.md`).
  Bank before a coin-flip fight, or fight coin-flips first on a fresh page.
- **`threat_ratio`, `tier`, `bounty`, `multiplier`** in
  `opponent_bounties` are the slot's bounty economics (tier 1–4 → base
  bounty 10/20/40/70). They are **not** a strength signal: threat_ratio
  doesn't track win chance (e.g. 4.25 at a quoted 63%, won).

---

## Implication for Arena Auto

`ArenaAutoConfig.bossWinPctThreshold` (default 50) compares against
`boss_data.win_pct`. Every boss quote seen so far is 37–47%, so **Arena Auto
never attacks a boss**, even though bosses have won 20/23 overall and
18/18 outside Iron River. Using the kill-race score, or at minimum
"non-Iron River or STR under break-even", would change which fights it
takes. That's a behaviour change to decide on separately.

---

## Caveats

- Card → combat fits are regressions over 179 fights. The HP-from-level
  fit for regular opponents is the loosest (±44 HP), which is most of why
  the 0.8–1.2 band is uncertain.
- The minimum-damage steps and their ~8.8% mean are measured, not read
  from game code.
- Your side of the score uses the week's median of your own logged numbers.
  After a loadout change, re-run the verification script to get the new
  base, HP, reduction and K before trusting the tables.
