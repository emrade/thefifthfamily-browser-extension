# Smuggling bulk actions (`v2_launch` / `v2_offload_all`) — scoping notes

Status: **draft — scoping only, nothing in this doc is implemented yet.** The
player is still manually testing the new UI in-game; this exists to capture what
the archive already confirms about it, from real captured traffic, so a future
overhaul starts from facts instead of re-deriving them from scratch. Sections
marked `CONFIRMED` come from `fifth-family-archive-2026-09-18T23-32-12-299Z.ndjson.gz`.
Everything else is flagged as unconfirmed — only one real call of each new
action exists in the archive so far.

See `docs/smuggling-v2-plan.md` for the pet-courier system this sits inside, and
`docs/smuggling-route-ribbon-plan.md` for the destination-detection work this may
partly obsolete (see "Effect on the route ribbon plan" below).

---

## What changed

The game added two new bulk actions on top of the existing per-pet flow — this
is **additive, not a replacement**. `v2_draft`, `v2_load`, `v2_depart`,
`v2_offload`, `v2_cancel` all still fire normally in the same archive, and the
"Where You Can Send" ribbon (`sv2-rib`) and hourly rotation are unchanged. The
new actions are a convenience layer, not a mechanic rewrite — confirmed by their
coexistence with the old calls in the same session, not inferred.

## `v2_launch` — send some/all idle pets in one call

**CONFIRMED real request/response** (one example, `origin: "page"` — the
player's own manual test, not this extension):

```
POST /actions/smuggling.php
action=v2_launch&user_pet_ids=2581,19919,1997,1984,1996&item_id=22&destination_city_id=1&buy=1&max_spend=1403000

→ {"ok":true,"message":"5 couriers away to Downtown — 61 units, 61 bought for
   $1,403,000, last one lands in 23.6 min.","sent":5,"units_sent":61,
   "units_bought":61,"cash_spent":1403000,"destination":"Downtown"}
```

Replaces what used to be a draft→buy→load→depart sequence repeated once per
pet. One item, one destination, one cash cap, applied to every pet in
`user_pet_ids` at once — the server buys the cargo itself (`buy=1`).

### The UI behind it

A 3-step picker embedded in the fleet panel, under an "Inactive" pets group,
real copy: *"All 5 idle animals out in one press · cargo bought for you."*

1. **What are they carrying** — pick exactly one item from up to 3 offered
   (`sv2-lo-item`, `onclick="Game.smugV2LaunchPick(this, true)"` — the `true`
   makes this a single-select radio group).
2. **Where are they going** — pick exactly one destination (`sv2-lo-dest`,
   same `LaunchPick(this, true)` radio pattern). **Only 2 destinations were
   listed** on the account checked: Downtown (open, selectable) and The
   Underground (`disabled`, "Boss not beaten"). Several other districts this
   account has level-unlocked (The Strip, The Docks, Industrial District)
   were **not shown at all** — not even as disabled. The picker appears to
   only surface "currently open by rotation" + "locked, for upsell," silently
   omitting "level-unlocked but not open this hour." **Unconfirmed** whether
   that holds across other rotation windows, or whether `v2_launch` would
   even accept a destination that isn't currently open if submitted directly
   (never attempted in the archive).
3. **Who is going** — every idle pet pre-selected, tap one to drop it
   (`sv2-lo-pet`, `onclick="Game.smugV2LaunchPick(this, false)"` — `false`
   makes this a multi-select toggle, not a radio).

Final button: `<button class="sv2-lo-go" onclick="Game.smugV2Launch(this)">
Send N Couriers</button>` — reads all the selected state straight off the DOM
and fires the one `v2_launch` call.

### A clean, single on/off signal — this answers one of the open questions above

**CONFIRMED, and this is the most useful single finding in this doc.** The
whole "Send Every Courier" block carries exactly one of two container
classes — `class="sv2-lo"` (enabled, shows the 3-step picker above) or
`class="sv2-lo off"` (disabled — the picker is replaced entirely by one
`sv2-lo-why` explanatory line). Three real messages confirmed, each a
distinct, named reason:

- *"Both routes open from Arms District this hour are still locked to you.
  They rotate hourly — check back."* — **this is the one the player quoted,
  and it directly confirms `COURIER_DEST_POLL_BUFFER_MS`'s own comment in
  `constants.ts`**: there really are exactly two routes open per hour, in
  plain first-party copy rather than only inferred from capture timing. This
  specific case is "two routes are open this hour, but both are level-locked
  for this account" — not "nothing is open account-wide."
- *"You have a delivery open and being loaded. Send it or cancel it, then
  every idle courier can go at once."* — a stuck/in-progress draft blocking
  the bulk button (same case `probeDestination`'s stuck-draft cleanup in
  `courierWatch.ts` already handles for the old flow).
- *"No idle couriers. Every one you own is out, deployed as your combat pet,
  or not trained to carry yet."* — no eligible idle pets (same concept as
  `PetRosterEntry.draftBlockedReason`).

**This is a strictly better signal than either the old draft-probe or the
ribbon plan for one specific question — "is there anything I can send right
now" — because it's a single class check on a fetch the panel already
returns, with no draft/cancel round-trip and no need to cross-reference a
separate ribbon element against the account's own unlock levels.** It doesn't
by itself say *which* destination is open (the ribbon still answers that, if
needed) or expose the per-pet capacity/item-matching the old flow used — just
a clean "can I act at all" gate. See the ribbon-plan status note for how this
changes that doc's outlook.

## `v2_offload_all` — collect every pending delivery in one call

**CONFIRMED real request/response**, `origin: "page"`:

```
POST /actions/smuggling.php
action=v2_offload_all

→ {"ok":true,"message":"Collected 10 deliveries — 116 units for $3,196,201
   ($528,197 profit). Family Favor earned.","runs_collected":10,
   "units_sold":116,"cash_received":3196201,"net_profit":528197,
   "units_unsold":0,"was_capped":false}
```

No parameters beyond auth. Sweeps every already-landed, unbanked delivery
account-wide — replaces the old per-shipment offload+sell loop entirely.
`was_capped` lines up with the existing Daily Profit monitor concept
(`dailyProfitCapRemaining` in `SmugglingV2Snapshot`) — not a new mechanic, the
same cap just applied in bulk.

## Two smaller, unconfirmed additions

Found their `onclick` signatures via a broad regex sweep of the archive but
didn't get a clean enough capture to know their full purpose — flagged here so
they're not lost, not because they're understood yet:

- `Game.smugV2Reserve(itemId, qty, itemName)` — real args seen:
  `71196,273,'Hidden Compartments'`. Possibly reserving stash toward a
  specific item ahead of a launch. **Needs a real capture with surrounding
  context to confirm.**
- `Game.smugV2Unload(userPetId, itemId, qty, itemName)` — real args seen:
  `67432,22,8,'Encrypted Weapons Schematics'`. Possibly pulling one item back
  off a pet's manifest before departure (the inverse of `v2_load`). **Same
  caveat — unconfirmed.**

Also present but purely UI state, not game actions: `smugV2Filter(this, bool)`,
`smugV2ShowAll(this)` — filter/expand toggles on the fleet or black-market
grid, no server call behind them.

## Effect on the route ribbon plan

`docs/smuggling-route-ribbon-plan.md` was scoped around replacing
`courierWatch.ts`'s draft-then-cancel destination probe with a read of the
`sv2-rib` ribbon instead. That ribbon is still present and unchanged in this
archive, so nothing there is *broken* — but if a future courier automation
gets rebuilt around `v2_launch` (one call, whatever destination the picker
currently offers), the whole "how do we cheaply detect which destination is
open" question the ribbon plan exists to answer may become moot: the picker
UI already appears to only offer the currently-open destination, meaning
`v2_launch` might not need a separate open-destination probe at all — reading
its own available-destinations list (however that's exposed, likely inline
in the panel fetch already used) could replace both the old probe *and* the
ribbon-reading plan in one step.

**Not deleting that doc** — this is a real possibility, not a confirmed one
yet (see the open question above about whether the picker's destination list
is authoritative or just a UI convenience). Revisit both docs together once
there's enough real `v2_launch` traffic to know whether a separate
open-destination signal is still needed at all.

## What's still needed before any redesign

1. **Multiple `v2_launch` calls across different rotation windows** — to
   confirm whether the destination picker always mirrors the ribbon's
   `is-lane` state exactly, or can diverge.
2. **A `v2_launch` attempted with a destination that isn't currently open** —
   to see whether the server rejects it (and with what message) or the UI
   simply never allows submitting one.
3. **A rejection case for either action** — insufficient cash for
   `max_spend`, an empty roster, nothing pending to offload — none captured
   yet, so error handling can't be designed against real shapes.
4. **`smugV2Reserve`/`smugV2Unload` in context** — a capture showing the
   surrounding UI (what section they're in, what triggers them) rather than
   just the bare `onclick` signature.
5. **Whether `item_id` is constrained** to what the destination's district
   actually trades, or accepted unconstrained by the server.
