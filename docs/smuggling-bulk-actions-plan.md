# Smuggling bulk actions (`v2_launch` / `v2_offload_all`) — scoping notes

Status: **implemented and shipped (v0.28.0)** — see `petCourier.ts`'s
`runLaunch`/`runOffloadAll` and `courierWatch.ts`'s live-panel destination
check. Originally scoping notes only, written while the player was still
manually testing the new UI; kept as a living record afterward, since real
post-ship traffic keeps surfacing things the pre-ship archive never happened
to capture (see "CONFIRMED post-ship" below). Sections marked `CONFIRMED`
come from `fifth-family-archive-2026-09-18T23-32-12-299Z.ndjson.gz` unless a
different archive filename is cited inline.

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

**The page is now split into tabs — "Operations · Inventory · History"** —
and the manual buy UI moved rather than disappeared. Player's own
confirmation: the Black Market Inventory grid (the `Game.buyContraband(...)`
"Purchase" button — see below) now lives under **Inventory**, not the main
**Operations** view where the fleet/launch/offload UI sits. Explains why it
looked missing at first — it's a real navigation change, not a removed
feature, and it's why the extension's own existing `buy` automation
(`petCourier.ts`) kept working the whole time (confirmed: 740 real `buy`
calls in the latest archive, all succeeding) while it looked absent from the
page a player would normally be looking at.

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

### CONFIRMED post-ship: `v2_launch` caps at 10 couriers per call, regardless of cash

Found after this feature shipped, once the account had more than 10 pets
idle at once for the first time — nothing in the scoping above caught this
because every archive sample available at design time topped out at 9 pets
in one call. Confirmed from
`fifth-family-archive-2026-09-19T18-18-08-723Z.ndjson.gz`, four real
`v2_launch` calls spanning two separate sessions (one the account owner's
own manual testing from before this feature existed, one this extension's
own first real run):

```
11 pet ids, cash short of the full cost
→ {"ok":false,"error":"Ran out of cash for more cargo."}

11 pet ids, cash short of even the accepted 10's cost
→ {"ok":true,"sent":10,"units_sent":137,"units_bought":129,"cash_spent":2967000,...}
   (137 = full capacity of the first 10 pet ids in the list; only $2,967,000
   of the needed $3,151,000 was on hand, so it also ran out mid-purchase —
   a separate, previously-unseen "bought as much as it could afford, still
   ok:true" behavior, distinct from the hard-rejection case above)

11 pet ids, cash sized exactly for all 11 ($3,243,000)
→ {"ok":true,"sent":10,"units_sent":137,"units_bought":137,"cash_spent":3151000,...}
   (the 11th pet id — smallest capacity, last in the submitted list — is
   simply dropped; the $92,000 its cargo would have cost is never spent,
   and the response gives no signal that anything was left out beyond
   sent=10 not matching the 11 ids submitted)

10 pet ids, cash comfortably more than needed
→ {"ok":true,"sent":10,"units_sent":137,"units_bought":137,"cash_spent":3151000,...}
   (clean, full success — 10 is fine)
```

Every 11-pet attempt across both sessions hit the identical ceiling: the
first 10 pet ids in the submitted list are accepted, the 11th is silently
dropped, and the response still comes back `ok:true` — no error, no
`was_capped`-style flag, nothing to detect except `sent` not matching
`user_pet_ids.length`. 10 pets in one call has succeeded fully multiple
times across both sessions; 11 has never once gone through in full,
regardless of how much cash was available — ruling out a cash-sizing
mistake as the explanation (the third example above had the exact right
amount of cash for all 11 and still lost one).

**Implication for automation:** `runLaunch` must never submit more than 10
`user_pet_ids` in one call. More than 10 idle pets needs multiple `v2_launch`
calls in the same cycle, chunked at 10 — and, per the design requirement
below, each chunk after the first needs its own live `launchAvailability`
re-check immediately before it fires, not just the first, since sending one
chunk changes which pets are still idle and (at the top of the hour) the
destination itself could rotate between chunks.

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

## Two smaller additions — CONFIRMED, and both belong to the *old* draft flow, not the new bulk one

Found their bare `onclick` signatures via a first regex sweep and left them
unconfirmed; went back into the same archive and pulled the actual
surrounding markup rather than asking for a fresh capture — both are
resolved now.

- **`Game.smugV2Reserve(inventoryInstanceId, boosterCatalogId, boosterName)`**
  — e.g. `smugV2Reserve(65975,273,'Hidden Compartments')`. Sits in the
  single-shipment draft screen's **"Boosters · one per effect family"**
  section, next to a `"Profit"` row reading `"none held"` — this is the
  button that applies a held booster consumable (Hidden Compartments =
  the Capacity-family booster) to the shipment currently being drafted. Not
  a `qty` in the second argument — `273` showed up identical across every
  real "Hidden Compartments" click captured, so that's the booster's own
  catalog id; the first number is the specific held copy's inventory id.
- **`Game.smugV2Unload(userPetId, itemId, qty, itemName)`** — e.g.
  `smugV2Unload(65989,22,33,'Encrypted Weapons Schematics')`. Original guess
  was right: sits directly on one manifest line
  (`"Encrypted Weapons Schematics ×33 · Kito-gumi · paid $759,000..."`,
  `"33 / 33"` manifest count shown full above it) as an **"Unload"** button —
  removes that whole line from the draft before departure. Exact inverse of
  `v2_load`, in the same old single-shipment screen.

Neither is part of the new `v2_launch`/`v2_offload_all` bulk flow — both are
previously-undocumented pieces of the pre-existing manual draft screen that
this archive happened to also capture. Worth a mention in
`docs/smuggling-v2-plan.md` at some point (the Boosters section especially —
a whole mechanic with no doc coverage yet), but out of scope for this one.

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

**Never call either bulk action in a state where the real UI doesn't offer
the button for it.** Confirmed for both:

- **`v2_launch` against a locked destination slot** — the real UI disables
  it outright, no `onclick`, can't be tapped. Its own idle-pet threshold is
  low, though — confirmed across all three archives pulled for this doc: the
  bulk picker (`<div class="sv2-lo">`, no `off`) enables with as few as **1**
  idle pet, not 2. Don't assume the two actions share a threshold — they
  don't (see next point).
- **`v2_offload_all`** — confirmed from the archive, not just a screenshot:
  the whole `<button class="sv2-collect-all" onclick="Game.smugV2OffloadAll(N)">`
  is **entirely absent from the markup**, not merely disabled, whenever
  fewer than **2** deliveries have arrived. Checked 57 real instances of the
  button across this archive — `N` always matched the live ready-delivery
  count exactly, and it never appeared once below 2. With exactly 1 arrived,
  the panel doesn't just hide the bulk button — it shows the old
  single-shipment card in its place instead, with its own already-known
  actions: `Game.smugV2OffloadPartial(shipmentId, qty)` ("Offload Some") and
  `Game.smugV2Offload(shipmentId, qty, qty)` ("Offload"), both already
  implemented in `petCourier.ts`. So this isn't only "don't call
  `v2_offload_all` below 2" — it's "below 2, use the existing single-shipment
  offload flow instead, exactly matching what a real player sees." Any
  automation built around the bulk actions still needs the old per-shipment
  path kept alongside it for this case, not dropped in favor of the new one.

In both cases, a real player has **no way to trigger the call at all** in
that state — this isn't "the server would probably reject it," it's "there
is no legitimate path to ever construct this request." Any future automation
has to match that exactly: re-read the live state immediately before calling
either action (same discipline as Career Auto's live cooldown cross-check),
so a stale earlier read can never reach the network as a request the real
client couldn't have sent. Not a "handle the rejection gracefully" case for
either action — a "the request must never be constructed in the first place"
one, same account-safety reason already raised for Arena's day-complete
state. Decided now, not deferred, so it can't get skipped once an
implementation is actually being written.

The existing pause-and-notify pattern (Career Auto, Arena, Street Intel,
Crimes Auto all disable themselves and wait for a manual look on a genuinely
unrecognized response — player's own confirmation this has been working
well) stays the backstop for anything else unexpected. This rule isn't
replacing that; it's narrowing what "unexpected" ever has to cover by keeping
these two specific, foreseeable cases from reaching the network in the first
place.

## The shape a rebuild would likely take — sketch only, not scoped or decided

"Additive" describes what the *game* changed (nothing removed, buy just
moved tabs) — it doesn't mean our own automation would stay the same shape.
The new actions cover most of what the old per-pet loop did manually, in one
call instead of N, so a rebuild would touch real structure, not just swap a
function call.

**Background (`petCourier.ts` / `courierWatch.ts`):**

- **The per-pet dispatch loop mostly disappears.** `runCourierBatch()`
  today drafts, buys, loads, and departs one pet at a time. A rebuild
  replaces nearly all of that with a single `v2_launch` per cycle: gather
  eligible idle pets, pick an item, pick the destination, fire once. The old
  per-pet loop only survives for the cases already confirmed the bulk button
  doesn't cover (none of which are "many idle pets" — they're the documented
  edge cases above).
- **Destination detection gets cheaper.** `courierWatch.ts` currently drafts
  a shipment and cancels it just to see whether a destination is open — the
  whole reason `docs/smuggling-route-ribbon-plan.md` exists. The `sv2-lo`/
  `sv2-lo off` signal on the same panel fetch answers "can I send right now"
  directly, no draft/cancel needed.
- **Offload gets the same treatment**, with the confirmed 2-vs-1 split:
  `v2_offload_all` at 2+ arrived, the existing single-shipment
  `v2_offload`/`v2_offload_partial` for exactly 1, nothing at 0.
- **One genuinely new piece of logic: cash management.** The old flow bought
  small amounts per pet as it went. `v2_launch` wants a `max_spend` up
  front, which — per the account owner's own workflow — means checking cash
  on hand and withdrawing from the bank first if it's short. Nothing in the
  current automation does this today.

**UI (`courierPanel.ts` overlay + `PetCouriersHome.tsx` popup):** mostly
simplification. Status display currently tracks per-pet draft/load/depart
progress across a multi-step batch; that collapses to one summary line per
cycle ("sent N couriers to X, bought Y units for $Z"), since there's one
call to report on instead of a sequence. The enable/disable toggle stays the
same shape.

**"Buy the priciest item" is a sound, grounded choice — confirmed, not just a
habit.** `v2_launch` picks a single item for the *entire* batch, same as the
existing automation's own `pickItem()` (`petCourier.ts:97`) always has: the
highest-priced buyable item. No comment explains it in the code, but the
reasoning behind it checks out:

- **The fact behind it predates the code, confirmed from `docs/smuggling-v2-plan.md`**
  — written the same period `pickItem()` was added (2026-08-19), already
  quoting the panel's own copy: *"Hand-Carry Markets... Not couriers · they
  pay a flat ×1.20"* — the exact same fixed-margin fact the account owner
  quoted from today's UI. Sell price is always buy price × 1.20, so profit
  *per unit* scales with item price. Pet capacity caps *units carried*, not
  cash spent — so under a fixed-capacity trip, buying the priciest item
  maximizes total profit. That's the correct conclusion from that fact, not
  a coincidence — the plan doc's own "cheapest maximizes units per
  withdrawal" line wasn't a competing conclusion the code ignored, it was
  explicitly one of *"two design questions worth deciding before writing any
  of this"* (the doc's own framing) — an option weighed, not a decision
  overridden.

**Not actually a design question — corrected from an earlier draft of this
doc, which overthought it.** The archive's `"Ran out of cash for more
cargo"` rejection looked like it might mean the account genuinely couldn't
afford the batch. It didn't: bank balance at the time was **$674,499,968**;
the batch needed $3,243,000, well under 1% of it. What actually happened was
pure sequencing — `v2_launch` was called before withdrawing, got rejected,
the account owner withdrew, then it succeeded. There's no real affordability
problem to design around here, and no tradeoff to weigh: an automated
version just needs to withdraw what the batch will cost *before* calling
`v2_launch`, the same order the account owner already uses by hand. With a
bank balance in the hundreds of millions, that alone makes the rejection a
non-issue in practice.

## What's still needed before any redesign

Nothing left open as of the original scoping pass — every question listed
here got resolved from the archive data in hand at the time, not from a
fresh capture. One thing *has* surfaced since, from real post-ship traffic
rather than scoping: the 10-courier-per-call cap documented above. Chunking
`runLaunch` at 10 is the follow-up this leaves open.

- `v2_launch`'s insufficient-cash shape — confirmed hard rejection, above.
- Whether either bulk action can be called in a state its own button
  wouldn't exist for — confirmed no, for both, in the design-requirement
  section above.
- `smugV2Reserve`/`smugV2Unload` — confirmed above, both old-flow, not
  new-flow.
- Whether `item_id` is constrained to the player's current district —
  corrected: this was never really open, the underlying buy mechanic hasn't
  changed (player's own confirmation: still 3 items per district, tied to
  physically standing there, still buy the priciest of the 3). The picker
  only offering 3 choices (the exact 3 for this account's home district,
  $15,000/$19,000/$23,000) reflects that same long-standing rule, not a new
  one worth re-verifying. `v2_launch` just gives that same choice a
  "pick one" step instead of a separate `buy` call per pet.

Only remaining real gap: a genuine rejection case for `v2_offload_all`
itself (empty roster aside — nothing pending to collect at all — was never
actually tested against the server, only inferred from the button's own
absence). Low priority; the "won't even construct the call" design rule
already covers the case that matters for safety.
