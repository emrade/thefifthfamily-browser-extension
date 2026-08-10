# HTTP Archive

A local, compressed recording of every request the game makes, plus an index of when
its endpoints change shape.

Added in 0.10.0.

---

## Why it exists

Nearly every mechanic in this game is delivered over a handful of API endpoints. Every
formula in [game-mechanics.md](./game-mechanics.md) — the `5 + 45 × fullness` risk fit,
the flat 0.25 bribe rate, the 1.17 → 1.32 sell multiplier step — was recovered by
reading captured responses. That work was only possible because the data happened to
have been captured before anyone knew which question it would answer.

Two problems followed from doing that ad hoc:

**Deriving a new mechanic meant waiting.** The parsed tables hold what the adapters
already knew to extract. A question they weren't written for — "does the raid screen
carry a field we're ignoring?" — could not be answered from stored data at all, only by
adding a parser and then waiting days for fresh samples to accumulate.

**Game-side changes were silent.** The adapters key off CSS classes: `sgl-c-price`,
`sgl-raid-screen`, `sgl-monitor`. If the game renames one, `parseSmugglingPanel` returns
`null`, the console logs a parse failure, and the extension quietly stops recording
trades. Nothing announces *what* changed, and diffing months of stored bodies by hand to
find out is not a realistic way to spend an afternoon.

The archive addresses the first. The shape index addresses the second.

---

## What is captured

**Every same-origin `fetch` and XHR to `thefifthfamily.com`** — not just the five
endpoints the adapters parse. That is deliberate: an endpoint no adapter knows about yet
is exactly the thing worth having a record of once it turns out to matter.

Both sources are covered:

| Source | Mechanism | Volume |
|---|---|---|
| The game's own page code | `mainWorldHook.ts` patches `fetch`/`XHR` in the MAIN world | ~1,000/day |
| The extension's background pollers | `loggedFetch()` wraps their `fetch` calls | ~430/day |

The background half matters more than its share suggests: those requests are the only
ones that exist while the game tab is closed, and the page hook structurally cannot see
them.

### What is not captured

- **Full-page navigations and static assets.** MV3 provides no access to those response
  bodies — `webRequest` cannot read them and there is no other hook. This is a platform
  ceiling, not a design decision.
- **Cross-origin requests.** Dropped in `resolveCapture()`. The archive is built to be
  exported, and third-party traffic has no business in a file you hand to someone else.
- **Headers and cookies.** The hook never sees them, so your session cookie is
  structurally absent from the archive.

### Redaction

Request bodies and URLs pass through `redact.ts` before storage. Values whose *key*
matches `csrf`, `token`, `auth`, `session`, `password`, `secret`, `api_key`, `signature`,
or `nonce` are replaced with `[redacted]`.

Matching is by key name, not value shape. Guessing "this looks like a token" from entropy
both misses short tokens and mangles ordinary game data — district slugs and item names
look plenty random to a heuristic.

---

## Where the data lives

IndexedDB, under the extension's own origin, inside your browser profile. On macOS
Firefox that is:

```
~/Library/Application Support/Firefox/Profiles/<profile>/storage/default/
  moz-extension+++<uuid>/idb/
```

It never leaves the machine. There is no server. Note that `chrome.storage.sync` *would*
replicate across a Firefox Account — this extension uses `chrome.storage.local` and
IndexedDB, and **neither syncs**.

The `unlimitedStorage` permission keeps the browser from evicting it under disk pressure.
It does not protect against uninstalling the extension, refreshing the profile, or the
clear buttons in Settings.

---

## Retention

**30 days by default**, adjustable to 7, 14, or 90 in Settings. A background alarm sweeps
hourly, so the archive trims steadily rather than in one large burst after a long gap.

Two things qualify that number:

- **A 120,000-row cap** (`REQUEST_LOG_MAX_ROWS`) runs behind the age limit as a safety
  valve, because age alone assumes traffic stays near its measured rate — a retry loop or
  a much heavier session could blow the disk budget well inside 30 days. At ~1,500
  requests/day the cap fills in roughly 80 days, so **selecting 90 days will in practice
  yield about 80**. At 30 days (~45,000 rows) it never binds.
- **The shape index is never swept.** It is a few KB, and it is most valuable exactly
  when it outlives the bodies that produced it. Knowing an endpoint changed two months
  ago costs nothing and is the whole question the index exists to answer.

### Storage cost

Bodies are gzipped via `CompressionStream` before storage. Panel responses are HTML
fragments that re-send the same inlined `<style>` block every time, which is close to the
ideal case for DEFLATE.

Settings shows the **actual** measured ratio for your data ("% saved") rather than an
estimate — trust that number over any figure written here, since it depends on what the
game actually sends.

---

## Using it

### Settings → HTTP Archive

Live counts, on-disk size, the covered date range, and an amber alert listing any
endpoint whose response structure has changed.

### The three exports

| Export | Contents | Size | Use when |
|---|---|---|---|
| **Shape Digest** | Every endpoint's structural change history | KB | Something broke, or you want to know what the game changed |
| **Download Selection** | Chosen endpoints × chosen window | MB | Working on a specific feature |
| **Full Archive** | Everything stored | Large | Bulk analysis, or archiving before a wipe |

**Reach for the selection export by default.** A monthly full archive is the wrong
artifact to hand an AI agent — it is mostly repeated boilerplate, and no agent will
usefully read 40,000 near-identical HTML blobs. Checking one endpoint and picking "Last 3
days" typically yields something small enough to paste directly.

The picker lists each endpoint with its live row count, busiest first. Selection queries
run off the `[endpoint+timestamp]` index using `.primaryKeys()`, so choosing what to
export never deserializes a row body.

### Format

Archive exports are gzipped **NDJSON** — one JSON object per line. Line 1 is a header
recording the filter that produced the file; every subsequent line is one request.

NDJSON rather than a single JSON array for two reasons that both matter at this size: it
can be produced incrementally, so an export never holds the whole decompressed archive in
memory, and it can be *consumed* incrementally.

```bash
# What is in this file?
zcat fifth-family-selection-*.ndjson.gz | head -1 | jq

# First response body
zcat fifth-family-selection-*.ndjson.gz | sed -n 2p | jq -r .responseBody

# Filter after the fact
zcat fifth-family-archive-*.ndjson.gz | grep 'type=smuggling' > smuggling.ndjson
```

---

## The shape index

For every response, `fingerprint.ts` extracts a set of **structural** tokens — CSS class
names, element ids, form field names, `data-*` attribute names, tag names, and for JSON,
key paths with leaf *types* — and hashes them. A row is written to `endpointShapes` only
when that hash is new for the endpoint.

The effect is that data churn is invisible and structure changes are loud:

| Event | Registers as a change? |
|---|---|
| Prices shift on the 10-minute boundary | No |
| A different number of market cards | No |
| A new CSS class appears on a card | **Yes** |
| A JSON field changes `number` → `string` | **Yes** |
| An endpoint stops returning a class an adapter reads | **Yes** |

Panel responses are unwrapped before fingerprinting — every `panel.php` reply is
`{ok, title, html}`, so fingerprinting the envelope alone would report the same three
keys for every panel in the game and detect nothing.

40 structurally identical responses produce **one** row, not 40. That is what keeps the
digest small enough to be worth exporting separately.

### Reading a change

The digest diffs consecutive shapes per endpoint:

```json
{
  "endpoint": "GET /api/panel.php?type=smuggling",
  "distinctShapes": 2,
  "changes": [
    { "at": "2026-07-22T09:14:03Z", "shapeHash": "3f2a...", "added": [], "removed": [] },
    { "at": "2026-08-09T11:40:12Z", "shapeHash": "9c81...",
      "added": [".sgl-c-tariff"], "removed": [".sgl-c-origin"] }
  ]
}
```

That reads directly as: on 9 August the game added a tariff element and dropped the
origin element — so `smugglingPanelAdapter.ts`, which reads `.sgl-c-origin` to decide
`isLocal`, is now broken, and there is a new field worth parsing.

A shape change also logs a `console.warn` the moment it happens, so the signal does not
wait for anyone to open the popup.

---

## Working with an AI agent

1. Export the **shape digest** — always cheap, and it frames everything else.
2. If an endpoint shows `distinctShapes > 1`, the `added`/`removed` arrays usually
   identify the break on their own.
3. For deeper work, export a **selection**: the one endpoint, last few days.
4. Hand over both files plus the relevant adapter under
   `src/content/features/*/adapters/`.

The digest carries a `note` field describing its own format, so an agent receiving it
cold does not need this document to interpret it.

---

## Architecture

```
MAIN world              Isolated world           Background worker
──────────              ──────────────           ─────────────────
mainWorldHook.ts        content/index.ts         background/index.ts
  patches fetch/XHR  →    postMessage bridge  →    request-log branch
  caps body size          gates feature            │
  drops cross-origin      dispatch on `tracked`    ↓
                                                 queue.ts (serialized)
background pollers                                 ↓
  loggedFetch() ─────────────────────────────→   record.ts
                                                   redact → fingerprint
                                                   → gzip → Dexie
```

Three constraints shaped this:

**Writes must happen in the background worker.** A content script's IndexedDB belongs to
the *page's* origin, not the extension's — a write issued there would land in the game's
database, invisible to the popup. This is the same reason every existing feature routes
parsed events through `chrome.runtime.sendMessage`.

**Archive writes need their own queue.** They must be serialized among themselves,
because the shape index does a read-then-write on `[endpoint+shapeHash]` and two
concurrent responses carrying a new shape would both read "absent" and both insert it —
the same race the feature queue already prevents for trades. But they must *not* share
the feature queue: one arrives for every request the game makes, each costing a gzip plus
two IndexedDB round-trips, and chaining them ahead of feature work would add that latency
to every price snapshot and trade. The archive is observational and can afford to lag.

**Fingerprinting is regex-based, not DOM-based.** It runs in the background worker, and
MV3 service workers do not reliably have `DOMParser` — the same constraint that already
forced `marketPoller.ts` to carry a regex twin of the content script's DOM parser.

### Size accounting

Totals are maintained incrementally in `stats.ts` rather than computed on demand.
IndexedDB has no column projection, so summing a size column over a six-figure table
would mean inflating every gzipped body just to read the integer beside it — making
"open the popup" an expensive operation. `recomputeStats()` is the escape hatch if the
counters ever drift.

---

## Relationship to "Clear All Data"

The archive is **not** touched by Settings → Clear All Data. Two different lifecycles:
that button clears the player's game history (trades, prices, customs events), while the
archive is a developer-facing recording with its own retention, exports, and clear
control. Wiping months of capture as a side effect of resetting a trade ledger would be
the wrong behaviour.

`clearAllData()` handles the former; `clearRequestLog()` handles the latter, behind its
own confirmation in the HTTP Archive section.

The archive's *preferences* (capture on/off, retention) do reset with Clear All Data,
consistent with every other preference. Capture stays on; retention returns to 30 days.

---

## Tuning

All in `src/shared/constants.ts`:

| Constant | Default | Effect |
|---|---|---|
| `REQUEST_LOG_RETENTION_DAYS` | 30 | Default age cutoff (per-install override in Settings) |
| `REQUEST_LOG_MAX_ROWS` | 120,000 | Hard row cap; raise for a true 90-day window |
| `REQUEST_LOG_MAX_BODY_BYTES` | 512 KB | Bodies above this are stored truncated |
| `REQUEST_LOG_SWEEP_INTERVAL_MINUTES` | 60 | How often retention runs |

To disable capture entirely, untick **Record Game Traffic** in Settings. Existing rows
are kept — toggling off is a pause, not a wipe.
