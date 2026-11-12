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

**Drops (2026-11-12):** the cash-per-Stamina figures here leave out drops,
which are worth 2–3× the cash and change which cards pay best — see
[street-intel-drops-by-card.md](street-intel-drops-by-card.md).

## Analytics tab

In the in-page Street Intel panel (Auto | Analytics tabs) and the popup's
Street Intel tab. Sections:

Both suggestions come in two versions (since 2026-11-13): **counting cash
only** and **counting cash + drops** (the drops' estimated sale value, as in
section 6). When they agree the tab shows one answer; when they don't, both,
each with its own Apply. Drops are worth 2–3× the cash per Stamina but only
pay once sold, and the player holds back selling near the vault limit
(upgrading it needs Mafia Gold), so which to follow is the player's call.
See [street-intel-drops-by-card.md](street-intel-drops-by-card.md).

1. **Suggested minimum card value**, with Apply: raise, keep or lower.
   - **Supply** (unchanged rule): over the last 7 days with the board watched
     (≥30 new cards and ≥5 attempts; needs 3 such days), cards at or above a
     minimum must add up to at least 1.1× the Stamina spent per day. The
     extreme rule, if on, is applied. If the current minimum fails this, it
     suggests lowering to the highest card value that passes.
   - **Payoff** (since 2026-11-08): otherwise it raises only to the highest
     card value where the cards the raise cuts (from your minimum up) paid
     clearly less per Stamina, over the last 30 days of attempts, than the
     cards just above the new minimum worth the same Stamina — where the
     freed Stamina goes. "Clearly": at least 10% more *and* 2 standard
     errors, with 30+ attempts each side. Otherwise it says keep.
   - **Counting drops**, the same test on cash + drops, with **100+
     attempts each side**: a gold drop is worth 100+ attempts' cash and comes
     on ~2–8% of tries, so at 30 one or two lucky drops passed the test (from
     no minimum, 40–80 attempts on $38k–142k cards read $270–475k per Stamina
     and it suggested keeping only those; over Oct 1–Nov 12 cards under $150k
     made $121k in drops per Stamina, below the big cards). Lowering is still
     on supply only, so the drops version never says go back down on payoff:
     from $1M on Nov 12 it says keep $1M although from $800k it says keep
     $800k.
   - Checked on Nov 12 from $800k: cash only says $1M, cash + drops keep
     $800k (the $849.85k card's range $179k per Stamina against $275k for
     $881k–944k, 217 and 231 attempts — not clearly more). On Nov 13
     cash + drops says $850k, cutting only the high $849.85k card.
   - Candidates are the card values on the board in those 7 days
     (midpoints), shown as the roundest amount between the card cut and the
     card kept, and the tab names those cards. The 30 days of attempts only
     price each value range: they include card values from before a level-up
     that the board no longer shows (first version named $808.65k and
     $816.35k cards on Nov 8, when the only card between $800k and $850k for
     a week had been $849,850).
   - Why: the old rule took the highest $50k step that passed supply and
     assumed higher always pays. On Nov 8 it said $850k from $800k, which
     only cut a $849,850 high-risk card paying the same per Stamina as
     $850k–1M ($56.6k against $56.0k); a $1M+ card was affordable on the
     board for 1 of its 72 attempts, so its Stamina wouldn't reach big cards.
   - Checked with `verification/street-intel/verify_min_card_suggestion.py`
     (runs the real code at past dates): from $800k it says keep on Oct 22,
     Nov 1, Nov 5 and Nov 8 (Nov 8: the $849,850 card's range made $54k per
     Stamina against $54k just above); from $500k or none it raises to
     $700k (Oct 22) or $849–850k (Nov); from $1M it lowers to the same. The
     old code reproduces the panel's Nov 8 figures (1,158 against 873,
     $850k).
2. **Suggested extreme card minimum**, with Apply. For each option ($1M,
   $1.5M, $2M, $3M), over the card table's 30 days: the extreme attempts it
   would skip (worth at least the minimum card value, under the option),
   against high/medium/low attempts of the same value range per Stamina — the
   change in cash and failures per day had that Stamina gone to them instead.
   Suggests the option adding the most cash, if it adds at least 1% of daily
   cash, else off. The drops version judges cash + drops against 1% of daily
   cash + drops; the table shows both Cash/day and Drops/day. There's no
   standard-error test here, only the 1% floor and 15+ attempts each side.
   On Nov 12 at an $800k minimum: cash only off; cash + drops $3M+ (305
   extreme attempts skipped over 29 days, −$4.0M cash and +$16.5M drops a
   day, −1.9 fails) — extremes under $3M drop gold on 2–4% of tries against
   up to 11–12% for the high $1.99M and medium $881k cards. Board supply at
   $800k with extremes at $3M+ was still 1,336 Stamina a day against 892
   spent (this suggestion doesn't check supply itself). A failure's longer lockout (12 min,
   disaster 15 + ~6 jail, against 8 for a success) mostly overlaps time spent
   waiting for Stamina: ~57 attempts a day are ~8.5 h of lockout. Each option
   needs 15+ skipped and 15+ comparison attempts. On Oct 1–30 at a $500k
   minimum: $1M −$146k/day, −0.6 fails; $1.5M +$40k, −0.6; $2M −$1.1M,
   −1.4; $3M −$3.1M, −2.0 — so **off** (+$40k is noise). Extreme cards
   bunch at $750k–1M, $1.5–1.75M, $2.5–3M and $4.25M, so $1M and $1.5M skip
   nearly the same cards. The two suggestions each assume the other setting
   as it is, so applying one can move the other.
3. **Today vs 7-day average**: cash, drops (est.), attempts, fail rate
   (failure + disaster), Stamina (attempts + paid scouts), cash per Stamina,
   cash + drops per Stamina.
4. **Board vs your Stamina**: Stamina's worth of cards at or above the
   minimum that appeared today, against Stamina spent.
5. **Results by card** (risk × value band, last 30 days, ≥5 attempts): tries,
   fail %, cash per Stamina, drops per Stamina. Rows under the minimum are greyed.
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
