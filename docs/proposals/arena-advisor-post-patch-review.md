# Arena Fight Advisor: review after the Oct 30 patch

Status (2026-11-01): **gathering data, nothing changed.** The player paused
any advisor changes until there's enough post-patch data. Don't blend the
game's own % into the advisor without asking first.

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
