# Equipment Forge — Measured

Rules recovered from real captured `forge_v2.php` traffic, not a guide. Confirmed
against `fifth-family-archive-2026-09-18T12-57-58-719Z.ndjson.gz` (54 real `attempt`
calls in one forging session — every item that was worked on topped out at rank 5;
none was actually pushed to +6) and `fifth-family-archive-2026-09-18T12-32-37-522Z.ndjson.gz`
(panel snapshots covering the button state for ~150 distinct items/ranks). The +6 row in
the table below is real, server-sent data too — the panel shows an item's *next* rank
cost/success before you click it, so once 4 items sat at +5 their (unattempted) +6
pricing was visible — but it's unattempted, not a completed roll. Re-derivable the same
way as
`docs/game-mechanics.md`'s other sections: pull a Forge-page selection export after any
future forging session and re-run the same extraction.

---

## The request tells you nothing, and there's nothing to lever

```
POST /api/forge_v2.php
action=attempt&inventory_id=<id>&idempotency_key=<uuid>&_csrf=<redacted>
```

That's the entire request. No stat, no client-supplied roll, no seed — the response's
own `roll` and `success_bp` are the only place either number appears, generated
server-side at the moment of the call. Same shape as Arena combat (see
`game-mechanics.md`'s "no pre-roll or seed exposed" note). **Checked specifically for
an exploitable lever here and there isn't one** — this is a closed question, not an
open one to keep chasing.

## Confirmed: a failed attempt still charges full cash

The response's `cash` field is **the cost of that attempt**, not a remaining balance —
confirmed because it's numerically identical to the cost shown on the panel's own
temper button for that rank, every time. It's charged **identically on success and
failure**. Only `gold` (a separate, plentiful currency — 1,072 on hand on the account
measured) is withheld on failure; cash is not.

Real session totals: 32 successful attempts spent $284,050,000; **14 failed attempts
spent $193,050,000 for zero rank gain — 40.5% of all cash spent that session bought
nothing.** By item:

| Item | Fails (wasted $) | Successes ($) |
|---|---|---|
| Phantom Grip Gauntlets | 8 fails → **$108,300,000** | 2 → $22,800,000 |
| Midnight Broker's Jacket | 2 fails → $38,800,000 | 5 → $60,625,000 |
| Executive's Precision Rifle | 1 fail → $22,000,000 | 5 → $55,000,000 |
| The Don's Noose | 2 fails → $15,400,000 | 5 → $27,500,000 |
| Vision of the Future | 1 fail → $8,550,000 | 5 → $35,625,000 |

**Phantom Grip Gauntlets' streak is worth keeping as a reference case.** Its +4→+5
roll (55% success / 45% fail) missed **seven times in a row** — P ≈ 0.45⁷ ≈ 0.37%,
genuinely unlucky, not a sign anything is rigged — before landing on the 8th attempt.
At $14,250,000 per attempt regardless of outcome, that one streak cost **$99.75M**
before the successful roll even landed. This is the real shape of the risk: not "the
expected cost," but the tail you can actually land on.

## The cost/success curve, confirmed exactly across 4 independent items

Every `ForgeV2.temper(inventory_id, name, next_rank, cost, gold_cost, success_pct)`
button captured across the session, cross-checked against Executive's Precision Rifle,
Kingpin's War Belt, Midnight Broker's Jacket, and The Don's Noose — all four hit the
exact same multiplier relative to their own rank-1 cost, to the dollar:

| Rank | Cost multiplier (of rank-1 cost) | Success chance | Gold on success |
|---|---|---|---|
| →+1 | 1.0x | 95% | 1g |
| →+2 | 1.5x | 90% | 1g |
| →+3 | 2.0x | 80% | 1g |
| →+4 | 3.0x | 70% | 2g |
| →+5 | 5.0x | 55% | 2g |
| →+6 | 7.5x | 40% | 3g |

**The +6 row is real but unattempted** — 4 items sat at +5 by session's end and the
panel showed their next-rank button (cost/success/gold), but nothing in this session
actually rolled a +5→+6 attempt, so it's confirmed pricing, not a confirmed outcome.
**Ranks 7–10 have no data at all**, not even button state — nothing reached +6 to
reveal what +7 would cost. Given the trend (success dropping faster, cost multiplier
accelerating rather than leveling off) there's no reason to expect it gets friendlier;
extrapolating a specific number would be a guess, not a measurement, so none is given
here. Re-check this table if a future session pushes further.

### Expected total cost, accounting for retries on failure

Since a failed attempt still charges the full cost, the real expected cost to *land*
a rank is `cost ÷ success_chance` (expected number of attempts is `1/p`, each one
full price):

| Rank | Expected $ for this rank alone (× rank-1 cost) | Cumulative expected $ from +0 |
|---|---|---|
| →+1 | 1.05x | 1.05x |
| →+2 | 1.67x | 2.72x |
| →+3 | 2.50x | 5.22x |
| →+4 | 4.29x | 9.51x |
| →+5 | 9.09x | 18.60x |
| →+6 | 18.75x | 37.35x |

**The +5→+6 step alone costs, in expectation, about as much as everything from +0
through +5 combined.** That's the inflection point — ranks 1–4 roughly double the
cumulative total each step; +5 and +6 each roughly double it *again*. This is the
basis for treating **+5 as the practical stopping point** for standard (non-Variable)
gear: past it, the expected-cost curve stops being "expensive" and starts being
"pay for your whole investment again, per rank," on top of real variance that can
land far worse than the expectation (see the Phantom Grip Gauntlets case above).

## Variable Rarity gear pays roughly double per stat point

Confirmed by comparing two Underworld Epic Special items at LV100, one Variable
(auto-recuts into the next rarity band as the player levels, keeping its forge ranks)
and one fixed:

| | Sapphire Pin (Variable) | The Sealed Letter (fixed) |
|---|---|---|
| Base stats | STR 13 / DEF 38 / AGI 25 / DEX 50 (126 total) | STR 42 / DEF 32 / AGI 42 / DEX 42 (158 total) |
| +1 rank gives | +1 / +2 / +1 / +2 (+6 total) | +5 / +3 / +4 / +4 (+16 total) |
| Cost for +1 | $3,158,300 | $3,950,000 |
| Cost per stat point | ~$526,000 | ~$247,000 |

The item's own tooltip claim — *"Forge upgrades give half their normal benefit on
Variable Rarity gear"* — checks out directly against the displayed numbers: the %
gain per rank is roughly half, but the *cost* isn't discounted to match, so Variable
gear ends up costing roughly 2.1x more per stat point than fixed gear at the same
rank. Worth it only when the payoff is "never having to re-gear at a rarity
crossing" — not as a straight efficiency play. See the account's own numbers at the
time this was checked: level 103, 77,838/287,038 XP into that level alone, so a
rarity-band crossing (next at level 120) wasn't imminent — favoring fixed gear for
near-term value. Re-check this call if levelling speed changes materially.

## Open questions for a future check

- Ranks 7–10: cost multiplier and success% curve, from a session that actually
  reaches them.
- Whether `idempotency_key` (a fresh UUID per attempt, `fg-<inventory_id>-<n>-<uuid>`)
  is purely a duplicate-submission guard or does anything else — never seen reused
  across attempts in this data, so not investigated further.
- Whether the cost multiplier table is universal across *all* item rarities/slots, or
  only confirmed so far for Underworld Epic Specials — the 4 cross-checked items were
  all Specials; a Variable or a lower-rarity slot item pushed past +3 would confirm or
  rule out any rarity-dependent variation.
