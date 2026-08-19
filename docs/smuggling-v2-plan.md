# Smuggling V2 — scoping notes

Status: **draft — scoping only, nothing in this doc is implemented yet.** This exists to
capture what the 2026-08-11 upgrade actually changed about Smuggling, from real
captured traffic, so building pet automation later starts from facts instead of
re-deriving them from scratch. Sections marked `CONFIRMED` come from archive exports
(`fifth-family-archive-2026-08-18T13-30-14-218Z.ndjson.gz`, then a follow-up
`...T15-24-03-028Z.ndjson.gz` spanning 2026-08-11 through 2026-08-18, ~92k and ~95k
requests respectively). Sections marked `NEEDS CAPTURE` are gaps — things the archive
doesn't show, that need a deliberate capture session before they can be built against.

See `docs/http-archive.md` for how to pull a fresh export, and `docs/trade-assistant-plan.md`
for the old (pre-upgrade) model this replaces.

---

## What changed

Manual travel-and-carry smuggling still works — it's not gone, it's just the weaker of
two now-parallel paths. The panel's own copy calls it out directly: "Hand-Carry
Markets... Not couriers · they pay a flat ×1.20", with its own Border Seizure Risk
meter, sitting alongside the new pet system as a collapsed section a player can still
use. In the player's own words: it's still there, but the profit from travelling and
carrying cargo yourself is small next to sending a full roster of high-capacity pets,
so pets are now the primary path, not the only one.

The pet (courier) side: withdraw cash, pick a pet, buy items into your stash while
physically standing in their origin district, load them onto the pet, send it to a
destination, and it delivers and sells automatically — no manual travel required for
that leg. Each district now sells **3** contraband items (was 1) — true for both paths,
since it's the same underlying black-market catalog.

**Border seizure no longer happens on pet shipments** — confirmed from data: zero
`customs_bribe`/`customs_run`/`customs_surrender` actions anywhere in the archive after
the rollout (2026-08-11 22:xx UTC), 10 before it, none since, across 92k requests. That
absence lines up with player experience (pets stopped getting seized) but the archive
can't confirm whether hand-carry runs still risk it — none were attempted post-rollout
to check. Treat "hand-carry still has border seizure risk" as the panel's own claim,
not independently confirmed, until someone runs that path again with logging on.

## The new economy, confirmed

**10 districts, 3 items each (30 total)** — up from 8 districts × 1 item. New districts:
**Industrial District** and **Diamond District**, neither in `SEED_DISTRICTS`
(`src/shared/constants.ts`) — harmless (that seed only bootstraps an empty install; live
`get_state` captures overwrite it), but worth knowing if anyone reads that constant
expecting a complete list.

**Pets have names, tiers, capacity, and speed — all confirmed directly from archived
responses**, not inferred from a screenshot (an earlier draft of this doc read this off
a UI screenshot and mislabeled it `CONFIRMED`; it's now pulled from the `.sv2-load-*`
banner in 717 real `smug_tab=proto` captures — the full roster, not just the one pet
visible in any single screenshot):

| Pet | Tier | Capacity | Travel time penalty |
|---|---|---|---|
| George | Heavy freight | 30 | +160% |
| Wild Boar | Heavy freight | 23 | +160% |
| Blue Crab | Slow freight | 14 | +150% |
| Raccoon | Small hauler | 6 | +110% |
| Red-Tailed Hawk | Express | 10 | +60% |
| House Cat | Balanced | 8 | +82% |
| Moray Eel | Light courier | 7 | +80% |
| Fox | Runner | 5 | +55% |
| Pigeon | Tiny express | 2 | +60% |

Nine pets total, every tier name distinct — this is a real capacity/speed spectrum, not
flavor text on top of one stat block. Each pet has its own 0/10 **training** track, and
the panel always shows the *server-predicted* result of reaching it — for George:
"+10 more STR/DEF/AGI/DEX (any mix) for the next milestone... then carries 33 at +136%
travel time" (instead of 30 at +160%). That number comes from the server, not a guess,
but it's a prediction embedded in the response, not an observed transition — every pet
in the archive sits at a fixed 0/10 or 1/10 the entire 7-day window, so no capture
actually shows a capacity value change from one response to the next. What acquires and
advances pets is confirmed separately, via `POST /actions/menagerie.php`: `buy_pet`
("Acquired Wild Boar") adds a new pet to the roster, `train_pet`/`feed_pet` ("+10
points"/"+1 point") advance the 0/10 bar — "same stats it fights with — raise them in
the Menagerie" (`panel.php?type=menagerie`, itself a tracked-but-unbuilt endpoint in the
archive). Travel time penalty is a multiplier on the district-pair's base time —
`v2_depart`'s `travel_mod` field (`1.6` for Pigeon in one capture) is exactly this
number, confirming the fleet-strip stat and the actual departure math agree.

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

**Panel views** — one endpoint, three states, confirmed:

- `GET /api/panel.php?type=smuggling` (base, no `smug_tab`) — now just a tab-switcher
  stub, no real content. This is what broke the old `smugglingPanelAdapter.ts`.
- `GET /api/panel.php?type=smuggling&smug_tab=proto` — the real dashboard. **This one
  URL is all a parser needs** — the `sv2_focus` query param seen in `Game.smugV2Focus()`
  onclick handlers turns out to be client-side UI state, not a distinct request: clicking
  a fleet button (e.g. "Send George") fires `v2_draft` and then re-fetches this exact
  same `smug_tab=proto` URL, which now embeds the shipment's loading UI because a draft
  exists server-side. Confirmed directly — a captured "Send George" click showed the
  triggered request as plain `...&smug_tab=proto&_t=...`, no `sv2_focus` in sight. The
  response takes one of three shapes depending on shipment state:
  - **Idle** (no open shipment): fleet strip + stash + market catalog only.
  - **Drafting** (a shipment opened, not yet departed) — adds a Shipment section:
    - Assigned-courier banner (`.sv2-load`): pet name, tier, capacity (`.sv2-load-n`
      "Carries"), travel-time penalty (`.sv2-load-n` "Travel time").
    - Manifest (`.sv2-man-*`): `N / capacity` loaded so far, empty-state prompt if
      nothing loaded yet.
    - "In Your Stash" list: each unshipped item with a
      `onclick="Game.smugV2Load(<shipment_id>,<item_id>,<qty>,'<item name>')"` Load
      button — `qty` here is the full stash count, i.e. the UI offers to load
      everything in one click, not incrementally.
    - **Destination picker** (`.sv2-dest.two` — always exactly 2 cells, confirmed by
      the pet-picker's own copy: "send it to one of the two districts open this hour"):
      one `.sv2-dcell` per open destination, `.locked` if under-levelled. Each cell:
      district name (`.sv2-dname`), a `.sv2-dstate` badge (`+7`, `+2` — meaning not yet
      confirmed, see open questions below), `Base` / `With courier` travel times
      (`.sv2-drow .sv2-dval`), and `Sale Rate` (`.sv2-dval.mult`, seen fixed at `×1.20`
      on every open cell so far — matches "couriers always sell at a flat ×1.20,
      whatever the market is doing" from the Hand-Carry Markets note). A `.sv2-dfoot`
      note explains why a cell can't be picked yet ("Load cargo first" / "Level 121
      required"). The whole picker rotates on a countdown shown separately ("Routes
      rotate in 16m 54s") — confirmed exactly **60 minutes** by the player.
    - `onclick="Game.smugV2Cancel(<shipment_id>)"` — maps to the `v2_cancel` action.
  - **In transit**: the Shipment section instead shows a live ETA
    (`.sv2-eta`/`.sv2-tick`, `data-seconds`) and a summary of what's loaded — this is
    the shape already in the API reference table above (`v2_depart`'s response).
  - **Fleet strip** (`.sv2-fl` buttons, present in all three states): one per open
    shipment, `onclick="Game.smugV2Focus(<shipment_id>)"` (the **shipment id**, not the
    pet id used in `v2_draft`'s `user_pet_id`). Pet name and status text
    (`.sv2-fl-txt b`/`span`), ETA countdown (`.sv2-fl-eta`, `data-seconds`) once
    departed. A `.sv2-fl.new` "New delivery" button (`smugV2Focus(-1)`) starts a fresh
    draft.
  - **Black Market Inventory** (`.sv2-grid#sv2-contraband-grid`, present in all three
    states): all 30 items, each a `.sv2-card` with `data-sv2-here="1"/"0"`, item name
    (`.sv2-card-name`), owning family (`.sv2-fam-pill`), origin district
    (`.sv2-origin-pill`), price (`.sv2-card-price`), owned qty (`.sv2-card-stash`), and
    — only when buyable (`data-sv2-here="1"`) — `onclick="Game.buyContraband(<item_id>)"`.

## Gaps — needs a deliberate capture, not guessing

Resolved since the first draft of this doc: the destination picker's structure and
per-pet capacity/speed are both now confirmed above, straight from the player checking
the live UI. Two more resolved by the player's own direct knowledge, no capture needed:
**the destination rotation is confirmed exactly 60 minutes** (not just "roughly hourly"
inferred from one countdown), and `cancel` for travel is explicitly out of scope — the
player doesn't cancel trips and it has no bearing on smuggling either way, so
`travelAdapter.ts`'s unverified guess at the action name is a non-issue, not a gap.

What's actually left:

- **Full item_id catalog — 12 of 30 confirmed, all reachable ones.** The player has 3
  districts unlocked; the archive already has complete item data for everywhere
  currently accessible (Downtown, The Strip, The Docks all fully mapped — 20/21/22 for
  Arms District came from captures before that account's current district set). The
  other 18 ids sit behind level-gated districts that unlock over months of normal play,
  not something to chase or wait on. Per the "don't hardcode" rule above, this was never
  going to be a fixed table anyway — whatever's unlocked shows up live. Not a gap so
  much as a fact about how far the account has progressed.
- **What the `.sv2-dstate` badge (`+7`, `+2`) on a destination cell means — narrowed,
  not solved.** `v2_offload` responses do carry real reputation data now: `families` is
  an object, not the empty array first assumed — `{"volkskaya": 5}` alongside a message
  suffixed "Family Favor earned", where Volkskaya is the loaded item's own owning family
  per the black-market catalog's `.sv2-fam-pill`. So the mechanic is real and confirmed:
  selling nets favor with the item's family. What's still unconfirmed is whether the
  picker's `+N` badge *is* that same number shown as a preview — the badge is visible
  even before anything is loaded ("Load cargo first"), so if it's a preview it can't be
  keyed off the specific items in that shipment; more likely it's tied to which family
  controls the destination district itself. Doesn't block automation (the picker already
  says what's pickable and what it pays), just not nailed down.

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

One design rule settled already, not left open: **the pet roster, capacity, and speed
table earlier in this doc is reference material for us, not something automation should
hardcode.** Confirmed from `POST /actions/menagerie.php` — `buy_pet` ("Acquired Wild
Boar") is how a new pet enters the roster, `train_pet`/`feed_pet` ("+10 points"/"+1
point") are how a pet's capacity/speed milestone advances — neither is reflected
anywhere client-side; both just change what the server renders into the next
`smug_tab=proto` response. So automation should always read pet stats from the *latest*
captured panel response, keyed by pet name, never from a fixed table. Done that way, a
new pet from `buy_pet` or a capacity bump from crossing a training milestone shows up on
the very next panel view with no code change and no manual "rescan" step — the same
applies to newly-unlocked districts via `get_state`'s `cities` list and newly-buyable
items via the black-market grid's `data-sv2-here` flag, both already read live rather
than from `SEED_DISTRICTS` or a hardcoded catalog.

Two design questions worth deciding before writing any of this, since this is qualitatively
different from everything shipped so far — it would be the first feature that *acts* in
the game rather than only observing it:

- **What decides the route** (which pet, which items, which destination) — a fixed
  player-configured rule, or a profit-ranking built from the black-market catalog +
  `run_report` history once that data starts flowing again? With capacity/speed now
  known per pet and sale rate fixed at ×1.20 for every destination, the per-run math is
  actually simple: profit per unit is the same regardless of which of the two open
  destinations gets picked (modulo the still-unexplained `+N` badge), so the real lever
  is *which pet* (bigger capacity moves more cargo, at a steeper time cost) and *which
  item* (cheapest-per-unit at full pet capacity maximizes units moved per withdrawal),
  not route selection.
- **Safety rails** — a spend cap, a "don't run while I'm actively on the page" guard, and
  how failures (a `v2_load` rejected mid-sequence, a session/CSRF expiry) should stop the
  loop rather than retry into something worse.

Not resolved here — this doc is the map, not the decision. Every piece of the flow is now
confirmed from real traffic; nothing left in this doc blocks starting to build.

## Execution model — built, and an alternative worth having side by side

**Built (direct HTTP from background):** `petCourier.ts` reconstructs each action's
POST itself (`v2_draft`, `buy`, `v2_load`, `v2_depart`, `v2_offload`, bank
`withdraw`) via `loggedFetch`, using a CSRF token cached from whatever the content
script last observed on a real player-driven request (`csrfToken.ts` — see the
"CSRF" note earlier in this doc). Runs from the background service worker, so it
doesn't depend on the game tab staying open or focused once triggered. Ships as the
"Couriers" tab in the popup.

The CSRF-caching design carries a real, unresolved uncertainty: nothing confirms
whether the token would still be accepted if it rotates per-request server-side
(checked — no response body anywhere in the archive ever returns a fresh one, and
6,342 real POST actions across 7 days show only one non-JSON response, which is
suggestive of a static per-session token but not proof). The implementation now
fails fast and distinctly on this rather than guessing silently: `postAction`
throws a `SystemicActionError` (kind `'auth'` for a missing/rejected token, `'shape'`
for a response that parsed but doesn't look real) that aborts the whole run
immediately with one clear message, instead of retrying the identical failure once
per remaining pet.

**Alternative (drive the game's own UI functions), documented but not yet built:**
since the player's game tab is open anyway, calling the game's own `Game.*` methods
directly — the same ones its buttons already call — sidesteps the CSRF question
entirely (the game's own code handles its own token internally, same as a real
click) at the cost of needing the tab open for the run's duration. Confirmed
function signatures, pulled from real captured onclick handlers:

| Step | Confirmed call |
|---|---|
| Draft | `Game.smugV2Draft(userPetId, name)` — e.g. `Game.smugV2Draft(1997,'House Cat')` |
| Load | `Game.smugV2Load(shipmentId, itemId, qty, itemName)` |
| Depart | `Game.smugV2Depart(shipmentId, destinationCityId, destinationName, courierMinutes)` — e.g. `Game.smugV2Depart(531,2,'The Docks',19)`. Notably includes the numeric destination city id directly, which the HTTP version has to resolve separately via `db.districts`. |
| Offload | `Game.smugV2Offload(shipmentId, qty, qty)` — e.g. `Game.smugV2Offload(531,8,8)`. (There's also `Game.smugV2OffloadPartial(shipmentId, qty)` — a different action, not this one.) |
| Withdraw | `Game.bankAction('withdraw', document.getElementById('bank-amount').value)` — reads a text input's value at click time, so this one isn't "just a function call" so much as "set an input, then call a function." |

**Blocked on one real gap: buy.** `Game.buyContraband(itemId)` takes only the item
id — no quantity. Since the real POST does carry `qty=`, that number has to come
from somewhere else, and searching the archive for any input/quantity element near
every `buyContraband` occurrence found nothing. The likely explanation is a
quantity-confirm modal that opens on click and only fires a second, different
function on submit — which is pure client-side DOM, so it would never appear in a
captured network response no matter how much traffic gets recorded. This is
genuinely unconfirmed, not just undocumented — building against a guessed function
name here risks silently mis-buying with real cash, which is exactly what the rest
of this doc has tried to avoid doing anywhere else.

**To close this gap** (next step, not yet done): watch one real "Purchase" click —
either the resulting modal's HTML directly, or the page's own JS source (DevTools →
Debugger → search `buyContraband`) for whatever function the modal's own confirm
button calls. Once that's confirmed, the UI-driven path can be built as a second,
independent execution backend behind the same planning logic `petCourier.ts`
already has (which pet, which item, which destination, how much to spend) — sharing
the "what to do" decision and only swapping "how to perform one step," so the two
don't need to duplicate the affordability/selection math, just the execution layer.
