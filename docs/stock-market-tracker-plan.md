# Stock Market Tracker

Status: **implemented** (data collection only — no trading).

Passively records this account's Stock Market prices and rumor outcomes forever,
so that a real trading strategy can eventually be evaluated against enough data —
the game itself only retains a fraction of what's needed for that.

---

## What the archive showed

Checked against a real archive export (1,449 `stocks_v2.php` `poll` calls and 37
`chart` calls, covering 8 stocks over their full history since this account's
Stock Market unlocked):

- **8 stocks**, each with a live price, a current **rumor** (a directional hint —
  `Up`/`Down`/`Positive`/`Negative`/`Flat`/`Mixed` — plus a severity/quality flavor
  tag), and a **whispers** list of past rumors. A rumor stays active for roughly
  100–300 hours before resolving and rolling into whispers, which is the only place
  the game reveals whether it actually panned out (`truth_flag: "True"/"False"`).
- **Trading is simple**: 0% buy fee, 4% sell fee, no shorting, no visible position
  limit or cooldown. A round-trip trade needs the price to move **≥4.17%** in your
  favor just to break even.
- **Direction is reliable**: 53 of 54 resolved rumors in this account's full history
  were `True`. Restricted to genuinely directional rumors (`Up`/`Down`/`Positive`/
  `Negative` — excluding `Flat`/`Mixed`, which are non-committal), 12 of 13 moved in
  the stated direction once matched against real price data.
- **But magnitude usually isn't enough to profit.** Of those same 13 directional,
  price-matched rumors, only **2 (15%)** moved far enough to clear the 4.17% fee
  floor — both the same stock (`KITO`, Biotech), which also had the largest
  average rumor-driven moves of any stock observed. Average move on a correct
  `Up`/`Positive` call was only ~2.7%. **A "trade every directional rumor" strategy
  would likely lose money to fees on net**, despite ~92-98% directional accuracy —
  this is the whole reason to keep collecting rather than build a trading feature
  now: the sample (54 resolved rumors total, 24 with measurable price data) is far
  too small to know which stocks/severities reliably clear the fee threshold.
- **The game's own retention is short.** `action=chart&timeframe=all` returns
  empty — apparently broken, or simply not supported — and `timeframe=30d` returns
  exactly 720 hourly points (30 days), nothing older. Whatever isn't captured now
  is gone for good once it ages out.
- **The rumor and price-history units line up.** A rumor's `generated_hour`/
  `expires_hour` and a price point's position in the `chart`/`poll` arrays are both
  expressed in the same integer "hours since launch" counter. The live panel's own
  inline script exposes the anchor directly: `V2.launchTs = 1783119600000` (ms),
  confirmed to advance exactly 1:1 with real time by cross-checking a poll's
  reported `hour` against `floor((request_time_ms - launchTs) / 3600000)` — they
  matched exactly. This is what lets a price point be joined to "the price when a
  rumor fired" and "the price when it resolved" by a plain integer lookup, with no
  timestamp-nearest-match needed.

---

## What data we're collecting, and why

Two permanent tables (no retention sweep — unlike the raw HTTP archive, which
ages out after 30 days and would otherwise be the only record of this):

**`stockPrices`** — one row per stock per hour (`symbol`, `hour`, `price`,
derived `timestamp`), keyed on `"${symbol}:${hour}"` so re-polling an hour
already stored is a plain overwrite, never a duplicate. Backfilled once via
`chart&timeframe=30d` for every stock the first time a poll succeeds (so the
account doesn't start from zero and lose whatever's about to age out of the
game's own 30-day window), then extended forever by the ongoing poller.

**`stockRumors`** — one row per rumor (keyed on the game's own `rumor_code`),
covering its full lifecycle: first seen as the live, unresolved `rumor`
(`truthFlag: null`), then updated once it appears in `whispers` with a real
`truthFlag` and a `resolvedAt` timestamp that's never touched again. Direction,
severity, quality, and the game's own flavor text are kept as-is — no
interpretation happens at collection time, since we don't yet know which of
those fields (if any) predict magnitude.

Collection is why, not analysis: the point of this table is that four weeks or
four months from now, there'll be enough resolved rumors — with real,
measured price moves already joined against them — to actually answer "does
this stock/severity/quality combination clear the fee threshold reliably
enough to trade on," instead of guessing from 54 samples.

---

## How this can be used in the future

Once enough rumors have resolved with real price data behind them:

1. **Segment by stock and by severity/quality** to find which specific
   combinations reliably produce moves ≥4.17% — the KITO/Biotech pattern seen
   in this first pass is suggestive, not yet confirmed, at n=4.
2. **A "Stock Market Advisor" overlay**, in the same spirit as the Real Estate
   Advisor — surfacing which of the 8 stocks currently has an active rumor
   whose stock/severity combination has *historically* cleared the fee
   threshold often enough to be worth acting on, with the accumulated hit
   rate shown alongside it (not just the rumor's raw direction).
3. **Only after that** — and only if the data actually supports it — a
   semi- or fully-automated trading feature, matching this extension's existing
   bar for automation (Career Auto, Street Intel Auto): verified against a real
   archive first, implemented against confirmed shapes, never against a guess.

No dedicated analysis UI ships with this yet — the data already reaches the
existing "Download All Data" export (`exportAllData.ts`), which is how this
analysis was done and how it'll be repeated later once more history has
accumulated. There is a small in-page status overlay (below) confirming the
collector is actually running, but it's a health check, not an analysis view.

---

## What shipped

- `src/shared/types.ts` — `StockPricePoint`, `StockRumorRecord`.
- `src/shared/constants.ts` — `STOCK_MARKET_LAUNCH_TS`, `STOCK_MARKET_POLL_INTERVAL_MS`
  (30 min — price only ticks hourly; this is just a safety margin against one
  missed alarm, not an attempt to catch a faster-moving number), and the new
  alarm name.
- `src/shared/db.ts` — Dexie v6, adding `stockPrices` and `stockRumors`.
- `src/shared/exportAllData.ts` — both new tables added to the existing export.
- `src/background/features/stockMarket/poller.ts` — the poller itself: calls
  `action=poll` on `POST /actions/stocks_v2.php` via the shared `postAction()`
  helper (same CSRF/rate-limit handling every other automation in this
  extension uses), persists prices and rumors, and runs the one-time 30-day
  backfill (tracked via `storage.getStockMarketBackfillDone()`) the first time
  it succeeds.
- `src/background/features/stockMarket/index.ts` — arms/disarms the alarm to
  match the player's own "Stock Market Tracker" Settings toggle
  (`PAGE_FEATURE_DEFINITIONS`'s `stockMarketStatus`), both on every
  service-worker wake and live, the instant that toggle changes (a
  `chrome.storage.onChanged` watcher, same shape as Career Auto's
  `watchConfigChanges`). Unlike Career Auto / Street Intel Auto there's no
  separate "paused" state on a failure — a failed poll just retries on the
  next scheduled cycle forever, since (unlike those two) this never spends
  anything and a resumed CSRF token needs no explicit re-enable to pick back
  up. The toggle existing at all is specifically so disabling it on one
  browser (e.g. a Chrome install used only for testing, primary play on
  Firefox) provably stops the outgoing requests, not just the on-page display
  of them.
- `src/background/index.ts` — wired into the shared alarm dispatcher, plus
  two message handlers: `stock-tracker-status-requested` (`getStatus()` in
  `poller.ts`, answering "is this actually working" with the last poll time/
  error, backfill state, and live Dexie counts) and
  `stock-tracker-poll-requested` (runs `pollNow()` immediately and returns the
  refreshed status — backs the overlay's "Sync Now" button, since the
  displayed status otherwise only ever reflects the last *scheduled* attempt
  and can lag a real fix, like a freshly-observed CSRF token, by up to the
  full 30-minute cycle).
- `src/content/features/stockMarket/index.ts` — a small status overlay on the
  live Stock Market page (`#lsv2-data` marker), same collapsed-badge-that-
  expands shape as the Pet Courier panel. Shows a colored dot (green/amber/red
  for synced/stale/errored), last-sync time, backfill state, running totals
  (price points, stocks tracked, rumors resolved with a true/false split), and
  a "Sync Now" button — the only way to confirm the background collector is
  doing anything at all, since it previously had no UI whatsoever. Like every
  other page-feature toggle, disabling "Stock Market Tracker" only hides this
  overlay on the *next* reload (the content script reads the toggle once at
  load); the background collection side of the same toggle, above, stops
  immediately without needing one.
