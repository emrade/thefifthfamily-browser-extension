# Arena V2 — combat mechanics & predicting fights

How Arena V2 fights are actually decided, why the page's "% CHANCE" badge is
misleading, and a rule that predicts wins from what the opponent card already
shows. Derived 2026-09-24 from every archive export on hand: **184 real V2
fights** (160 regular opponents, 24 bosses, 2026-09-09 → 09-24), each with its
full round-by-round combat log. Re-check with
[`verification/arena/verify_combat_rule.py`](../verification/arena/verify_combat_rule.py).
The earlier boss-only check is `verification/arena/verify_boss_odds.py`.

The extension turns this into the **Arena Fight Advisor** (verdict badges on
the Arena page) and the **Arena page reminder**. See
[What the extension does with this](#what-the-extension-does-with-this).

**Updated 2026-10-05** with 387 fights (2026-09-09 → 10-04), and a fix to the
verification script, which had been dropping every fight after a Refresh.
New: [Pot, bounty and Refresh](#pot-bounty-and-refresh-2026-10-05) and
[Why opponents got harder](#why-opponents-got-harder-oct-1-season). Corrected:
the % CHANCE is a good cut-off for *regular* opponents (it was compared
including bosses), `threat_ratio` *is* a strength signal (it sets the
bounty), and non–Iron River bosses can lose (boss "Beatable" is now 1.3+).

---

## TL;DR

- The **% CHANCE badge is just the opponent's Combat Power** on a log curve
  (`≈ 249 − 24.6·ln(CP)`, within ±2). CP is roughly the sum of the four
  stats, but the stats don't matter equally in a fight. Even so, for
  **regular** opponents it works as a **50% cut-off** (right 297/331, the
  kill-race score 293/331), and inside a coin-flip it's the best tie-breaker
  there is. For bosses it's useless.
- A fight is a **race between damage and HP**. What matters is the
  opponent's **STR** (how hard they hit) against their **level** (their HP).
  DEF only matters when it's low; AGI and DEX barely matter.
- The **kill-race score** below calls **160/184** fights correctly. Quoted
  ≥ 50% gets 142/184. Score ≥ 1.2 has won **85/85**; score < 0.8 has won
  **2/40**.
- **Bosses:** score them like anyone else, with a higher bar: **1.3+** has
  won 24/24, 1.1–1.3 won 23/27. Iron River bosses (built on STR) score
  lowest and lose most; the others lost only at 1.13–1.22.
- **Pot:** a win adds the opponent's **bounty**, any loss wipes the
  unbanked pot, and banked pots are the season score. Bounty is the game's
  own difficulty price (set by `threat_ratio`). See
  [Pot, bounty and Refresh](#pot-bounty-and-refresh-2026-10-05).
- **Passive** opponents fight weaker than their card shows; **active** ones
  stronger — but the quoted % is the better coin-flip tie-breaker.
- About **10% of fights are genuine coin-flips**. Even a simulator fed each
  fight's real in-fight numbers only called 159/179.

---

## Where the data comes from

| Source | What it gives |
|---|---|
| `GET panel.php?type=arena&arena_tab=v2&av2_view=arena` | Opponent cards (HTML): name, level, rank, bounty, **% CHANCE**, **Passive** tag, **Combat Power**, **STR / DEF / AGI / DEX**; the boss card (family in its class, `ar-opp-boss-<family>`); your locked level and max HP |
| `POST arena_v2.php action=preview_loadout` | Your locked `fighting_stats`, `level`, `max_hp`, gear and every bonus (see [Season lock-in](#season-lock-in)) |
| `POST arena_v2.php action=open_next_page` | `opponent_bounties{id: win_pct, bounty, threat_ratio, tier, …}` and full `boss_data` (family, tier, level, `snapshot_*` stats, gear, `combat_power`, `win_pct`) |
| `POST arena_v2.php action=attack` | Result plus the full combat log: `rounds[]` with per-hit `base_dmg`, `reduction`, `min_dmg`, `damage`, dodge / crit / block chances and rolls, crit / block multipliers, first strikes; both sides' max HP, level, gear |

Your own loadout is **locked for the season** (7 days), so your side of
every fight is fixed all week.

### Season lock-in

At the start of each season, opening the Arena shows a lock-in screen
before anything else can be done. Traced for the Sep 23–29 season
(2026-09-22 23:01 UTC = 23 Sept 00:01 WAT):

```
23:01:39  GET  panel.php?type=arena
23:01:41  POST arena_v2.php action=claim_rewards    → last season's rewards
23:01:46  POST arena_v2.php action=preview_loadout  → the stats being locked
23:01:52  POST arena_v2.php action=open_next_page   → page 1
23:02:04  POST arena_v2.php action=attack ...        → first fight
```

`preview_loadout` returns `fighting_stats {strength, defence, agility,
dexterity}`, `level`, `max_hp`, `loadout` (7 gear slots with enhancement
levels), `vehicle` and every active `bonuses[]` entry. Sep 23–29: STR 844,
DEF 747, AGI 605, DEX 709, level 106, max HP 737. Afterwards the Arena page
shows "Locked Level" and "Locked Max HP", but not the four stats.

Your locked stats map to your combat numbers only roughly, because weapon
and bonuses shift the ratio:

| Season (max HP) | STR → your mean base damage | DEF → your reduction |
|---|---|---|
| 661 | 527 → 281 (0.53×) | 434 → 472 (1.09×) |
| 710 | 554 → 295 (0.53×) | 563 → 592 (1.05×) |
| 737 | 844 → 431 (0.51×) | 747 → 773 (1.03×) |

So the best source is the combat logs of your fights after lock-in:
`base_dmg` and `reduction` on your own side, and `att_max_hp`.
`preview_loadout` is good for an estimate before the first fight.

---

## How a fight works

Each round, either side may get a **first strike** (a "snap shot" at about
half base damage; chance based on AGI). Then you hit, then they hit. Fights
always go to the death: 2–35 rounds observed, and the loser is always at
0 HP.

### Damage per hit

1. **Base damage** is rolled around the attacker's mean (about 0.86–1.17×).
   A miss logs base damage 0, so leave misses out of any average (including
   them drags it down about 5%).
2. **If base > the defender's reduction:** damage ≈ `base − reduction`.
3. **Otherwise** damage is a random **minimum damage** drawn from 5 steps
   scaled to the attacker's mean base. Measured mean: **8.5%** of base for
   you, **9.1%** for opponents. For you right now the steps are
   21 / 28 / 35 / 42 / 49.
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
| STR | mean base damage | `0.555·STR − 7` (r 0.99) | `0.483·STR + 10` (r 0.997) |
| DEF | reduction | `1.16·DEF − 51` (r 0.98) | `≈ DEF` (r 1.00) |
| Level | max HP | `≈ 7.2·level − 50` (r 0.91, ±45) | `95 + 5·level` (exact; 625 at lvl 106) |
| AGI | chance to dodge your hits | ≈ `0.6 + 0.010·AGI` % | ≈ `0.7 + 0.009·AGI` % |
| DEX | their crit chance | ≈ `0.7 + 0.014·DEX` % | ≈ `2.0 + 0.011·DEX` % |

A high-AGI or high-DEX opponent adds only a few percentage points of dodge
or crit, but inflates Combat Power, and so the badge, just as much as STR.

### Your side (Sep 23–29 loadout)

| | Value |
|---|---|
| Max HP | 737 |
| Mean base damage | ~431 |
| Reduction (your armour) | ~773 (varies by opponent, 673–777) |
| Minimum damage | 21–49, mean ~37 |

With 773 reduction, only regular opponents with **STR ≳ 1,400** (bosses
**STR ≳ 1,580**) can hit past your armour for big damage. Your ~431 base
damage gets past anyone with **DEF ≲ 430** (regular) and tears through
DEF < ~350 (e.g. DEF 206 died in 3 rounds, DEF 124 in 2).

Earlier seasons were much weaker (max HP 661: base 281, reduction 472;
max HP 710: base 295, reduction 592). Every threshold here moves when the
loadout re-locks.

---

## Why the % CHANCE badge is wrong

It's a curve on the opponent's Combat Power only:

| ISO week | Fit | r | Residual |
|---|---|---|---|
| 37 | `244.1 − 25.2·ln(CP)` | −0.98 | 1.3 |
| 38 | `242.2 − 24.4·ln(CP)` | −0.98 | 2.0 |
| 39 | `249.2 − 24.6·ln(CP)` | −0.99 | 1.5 |

It ignores *which* stat is high, so it misjudges both ways:

| Quoted | Regular: won | Boss: won |
|---|---|---|
| 30–39% | 0/11 | 3/3 |
| 40–49% | 11/55 (20%) | 18/21 (86%) |
| 50–59% | 53/63 (84%) | — |
| 60–69% | 24/24 | — |
| 70–79% | 7/7 | — |

For regular opponents it acts like a blunt **~50% cut-off** rather than a
probability. For bosses it's useless: every boss is quoted 37–47%, because
bosses carry one huge stat that inflates CP.

2026-10-05, 331 regular fights: 30–39% won 0/11, 40–49% 18/92, 50–59%
127/143, 60%+ 85/85. As a cut-off ("≥ 50% = win") it's right 297/331 —
level with the kill-race score (293/331). The earlier "142 vs 160" comparison
lumped bosses in, where the quote is meaningless.

---

## The kill-race score

```
their_hit = max(0.088 × their_base, their_base − your_reduction)
your_hit  = max(0.088 × your_base,  your_base − their_DEF)
score     = (your_HP / their_hit) ÷ (their_HP / your_hit)      // > 1 ⇒ you outlast them
```

`their_base` and `their_HP` come from the card table above; your numbers
are the season medians of your own logged fights. The minimum-damage
fraction is a shared 8.8%: the measured 8.5% (you) and 9.1% (opponents)
average to it, only the ratio between the two sides matters, and the
shared value fits the actual results best.

| Score | Record |
|---|---|
| ≥ 1.2 | **85/85 won** |
| 1.0 – 1.2 | 20/33 won (61%) |
| 0.8 – 1.0 | 9/26 won (35%) |
| < 0.8 | 2/40 won |

Overall: **160/184** correct at score ≥ 1 ⇒ win. Quoted ≥ 50% gets 142/184.

### Shortcut for regular opponents

For the usual case (their DEF above your base damage, their STR under
~1,400), both sides deal minimum damage and the score reduces to:

```
score ≈ K ÷ (STR × (7.19 × level − 49))         K ≈ 573,000 this season
```

`K = your_HP × your_base / 0.555`. It changes with your loadout: ~335,000
(max HP 661), ~377,000 (max HP 710).

**Maximum STR you can beat (score = 1), by opponent level, Sep 23–29:**

| Level | 80 | 85 | 90 | 95 | 100 | 105 | 107 | 110 | 115 | 118 | 120 | 125 | 130 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Max STR | 1,101 | 1,031 | 970 | 916 | 867 | 824 | 807 | 784 | 749 | 729 | 716 | 686 | 659 |

Stay about 20% under the line (score ≥ 1.2) for a near-certain win. DEF
under ~350 is an easy win at any STR within reason.

### Tie-breakers in the coin-flip band (0.8 ≤ score < 1.2)

**2026-10-05: the quoted % is the tie-breaker** (account owner's own
observation, confirmed on 98 coin-flip fights):

| | Quoted ≥ 50% | Quoted < 50% |
|---|---|---|
| Passive | 22/28 (79%) | 10/24 (42%) |
| Active | 15/22 (68%) | 4/24 (17%) |

48–49% won 11/23, 50–51% 24/37, 52–53% 10/11. "Leans win if quoted ≥ 50%"
is right 71/98; the old "Passive or quoted ≥ 51%" rule 68/98 — it leaned win
on every Passive opponent, and a Passive one quoted under 50% won only
10/24. The advisor now follows the quote (Passive only when no quote shows).

Original (2026-09-24, 184 fights):

| | Score 0.8–1.0 | Score 1.0–1.2 |
|---|---|---|
| **Passive** opponent | 9/14 won | 12/19 won |
| **Active** opponent | 0/12 won | 5/11 won |

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
| Kito-gumi | DEX (~1,000–1,430) | 8 | **8** | 546–787 |
| Viola | AGI (~1,100–1,520) | 7 | **7** | 323–605 |
| SBP | DEF (~1,040–1,170) | 2 | **2** | 605–627 |
| Volkskaya | DEX (~1,000–1,430) | 2 | **2** | 615–771 |
| **Iron River** | **STR (~900–1,630)** | 5 | **2** | 898, 1,114 L, 1,125 L, 1,523 L, 1,627 |

So (2026-09-24):

- **Non–Iron River boss:** a near-certain win at current stats. Their STR
  sits well under the break-even point.
- **Iron River boss:** decide by STR. **Break-even ≈ 1,030 STR** this
  season (~675 at max HP 710; ~600 at max HP 661). Under ~900 has always
  been a win; the one win above 1,500 was luck.

**2026-10-05 update (57 boss fights):** non–Iron River bosses now lose too —
Kito-gumi at STR 821 and 871, Volkskaya at 857 and 885. Boss HP grows with
level (625 at 106, 645 at 110), and the in-game wiki says each family's
bosses move up a tier (Common → Uncommon → Rare → Legendary) once you've
beaten all of the tier below, so bosses keep getting stronger as you clear
them. By kill-race score:

| Boss score | Record |
|---|---|
| 1.3+ | **24/24** |
| 1.1–1.3 | 23/27 (all four non–Iron River losses: 1.13–1.22) |
| < 0.8 (all Iron River) | 2/5 |

So the boss "Beatable" line is now **1.3** (regular stays 1.2), and whether
to fight a boss depends on the pot riding on it — see below.

Boss stats have grown over time: `band` went 5 → 6 on ~2026-09-16, and
stats rose again ~2026-09-22. Always read the current card rather than
assuming.

---

## Page rules worth knowing

- **The boss unlocks once all four opponents have been *fought*, won or
  lost.** On 2026-09-20 13:48 all four were lost, and the boss was still
  fought (and beaten, +144).
- **Banking ends the page.** A banked page can't be fought any further, so
  the boss is either fought with the pot riding on it, or skipped by
  banking first.
- **Any loss forfeits the page's unbanked pot, including a boss loss.** The
  boss response's `page_banked_due_to_loss: true` does *not* mean the pot
  was saved. Verified 2026-09-24 10:35 UTC: pot 216 before the Diego
  Alvarez loss, `page_pot: 0` after, and the season score stayed at 3,553
  across the next `open_next_page`, so 216 points were lost.
- **Fight riskiest first.** An early loss costs only the small pot built so
  far; the pot then rebuilds from the later, safer fights and the boss
  bounty (144–180). This is how every manually played page went.
- **6 pages a day.** After page 6 the page shows "The final summons of the
  day" (`ar-day-complete`). After the daily reset (23:00 UTC so far, not
  hard-coded anywhere) the same box becomes "The Gates Await … Open The
  Gates", with an `av2_arenaOpenNextPage()` button and every page dot back
  to `locked`. The button is what tells a new day's first page from a
  finished day.
- **Bosses can be skipped.** 41 boss pages were opened but only 23 bosses
  fought. For a boss over your break-even, bank and move on.
- **Refresh re-rolls the four regular opponents only, never the boss.**
  Each page has a free refresh, locked once you've attacked anyone on it
  ("Combat has begun — refresh locked"); later refreshes cost MG.
  `POST arena_v2.php action=refresh&page_number=N` →
  `{"free_refresh_used_this_page":true,"cost_mg":0,"opponent_ids":[…]}`,
  with no boss data. Confirmed 2026-09-24 12:53 UTC on page 5: all four
  opponents were replaced, and the boss (Vito 'The Shadow' Moretti, Iron
  River, STR 1,605 / DEF 719 / CP 3,830) was identical before and after.
- **`threat_ratio`, `tier`, `bounty`, `multiplier`** in
  `opponent_bounties` are the slot's bounty economics. *Corrected
  2026-10-05:* they **are** a strength signal — `multiplier` is set by
  `threat_ratio` (the game's own opponent-vs-you strength), and it's what
  makes a bounty big. See the next section. (A single 4.25 that won proves
  nothing either way.)

---

## Pot, bounty and Refresh (2026-10-05)

Banked pots are the season score, so this is what actually decides ranking.

- **A win adds exactly the card's BOUNTY to the page pot** (230/230 wins).
  **Any loss wipes the unbanked pot**; you keep fighting to rebuild it.
  Banking ends the page.
- **Bounty = slot base × a multiplier from `threat_ratio`** (the game's
  opponent-vs-you strength):

  | threat_ratio | multiplier |
  |---|---|
  | < 0.8 | ×0.8 |
  | 0.8–1.0 | ×1 |
  | 1.0–1.2 | ×1.2 |
  | 1.2–1.5 | ×1.5 |
  | 1.5+ | ×2 |

  Slots 1–4 carry base 10/20/40/70 (20/40/40/70 on some pages), so every
  page has roughly an 8 / 20 / 48 / 105–140 lineup. Big bounty = strong
  opponent: 8-bounty opponents won 88%, 140-bounty ones 55%.
- **Attack order: riskiest first.** A bounty only survives if every later
  fight is won too, so expected banked points are `Σ bountyᵢ·pᵢ·Π(later p)`.
  Every opponent has to be fought to unlock the boss, and a first fight is
  free to lose (the pot is empty), so the least-winnable fight goes first.
  A bounty-weighted order (sort by `(1 − p) / (bounty·p)`) was tried
  2026-10-05: it differed on 109 of 136 real lineups but gained only ~3
  points a page, so the account owner kept riskiest first.
- **Boss with a pot on it.** Fight while `p × (pot + boss bounty) > pot`,
  i.e. while the pot is under `p·bounty / (1 − p)`. With the boss bands
  above: a 1.3+ boss is always worth it; a 1.1–1.3 boss (~85%) up to a pot of
  ~800 (always, in practice); an Iron River boss under 0.8 (~40%, bounty 120)
  only under a pot of ~80.
- **Refresh.** Re-rolls all four regulars (never the boss); the first per
  page is free, later ones cost MG, and it locks once you attack. A fresh
  lineup played riskiest first banks **~87** expected points on average
  (136 real lineups; 103 last season, 77 this one). So re-roll a lineup that
  expects less than ~87 and keep one that expects more — typically one whose
  105/140 is Beatable. Backtested on the account owner's 48 real refreshes:
  where this rule says re-roll (46), the re-roll raised the expected pot by
  **+46** on average; where it says keep (2), re-rolling lost 16.
- **Win chances used** (real record per verdict band, all 387 fights):
  regular Beatable 176/176, Avoid 3/57; coin-flip 0.8–1.0: quoted ≥ 50%
  12/17, under 7/33; 1.0–1.2: 25/33 vs 7/15. Bosses as in the table above.

### Why opponents got harder (Oct 1 season)

| Season | Your level | Opp. level (median) | Opp. STR (median) | Beatable | Avoid | Won | Banked / page |
|---|---|---|---|---|---|---|---|
| Sep 22 (HP 737) | 106 | 100 | 608 | 63% | 9% | 80% | 270 |
| Oct 1 (HP 759, partial) | 110 | 104 | 707 | 55% | 20% | 70% | 212 |

- Opponents are matched to **your level** (median ~6 levels below, range
  −25 to +24), and STR climbs steeply with level (lvl 100–104 ≈ 638, 110–114
  ≈ 822, 120+ ≈ 1,204). Your 4 levels pulled in noticeably stronger players;
  at the same level band players only got ~8% stronger week to week.
- Your locked numbers barely moved (HP 737 → 759, base 418 → 431, ~3%): the
  loadout locks per season and levels add little fighting power. This
  season's `preview_loadout` wasn't captured.
- Fewer Passive opponents (~75% → 64%).
- The "Tight matchmaking" / "Open pool" page pill didn't show a clear
  difficulty difference in this data.
- Bosses tier up as you clear them (see Bosses).

## Why Arena Auto-Attack was removed

Arena Auto ran 2026-09-17 → 09-19 and was switched off for losing points:
**16/38 wins (42%)** against 96/141 (68%) for manual play, and its pages
banked 8–140 points against 170–360 for manual pages. Scored with the
kill-race rule, its fights break down as:

| Verdict | Auto fights | Won |
|---|---|---|
| Avoid (< 0.8) | 12 | **0** |
| Coin-flip (0.8–1.2) | 16 | 6 |
| Beatable (≥ 1.2) | 10 | 10 |

The bigger cost was bosses: it compared `boss_data.win_pct` against a 50%
threshold, but every boss quote is 37–47%, so it never fought one and
never collected the 144–180 boss bounty. On 2026-09-24 the player chose to
play every page by hand with the Fight Advisor instead, and the feature
was removed. Its design notes stay in `docs/arena-auto-plan.md` for
history.

---

## What the extension does with this

- **Arena Fight Advisor** (`src/content/features/arena/fightAdvisor.ts`,
  model in `src/shared/arenaCombat.ts`). Badges each live opponent and the
  boss **✅ Beatable / ⚖️ Coin-flip (lean win or loss) / ⛔ Avoid** with the
  verdict band's real win rate, numbers the attack order riskiest first, and
  adds a
  plan above the cards: the order (with each bounty), the expected pot from
  the fights left, the boss call given the current pot (read from the
  game's own Page Pot box), and — before any fight, while Refresh is
  available — whether to re-roll this lineup or keep it (see
  [Pot, bounty and Refresh](#pot-bounty-and-refresh-2026-10-05)). *(Until
  2026-10-05 the Refresh tip fired whenever 2+ opponents were Avoid, which
  ignored bounty.)* Hovering a badge (or an
  attack-order chip) shows the verdict and its main reason; clicking opens a
  breakdown (`fightDetails.ts`): the win rate and what a win adds to the
  pot, HP, damage per hit and hits to finish for both sides, their STR
  against your limit, notes, the game's quoted %, and what each verdict has
  meant so far. That record is live
  (`ArenaTrackRecord`): the 184 archived fights plus every desktop fight
  scored against the verdict its card showed before the attack, all-time
  and for this season. Losing a Beatable fight (or beating an Avoid) puts a
  Heads-up line in the banner for 24 hours. A coin-flip leans win when the
  card's quoted % is 50+ (regular; Passive only when no quote shows), or it
  scores ≥ 1.0 (boss). Your numbers come from the
  captured `preview_loadout` (an estimate), then the season medians of your
  logged fights. Replaying every archived fight in order, with the numbers
  as they would have stood at the time, gives 154/179 correct, Beatable
  81/81, Avoid 2/40.
- **Arena page reminder** (`src/background/features/arena/watcher.ts`).
  Read-only. Reminds every 15 minutes while a page is ready to open **or**
  opened but not banked (fights left, boss unlocked, or pot unbanked), and
  stops once it's banked or the day's 6 pages are done. One notification
  that replaces itself each time (and asks to stay on screen in Chrome;
  Firefox ignores that option, so set Firefox's macOS notification style to
  Persistent to keep it on screen). Clicking it brings the game tab forward.
- **Arena panel** (`src/content/features/arena/overlay.ts`). The reminder
  toggle and state, your season numbers, the STR-by-level limits, and the
  boss break-even.

---

## Caveats

- Card → combat fits are regressions over 184 fights. The HP-from-level
  fit for regular opponents is the loosest (±45 HP), which is most of why
  the 0.8–1.2 band is uncertain.
- The minimum-damage steps and their mean are measured, not read from game
  code.
- The model's coefficients live in `src/shared/arenaCombat.ts` and are
  mirrored in `verification/arena/verify_combat_rule.py`. Change them
  together, and re-run the script after a loadout change or a game update.
