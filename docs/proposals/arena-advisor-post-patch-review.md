# Arena Fight Advisor: review after the Oct 30 patch

Status (2026-11-03): **reviewed with 116 post-patch fights, mechanics
re-derived (see arena-combat-mechanics.md "Additions from the 2026-11-03
review"); options 1–6 to the player, nothing changed yet.** See "Review 2026-11-03" below.

Earlier status (2026-11-01): **gathering data, nothing changed.** The player paused
any advisor changes until there's enough post-patch data. Don't blend the
game's own % into the advisor without asking first.

## Review 2026-11-03 (116 post-patch fights)

Data: every regular `attack` from 2026-10-30 11:09 UTC (the patch) to
2026-11-03 12:23 UTC, across the raw exports through
`fifth-family-archive-new-2026-11-03T14-08-51-652Z`. The verdicts come from
the extension's own code (`verdictFor` in `src/shared/arenaCombat.ts`).
- The opponent's card is read from the last `panel.php?type=arena` page
  before the fight. Found for 96 of the 116; the other 20 went 15/20.
- The player's profile is rebuilt by folding every earlier `attack` through
  `sampleFromAttack` / `foldFight`, as the extension does.
- Scratch scripts: `replay.ts` (and `m.ts` for the margin test) in the
  session scratchpad.

**Advisor verdict × game's % → result**

| Advisor | Game's % | Won |
|---|---|---|
| Beatable | ≥ 90% | **57/57** |
| Beatable | < 50% | **0/3** (all NehNehPok) |
| Coin-flip | ≥ 90% | 8/8 |
| Coin-flip | 70–89% | 7/9 |
| Coin-flip | 50–69% | 3/5 |
| Coin-flip | < 50% | 0/12 |
| Avoid | < 50% | 0/2 |

**The game's % alone:** ≥ 90% won 65/65; 70–89% 7/9; 50–69% 3/5;
< 50% **0/17**. Since the patch, the game's own number has been a near-
perfect guide, better than the advisor's.

**The "winnable" losses** were all the same opponent, NehNehPok (Lv 134,
STR 2483 / DEF 930 / AGI 1402 / DEX 1055, game 15%), fought three times:
2026-11-01 12:24 (score 1.36, they were left on 117 HP), and 2026-11-03 12:13
(score 1.41, left on 400 HP) and 12:15 (score 1.38, left on 148 HP). In all
three, their real armour was 1,088 against card DEF 930, the problem
described below.

**Armour check** (planned step 1), real armour (`rounds[].attacker.reduction`)
÷ card DEF over 96 fights:
- Median 1.10×; 10th–90th percentile 0.98–1.28×; range 0.90–1.67×.
- By card DEF: under 800 it's 0.98×; 800–1,200 it's 1.13×; 1,200+ it's
  1.17×.
- So it isn't a constant. Gear adds armour the card doesn't show, and more
  so for high-DEF opponents.

**Margin test** (`verdictFor` with card DEF scaled up, same fights):

| Armour assumed | Beatable | Coin-flip | Avoid |
|---|---|---|---|
| Card DEF (today) | 57/60 | 18/34 | 0/2 |
| DEF × 1.10 | **57/57** | 18/37 | 0/2 |
| DEF × 1.17 / × 1.25 / + 100 | 57/57 | 18/37 | 0/2 |

Any margin of 10% or more moves the three NehNehPok losses from Beatable to
Coin-flip, and costs no Beatable win. The Coin-flip band stays mixed
(18/37), and within it the game's % separates wins from losses (≥ 90% 8/8,
< 50% 0/12).

**Is it just NehNehPok? (whole season since 2026-10-27, 112 fights with a
card)**
- **Hidden armour is common.** In 13 fights, against 9 opponents, the card's
  DEF was below the player's base damage but the real armour was at or
  above it (1.13–1.30× DEF): Ignivar, Jebustar ×2, Facelessghost, DaynJah
  ×3, Gralba, n0ma13, Nightfall, NehNehPok ×3. All won except NehNehPok's
  three. Those others have STR 950–1,400, so at floor-vs-floor damage the
  player still wins.
- **It costs a fight when the opponent also hits hard.** Opponents with
  NehNehPok-like stats (STR ≥ 1,800, card DEF 800–1,100):
  - NehNehPok 0/3 (game 15%).
  - GigglinRina 0/2 (STR 1,991, armour 1,198 = 1.13× DEF; advisor
    Coin-flip 1.02; game 19%).
  - 4lbert 1/1 (game 79%).
  - Dhensley12 4/4 (STR ~1,990, armour 1,094 = 1.07×; game 52–99%).
  - Dhensley12 won despite stats like GigglinRina's, so card stats alone
    don't separate these; the game's % called every one of them correctly.
- **An opponent's armour is fixed fight to fight** (26 opponents met more
  than once). It moves only at the Oct 30 patch (+4–7%, e.g. NEMESIS
  808 → 863, Dhensley12 1,053 → 1,094) or on a re-gear (Mr_Wednesday
  1,644 → 2,459). So it comes from their gear, and once the player has
  fought someone, their real armour is known exactly from that fight's log.
  That makes a possible option 5: remember each opponent's real armour from
  past fights and use it instead of card DEF.

**Options for the player** (nothing built; each would be its own Arena
page setting, default off):
1. **Armour margin:** score opponents as if their armour were card DEF ×
   1.10. It fixes every "Beatable but lost" case in this data, with no wins
   lost. Small change, in the advisor's own model.
2. **Trust the game when they disagree:** when the game says under 50%,
   never show Beatable; when it says 90%+, never show worse than Coin-flip
   leaning win. In this data, the game's % was right 65/65 at 90%+ and
   17/17 under 50%. (Blends the game's % into the verdict, which the player
   asked to approve first.)
3. **Show the game's % on the badge** next to the advisor's verdict, and
   leave the verdict alone.
4. Leave it as it is.
6. **Simulate rematches exactly:** store each opponent's numbers from
   their last fight log (armour, base, dodge, block, crit chance and
   multiplier, armory, first-strike chance, HP), then run the fight
   simulation (see "Additions from the 2026-11-03 review" in
   `docs/arena-combat-mechanics.md`). It matched the game's % to a median
   of 1 point using such numbers. It covers 60% of fights (rematches).
   First meetings would still need card estimates (option 1).
7. **Simulate first meetings from the card:** estimate the opponent's
   numbers from their card and run the same simulation. Fits, post-patch,
   regular opponents:
   - base = 0.594·STR − 36; armour = 1.314·DEF − 164; HP = 11.15·level −
     523;
   - their dodge = 1.78 + 0.0083·AGI %; their block = 1.49 + 0.0142·DEF %;
     their crit = 0.08 + 0.0808·DEX^0.75 %;
   - your crit multiplier = 3.02 − 0.0007·their DEX;
   - your first-strike chance = 48.8 − 0.0438·AGI % (0–30); theirs =
     0.0149·AGI − 11.9 % (0–30);
   - their floor ≈ 6.1% of their base; their crit multiplier ≈ 1.38;
     armory assumed 1.035 (unknown from the card).

   Tested on the 96 fights with a card:
   - median 1 point from the game's % (90th percentile 29, worst 69);
   - rated 90%+: 62/62 won; under 30%: 1/17 won;
   - NehNehPok 10% (game 15%), GigglinRina 18% (19%), Mr_Wednesday 6% (1%);
   - Brier score 0.056, against the game's own 0.034.

   Big misses come from opponents whose gear is far from typical (4lbert:
   10% against the game's 79%, won; Pierewiet 77% against 11%, lost; Katy
   33% against 84%). Fitting on the earlier half of the fights and testing
   on the later half gave about the same errors per number (HP somewhat
   worse), so the fits aren't overfitted.
5. **Remember real armour:** after the first fight against an opponent,
   use the armour from that fight's log instead of card DEF (exact for
   repeat opponents, e.g. NehNehPok's 2nd and 3rd fights). Combine with 1
   for first meetings.

## Problems seen so far

### 1. Too cautious: Coin-flip where the game says 90%+

The advisor showed Coin-flip ~69% (scores 1.14 / 1.07) while the game said
96% / 98%. Post-patch record as of 2026-11-01 (44 fights):

| Advisor | Game's % | Record |
|---|---|---|
| Coin-flip | ≥ 90% | won 2/2 |
| Coin-flip | 50–89% | won 5/6 |
| Coin-flip | < 50% | won 0/8 |
| Beatable | ≥ 90% | won 28/28 |

### 2. Too confident: Beatable ~99% where the game says 15% (lost)

NehNehPok, 2026-11-01 12:24 UTC (archive
`fifth-family-archive-new-2026-11-01T12-27-28-087Z`). Lv 134, rank #7,
6,807 CP, card STR 2483 / DEF 930 / AGI 1402 / DEX 1055, bounty 35. The
advisor showed **Beatable ~99%, score 1.50**; the game showed **15%**. Lost in
round 13, with the opponent on 117 / 937 HP.

From the fight log:

| | Player | NehNehPok |
|---|---|---|
| Mean base damage | 996 | 1,464 |
| Armour (reduction) hit against | **1,088** (theirs) | 1,487 (the player's) |
| Damage per round | 63 | 74 |

Both sides did mostly minimum-floor damage, so crits and misses decided it.

**Cause:** `myHitOn` in `src/shared/arenaCombat.ts` uses
`me.baseDamage - card.defence`, so it treats the card's DEF as the
opponent's armour. The real armour was **1,088 = 1.17 × DEF**, because gear
adds reduction the card doesn't show. Re-running the advisor's formula:
- with the card's DEF: score **1.12**
- with the real armour: score **0.96**, a coin-flip leaning to a loss,
  consistent with the game's 15% and the result

The advisor actually showed 1.50, which means its stored `baseDamage` for the
player was a bit above the 996 in this fight. The score is very sensitive
when the player's damage sits just above the opponent's armour.

The player also lost to Aaron 15 s earlier (12:24:09). Check that fight's
verdict too.

## How much data is needed, and when

The player fights **~20–24 regular fights a day** (Oct 26–31). As of
2026-11-01 there are ~56 since the patch.

| Question | Data needed | When |
|---|---|---|
| Real armour vs card DEF (problem 2) | Each fight log's `reduction`, paired with the opponent's card from the arena panel shown just before | **Now**: the ~56 post-patch fights are enough |
| Refit the advisor's formulas to the patched game | ~150 fights | ~4–5 days after 2026-11-01 (around Nov 5–6) |
| Coin-flip vs the game's % (problem 1) | ~30 coin-flip fights; about 1 in 4–5 fights is a coin-flip | ~1 week (around Nov 8) |
| Beatable but the game says < 50% (problem 2's band) | ~15–20 such fights | Several weeks: rare, maybe one every day or two. Don't wait for it. |

## Plan

1. **Armour check (can run now, read-only):**
   - For every post-patch regular fight, take the opponent's real reduction
     from the attack log (`rounds[].attacker.reduction`).
   - Pair it with the card's DEF from the preceding
     `panel.php?…type=arena` HTML.
   - Report the ratio's spread: whether it's always ~1.17×, or depends on
     level, rank or gear.
2. **Full review around Nov 8:**
   - Advisor verdict vs the game's % vs the outcome, for every post-patch
     regular fight.
   - "Beatable but game < 50%" gets its own row.
   - Refit the card coefficients.
   - Test whether an armour margin, or treating near-armour fights (the
     player's damage only just above the opponent's armour) as coin-flips,
     fixes the NehNehPok-type cases without breaking the 28/28 Beatable
     record.
3. **Present options to the player before changing anything.** Any change
   in behaviour goes behind its own page setting, default off (see memory
   `feedback_keep_existing_behavior_toggle_new`). Options offered so far:
   - (1) leave it as it is
   - (2) defer to the game's % when it disagrees with the advisor
   - (3) show the game's % on the badge
   - plus the armour fix above

## How to count fights

Count the `POST /actions/arena_v2.php` rows with `action=attack`, excluding
`opponent_id=0` (bosses). Take every archive from `find_archives()`, plus any
new export still in `~/Downloads/`, and remove duplicates by
(`isoTime`, `requestBody`).
