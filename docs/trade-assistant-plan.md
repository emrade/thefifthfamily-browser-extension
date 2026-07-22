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
- A customs encounter ("Border Ambush!") is *also* delivered as one of these panel
  responses (likely returned in place of, or in addition to, the smuggling panel when
  triggered by an action). Observed fields in that payload:
  - district name (e.g. "Downtown")
  - bribe amount (e.g. `$44,000`)
  - three resolution actions, each a JS `onclick` call:
    - `Game.resolveCustoms('run')` — run for it (energy cost + jail risk, no numbers shown in this payload)
    - `Game.resolveCustoms('bribe')` — pay the bribe
    - `Game.resolveCustoms('surrender')` — lose the cargo
  - Note: this sample did **not** include cargo type/quantity/displayed catch % —
    those may be in a separate payload (e.g. the action that *triggered* the customs
    check) rather than the customs panel itself. Needs verification.

### Detection Strategy (CONFIRMED approach, changes the PRD's original assumption)

The original PRD assumed we'd need pure DOM text-matching + `MutationObserver` because
"the game UI may change." Now that we've seen a real payload, there's a better primary
signal available: **the panel API responses themselves are structured enough to key
off of** (`type` param, `title` field, and predictable HTML inside `html`). Plan:

1. **Primary: network interception.** Hook `fetch`/`XMLHttpRequest` in the page's main
   world (MV3 content script with `"world": "MAIN"`, or `chrome.scripting.executeScript`
   with `world: "MAIN"`) to observe every `panel.php` request/response as it happens.
   Parse `response.type` + `response.title` to know what we're looking at, then parse
   `response.html` (as a detached `DOMParser` document, not the live page DOM) for the
   actual data. This is more reliable than scraping live DOM because:
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

To finish this section we need a few more captured payloads (Network tab → right-click
→ Copy Response, same as the customs one you already grabbed):

1. **Market/buy panel** — the actual panel that lists contraband with buy prices (your
   example: "Counterfeit Passports, Buy: 3000"). What's its `type=` value? Is it a tab
   inside `smuggling`, or a separate panel entirely?
2. **Sell panel** — when viewing another district to check/sell prices, is that the
   same panel type with a `district=` param, or a different `type=` altogether?
3. **A completed buy action** — the response when you actually click "Buy" on an item
   (need quantity, item, price, resulting cash change).
4. **A completed sell action** — same, for sell.
5. **Current district / player location** — where does the game tell us "you are
   currently in Downtown"? Top bar panel? A `type=` value? Or is it embedded in every
   panel response as a shared field?
6. **Full customs payload** — one where cargo type, quantity, cargo value, and
   "displayed risk %" are visible (the sample only had bribe amount + district).
7. **Full district list** — confirm the 7 named in the PRD (Downtown, The Docks, The
   Strip, Arms District, Underground, Penthouse, Waterfront) are the actual in-game
   names, and get the full contraband/item catalog if possible.
8. **Auth** — confirm `panel.php` requests just ride the browser's existing session
   cookie (no extra auth header/token we need to replicate) — likely yes since it's
   same-origin, but worth confirming nothing like a CSRF token appears in the request.

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
  item: string;
  quantity: number;
  cargoValue: number;
  bribe: number;
  displayedRisk: number;
  district: string;
  caught: boolean;
}

interface District {
  id: string;
  name: string;
}
```

---

## Market Timeline (recommended enhancement, per PRD)

Every 10 minutes (matching the server's market refresh cadence — **needs
verification**: is 10 minutes confirmed, or an assumption?), snapshot every known
price in every district the player has visited, even without an explicit page visit,
using a `chrome.alarms`-driven background poll (same pattern as SimpleMMO's bounty
poller) hitting `panel.php` directly with `credentials: 'include'`. This builds a
historical dataset for rotation-pattern analysis. Depends on confirming panel.php
doesn't require anything beyond the session cookie, and on knowing the correct
`type=`/params for each district's market.

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

1. **You:** capture the remaining payloads listed under "Open questions" above —
   buy panel (market/buy listing), sell panel (viewing another district), a completed
   buy action response, a completed sell action response, the current-district signal,
   and a fuller customs payload (with cargo type/qty/displayed risk visible). Network
   tab → right-click the request → Copy Response, same as you did for the customs one.
2. Once those are in hand, write adapters against the *real* payloads (not
   assumptions) for: district detection, market panel (buy+sell), customs panel,
   trade completion.
3. Stand up the Dexie schema + background message router + main-world fetch/XHR hook.
4. Verify passive capture against real gameplay before touching any UI.
5. Only then: build the popup dashboard (item 7) and Best Trade (item 8) as a
   follow-up feature.
