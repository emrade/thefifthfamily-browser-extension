# Smuggling route ribbon — scoping notes

Status: **not ready to implement — one confirmation short.** The game added a UI
element that looks like it makes courier-watch's destination probe obsolete, but
only ~6 minutes of post-rollout traffic exists so far, all showing the same single
open district. This doc exists so the idea doesn't have to be re-derived from
scratch once a fuller capture is available — see "What's still needed" before
building anything from it.

Source: `fifth-family-archive-2026-09-18T10-10-47-087Z.ndjson.gz` (covers
2026-09-15T13:18 through 2026-09-18T10:10 UTC, 15,395 rows). See
`docs/http-archive.md` for how to pull a fresh export, and
`docs/smuggling-v2-plan.md` for the pet-courier system this sits inside.

---

## The trigger

The player noticed a new "WHERE YOU CAN SEND" strip at the top of the in-game
Smuggling page listing every district with an at-a-glance status (open, locked,
"you are here"), and asked whether it makes market-open detection easier.

## What the archive confirms

**Brand new, same-day.** Every `panel.php?type=smuggling` response in this archive
before **2026-09-18T10:04:23 UTC** lacks the markup below; every one after it (13/13
captured before the export) has it. The archive's earliest row is
2026-09-15T13:18 UTC, so this is at least 3 days of prior traffic with zero
occurrences, then a clean switch-over — a real rollout, not a fluke of one capture.

**Markup shape** — a `sv2-rib` block, one `sv2-rib-chip` per district, no shipment
draft required (this is the key difference from today's detection — see below):

```html
<div class="sv2-rib">
  <div class="sv2-rib-head">
    <span>Where You Can Send</span>
    <span class="sv2-rib-rot">Routes rotate in 55m</span>
  </div>
  <div class="sv2-rib-strip">
    <div class="sv2-rib-chip" style="--ribC:#9ca3af;" title="Downtown — market fair">
      <div class="sv2-rib-name">Downtown</div>
      <div class="sv2-rib-meta">No route now</div>
    </div>
    <div class="sv2-rib-chip is-lane" style="--ribC:#34d399;" title="The Strip — market good" onclick="...">
      <div class="sv2-rib-name">The Strip</div>
      <div class="sv2-rib-meta">&rarr; 13 min</div>
    </div>
    <div class="sv2-rib-chip is-here" style="--ribC:#22d3ee;" title="Arms District — market hot">
      <div class="sv2-rib-name">Arms District</div>
      <div class="sv2-rib-meta">You are here</div>
    </div>
    <div class="sv2-rib-chip is-lock" style="--ribC:#9ca3af;" title="The Underground — market fair">
      <div class="sv2-rib-name">The Underground</div>
      <div class="sv2-rib-meta"><i class="fa-solid fa-lock"></i> Lv 101</div>
    </div>
    <!-- one chip per district, 10 total -->
  </div>
</div>
```

Per-chip signal, by class modifier + `sv2-rib-meta` text:

| State | Class | Meta text |
|---|---|---|
| Open route | `is-lane` | `→ {baseMinutes} min` |
| Current district | `is-here` | `You are here` |
| Below level requirement | `is-lock` | `Lv {n}` (with a lock icon) |
| Not currently open | *(none)* | `No route now` |

**Trap: `→ {n} min` is a static travel duration, not a countdown.** Watched the
same chip (The Strip) across a 5-minute span of real captures: its meta text held
at a constant "→ 13 min" the entire time, while the ribbon header's own
`"Routes rotate in Xm"` ticked down live over the same span (55m → 52m → 51m →
50m). The minutes on the chip are the same figure as the draft-based panel's
"Base" travel time to that district (confirmed via the same cross-check below,
13 min in both) — "how long a courier takes to get there if sent now," not "time
left on this open window." The header's rotate-countdown is the one that tracks
when the current open/locked state expires.

**Trap: `--ribC` / the `title` attribute is market price tier, not route
availability.** Each chip also carries a color and a `title="{District} — market
{fair|good|hot}"`. That's the black-market pricing state for that district,
completely independent of whether a route is open. Confirmed from the player's own
screenshot: Industrial District carries the same green ring as The Strip (both
"market good") but its meta text still reads "No route now" — only `is-lane` (or
the meta text pattern) means a route is actually open. Don't key detection off the
color or the title.

**Cross-checked against the existing ground truth, once.** One captured row
(`timestamp 1789726175109`) has both the ribbon *and* an active shipment draft —
the only way today's code can see destination state at all (`parseDestinations` in
`src/background/features/smuggling/smugglingPanelRegexParser.ts`, gated on a draft
existing). They agree exactly:

| | Ribbon (`sv2-rib`, no draft) | Draft-based `sv2-dest` (today's method) |
|---|---|---|
| The Strip | `is-lane`, "→ 13 min" | open cell, Base 13 min, "Load cargo first" |
| The Penthouse | `is-lock`, "Lv 141" | locked cell, "Level 141 required" |

## Why it would matter

Today, `probeDestination()` in `src/background/features/smuggling/courierWatch.ts`
(lines 359–386) has to **draft a shipment with an idle pet, poll the panel, then
cancel the draft** purely to observe which destination is open — because
`parseDestinations` only returns anything once a draft exists (see that parser's
own doc comment). That has real cost:

- Needs an idle, draftable pet just to check — `evaluateDestination` skips the
  probe entirely with `'skipped-no-idle-pets'` when none is available.
- Real side effects: creates and cancels a shipment every probe. There's already
  cleanup code in `probeDestination` for a stuck `'drafting'` state left over from
  exactly this (see its doc comment, confirmed real 2026-09-05).
- A whole extra request round-trip (draft → panel fetch, retried up to twice → cancel)
  per hourly check or per pet return, versus reading a field that's already on
  every routine panel GET.

If the ribbon holds up, `evaluateDestination`/`probeDestination` could shrink to:
read the panel (which the hourly alarm and return-alarm already do via
`fetchPanel()`), scan the ribbon for an `is-lane` chip, done — no draft, no idle
pet requirement, no cancel-cleanup path needed at all. `pickDestination`
(`petCourier.ts:107`) would stay as-is for actually choosing which pet to send once
dispatch happens.

## What's still needed before implementing

Only 13 samples, all within one ~6-minute window, all showing **the same single**
`is-lane` chip (The Strip). That's not enough to trust as the sole detection
source:

1. **A "nothing open" state.** Never observed a panel with zero `is-lane` chips —
   worth confirming the ribbon actually goes fully dark rather than, say, always
   keeping the nearest district lit as a fallback.
2. **A rotation boundary.** `COURIER_DEST_POLL_BUFFER_MS`'s own comment
   (`src/shared/constants.ts`) says "two open destinations rotate on a confirmed
   60-minute cycle." This sample never crossed a `:00` boundary, so it doesn't show
   the ribbon transitioning, and doesn't confirm whether "two open destinations"
   means two simultaneous `is-lane` chips (never seen more than one here) or
   something else (e.g. this hour's + next hour's).
3. **Whether `is-lane`'s minutes are always base minutes, not courier-adjusted.**
   The one cross-check matched base minutes (13 min, not the "with courier" 31 min
   figure) — worth confirming on a district with a different pet-speed modifier
   before hard-coding that assumption.
4. **A longer shape-index baseline.** This is new markup with essentially no
   track record; per the reverse-engineering checklist in the project's
   `CLAUDE.md`, a few more days of it showing up consistently (and the archive's
   shape index confirming no silent variant) is cheap insurance before retiring
   the working draft-based method.

**Next step, not yet done:** pull a fresh selection export (`type=smuggling`,
last 3–7 days) once enough time has passed to span at least one full hour with the
ribbon present, and check items 1–3 above against it.

## Migration note

Kill switch defaults stay as-is — this only changes *how* `evaluateDestination`
learns the open/locked state, not any automation's on/off behavior, so no new
toggle is needed for the detection swap itself. If the swap removes the
draft/cancel round-trip, that also removes the only reason `probeDestination`
currently needs `cancelShipment`'s stuck-draft cleanup on this path — worth
re-checking whether that cleanup is still needed elsewhere (batch-start cleanup in
`executeCourierBatch` is separate and would stay) before deleting anything.
