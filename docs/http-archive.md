# HTTP Archive

A local, compressed recording of every request the game makes, plus an index of what
each endpoint normally emits and when that changes.

Added in 0.10.0. Moved to its own top-level view in 0.10.1, which also replaced the
change-detection model — see [The shape index](#the-shape-index) for why.

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

**Every same-origin `fetch` and XHR to `thefifthfamily.com`**, minus a short exclusion
list — not just the five endpoints the adapters parse. That is deliberate: an endpoint no
adapter knows about yet is exactly the thing worth having a record of once it turns out
to matter.

### Capture policy

Measured traffic is ~21,726 requests/day. Most of it is client-side polling that carries
no game rule, so `policy.ts` thins it (see that file for the measurement it is sized
against):

| Endpoint | /day | Payload | Policy |
|---|---|---|---|
| `stats.php` | 9,502 | Full player state | **Throttled to 1/min** → 1,440/day |
| `chat.php` | 6,078 | `{messages:[], online:120}` | Excluded |
| `get_announcements.php` | 2,775 | `{announcements:[]}` — always empty | Excluded |
| `feed.php` | 1,069 | Other players' activity | Excluded |
| `milestones_check.php` | 596 | `{has_unclaimed:false, count:0}` | Excluded |

Net effect: **21,726 → ~3,150 rows/day**, so a 30-day window is ~94,000 rows.

Two things this deliberately does not do. It never edits a body — throttling thins the
sampling *rate*, and whatever is kept is kept whole. And it never affects the feature
adapters: excluded endpoints are still captured by the network hook and still reach the
parsers, so nothing here can break Trade Assistant or Fight Club.

Excluding an endpoint also removes rows already archived for it, on the next sweep —
otherwise a policy change would take a full retention window to take effect.

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
clear controls on the archive's own page.

---

## Retention

**30 days by default**, adjustable to 7, 14, or 90 on the archive page. A background alarm sweeps
hourly, so the archive trims steadily rather than in one large burst after a long gap.

Two things qualify that number:

- **A 100 MB budget** (`REQUEST_LOG_MAX_BYTES`) runs behind the age limit, evicting
  oldest-first. Bytes are the resource that actually runs out. This replaced a
  120,000-row cap that was calibrated against an assumed 1,500 requests/day — measured
  traffic is **21,726/day**, fourteen times that, so the row cap evicted after 5.5 days
  and made the retention setting meaningless. The archive page shows usage against the
  budget, so drift is visible rather than inferred.
- **The shape index is never swept.** It is a few KB, and it is most valuable exactly
  when it outlives the bodies that produced it. Knowing an endpoint changed two months
  ago costs nothing and is the whole question the index exists to answer.

### Storage cost

Bodies are gzipped via `CompressionStream` before storage. Panel responses are HTML
fragments that re-send the same inlined `<style>` block every time, which is close to the
ideal case for DEFLATE.

The archive page shows the **actual** measured ratio for your data ("% saved") rather than an
estimate — trust that number over any figure written here, since it depends on what the
game actually sends.

---

## Using it

### Home → HTTP Archive

A top-level feature view, not a settings pane — it sits on the popup's Home list
alongside Trade Assistant and Fight Club. The page opens on live counts, on-disk size,
the covered date range, and — only when there is something to say — an alert naming any
endpoint that dropped a previously universal field. It then splits into three sections:

| Section | Holds |
|---|---|
| **Capture** | The on/off switch and the retention window |
| **Export** | The endpoint picker and the three download buttons |
| **Maintenance** | Rebuild the shape index, recount size, and the archive's own clear control |

### The three exports

| Export | Contents | Size | Use when |
|---|---|---|---|
| **Shape Digest** | Each endpoint's token vocabulary and structural events | KB | Something broke, or you want to know what the game changed |
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
key paths with leaf *types*. Those tokens are folded into a per-endpoint **vocabulary**:
one row per endpoint recording every token it has ever produced, and how often.

> **This replaced an earlier design, and the reason is worth keeping.** The first version
> stored one row per distinct token *set* and treated "more than one set" as evidence the
> game had changed. Measured against real traffic that was wrong in the most basic way. A
> single endpoint routinely returns several unrelated structures —
> `panel.php?type=smuggling` returns a market listing *or* a customs raid screen,
> `travel.php` returns a city list, a travel confirmation, or an error — and any optional
> element forks the set every time it toggles. A Street Intel cooldown timer blinked five
> classes in and out between consecutive polls, producing six "shapes" that simply
> alternated. The result: every endpoint reported as changed within an hour of first use,
> with nothing actually wrong. **Multiplicity is not change.** A variant recurs; a change
> happens once and persists.

A vocabulary cannot be fooled that way. A blinking timer contributes its classes once and
is thereafter part of what the endpoint is known to emit.

### What gets reported

| Kind | Meaning | Weight |
|---|---|---|
| `removed-universal` | A token that appeared in **every** prior response stopped appearing | **Actionable** — this is what silently breaks an adapter |
| `new-tokens` | A token never seen before showed up | Informational — often a new field, sometimes a rare variant's first appearance |

Three rules keep this quiet:

- **Warmup.** Nothing is reported until an endpoint has been seen at least
  `SHAPE_WARMUP_OBSERVATIONS` times *and* for `SHAPE_WARMUP_MS`. An endpoint's normal
  repertoire is wider than it looks and has to be learned, not announced.
- **Universality.** A token must have been present in *every* prior response, across at
  least `SHAPE_UNIVERSAL_MIN_OBSERVATIONS` (400) of them, before its absence counts.
  Both halves matter. "Present in all N so far" is weak evidence when N is small: a
  token appearing with probability p looks universal with probability p^N, so a
  91%-present decoration clears a 25-observation bar about 1 time in 10. That is not
  hypothetical — it produced a false alarm on Street Intel within hours of shipping,
  naming `.si-card-modifier`, which was back to 91% presence by the next export.
- **Targeting.** A removal is only reported if it touches a small slice of the vocabulary
  (`SHAPE_REMOVAL_MAX_FRACTION`). When a raid screen replaces a listing, every listing
  token legitimately vanishes at once; a real field being dropped moves a handful. After
  the first occurrence those tokens are no longer universal, so this can only ever
  misjudge a variant's debut.

### Reading the digest

```json
{
  "endpoint": "GET /api/panel.php?type=smuggling",
  "observations": 4812,
  "alwaysPresent": [".sgl-c-name", ".sgl-c-price", ".sgl-section"],
  "sometimesPresent": [{ "token": ".sgl-raid-screen", "seenPct": 3 }],
  "events": [
    { "at": "2026-08-09T11:40:12Z", "kind": "removed-universal", "tokens": [".sgl-c-origin"] }
  ]
}
```

`alwaysPresent` is the set an adapter can safely key off. `sometimesPresent` is
state-dependent and will be missing on perfectly normal responses — reading one of those
without a null check is a latent bug. The event above says `.sgl-c-origin` stopped
appearing on 9 August, so `smugglingPanelAdapter.ts`, which reads it to decide `isLocal`,
is now broken.

An endpoint with an empty `events` array has been structurally stable.

### Rebuilding

**Maintenance → Rebuild Shape Index from Archive** replays every stored response through
the current classifier. Two uses: getting an index that matches the current rules after
the model changes, and skipping warmup — an index built from live traffic alone stays
deliberately silent for hours on each endpoint, even when the archive already holds weeks
of evidence.

It is manual rather than automatic because every body must be decompressed and
re-tokenized: cheap for a few thousand rows, not for a full 30-day archive. The rebuild
shares its classifier with the live write path, so a replayed index is byte-identical to
one built as traffic arrived.

Safe to run at any time, and idempotent. It only ever writes `endpointProfiles`; the
archive itself is read-only to it, and trades, prices, and customs records are untouched.
The one imperfection: a response recorded *while* a rebuild is running can be missed,
since the rebuild picks its rows up front and rewrites the table at the end. That costs a
single observation's worth of counting accuracy on one endpoint, and the next rebuild
recovers it — the response is still in the archive either way.

> **Possible refinement.** The button is a repair tool sitting among everyday actions, and
> in normal operation it is never needed — live traffic keeps the index current. It could
> be shown only when it would actually help, by comparing total observations across
> profiles against the `requestLog` row count and surfacing it when the index lags well
> behind the archive (the state after a migration, a classifier change, or drift):
>
> *Shape index covers 40 of 1,847 stored responses. Rebuild to catch it up.*
>
> Not worth doing while the current detector is unproven on live traffic — hiding the
> recovery path behind an untested condition is the wrong order. Revisit once it has run
> for a while. `rebuildProfiles()` should stay regardless of what the UI does with it: it
> is the migration path for any future change to how shapes are classified, and the test
> that it matches the live path is what proves the two share a classifier.

## Working with an AI agent

1. Export the **shape digest** — always cheap, and it frames everything else.
2. Look at `events`. A `removed-universal` entry names the exact tokens that stopped
   appearing, which usually identifies the break on its own. An empty `events` array
   means the endpoint has been structurally stable.
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
own confirmation under Maintenance on the archive page. Keeping the two in separate
places in the UI is part of the point — they are not variations of one action.

The archive's *preferences* (capture on/off, retention) do reset with Clear All Data,
consistent with every other preference. Capture stays on; retention returns to 30 days.

---

## Tuning

All in `src/shared/constants.ts`:

| Constant | Default | Effect |
|---|---|---|
| `REQUEST_LOG_RETENTION_DAYS` | 30 | Default age cutoff (per-install override on the archive page) |
| `REQUEST_LOG_MAX_ROWS` | 120,000 | Hard row cap; raise for a true 90-day window |
| `REQUEST_LOG_MAX_BODY_BYTES` | 512 KB | Bodies above this are stored truncated |
| `REQUEST_LOG_SWEEP_INTERVAL_MINUTES` | 60 | How often retention runs |
| `SHAPE_WARMUP_OBSERVATIONS` / `SHAPE_WARMUP_MS` | 25 / 6h | How well sampled an endpoint must be before anything is reported |
| `SHAPE_UNIVERSAL_MIN_OBSERVATIONS` | 400 | Observations required before "always present" is trusted |
| `SHAPE_REMOVAL_MAX_FRACTION` | 0.3 | Above this share of the vocabulary, a disappearance reads as a variant switch |

To disable capture entirely, untick **Record Game Traffic** under Capture on the archive
page. Existing rows are kept — toggling off is a pause, not a wipe.
