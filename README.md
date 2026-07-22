# The Fifth Family Enhancements

A Manifest V3 browser extension for [The Fifth Family](https://www.thefifthfamily.com). Its first feature, **Trade Assistant**, passively watches your smuggling runs and automatically records buy/sell prices, trades, travel, and customs encounters — no more manually tracking prices or bribes in a spreadsheet.

More features will land alongside it over time (see `docs/`) — the popup is built around that from the start: a light Home view with your vitals and a nav list of installed features, not a single feature's dashboard bolted to the front page.

## Features

- **Passive capture** — hooks the game's own network traffic (`fetch`/`XHR`) to observe every panel view and action as it happens, no polling and no DOM scraping of rendered markup
- **Trade tracking** — matches buy → sell pairs into complete trades, netting out taxi fares and bribes paid along the way so profit/ROI reflect what a trip actually cost
- **Customs risk tracking** — records every bribe/run/surrender outcome against the district's displayed risk at the time, building toward an *actual* catch-rate model
- **Travel arrival notifications** — OS notification the moment a trip completes, confirmed against the server rather than a blind timer
- **Live player stats** — cash, bank, energy/stamina/nerve/vitality, and current location at a glance in the popup

See `docs/trade-assistant-plan.md` for the full feature plan, confirmed API shapes, and data model.

## Loading the Extension Locally

### Chrome / Edge / Brave

1. Build the extension:
   ```bash
   npm install
   npm run build
   ```
2. Open `chrome://extensions` (or `edge://extensions` / `brave://extensions`)
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `dist/` folder inside this project
6. The extension appears in your toolbar. Pin it for easy access.

> **Tip:** After any code change, run `npm run build` again, then click the ↺ refresh button on the extension card in `chrome://extensions`.

### Development (watch mode)

```bash
npm run dev
```

Rebuilds automatically on file changes. You still need to manually reload the extension in `chrome://extensions` after each build (Chrome does not hot-reload extensions).

---

## Project Structure

```
src/
├── background/
│   ├── index.ts                        # Service worker entry, message router
│   └── features/tradeAssistant/
│       ├── index.ts                    # Applies parsed events to Dexie/storage
│       ├── tradeMatcher.ts             # Buy/sell matching, profit/ROI/travel-cost calc
│       ├── riskEngine.ts               # Customs raid + resolution → CustomsEvent
│       └── travelNotifier.ts           # chrome.alarms scheduling + arrival confirmation
├── content/
│   ├── index.ts                        # Isolated-world entry — relays captured requests
│   ├── mainWorldHook.ts                # world:"MAIN" — patches fetch/XHR, forwards raw bytes
│   └── features/tradeAssistant/
│       ├── index.ts                    # Dispatches a captured request to the right adapter
│       └── adapters/                   # One parser per confirmed payload shape
├── popup/
│   ├── index.html / main.tsx / App.tsx # Preact popup shell (Home ⇄ feature views)
│   ├── views/
│   │   ├── Home.tsx                    # Default view — live stats + feature nav
│   │   └── LiveStats.tsx               # Player vitals, sourced from the latest stats.php poll
│   └── features/tradeAssistant/
│       └── TradeAssistantHome.tsx      # Feature entry point (dashboard is a later phase)
├── shared/
│   ├── types.ts, messaging.ts, db.ts (Dexie), storage.ts, constants.ts
└── design/
    └── tokens.css                      # CSS custom property design system
```

## Design System

The popup's visual language is deliberately built from the game's own — it already commits to Playfair Display for headers, Inter for body text, Courier New for money figures, and a fixed semantic palette (green = profit, gold = money/emphasis, red = danger, blue = travel/info, purple = rare). The extension reuses those exact hexes so a glance between the game and the popup reads as one language, on a warmer "ledger paper" neutral background that's the extension's own. See `src/design/tokens.css`.

## How It Works

The game is a single-page app (`index.php` never navigates) that loads every panel and action through a handful of JSON API endpoints. A content script running in the page's own JS context (`"world": "MAIN"`) patches `fetch`/`XMLHttpRequest` to observe those calls as they happen, and forwards the raw request/response bytes — nothing parsed yet — to an isolated-world content script via `postMessage`. That script runs the parsing (one adapter per endpoint/payload shape) and sends structured events to the background service worker, which is the only place that touches Dexie (IndexedDB) or `chrome.storage`.

This two-context split exists because MV3's isolated content-script world can't see the page's own `fetch` calls — only code actually running in the page's context can.

## Tech Stack

| | |
|---|---|
| Build | Vite + vite-plugin-web-extension |
| Language | TypeScript (strict) |
| Popup UI | Preact |
| Local database | Dexie (IndexedDB) |
| Manifest | V3 |
| Compatibility | Chrome 109+ (uses `content_scripts[].world`, requires Chrome 111+) |

## Commands

| Command | Description |
|---|---|
| `npm run build` | Production build → `dist/` |
| `npm run dev` | Watch mode (rebuilds on change) |
| `npm run type-check` | TypeScript check without building |
| `npm run icons` | Regenerate extension icons |
