# Fifth Family Trade Assistant — Browser Extension Plan

This is the first feature of **The Fifth Family Enhancements**, a browser extension for
[thefifthfamily.com](https://www.thefifthfamily.com). It passively watches gameplay and
automatically records trading, customs, and market data so the player never has to
manually track buy/sell prices, bribes, or catch rates again.

Status: **draft — refining before implementation.** Sections marked `CONFIRMED` are
based on observed network traffic. Sections marked `NEEDS VERIFICATION` still need a
sample payload or an answer from the player.

---

## What We Know

### Game Behaviour (CONFIRMED)

- The entire game lives at a single URL: `https://www.thefifthfamily.com/index.php`. It
  never navigates — everything is a client-side panel swap driven by the page's own JS
  (`Game.loadPanel(...)`).
- Panels are fetched from a JSON API:
  `GET /api/panel.php?type=<panelName>&_t=<clientTimestamp>`
  Response shape:
  ```json
  { "ok": true, "title": "Syndicate Smuggling", "html": "<style>...</style><div class=\"panel-content\">...</div>" }
  ```
  The `html` field is a **string** containing a full fragment (inline `<style>` +
  markup) that the game injects into the DOM. This means we can potentially read
  structured data straight from the network response, before it ever touches the DOM,
  rather than scraping rendered HTML.
- Known panel type so far: `type=smuggling` (has sub-tabs `smug_tab=live` and
  `smug_tab=proto`, switched client-side via `Game.loadPanel('smuggling', '', '&smug_tab=...')`
  — same endpoint, extra query param).
- **Actions are a separate endpoint from panel views:** `GET /api/panel.php?type=X` is
  read-only (loads a view). Mutating actions go to
  `POST /actions/<feature>.php` (confirmed: `/actions/smuggling.php`) with a
  `application/x-www-form-urlencoded` body: `action=<actionName>&_csrf=<token>`. After
  an action completes, the game re-fetches the relevant panel via the usual
  `GET /api/panel.php?type=X` to refresh the view. This means our capture pipeline has
  two distinct signal types to hook, not one: panel-view GETs (state snapshots) and
  action POSTs (state transitions + their result messages). The `_csrf` token confirms
  there's a CSRF token in play — irrelevant for a passive/read-only tracker, but worth
  knowing since it means we can't easily replay/synthesize requests ourselves later
  without reading it from the page.
- **Confirmed action: `action=customs_bribe`.** Response is a bare confirmation, not
  structured data: `{"ok":true,"message":"You slipped the guard $44,000. You passed the
  checkpoint."}`. The bribe *amount* only appears in the free-text message here — the
  structured bribe amount we actually want comes from the customs panel/screen that
  appeared *before* this action fired (see below). So capture order matters: the raid
  screen (with district + bribe amount) is the primary data source; the action response
  is only useful as an outcome confirmation (parse "$X" out of the message as a
  cross-check, or just trust that a `customs_bribe` action firing means the prior raid
  screen's outcome was "paid").
- **Corrected: the "Border Ambush!" raid screen is returned by a plain
  `GET /api/panel.php?type=smuggling` reload, not embedded in a POST action's
  response.** Confirmed directly: "when it showed that i was caught by border agents,
  it is the same request, no body just a GET request." So `panel.php?type=smuggling`
  has (at least) two possible response shapes for the exact same request — the normal
  listing, or the raid screen — decided server-side by RNG at fetch time. Our adapter
  for this endpoint needs to branch on response shape (e.g. presence of
  `sgl-raid-screen` in the HTML) rather than assume one fixed shape per `type=`. The
  raid screen still only carries district + bribe amount, no cargo type/qty/value — see
  "Customs cargo attribution" design decision below for how we plan to fill that gap
  without further captures.
- **Confirmed buy action:** `POST /actions/smuggling.php`, **multipart FormData**
  (not urlencoded) body `action=buy&item_id=<id>&qty=<n>&_csrf=<token>`. So buy *does*
  take an explicit quantity — confirmed real example `item_id=3&qty=22` (Stolen
  Artwork). Response is still just a message:
  `{"ok":true,"message":"Secured 22 Stolen Artwork! Now move out securely."}` — no
  price or resulting cash in the response, so **buy price must come from the most
  recent smuggling-panel price snapshot for that item**, not from the action response.
- **Confirmed sell action:** `POST /actions/smuggling.php`, FormData body
  `action=sell&item_id=<id>&_csrf=<token>` — **no `qty` param**, consistent with the
  single shared stash pool (selling always offloads everything you're holding).
  Response is structured enough to parse directly:
  `{"ok":true,"message":"Market offload: Sold 22 Counterfeit Passports for $81,503
  ($15,503 profit)"}`. This one message gives us quantity, item name, total sale
  value, **and profit** in one shot — parseable with something like
  `/Sold (\d+) (.+?) for \$([\d,]+) \(\$([\d,]+) profit\)/`. Since profit = sale − cost,
  we can back out the total buy cost (`sale − profit`) straight from this single
  message, without needing to have perfectly tracked the earlier buy price — though we
  still want the buy event for `buyDistrict`/`buyTime`/trip-duration fields.
- **The earlier ambiguity is resolved:** the previous capture's
  `"Secured 22 Counterfeit Passports!"` message *was* a genuine buy confirmation — it's
  just that a separate sell of the held Artwork happened first (now confirmed above as
  its own distinct `action=sell` request), and both fired in the same play session.
  Two separate actions, as suspected, not one combined action.
- **Confirmed: travel is a distinct subsystem with its own API file, not
  `panel.php`/`actions/smuggling.php`.** `GET /api/panel.php?type=travel` only returns
  a loading shell — the actual city list and travel state are fetched by a second,
  inline-injected request the shell's own script fires immediately after:
  `POST /api/travel.php` with FormData `action=get_cities` (no other fields), returning
  the full city catalog plus live travel status:
  ```json
  {
    "ok": true,
    "cities": [
      { "id": 1, "name": "Downtown", "slug": "downtown", "level_required": 0,
        "travel_time_walk": 660, "travel_time_taxi": 330, "travel_cost_taxi": 4000,
        "crime_bonus": "1.00", "casino_bonus": "1.00", "smuggling_bonus": "0.00",
        "requires_boss_id": null, "boss_locked": false, "boss_lock_msg": "" },
      { "id": 4, "name": "The Strip", "smuggling_bonus": "0.00", "boss_locked": false, "...": "..." },
      { "id": 7, "name": "The Waterfront", "smuggling_bonus": "2.50", "boss_locked": true,
        "boss_lock_msg": "Defeat Don Enzo Castellano in The Penthouse", "...": "..." }
    ],
    "current_city": 4,
    "travelling": true,
    "travel_remaining": 660,
    "travel_destination": 1,
    "vehicle_name": "2023 Monarch Imperium",
    "vehicle_travel_reduction": 0
  }
  ```
  This is the **authoritative source for the District reference table** — full
  id/name/slug catalog, unlock requirements, and per-city bonuses — and it's fetched
  passively every time the player opens the Travel panel, so we get it for free. It
  also fully resolves the `current_city` id→name mapping (see table below) and gives us
  a **live, non-inferred travel countdown** (`travel_remaining` seconds,
  `travel_destination` id) instead of having to guess trip duration from timestamps.
  **Actually initiating travel** is a separate call:
  `POST /api/travel.php` with FormData `action=travel&city_id=<id>&method=walk|taxi` →
  `{"ok":true,"message":"Travelling to Downtown! ETA: 11 minutes.","instant":false,"travel_time":660}`.
  Travel is **not instant** — walking/taxi have real durations (taxi costs cash, is
  faster). This means PRD item 4's "trip duration" should be computed from this real
  `travel_time`/`travel_remaining` data, not purely inferred from buy/sell timestamp
  deltas, and district-change detection (item 1) should fire on arrival (when
  `current_city` actually updates), with travel-in-progress as its own visible state
  rather than a district change.
- **Confirmed full district catalog (from `get_cities`), superseding the earlier
  partial table** — note there are **8 districts total, not 7**; "The Syndicate" is an
  endgame-locked 8th location not mentioned in the original PRD:

  | id | Name | Native contraband | Unlock | Smuggling bonus |
  |---|---|---|---|---|
  | 1 | Downtown | Counterfeit Passports | none (start) | 0% |
  | 2 | The Docks | Uncut Diamonds | defeat boss in The Strip | 0% |
  | 3 | The Underground | Black-Market Steroids | defeat boss in Arms District | 0% |
  | 4 | The Strip | Stolen Artwork | defeat boss in Downtown | 0% |
  | 5 | Arms District | Military Munitions | defeat boss in The Docks | 0% |
  | 6 | The Penthouse | Forged Bonds | defeat boss in The Underground | 0% |
  | 7 | The Waterfront | Rare Antiquities | defeat boss in The Penthouse | **+250%** |
  | 8 | The Syndicate | *(unknown — not yet reached)* | defeat boss in The Waterfront | 0% |

  Note the district *id* order doesn't match travel-unlock order (id 4 = The Strip
  unlocks 2nd, right after Downtown) — so ids must never be assumed sequential by
  in-game progression, only learned from this payload. Also worth flagging for the
  later Best Trade feature (not v1): The Waterfront's +250% smuggling bonus suggests
  the displayed "Live Street Value" prices may already have per-city bonuses baked in,
  or may not — needs checking once we're at the recommendation-engine stage.
- **Confirmed: full contraband catalog = 7 items, one per district, matching 1:1.**
  Read directly off the `type=smuggling` panel's cards:

  | District | Native contraband |
  |---|---|
  | Downtown | Counterfeit Passports |
  | The Docks | Uncut Diamonds |
  | The Strip | Stolen Artwork |
  | Arms District | Military Munitions |
  | The Underground | Black-Market Steroids |
  | The Penthouse | Forged Bonds |
  | The Waterfront | Rare Antiquities |

  This confirms the PRD's 7 named districts are the real in-game names, and gives us
  the complete item catalog for v1 — no more items to discover.
- **Confirmed smuggling-panel fields** (per visit, all in the `html` fragment):
  - `Hidden Cargo`: current stash count / max capacity (e.g. `22 / 22`) — total across
    all held contraband, not per item. Player apparently can only hold one contraband
    type at a time (buying fills your held stash for that item; capacity is a single
    shared pool).
  - `Border Seizure Risk`: a single global percentage (e.g. `50%`), explicitly "escalates
    with volume" — i.e. this looks like a function of *how much cargo you're currently
    carrying*, not a fixed per-item risk. This is more general than the PRD's per-item
    `displayedRisk` assumption (item 6 / customs risk database) — **needs
    verification**: does the actual customs encounter also show a per-encounter risk %
    distinct from this running "Border Seizure Risk" gauge, or is this gauge literally
    the "displayed risk" the PRD means?
  - `Daily Profit`: a running total the game itself tracks (e.g. `$204,455`, cap
    `$1,600,000`, "Resets midnight"). Useful as a cross-check against our own computed
    profit, not a replacement for it (ours needs to survive past midnight resets and be
    per-trade, not just a daily aggregate).
  - `Market shifts in <span id="smug-price-timer" data-seconds="197">4m</span>` — the
    **exact seconds remaining until the next price shift is given directly in the
    payload** (`data-seconds`). This fully resolves the "is it really 10 minutes"
    question from the PRD's Market Timer nice-to-have — we don't need to assume a fixed
    cadence at all, we just read this value verbatim every time we see the panel.
  - Per-item card: name, origin district, "Wholesale Buy Price" (if you're standing in
    the origin district) *or* "Live Street Value" + trend arrow + `%` vs wholesale (if
    you're elsewhere), current STASH quantity, and a button that is one of:
    `Game.buyContraband(<id>)`, `Game.sellContraband(<id>)`, or a disabled
    "No Stock"/"Buy in `<district>`" lock button. The numeric id in `buyContraband`/
    `sellContraband` is a stable per-item id we can learn by pairing it with the card's
    item name the first time we see it — no need to hardcode a name→id table, the
    adapter can build it from observed payloads.
- **Confirmed: `GET /api/stats.php`** (polled frequently by the game's own UI — this
  will be one of the most common requests our hook sees) returns full player state,
  most importantly for us:
  ```json
  {
    "stats": { "cash": 212854, "bank": 2205468, "current_city": 1, "heat": 20, ... },
    "status": { "jailed": false, "hospitalized": false, "travelling": false,
                "travel_seconds": 0, "travel_destination": "", "travel_method": "walk" }
  }
  ```
  `current_city` is a **numeric district id**, given on essentially every stats poll.
  This is a far more robust signal for MVP item 1 ("detect current district") than
  parsing panel text — we just diff `current_city` across polls and emit a district
  transition when it changes. We don't have the id→name mapping yet, but we don't need
  it hardcoded either: the first time we observe a given `current_city` value alongside
  a smuggling-panel visit showing "Black Market Contacts: `<name>`", we learn that
  mapping and cache it. `cash`/`bank` are also useful as a sanity check against our own
  buy/sell price bookkeeping, and `travelling`/`travel_seconds`/`travel_destination`
  give us real trip-duration data (PRD item 4) instead of inferring it purely from
  buy/sell timestamps.

### Customs cargo attribution — design decision (no further capture needed)

The raid screen itself will likely never carry cargo type/qty/value (we've now seen it
twice, from a plain panel GET, and it's always just district + bribe amount). Rather
than keep hunting for a payload that may not exist, the plan is to **attribute cargo
context from the most recently observed stash snapshot**: every smuggling-panel view
already tells us current STASH item + quantity (via the `sgl-c-owned` card matching
`(You are here)`/held-item state). When a raid screen appears, we look up whatever
item+quantity we last saw the player holding and attribute the encounter to that. This
is a reasonable inference since the player can only hold one contraband type at a time.
`cargoValue` can be derived as `quantity × last-known wholesale price for that item`.

### Detection Strategy (CONFIRMED approach, changes the PRD's original assumption, and broadened from earlier drafts of this doc)

The original PRD assumed we'd need pure DOM text-matching + `MutationObserver` because
"the game UI may change." Now that we've seen real payloads, there's a better primary
signal available: **the panel/action/stats API responses themselves are structured
enough to key off of** (URL pathname, request body's `action=` field, `type`/`title`
fields, and predictable HTML inside `html`). One correction from an earlier draft of
this doc: we originally assumed only two endpoint shapes existed
(`/api/panel.php` for views, `/actions/*.php` for mutations) — but Travel introduced a
**third** file, `/api/travel.php`, called directly by inline page script rather than
through either of those patterns. So the hook must **not** hardcode an allowlist of
exact URLs — it should intercept every request to `thefifthfamily.com`'s `/api/*.php`
and `/actions/*.php` paths generically, and let each adapter self-identify from the
pathname + request body + response shape, since new panels will likely introduce
further one-off API files the same way Travel did. Plan:

1. **Primary: network interception.** Hook `fetch`/`XMLHttpRequest` in the page's main
   world (MV3 content script with `"world": "MAIN"`, or `chrome.scripting.executeScript`
   with `world: "MAIN"`) to observe every request under `/api/*.php` and
   `/actions/*.php`, generically, rather than a fixed list. Confirmed endpoints so far:
   - `GET /api/panel.php?type=X` — view snapshots. Parse `response.type` + `response.title`
     to know what we're looking at, then parse `response.html` (as a detached
     `DOMParser` document, not the live page DOM) for the actual data. Same `type=`
     can return more than one response *shape* (e.g. `type=smuggling` returns either
     the normal listing or a raid screen) — adapters must branch on shape, not just on
     `type=`.
   - `POST /actions/smuggling.php` — buy/sell/customs-resolution actions. Capture both
     the outgoing request body (`action=`, `item_id`, `qty` where present) and the
     response message.
   - `GET /api/stats.php` — frequent player-state polls; diff `current_city` for
     district-arrival detection, and read `cash`/`bank`/`travelling`/`travel_seconds`
     as supporting data.
   - `POST /api/travel.php` — `action=get_cities` gives the full District reference
     table (learned passively whenever Travel is opened); `action=travel` is the actual
     move, giving real ETA/duration data.

   This is more reliable than scraping live DOM because:
   - We get the data before any animation/rendering touches it.
   - We know *exactly* which panel it is from the `type` query param — no guessing.
   - It's immune to CSS class renames (game already uses fairly stable structural
     patterns like `.sgl-card`, `.sgl-c-name`, `.sgl-c-price`, `.xm-tab`, but we treat
     those as a fallback, not the primary key).
2. **Fallback: `MutationObserver` + text-label matching** on the live DOM, per the
   original PRD, for anything not delivered through `panel.php` (e.g. inline top-bar
   state, toast confirmations, anything rendered by inline `<script>` without a fetch).
3. **Adapter layer.** All parsing logic lives behind per-panel-type adapters (e.g.
   `parseSmugglingPanel(html)`, `parseCustomsPanel(html)`) so that if the game changes
   its markup, only one adapter needs updating — nothing else in the pipeline cares
   about HTML shape.
4. Content script relays parsed, structured events (not raw HTML) to the background
   worker via `chrome.runtime.sendMessage`, matching the pattern already used in the
   SimpleMMO extension (`src/shared/messaging.ts`).

**Why this matters for MV3:** intercepting `fetch` requires code running in the page's
own JS context (`MAIN` world), because the isolated content-script world has its own
`window` and can't see/override the page's `fetch`. The isolated-world content script
then acts as a relay: `page (MAIN world) → window.postMessage → content script
(isolated world) → chrome.runtime.sendMessage → background worker`.

### Open questions this raises — **NEEDS VERIFICATION from you** (much smaller list now)

Resolved by the last two captures: buy/sell action shapes + request bodies, the
buy/sell ambiguity from the previous round, the full district+item+id catalog, travel
mechanics, market timer cadence, and current-district signal. What's genuinely left,
and none of it blocks starting implementation — these can be filled in opportunistically
as you keep playing, not before we start building:

1. **`customs_run` and `customs_surrender` response shapes** — we only have
   `customs_bribe`'s response captured. Not blocking (we already know the resolution
   type from which button/action fired), just nice to have the exact message text for
   consistent outcome parsing.
2. **Is "Border Seizure Risk" (global, volume-scaling %) the same number the PRD calls
   "displayed risk", or is there a separate per-encounter % shown only during an actual
   raid?** We're proceeding with "Border Seizure Risk at time of encounter" as the
   `displayedRisk` value for CustomsEvent unless you spot a distinct number on the raid
   screen itself.
3. Whether taxi travel's response differs meaningfully from walk's beyond
   `travel_time`/cost — low priority, same shape expected.

---

## MVP Scope (from PRD, unchanged)

1. Detect current district on change → store `{ timestamp, district }`
2. Detect market prices whenever a market panel loads → store `{ timestamp, district, item, price }` (buy side), keep full history
3. Detect sell prices when viewing another district's market → store `{ timestamp, district, item, sellPrice }`
4. Track completed trades: buy event → sell event match → compute gross profit, ROI, profit %, trip duration
5. Customs tracker: cargo type/qty/value, district, bribe amount, timestamp, `caught: true/false`
6. Risk database: aggregate customs outcomes per item to compute **actual** catch rate vs. displayed risk %
7. Popup dashboard: Today's Profit, Lifetime Profit, Average ROI, Trips, Caught %, Average Bribe
8. Best Trade recommendation: given current known prices across visited districts, suggest buy/sell pair with expected profit/risk/EV

Nice-to-haves (heatmap, market timer, bribe predictor, customs calculator slider, trade
history table, analytics graphs) are explicitly deferred past MVP per the PRD.

---

## Proposed Architecture

Mirroring the conventions from `simplemmo-browser-extension` (feature-folder pattern,
`chrome.*` APIs, Vite + `vite-plugin-web-extension`), extended with a real local
database since this feature accumulates much more data than a bounty watcher does:

```
thefifthfamily-browser-extension/
├── manifest.json
├── vite.config.ts
├── tsconfig.json
├── package.json
├── public/icons/
├── src/
│   ├── background/
│   │   ├── index.ts                        # service worker entry, message router
│   │   └── features/tradeAssistant/
│   │       ├── index.ts                     # wires events → db writes
│   │       ├── tradeMatcher.ts              # buy/sell matching, profit/ROI calc
│   │       └── riskEngine.ts                # actual-catch-rate aggregation
│   ├── content/
│   │   ├── index.ts                         # entry, injects main-world hook
│   │   ├── mainWorldHook.ts                 # world:"MAIN" — patches fetch/XHR, posts raw panel.php responses
│   │   └── features/tradeAssistant/
│   │       ├── index.ts                     # isolated-world relay, MutationObserver fallback
│   │       └── adapters/
│   │           ├── smugglingPanel.ts        # parse buy/sell listings
│   │           ├── customsPanel.ts          # parse customs encounter
│   │           └── districtPanel.ts         # parse current-district signal
│   ├── popup/
│   │   ├── App.tsx
│   │   └── features/tradeAssistant/
│   │       ├── Dashboard.tsx                # today/lifetime profit, ROI, trips, caught %
│   │       └── BestTrade.tsx
│   ├── shared/
│   │   ├── types.ts                         # Trade, PriceSnapshot, Customs, District
│   │   ├── messaging.ts                     # ExtensionMessage union
│   │   ├── db.ts                            # Dexie schema + queries
│   │   └── constants.ts
├── docs/
│   ├── trade-assistant-plan.md              # this file
│   └── deployment.md                        # to be written once we're ready to ship
```

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Extension | Manifest V3 | matches SimpleMMO extension |
| Bundler | Vite + `vite-plugin-web-extension` | matches SimpleMMO extension |
| Language | TypeScript | matches SimpleMMO extension |
| UI | **Preact** | decided — matches SimpleMMO extension conventions, smaller bundle, same JSX/hooks API |
| Local DB | Dexie (IndexedDB) | new — SimpleMMO only needed `chrome.storage.local`, but this feature accumulates thousands of price snapshots/trades, which needs real querying |
| Charts | Chart.js | deferred past v1 — not needed until the dashboard/analytics phase |
| State | Plain hooks + Dexie live queries | decided against Zustand for now — v1 has no dashboard yet, so there's no UI state complex enough to need it; revisit once the dashboard is built |

---

## Data Model (from PRD)

```ts
interface Trade {
  id: string;
  item: string;
  quantity: number;
  buyDistrict: string;
  sellDistrict: string;
  buyPrice: number;
  sellPrice: number;
  buyTime: number;      // epoch ms
  sellTime: number;      // epoch ms
  profit: number;        // sellPrice*qty - buyPrice*qty
  roi: number;            // profit / cost
  caught: boolean;
  bribe: number;
}

interface PriceSnapshot {
  id: string;
  timestamp: number;
  district: string;
  item: string;
  price: number;
  type: 'buy' | 'sell';
}

interface CustomsEvent {
  id: string;
  timestamp: number;
  item: string;            // attributed from the most recent stash snapshot, not present on the raid screen itself
  quantity: number;        // ditto
  cargoValue: number;      // quantity * last-known wholesale price
  bribe: number;
  displayedRisk: number;   // = smuggling panel's global "Border Seizure Risk" at time of encounter, pending Q2 above
  district: string;
  resolution: 'bribe' | 'run' | 'surrender';
  caught: boolean;         // true unless resolution === 'bribe' (bribe = passed) — 'run' outcome TBD, see Q1 above
}

interface District {
  id: number;        // confirmed via GET/POST /api/travel.php action=get_cities — 1 Downtown, 2 Docks, 3 Underground,
                      // 4 The Strip, 5 Arms District, 6 Penthouse, 7 Waterfront, 8 The Syndicate (locked)
  name: string;
  slug: string;
  nativeItem: string;       // the one contraband item bought here
  smugglingBonus: number;    // e.g. Waterfront = 2.50 (+250%) — relevant to Best Trade later, not v1
  bossLocked: boolean;
}
```

Note: `Trade.buyPrice` should be the buy-time wholesale price read from the panel
snapshot (the buy action's own response has no price); `Trade.sellPrice`/`profit`
should come straight from the sell action's response message, which already contains
both the sale total and the profit — no independent computation needed there. Both
should be stored as **totals for the transaction**, not unit price, since quantities
vary per trade.

---

## Market Timeline (recommended enhancement, per PRD)

The smuggling panel already tells us exactly when the next price shift happens
(`data-seconds` on `#smug-price-timer`) — no cadence assumption needed. Once passive
capture is trusted, a `chrome.alarms`-driven background poll (same pattern as
SimpleMMO's bounty poller) can hit `panel.php` again right after each countdown hits
zero, snapshotting prices in every district the player has visited even without an
explicit page visit. This builds a historical dataset for rotation-pattern analysis.
Still open: whether `panel.php` needs anything beyond the ambient session cookie when
called from the background worker (no explicit auth header seen so far, but the
background worker isn't "in" a district the way the page is, so it's worth confirming
a background-fired request for a district you're not currently standing in returns the
same shape).

---

## Decisions Locked In

- **UI library:** Preact — matches the SimpleMMO extension, no benefit to React here.
- **v1 scope: capture first, dashboard later.** v1 ships the passive recording
  pipeline only — district detection, market/sell price capture, trade matching,
  customs/risk tracking, all written into Dexie. No popup dashboard, no Best Trade
  recommender, no heatmap/analytics yet. Once we've verified the captured data is
  accurate against real gameplay, the dashboard (item 7) and Best Trade (item 8)
  become their own follow-up feature built on data we already trust.
- **Background market-timeline polling: fast-follow, not v1.** v1 only records what
  you actually see by visiting panels in-game. The `chrome.alarms`-driven background
  poller (snapshotting every district every ~10 min even when not actively viewed)
  comes after passive capture is proven, once we're confident about `panel.php`'s
  auth/param requirements from real usage.

---

## Next Steps

We now have enough confirmed, real payload shapes to start building — the remaining
open questions (customs_run/surrender response shape, displayed-risk source, taxi vs
walk response parity) are minor and can be filled in opportunistically during testing
rather than blocking the start of implementation.

1. Stand up the Dexie schema + `shared/types.ts`/`shared/messaging.ts` + background
   message router + main-world fetch/XHR hook, generically intercepting `/api/*.php`
   and `/actions/*.php` (not a hardcoded URL list).
2. Write adapters against the *real* captured payloads for: `stats.php` (district
   arrival + cash/bank), `panel.php?type=smuggling` (both response shapes: listing and
   raid screen), `actions/smuggling.php` (buy + sell request/response parsing,
   including the sell-message regex), `travel.php` (`get_cities` → District table,
   `travel` → trip start/duration).
3. Wire the trade matcher: open trade on a buy action (item, qty, buyDistrict from
   current_city, buyPrice from last panel snapshot, buyTime), close it on the matching
   sell action (sellPrice + profit parsed directly from the sell message, sellTime,
   sellDistrict from current_city, trip duration from elapsed time and/or travel data).
4. Wire the customs/risk pipeline: raid-screen detection on `panel.php?type=smuggling`,
   cargo attribution from last stash snapshot, resolution capture from the
   `actions/smuggling.php` follow-up call.
5. Verify passive capture against real gameplay (a handful of real buy/sell/travel/
   customs cycles) before touching any UI — confirm Dexie records match what actually
   happened in a play session.
6. Only then: build the popup dashboard (item 7) and Best Trade (item 8) as a
   follow-up feature.
