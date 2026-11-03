# Arena after the Oct 30 patch: independent review 1, findings (reconstructed)

> **Reconstructed, not the original.** Review 1's own file was overwritten
> when review 2 saved to the same path, and it was never committed. This page
> was rebuilt on 2026-11-03 from two surviving sources:
> - the reviewer's hand-back report, which summarised its conclusions and its
>   comparison with the earlier analysis;
> - its section 5, Recommendations, which was read word for word before the
>   overwrite and is reproduced as closely as possible below.
>
> The detailed method, tables and per-finding evidence are lost. The scripts
> survive in `/private/tmp/claude-501/arena-independent-review/scripts/`
> (`parse.py`, `build.py`, `fightparams.py`, `hits.py`, `sim.py`,
> `cardsim.py`, `oracle.py`, `kfit.py`, `reg.py`, `analytic.py`,
> `compare.py`, `checks.py`, `evalutil.py`, `common.py`, `advisor.cjs`,
> `arenaCombat.cjs`), with extracts in `data/` there (temporary storage, may
> be cleared). Re-running them would rebuild the numbers.
>
> Brief: `docs/agent-briefs/arena-post-patch-independent-review.md`. Review
> 2: `arena-post-patch-independent-review-findings-2.md`.

## Data

- **Fights:** 116 post-patch regular fights, 2026-10-30 11:10 → 2026-11-03
  12:23 UTC; 90 won.
- **The game's %:** anything using it was measured on the 96 fights whose
  card was loaded after the patch and at most 15 minutes before the fight.
- **Coverage:** no gap in the post-patch span. One gap, 10-28 15:44 → 10-29
  00:24, falls before the patch.

## Summary of conclusions

**What decides a fight**
- Most hits land a small floor of about 20–75. A hit only does more when the
  attacker's base damage beats the target's armour.
- Base is rolled fresh on every hit, about 16% either side of the attacker's
  average. So an opponent whose average sits just under the player's armour
  still breaks through on some hits, and those do 2–4× the floor.
- Crits, blocks, dodges, first strikes and HP decide the rest. The roll rules
  held exactly on all 2,084 logged hits.
- In close fights, HP on both sides and the opponent's base damage matter
  most.
- The player's crit multiplier depends on the opponent's DEX: ×2.55 against
  DEX up to ~870, falling to ×1.6 at ~1,800 (a capped fit).

**Best predictor: the game's own % on the card**
- It is fixed when the page opens and is well calibrated.
- 95% or more: 62/62 won. 5% or less: 0/9 won. AUC 0.992.
- A simulation of the rules, fed each fight's logged numbers, matches the
  game's % to within ~2 points (r 0.996).
- A card-only simulation, tested only on fights after the ones it was fitted
  on, came close (AUC 0.989) but didn't beat the game's %.
- The extension's current advisor: AUC 0.88–0.90, with an error score about
  2.7× worse than the game's.

**Why "Beatable" fights were lost**
- All 3 post-patch Beatable losses were NehNehPok, which the game rated 15%.
- The advisor uses card DEF as armour; real armour is ~1.1× DEF
  (0.90–1.67×).
- It also compares *average* damage with armour, so it misses high rolls:
  against NehNehPok, 13 of 32 landed hits broke through the player's armour
  and did 59% of their damage.
- Only 2 of the 26 losses cost any pot: 30 and 70, both NehNehPok. The other
  24 were deliberate long shots taken with an empty pot.

## Recommendations

From its section 5, "Recommendations (options; each behaviour change would
be a new setting, off by default)":

1. **Use the game's % as the win chance.** Use it for the badge, the
   "riskiest first" ordering and `expectedPot`, in place of the score bands.
   It is measurably the best number available before a fight, and it is
   already on every regular card (all 852 post-patch regular-card views had
   one). Possible badge wording:
   - "Safe" at 95% or more (62 of 62 won);
   - "Risky" at 5–95%;
   - "Long shot" at 5% or less (0 of 9 won).
2. **Keep the kill-race as an explanation, not a verdict.** Next to the
   game's %, show *why*, using the corrected maths. For example:
   - "they break through your armour on ~45% of hits";
   - "your crits ×1.6 against their DEX";
   - "≈11 rounds each".

   If this is kept, two fixes would bring it in line with the data:
   - (a) estimate the opponent's reduction as DEF × ~1.1, or better, take it
     from an earlier fight log against that opponent;
   - (b) count the share of their ±16% base rolls that clear your reduction,
     instead of comparing averages.
3. **Remember opponents.** The same names come back often (Zelrik ×7,
   DaynJah ×5, Ninjatastic1 ×5, IcePick ×4, NehNehPok ×3). The logged
   parameters from an earlier fight predicted a repeat fight a little better
   than card stats did (Brier 0.041 vs 0.058 on 32 repeats). Showing "last
   time: won in 12 rounds, they hit you for 958" costs nothing.
4. **A pot line that uses the game's %.** Before a fight with pot P, bounty B
   and win chance p, fighting gains more than banking only if
   p > P ÷ (P + B). The extension could say so ("bank first: 70 at risk for
   40 at 15%"). Since all four opponents must be fought before the boss, the
   useful advice is the **order**: long shots while the pot is empty, safe
   fights after. The player already does this; the two pot-losing fights are
   the exceptions it would have caught.
5. **Don't show a "Beatable" badge that contradicts the card.** Even without
   option 1, the advisor could defer whenever its verdict and the card's %
   disagree by a lot (e.g. Beatable while the card says < 50%). On this data
   that would have flagged all 3 Beatable losses and no wins.

## Comparison with the earlier analysis (its section 8, summarised)

**It agreed on:**
- the game's % being near-perfect since the patch;
- card DEF understating armour;
- the roll order;
- the ~5% damage cut;
- first strikes;
- a simulation reproducing the game's %.

**It disagreed on four points** (each later verified and accepted by the
earlier analysis):
1. "Both sides did mostly floor damage" against NehNehPok missed that the
   high-roll hits did 59% of his damage.
2. The ×1.10 armour margin was tuned and tested on the same 3 losses against
   one opponent. It also leaves the Coin-flip band mixed: 7 fights the game
   rated 1–4% (all lost) and 8 rated 90%+ (all won).
3. `armory_mult` doesn't raise damage on top of the logged numbers: the
   damage factor on the player is 0.942–0.948 at every armory value. The
   earlier simulation options applied it, overstating opponents by up to 7%.
4. Its capped crit-multiplier fit beat the earlier one against high-DEX
   opponents (error −0.005 against +0.08).

**It also:**
- Questioned the earlier docs' note that the game's % is "24 simulations,
  ±10 points noise": most % values aren't multiples of 1/24, and they sit
  closer to a simulation than 24 runs would allow.
- Found that `threat_ratio` and `tier` carry no win information since the
  bounty ladder.
- Found that Combat Power alone ranks post-patch fights at AUC 0.979.
- Found that the pre-patch game's % ranked fights well but squashed its
  numbers into 34–81%.
- Found that only 100 pot points were actually lost to advisor errors.

**Not re-tested:** the earlier work on Passive opponents, bosses, Refresh and
Mastery.
