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
   makes this a single-select radio group). **Confirmed from a real
   screenshot, not just the request shape**: picking a different item
   live-recalculates the total cost shown before you even send — 141 units
   at Military Munitions' $15,000 ea priced the batch at $2,115,000 (exact:
   141 × 15,000); switching the same 141 units to Encrypted Weapons'
   $23,000 ea repriced it to $3,243,000 (exact: 141 × 23,000). Plain
   unit-price × total-units, client-side, before `v2_launch` is ever called.
2. **Where are they going** — pick exactly one destination (`sv2-lo-dest`,
   same `LaunchPick(this, true)` radio pattern). **Corrected from an earlier
   draft of this doc, which read the "only 2 destinations shown" fact wrong.**
   It isn't the picker filtering "currently open" + "locked, for upsell" out
   of the full 10-district roster — it's simpler than that: **the picker
   always shows exactly the two destinations that rotate open each hour**,
   full stop, regardless of whether either is actually usable by this
   account. One is whichever district is actually open this hour; the other
   is that hour's *other* rotating slot, shown locked with its real reason
   if this account can't use it yet — confirmed on two separate real
   screenshots, one showing Diamond District "Needs level 121" as the locked
   half, a different capture earlier showing The Underground "Boss not
   beaten" as the locked half, both alongside Downtown as the open half.
   Player's own confirmation: *"as usual, there are always 2 options for
   destination but there is only one open to me, the other one available
   this shift is level locked."* Districts not in this hour's rotating pair
   at all (The Strip, The Docks, Industrial District, etc.) simply aren't
   part of the picker that hour — nothing to do with this account's own
   unlock status.
3. **Who is going** — every idle pet pre-selected, tap one to drop it
   (`sv2-lo-pet`, `onclick="Game.smugV2LaunchPick(this, false)"` — `false`
   makes this a multi-select toggle, not a radio).

Final button: `<button class="sv2-lo-go" onclick="Game.smugV2Launch(this)">
Send N Couriers</button>` — reads all the selected state straight off the DOM
and fires the one `v2_launch` call.

### Insufficient cash — CONFIRMED, and it's a hard rejection, not a partial

**Corrected from an earlier draft of this doc, which guessed wrong from the
UI's pre-send warning copy alone.** The warning text (*"Not enough cash — the
last couriers will be left behind"*) reads like it's describing a graceful
partial fill, and the Send button staying enabled while it shows supported
that guess — but a real submitted call settles it:

```
action=v2_launch&user_pet_ids=<11 ids>&item_id=22&destination_city_id=1&buy=1&max_spend=3243000
→ {"ok": false, "error": "Ran out of cash for more cargo."}
```

**Full rejection. Nothing sent, nothing bought, nothing spent** — an ordinary
well-formed `{ok:false,"error":"..."}`, the same shape as every other
expected rejection this codebase already handles (not a shape/parse problem
to guard against). The warning text is telling you what *would* happen if
you don't lower the ask — not describing what the server actually does when
you send anyway.

Confirmed real fix by the account owner, 6 seconds after a `withdraw`:
dropped 2 pets from the roster, cut `max_spend` to `1,909,000`, resubmitted
— `{"ok":true,"sent":9,"units_sent":83,...}`. **Also confirms the account
owner's own observed workflow**: withdraw cash from the bank, then
`v2_launch` straight from cash on hand — no separate buy/load step at all,
matching `buy=1` handling the purchase inline as already documented above.

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
archive, so nothing there is *broken* — but a future courier automation
rebuilt around `v2_launch` may not need either the ribbon *or* the old probe
for the question that actually matters operationally: **"is there anything I
can send to right now."** That's answered directly by the `sv2-lo`/`sv2-lo
off` class (see above) with no cross-referencing needed — the picker itself
already shows both of the hour's rotating destinations regardless of whether
either is usable, and disables the block entirely when neither is.
Identifying *which specific district* is open (rather than just whether one
is) would still need either the ribbon or the picker's own open-slot label —
that half of the ribbon plan's original purpose isn't resolved by this
finding.

**Not deleting that doc** — the ribbon is still live, unchanged, and still the
better source if a rebuild ever needs "which district," not just "is
anything open." Revisit both docs together whenever a `v2_launch` rebuild is
actually scoped — and see the design requirement just below for a hard rule
that applies either way: whichever source ends up answering "which
destination," it must be re-read live immediately before sending, never
trusted from an earlier point in the cycle.

## Design requirement, decided now — not something to still figure out

**Never let a locked-destination `v2_launch` be reachable at all.** The real
UI disables the locked slot outright — no `onclick`, can't be tapped — so a
real player structurally cannot submit `v2_launch` against it, ever. Any
future automation has to match that exactly: re-read the live open/locked
state immediately before calling `v2_launch` (same discipline as Career
Auto's live cooldown cross-check), so a stale earlier read can never actually
reach the network as a request the real client couldn't have sent. This is
not a "handle the rejection gracefully" case — it's a "the request must never
be constructed in the first place" one, for the same account-safety reason
already raised for Arena's day-complete state. Decided now, not deferred,
specifically so it can't get skipped once an implementation is actually being
written.

The existing pause-and-notify pattern (Career Auto, Arena, Street Intel,
Crimes Auto all disable themselves and wait for a manual look on a genuinely
unrecognized response — player's own confirmation this has been working
well) stays the backstop for anything else unexpected. This rule isn't
replacing that; it's narrowing what "unexpected" ever has to cover by keeping
this one specific, foreseeable case from reaching the network in the first
place.

## What's still needed before any redesign

1. **A genuine rejection case for `v2_offload_all`** — nothing pending to
   collect, none captured yet. (`v2_launch`'s own rejection shape — cash —
   is now confirmed above.)
2. **`smugV2Reserve`/`smugV2Unload` in context** — a capture showing the
   surrounding UI (what section they're in, what triggers them) rather than
   just the bare `onclick` signature.

**Not actually open, corrected from an earlier draft of this doc:** whether
`item_id` is constrained to the player's current district. The underlying
buy mechanic hasn't changed — player's own confirmation: still 3 items per
district, tied to physically standing there, still buy the priciest of the
3. The picker only offering 3 choices (the exact 3 for this account's home
district, $15,000/$19,000/$23,000) reflects that same long-standing rule, not
a new one worth re-verifying. `v2_launch` just gives that same choice a
"pick one" step instead of a separate `buy` call per pet.
