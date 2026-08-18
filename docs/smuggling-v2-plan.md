# Smuggling V2 — scoping notes

Status: **draft — scoping only, nothing in this doc is implemented yet.** This exists to
capture what the 2026-08-11 upgrade actually changed about Smuggling, from real
captured traffic, so building pet automation later starts from facts instead of
re-deriving them from scratch. Sections marked `CONFIRMED` come from the archive
export (`fifth-family-archive-2026-08-18T13-30-14-218Z.ndjson.gz`, 92k requests).
Sections marked `NEEDS CAPTURE` are gaps — things the archive doesn't show, that need
a deliberate capture session before they can be built against.

See `docs/http-archive.md` for how to pull a fresh export, and `docs/trade-assistant-plan.md`
for the old (pre-upgrade) model this replaces.

---

## What changed

In the player's own words: pets now do the travelling. You withdraw cash, pick a pet,
buy items into your stash while physically standing in their origin district, load them
onto the pet, send it to a destination, and it delivers and sells automatically —
no manual travel required. Each district now sells **3** contraband items (was 1), and
**border seizure no longer happens** on pet (courier) shipments — the risk meter still
renders in the panel, but it appears to gate only the old hand-carry path, which the
pet system has functionally replaced. Confirmed from data: zero `customs_bribe`/
`customs_run`/`customs_surrender` actions anywhere in the archive after the rollout
(2026-08-11 22:xx UTC) — 10 occurred before it, none since, across 92k requests.

## The new economy, confirmed

**10 districts, 3 items each (30 total)** — up from 8 districts × 1 item. New districts:
**Industrial District** and **Diamond District**, neither in `SEED_DISTRICTS`
(`src/shared/constants.ts`) — harmless (that seed only bootstraps an empty install; live
`get_state` captures overwrite it), but worth knowing if anyone reads that constant
expecting a complete list.

**Pets have names, not just ids** — George, Wild Boar, Blue Crab, Red-Tailed Hawk, House
Cat, Moray Eel, Fox, Pigeon confirmed in one account's fleet. Whether capacity/speed
varies by pet is unconfirmed (see gaps below) but the variety of names/art strongly
suggests it does — the user's read is that profit varies by district and item, which is
confirmed (see per-district pricing below); whether it *also* varies by pet is open.

## API reference (CONFIRMED)

All actions are `POST /actions/smuggling.php`, body
`action=<name>&...&_csrf=<token>`, distinguished by `action=`. Bank and travel are
separate endpoints.

| Step | Request | Response (shape) |
|---|---|---|
| Withdraw cash | `POST /actions/bank.php`<br>`action=withdraw&amount=1000000` | `{"ok":true,"message":"Withdrew $1,000,000","cash":1409865,"bank":495675807}` |
| Buy into stash | `POST /actions/smuggling.php`<br>`action=buy&item_id=22&qty=3` | `{"ok":true,"qty":3,"qty_requested":3,"message":"Secured 3 Encrypted Weapons Schematics! Now move out securely."}`. `qty` can be less than `qty_requested` if capacity-capped (see `smugglingActionAdapter.ts`'s buy-qty fix, already shipped). Only works while standing in the item's origin district — the panel's `.sv2-btn` is `disabled`/`.sv2-btn-lock` otherwise. |
| Open a shipment | `action=v2_draft&user_pet_id=1983` | `{"ok":true,"shipment_id":10886,"message":"Delivery opened."}` |
| Load an item | `action=v2_load&shipment_id=10886&item_id=22&qty=2` | `{"ok":true,"message":"Cargo loaded.","cargo_basis":46000}` — `cargo_basis` is a running total cost, not per-call. Call repeatedly (different `item_id`s or more `qty`) until the pet is full. |
| Remove a loaded item | `action=v2_unload&shipment_id=6397&item_id=8&qty=10` | `{"ok":true,"message":"Cargo unloaded.","cargo_basis":0}` |
| Send the pet | `action=v2_depart&shipment_id=10886&destination_city_id=1` | `{"ok":true,"message":"Pigeon away to Downtown — 16 minutes.","minutes":16,"base_minutes":10,"travel_mod":1.6,"manifest_qty":2,"cargo_basis":46000,"pet_name":"Pigeon","pet_id":1983,"destination":"Downtown","fare_paid":0}` |
| Cancel before departure | `action=v2_cancel&shipment_id=6397` | `{"ok":true,"message":"Shipment cancelled. 0 units returned."}` |
| Sell on arrival | `action=v2_offload&shipment_id=9406&qty=` | Before arrival: `{"ok":false,"error":"That shipment has not arrived yet."}`. On success: `{"ok":true,"message":"Offloaded 2 units for $54,683 ($8,682 profit).","units_sold":2,"cash_received":54683,"purchase_cost":46000,"net_profit":8682,"market_state":"delivery","market_mult":1.2,"run_report":{"pet":"Pigeon","origin":"Arms District","destination":"The Docks","cash_received":54683,"purchase_cost":46000,"net_profit":8682},"was_capped":false,"families":[],"lines":[{"name":"Encrypted Weapons Schematics","contraband_id":22,"qty":2,"unit_net":4341.02,"rep":false}]}` |
| Pin a favourite pet | `action=v2_favourite&user_pet_id=2207&on=0` | `{"ok":true,"favourite":false,"message":"Unpinned."}` |

`run_report` on a successful offload is the single best target for a "trade closed"
event — it names pet, origin, destination, and net profit in one structured object,
unlike the old model's message-regex scraping.

**Panel views** (all `GET /api/panel.php?type=smuggling...`):

- `?type=smuggling` (base, no `smug_tab`) — now just a tab-switcher stub, no real
  content. This is what broke the old `smugglingPanelAdapter.ts`.
- `?smug_tab=proto&type=smuggling` — the real dashboard. Contains:
  - **Fleet strip** (`.sv2-fl` buttons): one per shipment/pet, `onclick="Game.smugV2Focus(<shipment_id>)"` — note this is the **shipment id**, not the pet id used in `v2_draft`'s `user_pet_id`. Pet name and current status text (`.sv2-fl-txt b`/`span`), ETA countdown (`.sv2-fl-eta`, `data-seconds`). A `.sv2-fl.new` "New delivery" button (`smugV2Focus(-1)`) starts a fresh shipment.
  - **Your Stash** (`.sv2-card` under that heading): unshipped items bought but not yet loaded onto a pet.
  - **Black Market Inventory** (`.sv2-grid#sv2-contraband-grid`): all 30 items, each a `.sv2-card` with `data-sv2-here="1"/"0"`, item name (`.sv2-card-name`), owning family (`.sv2-fam-pill`), origin district (`.sv2-origin-pill`), price (`.sv2-card-price`), owned qty (`.sv2-card-stash`), and — only when buyable (`data-sv2-here="1"`) — `onclick="Game.buyContraband(<item_id>)"`.
- `?smug_tab=proto&sv2_focus=<shipment_id>&type=smuggling` — per-shipment detail (used after `smugV2Focus`). Confirmed to render for an in-transit shipment; the loading screen for an *open, not-yet-departed* shipment (where the destination picker and per-item load buttons should live) was not captured cleanly in this export — see gaps below.

## Gaps — needs a deliberate capture, not guessing

- **The destination picker.** The user describes seeing "the list of destinations open
  at that time, they change every 1 hour or so" after picking a pet. No response in the
  archive contains a real (non-CSS-only) `.sv2-dcell`/`.sv2-dest` element — every
  `sv2_focus` capture landed on either `-1` (pet picker) or an already-in-transit
  shipment. Likely cause: my search matched `sv2_focus` against `user_pet_id`, but the
  URL param is actually the **shipment_id** (see above) — a capture taken with
  `sv2_focus=<the shipment_id from a v2_draft response>` should land on the loading
  screen. Worth one deliberate capture: open Smuggling → New Delivery → pick a pet →
  export the archive immediately after, before loading/departing.
- **Full item_id catalog.** Only the 3 items native to the capturing account's current
  district exposed a real `buyContraband(id)` handler in this export (ids 20/21/22,
  Arms District). The other 27 need either a capture from each district, or accumulating
  `item_id` values from `buy` action request bodies over time.
- **Per-pet capacity/speed.** Unconfirmed whether different pets (George vs Pigeon vs
  Wild Boar, etc.) carry different cargo capacity or travel speed multipliers — the
  fleet strip doesn't show it, and no two pets were compared loading the same route in
  this export. `v2_depart`'s `travel_mod` (seen as `1.6` for Pigeon → Downtown) hints
  pets do differ, but that's one data point.
- **`cancel` action name for travel.** `travelAdapter.ts` guesses the old `/api/travel.php`
  action name `cancel` survived the rename to `/actions/travel_proto.php` unchanged —
  zero cancel calls appear in this export to confirm it. Harmless if wrong (falls through
  to a no-op), but worth confirming before relying on it.

## Bundled cleanup (not yet done — scope for the same pass)

Two things came out of researching this that are real but not urgent, because neither
is currently producing *live* wrong behavior — they're dormant or self-correcting, not
actively broken:

1. **Retire the border-seizure/customs system.** `riskEngine.ts`, the `CustomsEvent`/
   `PendingCustoms`/`RiskObservation`/`SmugglingRaid` types, their Dexie tables, and the
   "Customs Calculator" popup tab (`analytics/customsCalculator.ts`,
   `analytics/riskDatabase.ts`, `popup/features/tradeAssistant/tabs/Calculator.tsx`) are
   all built around a mechanic that no longer fires. Nothing is currently miscomputing
   because of them — the code paths that would feed them (raid-screen detection,
   `customs_bribe`/`customs_run`/`customs_surrender` parsing) simply never match
   anymore, and `tradeMatcher.ts`'s bribe-cost math already degrades gracefully to zero
   with no customs events to sum. Removing this properly touches `types.ts`, `db.ts`
   (a schema version dropping two tables), `storage.ts`, `Trade.caught`/`bribe`/
   `bribeCount`, and the Calculator tab's removal from the popup — real but mechanical,
   best done compiler-guided (`npm run type-check` after each type-level cut) once the
   replacement price model below is being built anyway, rather than as an isolated pass.
2. **Stale trade pricing.** `tradeMatcher.openTrade()` still runs on every live `buy`
   action and prices the trade off `db.priceSnapshots` — which hasn't received a new
   row since the old panel broke (2026-08-11). Every trade opened since then is silently
   costed against pre-upgrade prices. Not fixable in isolation either — it needs a
   current price source, which is the black-market-catalog parser below.

## Toward automation

The step-by-step flow the user described maps directly onto the API table above:

```
withdraw (bank.php)
  → v2_draft (pick pet)
  → loop: buy (in origin district) + v2_load, until pet full or budget spent
  → v2_depart (pick destination)
  → wait for arrival (poll fleet strip / shipment ETA, or an alarm off `minutes`)
  → v2_offload
  → repeat
```

Two design questions worth deciding before writing any of this, since this is qualitatively
different from everything shipped so far — it would be the first feature that *acts* in
the game rather than only observing it:

- **What decides the route** (which pet, which items, which destination) — a fixed
  player-configured rule, or a profit-ranking built from the black-market catalog +
  `run_report` history once that data starts flowing again?
- **Safety rails** — a spend cap, a "don't run while I'm actively on the page" guard, and
  how failures (a `v2_load` rejected mid-sequence, a session/CSRF expiry) should stop the
  loop rather than retry into something worse.

Not resolved here — this doc is the map, not the decision. Once the destination-picker
gap above is filled in, this is buildable.
