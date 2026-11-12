# Street Intel: drops change which cards pay best

Found 2026-11-12 while checking the Analytics tab's suggestion to raise the
minimum card value from $800k to $1M.

## Summary

- **Drops are worth 2–3× the cash per Stamina.** Over the last 30 days
  Street Intel drops came to about $4.2B, against cash of roughly $40–105k
  per Stamina. Cash alone misses most of what a card earns.
- **The minimum-card suggestion ranks cards by cash only.** By cash, cards
  above $1M look much better than the ones under it ($84k against $58k per
  Stamina). With drops added they are about even: $283k against $268k per
  Stamina over 30 days, and the cards under $1M come out ahead over the
  last 7 days ($344k against $310k).
- **One card under $1M is among the best:** the medium-risk $881k card
  (now $888k after the Nov 12 level-up). It dropped gold or crowned
  legendary items on **12.5% of tries** (20 of 160), worth **$325k per
  Stamina** with cash included. Only the $4.4M extreme cards pay more per
  Stamina, and they need more Stamina per try.
- **The other cards under $1M are weak:** high $848–856k
  ($174–204k per Stamina) and extreme $943–950k ($132–176k).
- **Decision (Nov 12):** keep the minimum at $800k rather than apply
  $1M, which would skip the medium card. Turning on the extreme-card
  minimum at $1M would cut the weak extreme $943k cards without touching it
  (that card's own suggestion not yet checked). The high $850k card can't
  be skipped separately with the current settings.

## Evidence

All archives through 2026-11-12 22:15 UTC (merged monthly files plus every
unmerged export), 2,451 attempts since Oct 1. Days start at the game's reset,
23:00 UTC. Stamina here is the card's attempt cost without scouting, so
cash per Stamina runs a little higher than on the Analytics tab. Cash is net
of complication losses.

### The suggestion, recomputed

The extension's own code (`verify_min_card_suggestion.py`) gives the same
figures as the panel: from $800k it suggests $1M on Nov 11 and 12. It would
skip $849.85k–$944.25k cards ($57.7k per Stamina, 576 attempts) so their
Stamina goes to $1.335M–$2.84M cards ($84.4k, 508 attempts). On Nov 8 it said
keep, and on Nov 10 it said raise to $900k.

The supply side of that holds up. Over Nov 6–12, 12–34 cards worth $1M+
(192–566 Stamina) went untaken each day, while 194–320 Stamina a day went
to $850k–999k cards. So the freed Stamina would mostly have reached $1M+
cards. The problem is the cash-only comparison, not supply.

### By value band, cash plus drops

| Window | Band | Tries | Stamina | Cash/S | Drops | Drops/S | Total/S | Share of drops |
|---|---|---|---|---|---|---|---|---|
| Today (Nov 12) | $850k–999k | 24 | 314 | $56k | $162.5M | $518k | $574k | 44% |
| | $1M+ | 33 | 562 | $113k | $203.8M | $363k | $476k | 56% |
| 7 days | $850k–999k | 148 | 1,902 | $61k | $538M | $283k | $344k | 38% |
| | $1M+ | 264 | 4,443 | $110k | $891M | $201k | $310k | 62% |
| 30 days | under $850k | 491 | 4,645 | $40k | $905M | $195k | $235k | 22% |
| | $850k–999k | 368 | 4,600 | $58k | $967M | $210k | $268k | 23% |
| | $1M+ | 815 | 13,009 | $105k | $2,320M | $178k | $283k | 55% |

Today's drops came to $366M on this count; the panel showed about $371M a little
later. Four drops worth $27–50M each came from cards under $1M (three gold,
one crowned legendary), and three of the four came from the medium $888k card.

### By card, last 30 days ($800k+, 10+ tries)

| Card | Risk | Tries | Stamina/try | Gold+ per try | Underworld epics | Success | Cash/S | Drops/S | Total/S |
|---|---|---|---|---|---|---|---|---|---|
| $848k | high | 63 | 12 | 3% | 0 | 56% | $58k | $116k | $174k |
| $850k | high | 123 | 12 | 4% | 0 | 74% | $60k | $144k | $204k |
| **$881k** | **medium** | **149** | 14 | **12%** | 0 | 75% | $56k | **$270k** | **$325k** |
| $888k | medium | 11 | 14 | 18% | 0 | 82% | $58k | $554k | $612k |
| $944k | extreme | 45 | 10 | 2% | 0 | 64% | $67k | $65k | $132k |
| $1.335M | high | 176 | 15 | 2% | 24 | 73% | $74k | $194k | $267k |
| $1.99M | high | 100 | 18 | 11% | 0 | 74% | $83k | $200k | $283k |
| $1.705M | extreme | 69 | 13 | 4% | 0 | 59% | $95k | $102k | $198k |
| $2.84M | extreme | 65 | 15 | 2% | 0 | 43% | $118k | $65k | $183k |
| $4.45M | extreme | 80 | 19 | 3% | 15 | 55% | $164k | $210k | $374k |
| $6.185M | extreme | 19 | 23 | 16% | 0 | 63% | $182k | $155k | $337k |

(The script prints every card; smaller ones are left out here.)

### Is the medium card's gold rate luck?

Probably not:
- **Many different items:** its 20 gold+ drops are 14 different items, none
  more than twice.
- **Spread over time:** they fell on 12 of the 18 days it was tried, with
  no single day carrying it.
- **Well above nearby cards:** high and extreme cards of similar value drop
  gold on 2–5% of tries.

The high $1.99M card drops gold at a similar rate (11%), so the rate isn't
simply about medium risk. The game's wiki doesn't publish Street Intel drop
rates or loot tables. Checked: the Street Intel page and all 38 stored wiki
sections. So the reason for the difference is unknown.

## Limits

- **Drop values are estimates.** They use the item's last quick-sell quote,
  or a typical quote for its quality, as the Analytics tab does. They are
  not what the items actually sold for.
- **Drops are heavy-tailed.** One $40M gold item moves a day by more than
  all its cash, so judge cards by 30-day rates, not one day.
- **Sample sizes are moderate.** The medium card is 160 tries; cards with
  under ~50 tries (e.g. $888k, $6.185M) are noisy.
- **Card values shifted on Nov 12 07:53 UTC** (new card set, probably a
  level-up). The 30-day figures are almost all from before it.
- **No Stamina replay.** Whether skipped Stamina would actually land on a
  better card was estimated from untaken cards, not simulated against the
  Stamina history.

## Implication for the extension (not done)

The minimum-card suggestion (and the extreme-card suggestion) compare cash
per Stamina only (`docs/street-intel-analytics.md`). Ranking by cash plus
estimated drops, which the Analytics tab already computes per day, would
stop it recommending cuts like this one. Because drops are heavy-tailed, the
"clearly better" test would need care. A per-risk minimum (not only
extreme) would also let the high $850k card be skipped while keeping the
medium one.

## Reproduce

```
python3 -I verification/street-intel/analyze_drops_by_card.py [--seed FILE] [--asof YYYY-MM-DD]
python3 verification/street-intel/verify_min_card_suggestion.py --dates 2026-11-12 --minimums 800000,1000000
```
