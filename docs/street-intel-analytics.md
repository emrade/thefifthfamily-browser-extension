# Street Intel Analytics and the minimum card value

## Minimum card value

Replaced "Big cards only". Street Intel Auto skips, and doesn't scout, any card
whose reward midpoint is under `minCardValue`. Once Stamina reaches 90% of max
it takes any card, so regen is never lost to a full bar. 0 means no minimum.

Why a minimum pays: Stamina is the limit (it almost never sits full), and cash
per Stamina climbs steeply with card size. All archives, Aug 10 – Oct 30 2026,
cash net of complication losses per Stamina (scouting included):

| Card value | Cash per Stamina |
|---|---|
| Under $250k | $10–17k |
| $250k–500k | $22–30k |
| $500k–1M | $42–48k |
| $1M–2M | $64–74k |
| $2M+ (all extreme) | $113k |

Too high a minimum backfires: the board stops supplying enough cards to spend
the Stamina on, Stamina builds to 90%, and then goes on whatever is listed.
Over Oct 12–30, cards at $750k+ added up to roughly the Stamina spent each day
(550–1,170 against 650–1,070); a board replay paid best around $750k
(~$56M/day against ~$50M at $500k and ~$52M at $1M — rough, the archive has
gaps). Existing configs keep their behavior: "Big cards only" on keeps its
floor, off becomes no minimum. New installs start at $750k.

### Extreme rule

Optional, off by default: extreme cards must also be worth `extremeMinValue`
(default $1M). Extreme cards fail ~40% at every size; under $1M they paid no
more per Stamina than high-risk cards failing half as often (142 attempts,
40% fail, $48k/S vs high $500k–1M: 413 attempts, 25%, $46k/S). Lifted with
the minimum at 90% Stamina.

## Analytics tab

In the in-page Street Intel panel (Auto | Analytics tabs) and the popup's
Street Intel tab. Sections:

1. **Suggested minimum card value**, with Apply. The highest value (in $50k
   steps) whose cards, averaged over the last 7 days with the board watched
   (≥30 new cards and ≥5 attempts), add up to at least 1.1× the Stamina spent
   per day. The extreme rule, if on, is applied — taking extreme cards under
   $1M out of the supply lowers the suggestion for the rest. Needs 3 such
   days. On Oct 24–30: $800k (extreme rule off).
2. **Suggested extreme card minimum**, with Apply. For each option ($1M,
   $1.5M, $2M, $3M), over the card table's 30 days: the extreme attempts it
   would skip (worth at least the minimum card value, under the option),
   against high/medium/low attempts of the same value range per Stamina — the
   change in cash and failures per day had that Stamina gone to them instead.
   Suggests the option adding the most cash, if it adds at least 1% of daily
   cash, else off — judged on cash alone. A failure's longer lockout (12 min,
   disaster 15 + ~6 jail, against 8 for a success) mostly overlaps time spent
   waiting for Stamina: ~57 attempts a day are ~8.5 h of lockout. Each option
   needs 15+ skipped and 15+ comparison attempts. On Oct 1–30 at a $500k
   minimum: $1M −$146k/day, −0.6 fails; $1.5M +$40k, −0.6; $2M −$1.1M,
   −1.4; $3M −$3.1M, −2.0 — so **off** (+$40k is noise). Extreme cards
   bunch at $750k–1M, $1.5–1.75M, $2.5–3M and $4.25M, so $1M and $1.5M skip
   nearly the same cards. The two suggestions each assume the other setting
   as it is, so applying one can move the other.
3. **Today vs 7-day average**: cash, drops (est.), attempts, fail rate
   (failure + disaster), Stamina (attempts + paid scouts), cash per Stamina.
4. **Board vs your Stamina**: Stamina's worth of cards at or above the
   minimum that appeared today, against Stamina spent.
5. **Results by card** (risk × value band, last 30 days, ≥5 attempts): tries,
   fail %, cash per Stamina. Rows under the minimum are greyed.
6. **Drops by day**: count, estimated sale value, best item.

Days run from the game's reset, 23:00 UTC (player midnight, WAT).

## Data

`background/features/streetIntel/analytics/` keeps three IndexedDB tables:
`siCards` (every card the board showed, first/last seen), `siAttempts` (every
attempt, manual or automated, with complication outcome, cash lost and
drops; keyed on `opportunity_id`), `siDays` (paid scout Stamina per day).
Fed from `enqueueRecord`, the HTTP archive's capture point — the one place
both page and background traffic pass — so it pauses if archive capture is
turned off. The archive itself only holds a couple of days under its byte
budget, hence the separate tables. Kept 45 days (cards 14).

Drops are valued at the item's last `dispose_quote` (the inventory's
`QuickSellPriceBook.quotesByName`, over every archived quote in the seed),
else a typical quote for its quality. Consumables, cash boxes, currencies and
banner drops (shards, event items) count as 0.

### Seed

`src/shared/data/streetIntelAnalyticsSeed.json`, built by
`verification/street-intel/build_analytics_seed.py` from every archive:
attempts since Oct 1, the last 10 days of cards, scout Stamina per day, sell
quotes. Loaded once per install; the extension's own archive between the
seed's cutoff and the update is then replayed through the same ingest.
Checked: replaying the Oct 29–30 export through the live ingest gives the
same day totals as the seed (Oct 30: 56 attempts, $54.6M, 817 Stamina).
