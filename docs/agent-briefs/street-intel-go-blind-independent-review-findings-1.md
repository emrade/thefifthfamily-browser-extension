# Street Intel Go Blind: independent review, findings 1

Written from the data first. Everything above "Comparison with the earlier
analysis" was finished before I opened the earlier analysis. Data runs through
2026-11-04 22:52 UTC. Days are player days (WAT, UTC+1).

**Read with the last section.** Reading the earlier analysis led me to correct
four things below, listed under "Corrections to my own findings above". The main
ones: the dependable gain is +5% to +8%, and finding 12 is weaker than it reads.

## Summary

**Keep blind on. It is a sound stamina saver, not a proven luck boost.**

| Impression | True in the numbers? | How much is caused by going blind? |
|---|---|---|
| 1. More cash per Stamina | **Yes.** $92.6k vs $73.1k, +27% (blind, Nov 1-4, vs scouted, Oct 29-31) | **About +7% for certain**, the Stamina no longer spent on scouts. About 6 points is the Oct 29-31 baseline running unlucky, about 2 is card mix, and about 9 is Nov 1-4 running above its odds, which could be luck. |
| 2. Better success rate | **Partly.** 73.2% vs 67.8% against the last three scouted days, but scouted October as a whole was 72.4% on easier cards | **Unproven.** Blind beat its own odds by 4.7 points and scouted fell 2.4 short. That gap is suggestive (roughly 1 in 30 by chance, before allowing for how many things I tried) and is tangled with everything else that changed on Nov 1. What is well supported: **no penalty** for going blind. |
| 3. Better drops, lots of money | **Yes on value, and drops are worth more than the cash.** But since Oct 30 almost nothing has been sold, so the Nov 1-4 drop money is not in the bank yet | **Mostly not shown to be blind.** More Band 7 cards explain part of it, because attempt gold drops only come from Band 7. That rise comes from levelling up and a strict card minimum. The rest is a real-looking jump in top-tier drops that coincides with Nov 1 and can't be separated from it. |

What to expect if you stay blind: about 7% more cash per Stamina than scouting
the same cards, and a success rate near the displayed odds (about 68-70% on
today's cards), not a lasting 73%+. The clearest money finding has nothing to do
with blind: **drops outweigh cash, and the card minimum looks only at cash**
(finding 12).

## Method

**Data.** All seven files from `find_archives()`: merged 2026-08, -09, -10, -11
and raw exports `new-2026-11-04T11-43`, `T22-44`, `T22-52`. No fresh downloads
were in `~/Downloads`. I de-duplicated on timestamp + URL + origin + request
body. Rows from these files: 19,427 `street_intel.php` POSTs (4,115 attempts,
14,512 scouts, 795 complications, 5 go_dark), 20,604 board panels, about 47,900
`stats.php` reads, plus shop sales, inventory, crimes and market reads.

**Coverage.** Oct 1-Nov 4 has two gaps: Oct 23 22:43-Oct 25 23:18 and Oct 28
15:44-Oct 29 00:24 UTC. The Nov files join with no gap (merged ends 11-03 14:07,
the raw export starts 14:11, with `gapBefore:false`). Oct 29-31 and Nov 1-4 are
otherwise complete.

**Periods.**
- *Baseline, Oct 29-31:* 154 scouted attempts (152 auto, 2 by hand).
- *Blind, Nov 1-4:* 231 auto blind attempts. First at 11-01 00:50 UTC, last at
  11-04 22:40 UTC. The 11 scouted attempts on Nov 1 are held out as a tiny
  same-day control.
- *Wider baselines:* Oct 20-28 (429) and scouted Oct 5-31 (1,581 total, 1,535
  auto).

Oct 29 is the fair start because card minimums began around Oct 28-29 and low
payout cards almost vanish from then on. Even so, the floor wasn't steady: some
cards under $750k were still taken at 9-60% Stamina on Oct 30-31, while Nov 1-4
has none.

**Odds for every attempt.** I rebuilt each card's odds from what the board and
stats showed just before the attempt: wiki base, conditions sentence, the
board's "Your edge" (rank + prestige + mastery), the board's recon, the last
scouted collection, and the base stat ÷ 5. Checks: equal to the scouted number on
**198 of 198** attempts since Oct 20 where the approach was revealed (1,626 of
1,673 since Aug 21, with the misses mostly positive, as expected from short
buffs). Nothing dropped out of the joins: all 2,379 attempts since Sep 20 got a
card and a prediction.

**Stamina.** Card cost plus paid scouts (cached scouts are free). All scouts in a
period count, including those on cards not attempted.

**Drop value.** The game's own quick-sell quote (`dispose_quote`) where seen,
else 20% of the wiki cash value, the most common ratio (a few low-tier items are
lower, so this errs slightly high). Quotes never varied per item. Check: sold
amounts roughly match quote totals (Oct 20-28, $897M sold vs $789M of drops from
that stretch, with older stock sold too). 13 of about 520 gear drops had no price
and count as $0, as do shards, Mafia Gold and Platinum.

**Controls and looks.** Controls: the 3,576 auto scouted attempts since Aug 21
judged against their own odds; rolling same-sized windows of scouted attempts;
scouted attempts on an approach the scout had not revealed; 23 earlier hand-played
blind attempts; 11 scouted attempts on Nov 1; crime drops; the wiki's reward
range. I made **about 30 comparisons** (success about 8 ways, bands 4, complications
2, drop rate 5, drop tier 7, reward within band 3, complication loot 2). A single
"1 in 30" is not impressive among 30. The one strong number is the top-tier jump,
and I chose that test after seeing the data.

**Scripts** (not in the repo):
`/private/tmp/claude-501/-Users-emrade-Dev-Apps-browser-extensions-thefifthfamily-browser-extension/15d001f8-7c6b-4b8f-bc2b-e7124b407925/scratchpad/review-1/scripts/`.
`README.txt` there gives the run order. They read extracts made by grepping the
archives, and those large extracts have been deleted.

## Findings

### Cash per Stamina

**1. Measured: the rise is real, on top of a trend that started long before.**

| Period | Attempts | Stamina (cards + scouts) | Cash | Cash per Stamina |
|---|---|---|---|---|
| Oct 5-11 | 473 | 4,883 + 516 | $226M | $41.9k |
| Oct 12-19 | 540 | 6,197 + 582 | $385M | $56.8k |
| Oct 20-28 | 429 | 4,981 + 459 | $377M | $69.4k |
| Oct 29-31 | 154 | 2,123 + 161 | $167M | $73.1k |
| Nov 1-4, auto blind | 231 | 3,343 + 0 | $310M | **$92.6k** |

Complication cash losses barely matter ($3.5M blind, $0.6M baseline). 95% range
for blind, per card Stamina: $82k-$104k. For the baseline: $67k-$90k. These
overlap.

**2. Measured arithmetic, with one modelling step: where the +27% comes from.**
I fitted expected pay at each odds level on 2,075 scouted auto attempts from
Sep 20-Oct 31, then applied it to each period's actual cards.

| Step | Factor |
|---|---|
| Removing scouts (161 Stamina on 2,123 of card cost) | ×1.076 |
| Baseline ran below its own odds ($78.7k actual vs $83.4k expected per card Stamina) | ×1.060 |
| Card mix ($83.4k to $85.2k expected) | ×1.022 |
| Blind ran above its own odds ($92.6k vs $85.2k) | ×1.087 |
| **Total** | **×1.267** |

Only the first step is caused by blind for certain. The last has a 95% range of
0.98 to 1.19, so it includes "nothing". The same cards scouted would be expected
to pay about $79k per Stamina, so about +7% is the dependable gain.

**3. Measured: the auto-runner's choice rule did not change the cards.** I
replayed the old scouted rule and the blind rule on the real boards. On the
floor-at-$750k Nov boards, the two rules agree with the actual pick on 230 of 231.
On Oct 29-31, all 152 actual picks match the exact-odds rule. There are usually
only 1.3-1.6 cards clearing both the minimum and the 50% floor anyway.
So better selection isn't the source of the gain. The replay's bound on the
smart rule is modelled from the code, which is the one assumption here.

**4. Measured: other things that changed, and whether they matter.**
- Reward scale: not a cause. Board rewards equal the wiki range times a player
  multiplier that climbed from 1.04 (Aug) to 1.143 (Oct 20) and sat at 1.147 from
  Oct 27 through Nov 4. That climb is part of the earlier trend.
- Player level: 132 to 136 inside 41 minutes on Nov 1 (13:55-14:36 UTC), during
  hand-run crimes, then 137 on Nov 3. New cards at those levels entered the board.
- Card minimum: stricter on Nov 1-4 (lowest midpoint $850k vs $227k on Oct 29-31).
- Wiki: Street Intel page byte-identical between Oct 31 and Nov 4.
- Halloween drops ended Oct 31 (77 attempt drops since Oct 2, none after).

### Success rate

**5. Measured: the plain rate depends on the baseline.** Blind 73.2% (169 of 231)
vs 67.8% on Oct 29-31 and 72.4% for scouted auto Oct 5-31. Average odds were 68.5,
69.8 and 74.8. So blind matched October's rate on harder cards. "Success" here is
success + critical, which tracks the displayed odds. Adding partials overshoots
them by about 7-15 points.

**6. Measured: results against the card's own odds.**

| Group | n | Actual | Odds said | Gap |
|---|---|---|---|---|
| Blind auto, Nov 1-4 | 231 | 73.2% | 68.5% | **+4.7** |
| Scouted auto, Oct 5-31 | 1,535 | 72.4% | 74.8% | −2.4 |
| Scouted auto, Oct 29-31 | 152 | 67.8% | 69.8% | −2.0 |
| Scouted, approach revealed (all) | 1,586 | 71.9% | 75.4% | −3.5 |
| Scouted, approach hidden (all) | 1,990 | 73.7% | 74.9% | −1.2 |
| Blind by hand, Aug-Oct | 23 | 65.2% | 69.5% | −4.3 |
| Scouted, Nov 1 | 11 | 54.5% | 64.2% | −9.7 |

Blind vs scouted at equal odds is about +6-7 points. A regression gives
z = 2.0-2.4 on the longer baselines (Sep 20 on, Oct 5 on) and 1.6-1.7 on the short
ones (Oct 20 on, Oct 29 on), about 1 in 30 at best.
Only 0.9% of rolling 231-attempt scouted windows did as well (they overlap, so
that is rougher than it sounds). On its own, blind's +4.7 is 1.6 standard errors.

*Inferred: this is more likely mostly luck than a hidden server bonus.* The two
direct controls point the other way, though both are tiny, and a blind bonus has no
known mechanism. The game's own button says "No intel. Higher risk." Other things
changed on Nov 1 too. I can't rule a real effect out.

**7. Measured: no blind penalty.** If blind lost the recon bonus, the odds would
have been 61.2%, not 68.5%, against an actual 73.2%. That fits much worse
(log-likelihood −135.9 vs −129.2). A flat −5 is also rejected (−133.0), and −3
(−131.2) is about at the edge. The best fit is 0 to +5. Fewer failures than
expected (z = −2.1), no change in partials, and disasters not significantly
different (6.5% vs 9.7% on Oct 29-31).

Critical hits ran **lower** on blind: 10.0% vs 14.8% in October (z = −1.4). That
offsets part of the extra wins, because a critical pays about 1.46× the midpoint.
Pay within a band is the same (success 1.017 vs 1.005 of midpoint, critical 1.46
vs 1.465).

**8. Measured: real odds run slightly under the display in general.** Since
Aug 21, scouted auto attempts fell 2.2 points short (z = −3.2, n = 3,576), mostly
in the 50-70% range. At 90%+ the gap is zero. So "beating the odds" should be read
against about −2, not 0.

### Drops

**9. Measured: drops are worth more than the cash, and the value is real, but
November's is unsold.**

| Period | Intel cash | Attempt drops (quick-sell) | Complication drops | Actually sold |
|---|---|---|---|---|
| Oct 5-19 | $612M | $778M | $652M | $1,567M |
| Oct 20-28 | $377M | $324M | $465M | $897M |
| Oct 29-31 | $167M | $142M | $94M | $221M |
| Nov 1-4 | $322M | $545M | $178M | **$3,400** |

The last automatic bulk sale was Oct 30 21:03 UTC. The Nov 4 22:33 inventory still
holds these items (for example Reinforced Field Harness, Fire Opal Bauble, Iron
Diadem). I found no sale through another route. So about **$723M** at quick-sell
is sitting in inventory. Bank grew $189M a day on Nov 1-4, against $210M a day on
Oct 26-31 including $426M of sales. Without sales the October figure is about
$125M a day. So the banked rise is real but much smaller than the drop figures.
Sales aren't tagged by source; the singles I could name were 99% items Street
Intel also drops, but crimes share some of those items.

**10. Measured: drop tier follows the card's Band.** Since Sep 20, attempts at
Band 7 are the only source of gold (17 of 17), Band 6 of nearly all Underworld
Epic (84), Band 5 of most purple (91 of 100) and Band 4 of Infamous Rare
(63). Band 7 is what changed most: 5% of attempts on Oct 20-28, 15% on Oct 29-31,
31% blind. New Band 7 cards on the board went 5.5% to 7.8% to 11.3%, with distinct
Band 7 card levels 10 to 11 to 17 as the player levelled. The minimum also stops
attempts on cheap cards when nothing bigger is up, which raises Band 7's share.

**11. Measured then inferred: what's left over is a jump in top-tier drops I can't
explain.**
- Attempt drop value per card Stamina: $67k baseline, $163k blind (95% range
  $101k-$232k). At scouted per-win, per-band rates: $80k and $98k. So mix and win
  count give about +23%, and blind's actual is far above that.
- Overall drop rate per win: 34.3% vs 29.4%; adjusted, not significant
  (coefficient 0.23, SE 0.23).
- Top-tier drops per win in Bands 4-7: **38 of 155 (24.5%)**. Expected about 24 from
  scouted rates, z = 2.9-3.3. Every band is up (gold 20% vs 11%, Epic 25% vs 16%,
  purple 29% vs 20%, Infamous Rare 38% vs 21%), none significant alone. Earlier
  periods sit at 16-19% (including Sep 20-Oct 1, before Halloween drops existed, so
  the event ending doesn't explain it). No rolling scouted window reached this:
  the largest excess in 1,038 windows was +8.8, here +14.5.
- Against blind as the cause: hand-played blind wins had 2 top-tier drops in 15,
  scouted Nov 1 had 0 in 6 wins, and nothing in the request ties a drop to a scout.
- Crimes, which don't use the setting, also show more gold: 7 of 1,535 successes in
  October, 9 of 431 in Nov 1-4 (p = 0.003). But all nine came on crimes newly
  reached by levelling (1066-1068), and five came in that 30-minute hand-run burst.
  So this control can't separate level from date. Only crime 1066 has both: 0 of 18
  in October and 5 of 188 in November.

*Inferred:* a real change started around Nov 1. It might be blind, but a level
threshold or an unannounced loot change fits at least as well. **I could not
settle this.** It's the most interesting open question and also the one I chose
after looking, so hold it loosely.

### Other things worth knowing

**12. Measured with wide ranges: the card minimum ignores what cards are actually
worth.** All cards since Oct 5, including drops at quick-sell:

| Card type | n | Stamina | Cash midpoint | Odds | Cash per attempt + drops | Per Stamina (95% range) |
|---|---|---|---|---|---|---|
| Band 7, low | 27 | 11 | $264k | 95 | $5.87M | $534k ($153k-$1,024k) |
| Band 6, low | 46 | 9 | $173k | 95 | $4.04M | $449k ($228k-$722k) |
| Band 7, high | 25 | 18 | $2.25M | 67 | $8.43M | $468k ($219k-$763k) |
| Band 6, medium | 186 | 12 | $578k | 84 | $3.30M | $275k ($192k-$365k) |
| Band 6, extreme | 106 | 19 | $4.59M | 54 | $5.99M | $315k ($223k-$415k) |
| Band 5, extreme | 106 | 15 | $2.80M | 55 | $2.79M | $186k ($112k-$284k) |
| Band 4, extreme | 120 | 13 | $1.69M | 58 | $1.51M | $116k ($82k-$159k) |

A $750k cash minimum passes Band 4 extreme and blocks Band 6-7 low, and ranking by
odds × cash would pass them over anyway. At least one
blocked Band 6-7 card with 50%+ odds was on the board for 180 of 231 blind attempts
(78%). This is worth money only if drops get sold, and it rests on few gold drops.
Since Oct 28 very few of these were played, so it's history, not a test.

**13. Measured: complications are a profit, not a cost.** Complication rate on
success/partial results is unchanged: blind 21.8%, Oct 5-28 21.5% (Oct 29-31 was a
low 14.5%; adjusted blind coefficient −0.01, SE 0.19). The sentence on the card
matters ("lower" −0.62, "higher" +0.33). Lost complications cost about $294k on
average (38 cases). Won ones drop something about 30% of the time, worth about
$5M per win on average, including gold from any Band (Bands 1, 3, 4, 5, 6, 7).
By choice since Oct 12: `run` $7.24M per complication (n = 144), `stand_ground`
$3.53M (n = 10), `fight` $3.17M (n = 36), `talk` $0.76M (n = 36). I didn't check
for confounding here.

**14. Measured: Stamina may not be the tight limit.** Median Stamina just before a
blind attempt was 153 of 372, and half of attempts fire within 2 minutes of the
cooldown ending. Stamina items are also being used (for example 20 items, +595, on
Nov 4). So part of the "saved" Stamina is fewer drinks rather than more attempts.
Cash per attempt is a fair second yardstick: $1.08M to $1.34M.

**15. Read from code, with the board checked: blind mode can drift out of date.**
Mastery, recon and collection only update from scouts (`playerMods.ts`); rank also
updates from attempts. With no scouts, a mastery level-up or recon change won't
reach the prediction. So far no harm: the board's edge has been 38 on all five
categories and recon 31.5 since Oct 31. Several trees are close to levelling (for
example Robbery 822/850). A stale prediction runs low, not high, so the risk is
skipping cards or choosing slightly wrong, not taking worse ones. The board shows
both "Your edge" and recon, so no scout is needed to keep them current.

## How confident can you be, and what would settle it

- **Stamina saving:** certain. It's arithmetic.
- **"Blind isn't worse":** fairly confident on success and complications, from 231
  attempts at formula-matching odds.
- **"Blind is luckier":** not shown. +4.7 has a standard error of 3.0.
- **"Blind gives better drops":** not shown. There's a real-looking jump, with Nov 1
  bundled together with a level jump, a stricter minimum and the end of Halloween.

A before/after can't separate these, however long it runs. **Only running both at
once can.** Alternating scouted and blind per attempt, with the same minimum, costs
about 1 Stamina every other attempt:
- top-tier drop rate 24.5% vs 18%: about 620 wins in Bands 4-7 per arm, so about
  900 attempts per arm, or about 30 days at 60 attempts a day;
- success gap of 7 points: about 670 attempts per arm, 22 days; 5 points: about
  1,300 per arm, 44 days.

Without a test, continued blind data tells you only whether the excess holds: after
1,000 blind attempts the +4.7 would have a standard error of about 1.4. It's also
useful to record whether the top-tier rate stays up if you ever go back to scouting.

## Recommendations (options, your decision)

Anything that changes behaviour would be a new setting, off by default.

1. **Keep blind on (my suggestion).** Dependable +7% with no penalty found. If you
   switched back you'd lose that and, on what's shown so far, nothing else. Plan on
   $80-95k cash per Stamina at today's cards.
2. **Sell, or decide to hold, the drops.** About $723M at quick-sell has sat there
   since Oct 31. Check whether the auto-sale stopped on purpose. I couldn't tell.
   The market's lowest listing is often about 1.75× quick-sell (median of 53 reads),
   but that's the game's price floor, usually with no recent sales, so not proof it
   would sell there.
3. **New setting, off by default: scouted/blind A/B test.** Settles impressions 2
   and 3, and costs little.
4. **New setting, off by default: rank and floor cards by cash + expected drop value
   by Band.** Biggest potential gain, but only meaningful if drops get sold. The
   table in finding 12 is thin, so it deserves its own check first.
5. **Small fix to consider: refresh mastery and recon from the board's own numbers**
   in blind mode (finding 15), instead of waiting for a scout.

## What I couldn't settle

- Whether the top-tier drop jump comes from blind, level or a game change.
- Whether any of blind's +4.7 is real.
- Why selling stopped after Oct 30, and whether crime and other sales were mixed
  into drop-sale totals. Bulk sales aren't itemised and items overlap with crimes.
- The player's exact settings on each day. The archive doesn't record them, so the
  floor and rule are inferred from what got attempted.
- Whether `collection` changed after Nov 1, with no scout to show it. Short buffs
  on Nov 1-4 can't be seen either, though none appeared in 654 scouts from Oct 20
  on, which makes a hidden buff unlikely.
- Long-run drop value by market. Only quick-sell is reliable.

## Comparison with the earlier analysis

Written last. I read `docs/street-intel-plan.md` ("Exact odds, Go blind and the
Scouting choice", "Go blind: first live results"),
`docs/street-intel-estimate-calculation.md` ("Is a blind attempt rolled the
same?"), `analyze_blind_vs_scouted.py` and `simulate_scout_modes.py`. I ran both
scripts read-only: their main numbers reproduce, including 169 vs 158.1, the
+7.4-point figure, 17 gold drops worth part of $727.8M, and $70.37M vs $68.77M.

### Where we agree

- All three impressions are true on the surface, and the bottom line is the same:
  keep blind on, and don't count on a success or drop bonus yet.
- No blind penalty. +4.7 points against predicted odds, and scouted about −2.2.
  Independently I also got about 6-7 points at equal odds, with the same weaknesses
  (fewer criticals, hand-played blind shows no uplift, no known mechanism).
- Above-odds cash: their same-title check gives +8.6% ($90.9k vs $83.7k). Mine gives
  +8.7%, from a different method.
- Crime gold rose too, on newly reached crimes only, so it's a limited control.
- Nov's drops are unsold, with the last big sale on Oct 30.

### Where I disagree

**1. Error: "+2% to +8%" for not scouting mixes two yardsticks.** The +2.3% in
their replay is cash *per day*. The question is cash *per Stamina*. I added Stamina
totals to a scratch copy of the replay: Go blind $74.5k per Stamina vs Smart exact
odds' $70.9k, **+5.1%**. So on their own replay the range is **+5% to +8%** per
Stamina, with +2.3% only as the gain per day on a fixed Stamina supply. This doesn't
overturn "blind is a minority of the rise", but the low end was too low.

**2. "Without gold, value is flat" hides a rise.** It's a per-attempt average, and
31% of blind attempts are on Band 7, where non-gold drops are worth almost nothing.
Like for like, the top-tier rate on wins in Bands 4-6, which excludes gold entirely,
is 26 drops vs 17.1 expected (z = 2.4), and in Band 7, 12 vs 6.4 (z = 2.3). Their
gold test (12 of 72 vs 2 of 37, p = 0.13) looks at one tier, so it never sees this.
The data supports "attempt-route drops got richer in every Band on Nov 1-4". That's
still a test I chose after looking, and still can't be pinned on blind.

**3. "No better than mid-October" is true of the total, but it joins two different
things.** Oct 15-25's $201k per Stamina is 23 of its 26 gold from complications;
Nov 1-4 is 12 of 17 from attempts. Their own write-up splits the routes, yet its
headline treats these as one, as if October had already done what November did.
On the attempt route alone no earlier period matches November. I'd headline it as:
total drop value isn't unprecedented, but the attempt route is new.

**4. They give no cause for "31% on level 125+", and the level change is understated.**
"A level-132 crossing" undersells it. 132 came on Oct 31 22:43 UTC, then **133-136
in 41 minutes on Nov 1** and 137 on Nov 3. That took Band 7 from 11 to 17 distinct
card levels on the board and 7.8% to 11.3% of new cards. My replay shows the choice
rule didn't change picks (finding 3). So the shift is supply plus the minimum, not
blind, which the doc leaves open.

**5. The frozen-modifiers worry can be largely closed.** They list stale modifiers
as an open reason the +4.7 might be overstated. The board shows "Your edge" and
recon on every read, and neither changed from Oct 31 through Nov 4, so rank,
prestige, mastery and recon are ruled out. Only collection and a short buff remain.
Neither script reads these board values.

**6. Things they rest on without checking.**
- *"A couple of hundred blind attempts settle it"* settled only "no penalty". And
  *"re-check at about 500"* can't settle the cause, because every blind attempt is
  still after Nov 1. Only running both side by side can (sizes above).
- *"Those scouted attempts are the comparison's baseline"*: this baseline barely
  exists. Only 4 scouted auto attempts came after the first blind one, the last at
  11-01 09:26 UTC. So `oddsCheck` will hold almost no same-time scouted data.
- *Cash per day $50.8M to $79.6M, Stamina 670 to 878:* the Oct 26-31 baseline has no
  rows for 8.7 hours (Oct 28 15:44-Oct 29 00:24 UTC), about 6% of the window. No
  attempts appear there, though the runner was active right up to it. So the
  per-day baseline is probably about 6% low. The table has no such caveat, though the
  replay's output does.
- *The replay's fixed `CALIBRATION` curve* isn't fitted in the script and sits 6-14%
  below a straight line I fit on Sep 20-Oct 31 at 55-85% odds (55: 0.55 vs 0.64; 65:
  0.70 vs 0.74; 85: 0.88 vs 0.95). With a fixed 480s cooldown (real average about 530s) and
  all Stamina spent (ends at 1-10 where real play sits well above 100), it gives
  66.8 attempts a day against about 60 real. Row-to-row comparison is probably fine;
  absolute dollars aren't.
- *The +7.4-point interval (+1.5 to +13.4)* treats the scouted baseline as exactly
  known, and it includes hand-played attempts. With baseline noise and shorter
  windows my z runs 1.6-2.4 vs their 2.45. A small overstatement.
- *Fisher p = 0.51* in the doc: the script with `--since 2026-10-15` prints 0.565.
  This doesn't matter to the conclusion. I couldn't find which settings give 0.51.

### What they found and I missed

- **The card minimum is the biggest single cause against the wider baseline.** On
  Oct 26-31, cards at $800k+ paid $87.3k per card Stamina and cheaper ones $37.5k,
  and my model agrees ($88.5k and $37.2k). That confirms their +15%. Starting my
  baseline at Oct 29 put most of this out of view, making my "card mix about +2%"
  true only for that short window.
- **The complication route changes over time.** Oct 1-14: 19 Epic, 1 gold.
  Oct 15-25: 0 Epic, 24 gold. Since Oct 26: 7 gold from 84 wins (24 vs 7, p = 0.001).
  I checked this against my data: all confirmed, and `run` accounts for most of it
  (28 drops from 66 wins, then 3 from 29, then 6 from 24). Unexplained by either of
  us. I averaged over it.
- **The success excess is all on high-risk cards** (86 of 106 vs 74.3) and Nov 2
  supplies most of it. I didn't slice this way. My top-tier jump is also strongest
  on high-risk cards (24 vs 13.9, z = 3.0; medium z = 1.4, extreme z = 0.9). That
  overlap could be a clue or a coincidence, and it adds another look to the count.
- **Better price proof.** 119 sales with every item quoted beforehand: $793.1M both
  ways. Stronger than my rough check. I didn't rerun it.

### What I found and they didn't

- Drop tier follows the card's Band at every level, not only gold at level 120+.
- The pooled top-tier jump (38 vs about 24), and rejecting "no recon" and penalties
  of −5 or worse directly.
- Reward scale pinned down exactly (wiki × a multiplier, flat at 1.147 across both
  periods).
- Complication *rate* unchanged by blind, adjusted for risk and card conditions.
- Stamina often isn't the tight limit (finding 14), and how many attempts a real
  side-by-side test would need.

### Corrections to my own findings above

The text above is as I wrote it before reading. After checking their points:

- **Finding 2 and the Summary:** read the "+7% for certain" as **+5% to +8%**. It's
  +7.6% on identical cards, and +5.1% in the replay, where saved Stamina goes on
  weaker cards.
- **Summary, first row:** the "about 2 for card mix" applies only from Oct 29. Against
  the prior week, the card minimum is the largest cause.
- **Finding 12 and recommendation 4: weaker than I wrote.** Much of those table
  values comes from the Oct 15-25 complication gold. Split by date, Band 7 low went
  from 20 attempts at $7.84M each (Oct 5-25) to 7 attempts at $0.23M each (Oct 26 on).
  Band 6 medium fell from $3.41M to $2.68M. Band 6 low has only 2 attempts since
  Oct 26. Band 7 high ($8.57M, n = 24) and Band 6 extreme ($5.92M, n = 53) hold up,
  and both already pass the minimum. Drops are still worth more than cash on Bands
  6-7, but "the minimum blocks the best cards" is **not established**. Check this on
  post-Oct 26 data before building anything.
- **Finding 13:** "about $5M per complication win" hides large swings: $2.6M, $9.6M,
  $2.3M and $4.2M across Oct 1-14, Oct 15-25, Oct 26-31 and Nov 1-4. The `run`
  advantage is mostly that Oct 15-25 stretch. Complications remain net positive.
