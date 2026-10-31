# Arena changes, season of 2026-10-27

What changed in the Arena during the season that started 2026-10-27 23:00 UTC,
what the archive shows, and what the advisor does about it. Written 2026-10-31
after the account owner saw quotes like 99%, 77% and 4% on opponent cards,
won two Iron River bosses the advisor rated Avoid, and felt the season was
going badly. Background: [arena-combat-mechanics.md](../arena-combat-mechanics.md).

Data: every Arena request in the archives (merged Aug–Oct, unmerged exports,
the 2026-10-31 12:45 UTC download): 1,089 fights. Only ~1 day falls after the
patch (44 regular fights, 9 bosses), so the post-patch numbers below are thin.

## Two changes at once: 2026-10-30, 10:54–11:09 UTC

Gazette, "Halloween & Arena Changes" (Oct 30, 12:40 server time):

> Win chance calculations now run 24 real-time combat simulations when you
> refresh a page, giving a much more accurate win chance % than before.
> Previously most players would consistently see 49-51% win chance no matter
> the opponent.
>
> Previously, a players visible stats would be understated on each pre-fight
> card, even your own for other players. This was visual only and actual
> arena fight calculations were always true to locked in state. All opponents
> will now display the correct locked in stat state.

The last card on the old formula is 10:54 UTC, the first on the new one 11:09.

### 1. The card's % CHANCE is now a simulation

Before: `≈ 252 − 23·ln(Combat Power)` for every card, within ±1 point, every
week since September. After: clamped to 1–99, depends on the actual stats
(Kakashi, CP 7,049, STR 2,365: 22%; Elizium, CP 6,962, STR 1,234: 45%). The
same opponents went 59–63% → 99% (Hollow, Mazulis, Zelrik, Ninjatastic1).

Regular opponents since the patch:

| Game % | Won |
|---|---|
| 90–99 | 30/30 |
| 50–89 | 5/6 (loss: 4lbert at 65%) |
| under 50 | 0/8 |

- Kill-race score ≥ 1 called 41/44; the game % 43/44; in the 0.8–1.2
  coin-flip band the game % called 15/16.
- 24 simulations means steps of ~4 points and roughly ±10 points of noise
  near 50%.
- **Boss quotes did not change**: still 49–51% every time, and bosses won
  18/18 this season. Ignore them as before.
- The account owner reads the % straight off the card, so the advisor keeps
  its own verdicts and only uses the quote, as before, to lean coin-flips
  (`COINFLIP_LEAN_QUOTED_PCT`). Its "~67%" on a coin-flip is that band's
  past record, not the fight's chance — IcePick showed ~67% beside the
  game's 77% and was won twice.

### 2. In-fight numbers moved, with max HP unchanged

Despite "visual only", the combat logs moved at the same moment. The
player's own numbers at locked max HP 926:

| | Before 11:00 Oct 30 | After |
|---|---|---|
| Mean base damage | ~892 | ~1,020 (+14%) |
| Reduction (armour) | ~1,386 | ~1,505 (+9%) |

The same opponents' reduction rose ~4–6% (Mazulis 750 → 794, Herlims
737 → 787, mazzdingo 911 → 965); their cards changed by only 1–5 points.
The owner's note: the boost may come from careers, bloodline or similar
progress. Stats are meant to lock at season start, but the logs show the
fights used the higher numbers from the patch on.

The same kind of jump happened once before, unnoticed: **2026-10-07 13:49
UTC**, max HP 804, base 438 → 488, reduction 860 → 906.

**Effect on the advisor:** your numbers were the median of up to 250 fights
at the same max HP, restarted only when max HP changed, so after a jump they
lag for weeks. On Oct 31 it still held reduction ~1,394, so the two Iron
River bosses scored as Avoid:

| Boss | STR | Advisor then | With real numbers | Result |
|---|---|---|---|---|
| Raul Mendoza | 3,197 | 0.45 | 1.22 | won |
| Diego Alvarez | 3,293 | 0.36 | 0.77 | won (4 of its hits blocked) |

Regular verdicts moved ~0.02 (minimum damage decides most of them).

**Fix (2026-10-31, `foldFight` in `src/shared/arenaCombat.ts`):** after
each fight, if the median of the last 5 fights is off the median of the
earlier ones by more than 8% (base damage, noisy fight to fight) or 4%
(reduction, steady to ±1%), only the last 5 fights are kept. Replayed over
all 1,089 archived fights it fires on Oct 7 13:49 and Oct 30 11:10 and
nowhere else, and no verdict got worse (rule 969/1,081 either way; boss 1.3+
now 109/110). `verify_combat_rule.py`'s `Profile` mirrors it. A stored
profile corrects itself on the next fight.

### Still open: card → combat formulas

Opponents' logged numbers against what the card formulas predict:

| | Before the patch | After |
|---|---|---|
| Base damage (regular) | +2% | +6.5% |
| Reduction (regular) | −3% | +2% |
| HP (regular) | −2% | −0.5% |

Too few fights to refit (44). Rerun `verification/arena/verify_combat_rule.py`
section 3 once ~150 post-patch fights exist and refit the coefficients in
`arenaCombat.ts` (and the script) if the drift holds.

## "Not doing well this season" — it's the bounty ladder

| Season from | Regular won | Bosses won | Banked per page | Per day |
|---|---|---|---|---|
| Oct 13 | 137/168 (82%) | 33/34 | 280 | ~1,500–1,900 |
| Oct 20 | 92/120 (77%) | 29/29 | 273 | ~1,550–1,750 |
| **Oct 27** | **73/88 (83%)** | **18/18** | **140 (max 175)** | **535–885** |

- The fixed bounties from Oct 28 (25/30/35/40 + boss 45) cap a page at 175,
  down from ~300–390. That cut applies to everyone; rank is the real measure
  (not in the archive).
- Lineups aren't harder: 1.97 Beatable opponents per lineup vs 2.01 and 1.95
  the two seasons before; median opponent STR 1,042 vs 1,035; 86% Passive.
- Refresh works as before: across 44 refreshes, expected wins per lineup
  went from 2.39 to 2.70 (+0.31; earlier seasons +0.16 to +0.43). It can no
  longer find a bigger bounty, only an easier lineup.

## Re-checking

Scratch scripts for this were one-offs. To redo: run
`verification/arena/verify_combat_rule.py` (its section 2 shows the
quote-vs-CP fit per week, which collapses from the patch on), and for the
own-numbers timeline print `my_base` / `my_red` per fight from its
`build_fights`.
