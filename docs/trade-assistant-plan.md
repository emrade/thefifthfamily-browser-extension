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
- **The "Border Ambush!" customs screen is very likely returned as part of a
  buy/sell/offload action's own response** (i.e. `POST .../smuggling.php` returns the
  raid-screen `html` instead of a normal success message, when the server's RNG decides
  you get caught) — rather than being its own independently-fetched panel. **Needs
  confirmation**: capture the exact request/response pair for the moment "Border
  Ambush!" first appears (not just the `resolveCustoms` follow-up), so we can confirm
  which action triggers it and whether cargo type/qty/value are present in that
  specific response even though they weren't in the raid-screen HTML you already
  captured.
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

### Detection Strategy (CONFIRMED approach, changes the PRD's original assumption)

The original PRD assumed we'd need pure DOM text-matching + `MutationObserver` because
"the game UI may change." Now that we've seen a real payload, there's a better primary
signal available: **the panel API responses themselves are structured enough to key
off of** (`type` param, `title` field, and predictable HTML inside `html`). Plan:

1. **Primary: network interception.** Hook `fetch`/`XMLHttpRequest` in the page's main
   world (MV3 content script with `"world": "MAIN"`, or `chrome.scripting.executeScript`
   with `world: "MAIN"`) to observe three URL patterns as they happen:
   - `GET /api/panel.php?type=X` — view snapshots. Parse `response.type` + `response.title`
     to know what we're looking at, then parse `response.html` (as a detached
     `DOMParser` document, not the live page DOM) for the actual data.
   - `POST /actions/*.php` — state transitions (buy, sell, customs resolution, etc).
     Capture both the outgoing request body (which `action=` fired, against which item
     id) and the response (result message, or an embedded raid-screen `html` if customs
     triggered).
   - `GET /api/stats.php` — frequent player-state polls; diff `current_city` for
     district-change detection, and read `cash`/`bank`/`travelling` as supporting data.

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

### Open questions this raises — **NEEDS VERIFICATION from you**

Resolved by the latest capture: buy/sell panel shape, full district+item catalog,
market timer cadence, current-district signal, and the actions-endpoint pattern.
Still outstanding (Network tab → right-click the request → Copy Request/Response —
we now need **request bodies too**, not just responses):

1. **The `action=` name and request body for buying**, from clicking "Purchase"
   (`Game.buyContraband(id)`) on a card. Need: the exact `action=` value, the param
   name carrying the item id, whether a quantity param exists or a click always buys
   a fixed amount (your sample shows Passports STASH jumping straight from `—` to `22`
   — full capacity — in one visible step, which suggests one click may fill your
   entire hold rather than buying incrementally).
2. **The `action=` name and request body for selling/offloading**
   (`Game.sellContraband(id)`), and its **response** — does it return structured
   fields (item, quantity, sale price, resulting cash), or just a message like the
   buy confirmation did?
3. **Clear up an ambiguity in the last capture:** the message
   `"Secured 22 Counterfeit Passports! Now move out securely."` reads like a *buy*
   confirmation (Passports, not Artwork), but it was preceded by the Stolen Artwork
   stash (22 units) disappearing and Daily Profit jumping by ~$102k — which only
   makes sense if a *sell* of the Artwork also happened. Was there a separate sell
   request that wasn't captured, or does one action do both (auto-sell your current
   hold, then buy the new item) in a single POST? Please capture buy and sell as two
   **separate, isolated** clicks so we can see each request/response in isolation.
4. **The request/response pair for the moment "Border Ambush!" first appears** —
   not the `resolveCustoms` follow-up, but whichever buy/sell/offload action's
   response actually contains the raid-screen `html`. We still don't have cargo
   type/quantity/cargo-value for a customs event, only district + bribe amount.
5. **Is "Border Seizure Risk" (the global, volume-scaling % on the smuggling panel)
   the same thing as the PRD's per-item "displayed risk", or is there a separate
   per-encounter risk % shown only during an actual customs raid?**
6. **`current_city` id mapping** — optional, since we can learn it dynamically by
   pairing `stats.php`'s `current_city` with the district name shown in the
   `smuggling` panel at the same moment, but if you happen to note the id while
   visiting each district that saves us a step.

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
  item: string;            // still unconfirmed whether this is present on the raid screen itself
  quantity: number;        // ditto
  cargoValue: number;      // ditto
  bribe: number;
  displayedRisk: number;   // ditto — may just be the smuggling panel's global "Border Seizure Risk"
  district: string;
  resolution: 'bribe' | 'run' | 'surrender';
  caught: boolean;         // for 'bribe'/'surrender' caught is trivially known; 'run' outcome needs its own confirmation payload
}

interface District {
  id: string;       // maps to stats.php's numeric current_city, learned dynamically
  name: string;
}
```

Note: `Trade.buyPrice`/`sellPrice` should be captured as **totals for the transaction**
(not just unit price) if buying/selling fills to full stash capacity per click, per the
open question above about how quantity actually works.

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

1. **You:** capture the remaining items listed under "Open questions" above — this
   time include **request bodies**, not just responses (Network tab → click the
   request → Payload/Request tab). Specifically: an isolated buy click, an isolated
   sell click (don't do both back-to-back so we can tell them apart), and — if you
   can catch it — the request/response where "Border Ambush!" first appears rather
   than the resolution click.
2. Once those are in hand, write adapters against the *real* payloads (not
   assumptions) for: district detection (via `stats.php`'s `current_city`), smuggling
   panel (buy+sell listings), buy/sell actions, customs detection + resolution.
3. Stand up the Dexie schema + background message router + main-world fetch/XHR hook
   (covering `panel.php`, `actions/*.php`, and `stats.php`).
4. Verify passive capture against real gameplay before touching any UI.
5. Only then: build the popup dashboard (item 7) and Best Trade (item 8) as a
   follow-up feature.
