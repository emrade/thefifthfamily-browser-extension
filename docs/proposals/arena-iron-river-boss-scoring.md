# Arena: scoring Iron River bosses near the player's armour

Status (2026-11-04): **proposal only. Nothing built.** The player is
monitoring more Iron River fights first.

## The problem

The Fight Advisor calls almost every Iron River boss **Avoid** (score
0.22–0.26). Since the gear change on Oct 31, the player has fought five and
won four:

| When (UTC) | Boss | Result | Advisor score | Simulated win chance |
|---|---|---|---|---|
| Oct 31 11:17 | Raul Mendoza (STR 3197, DEF 1118) | Won | 0.26 Avoid | 65% |
| Oct 31 12:42 | Diego Alvarez (STR 3293, DEF 1278) | Won | 0.22 Avoid | 41% |
| Nov 2 01:14 | Connor Briggs (STR 3245, DEF 772) | Won | 0.97 coin-flip | ~100% |
| Nov 3 12:14 | Vito 'The Shadow' Moretti (L129, STR 3244, DEF 1350) | Won | 0.24 Avoid | 36% |
| Nov 4 11:42 | Vito 'The Shadow' Moretti (L137, STR 3297, DEF 1327) | **Lost** | 0.23 Avoid | 29% |

- Source: merged 2026-10 and 2026-11 files, plus
  `fifth-family-archive-new-2026-11-04T11-43-10-612Z`.
- Player for all five fights: Omertà Rifle +9, 926 HP (1,007 from Nov 4),
  soaks about 1,476 of each boss hit.
- With these win chances, about 2.7 wins out of 5 would be typical. The
  player got 4.

## Why the score is wrong for these bosses

**Iron River bosses hit right at the player's armour.**
- They are STR-built: about 3,200–3,300 STR, roughly double the other
  families.
- Their mean hit before armour is about 1,575–1,600. The player's armour
  soaks about 1,476.
- Each boss hit before armour varies a lot:
  - across the 33 logged boss hits, it ranged 0.87–1.17 × the card estimate;
  - the standard deviation was 8%.

**So each hit is a gamble:**
- Below the armour, the boss does only the 45–75 minimum.
- Above it, about 0.95 × (hit − armour) gets through: 100–370 per hit in
  these fights. Every logged hit that got through fits this, at 0.94–0.95.

**What the advisor does today:**
- `verdictFor` in `src/shared/arenaCombat.ts` scores with **one average hit
  per side**.
- Because of `BOSS_DAMAGE_MARGIN` (15%), whenever the margin would push the
  boss past the armour, it scores **every** hit as 15% stronger (about 1,840
  → about 330 damage).
  - That puts the score at about 0.23 (Avoid).
  - Without the margin, the score would be about 0.8–1.0 (coin-flip).
- Neither figure is the real expected damage. The real average is
  E[max(min, 0.95·(hit − armour))] over the spread of hits, which works out
  to roughly 140–150 per hit.

**The bigger missing piece is the dice.** The single-hit score ignores
dodge, block, crit and first strike. Here they decide the fight:
- Player dodge 11.5%, block 17.5%.
- Boss crit 9–16%, at ×1.3.
- Player crit 25%, at ×2.15–2.55.
- Player first strike 4–25%, doing minimum damage.

## What happened in the Nov 4 loss

1. **Dice: the main cause.**
   - The player dodged 1 of 8 boss swings; on Nov 3 it was 4 of 13.
   - The boss landed 371, 255 and 212 in a row.
   - The player missed 3 of 8 attacks and got only 1 crit.
2. **The season's level change.**
   - Boss STR +53 means about +25 to every hit, and all of it gets through.
   - In the simulation that cost about 10 points (39% → 29%).
   - HP growth on both sides (926 → 1,007 vs 740 → 780) roughly cancelled
     out (27% vs 29%).
3. **The player's side was unchanged.** Same armour (1,475 → 1,478), same
   damage.

The lever that matters is **armour**. Win chance in the simulation of the
Nov 4 fight, by how much of each boss hit the armour soaks:

| Armour soak | 1,476 (now) | 1,525 | 1,575 | 1,625 | 1,700 |
|---|---|---|---|---|---|
| Win chance | 28% | 48% | 69% | 86% | 97% |

## Proposal

For a **boss** whose expected hit range overlaps the player's armour, stop
scoring with one average hit. Choose one of the following.

**Option A: expected damage over the hit spread (small change).**
- Set the boss's `theirHit` to the average of max(min damage, 0.95·(hit −
  armour)) over the logged spread of hits (×0.87–1.17, standard deviation
  ~8%).
- This replaces both the nominal hit and the `BOSS_DAMAGE_MARGIN`
  pessimistic hit.
- The score stays a kill-race ratio and the bands stay as they are.
- Expected effect: Iron River bosses near the armour would score about
  0.6–0.9, so coin-flip instead of Avoid.

**Option B: simulated win chance (bigger change, better answer).**
- Simulate the fight from the logged dice:
  - dodge, then block, then crit, each rolled per swing;
  - first strike;
  - a minimum damage of 45–75;
  - the spread of each hit.
- Use the resulting win chance for bosses in this armour-edge zone, instead
  of the band prior (`bossAvoid` 1/3).
- Show it as "~30%" on the badge, so a 65% fight and a 29% fight no longer
  both read "Avoid".
- Cost: about 5–10k simulated fights per boss card. That is fine on page
  load, but should be cached per card.

**Either way:**
- Keep the change behind its own setting, default off, as with other new
  advisor logic.
- Add a section to `verification/arena/verify_combat_rule.py`:
  - replay every boss fight in the archive;
  - compare the new estimate with the actual results;
  - also check the non–Iron River bosses, as a control.

## Before building: what to collect

- **More Iron River fights at the current level (137) and armour.**
  - Five fights can't tell 30% from 50%.
  - At about 15–20 fights, check: did the simulation's predicted win rate
    match the actual win rate?
- **Whether armour soak varies by attacker.**
  - Against Iron River the logs show 1,474–1,478.
  - The advisor's profile holds 1,504: the median across all fights.
  - Use the per-family figure if it differs consistently.
- **The 0.95 factor on hits that get through.**
  - It appears only on boss hits against the player; the player's own hits
    use the full overshoot.
  - Check whether it comes from a gear or set bonus, so a gear change
    doesn't silently move it.
- **Older Iron River history** (September/October, before the Oct 31 gear
  change). Those fights were at lower armour and were mostly lost, so they
  test the model at a different armour gap.

## The numbers' limits

- The simulation is a reconstruction from the logged rules, so it is not
  validated beyond these five fights. It takes each fight's own logged
  chances and the player's spread of hits.
- The archive runs to 2026-11-04 11:43 UTC.
