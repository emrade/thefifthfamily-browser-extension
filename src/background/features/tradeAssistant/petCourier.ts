import { db } from '@/shared/db';
import { GAME_ORIGIN } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { storage } from '@/shared/storage';
import { getRoster, upsertRoster } from '@/shared/petRoster';
import { getCsrfToken } from '../../csrfToken';
import { parseSmugglingV2PanelRegex } from './smugglingV2RegexParser';
import type { BlackMarketItem, CourierProgressEvent, CourierRunSummary, DestinationOption, FleetEntry, SmugglingV2Snapshot } from '@/shared/types';

/**
 * Broadcasts one step of the run as it happens, so a UI surface watching (the
 * popup, the in-page floating panel) can show progress live instead of going
 * quiet until the whole batch finishes and the final `CourierRunSummary`
 * resolves. Best-effort and fire-and-forget on purpose — nobody may be
 * listening (popup closed, panel not on screen), and that's fine, since nothing
 * here is relied on for correctness; the final summary is still the record of
 * what actually happened.
 */
function emitProgress(event: CourierProgressEvent): void {
  chrome.runtime.sendMessage({ type: 'courier-run-progress', event }).catch(() => {});
}

/** Below this, further sales wouldn't pay out anyway — not worth spending on cargo
 *  that would just sit there past the daily cap. */
const DAILY_CAP_STOP_THRESHOLD = 1000;

/**
 * Thrown for a failure that isn't specific to one pet or one action — the batch
 * can't tell "this one thing failed, try the next" from "nothing from here on will
 * work either" without this. `kind` picks the remedy shown to the player:
 * - `auth`: no cached CSRF token, or a non-JSON response (the game returns clean
 *   `{ok:true/false,...}` for anything it actually processed — a stale/rejected
 *   token or expired session is the likely cause of anything else). Fix: reload
 *   the game tab, view Smuggling once, run again.
 * - `shape`: a response parsed as JSON but doesn't look like a real one (`ok`
 *   missing/non-boolean), or the panel parsed but a section that should never be
 *   empty was (the black-market grid — every district has always had 3 items).
 *   Fix: none available yet — this specifically means the game changed something
 *   this feature doesn't understand, so it needs to stop rather than guess.
 */
class SystemicActionError extends Error {
  constructor(
    message: string,
    public readonly kind: 'auth' | 'shape',
  ) {
    super(message);
  }
}

/**
 * Deliberately matches the *live client's* actual URL, not a hardcoded guess —
 * confirmed 2026-08-19 that the game dropped `smug_tab=proto` from normal use
 * entirely; the bare URL now returns the full dashboard directly (see
 * docs/smuggling-v2-plan.md). Explicitly requesting `smug_tab=proto` still might
 * "work" in the sense of returning 200, but nothing confirms it behaves
 * identically to what the real client gets now that the game stopped sending it —
 * matching the client exactly removes that as a variable.
 */
async function fetchPanel(): Promise<SmugglingV2Snapshot | null> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?type=smuggling&_t=${Date.now()}`, {
    credentials: 'include',
  });
  return parseSmugglingV2PanelRegex(await res.text());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Minimal stand-alone parse of `stats.php` for the two numbers this needs — not
 *  the full `RawStatsPayload` (that adapter lives under content/, where DOMParser
 *  availability isn't a constraint the way it is here, but this needs neither DOM
 *  nor any of its other two dozen fields). */
async function fetchCashAndDistrict(): Promise<{ cash: number; bank: number; districtName: string | null } | null> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/stats.php`, { credentials: 'include' });
  let json: any;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  if (!json?.ok || !json.stats) return null;

  const cityId = Number(json.stats.current_city) || 0;
  const district = await db.districts.get(cityId);

  return { cash: Number(json.stats.cash) || 0, bank: Number(json.stats.bank) || 0, districtName: district?.name ?? null };
}

/** Baseline gap enforced before every action call — this batch fires draft, buy,
 *  load (repeatedly), and depart back-to-back for every pet with no pause at all,
 *  which is exactly the shape of traffic a "Slow down!" rejection (confirmed real,
 *  seen on a `v2_draft` call) suggests the server is rate-limiting. No confirmed
 *  threshold exists to pace against, so this is a heuristic gap, not a tuned one —
 *  worth revisiting if "Slow down!" still shows up with it in place. */
const ACTION_PACING_MS = 600;

/** Backoff schedule for a rejection that's confirmed rate-limiting, not an
 *  ordinary business rejection — waiting and retrying the *same* call makes sense
 *  here in a way it wouldn't for e.g. "insufficient funds", since nothing about
 *  the request itself was wrong. Gives up after these three attempts and lets the
 *  caller treat it as an ordinary rejection (push an error, move on) rather than
 *  retrying forever against a limit that might not be lifting soon. */
const RATE_LIMIT_RETRY_DELAYS_MS = [2000, 4000, 8000];

async function postAction(path: string, params: Record<string, string | number>): Promise<any> {
  const csrf = await getCsrfToken();
  if (!csrf) throw new SystemicActionError('no CSRF token observed yet — open the game tab and view any panel first, then run again', 'auth');

  const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), _csrf: csrf });

  for (let attempt = 0; ; attempt++) {
    await sleep(ACTION_PACING_MS);
    const res = await loggedFetch(`${GAME_ORIGIN}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      // A request the game actually processed always comes back as clean JSON,
      // `{ok:true|false, ...}` — this is the CSRF token being rejected (or the
      // session having expired) far more often than it's anything specific to this
      // one action, so it's treated as systemic rather than retried per pet.
      throw new SystemicActionError(`non-JSON response from ${path} (status ${res.status}) — likely a stale session or CSRF token`, 'auth');
    }

    // `ok` missing or non-boolean means this isn't the response shape every real
    // action response has confirmed so far — a genuine business rejection is always
    // an explicit `ok:false`, never an absent field. Distinguishing this from that
    // is the whole point: an actual game-shape change should stop the run with one
    // clear message, not get retried once per remaining pet as if each were its own
    // unrelated failure.
    if (typeof json?.ok !== 'boolean') {
      throw new SystemicActionError(`unexpected response shape from ${path} — the game may have changed this action's format`, 'shape');
    }

    // A normal-shaped `{ok:false,"error":"..."}` rejection is otherwise
    // indistinguishable from an ordinary business rejection (insufficient funds,
    // wrong district, etc.) — no real CSRF rejection has ever actually been
    // captured to confirm its exact wording, so this is a heuristic, not a
    // certainty. But letting a stale-token rejection through unrecognised means the
    // run just repeats the identical failure once per remaining pet, which is
    // exactly the problem the shape/auth split above exists to avoid — so a
    // plausible-looking one gets treated the same way rather than not at all.
    if (json.ok === false && typeof json.error === 'string' && /csrf|token|session|unauthori[sz]ed|forbidden|not logged in/i.test(json.error)) {
      throw new SystemicActionError(`"${json.error}" from ${path} — looks like a stale session or CSRF token, not an ordinary rejection`, 'auth');
    }

    // Confirmed real ("Slow down!" on a v2_draft call) — retried in place with a
    // growing pause rather than surfaced as this pet's own failure, since the
    // rejection has nothing to do with this particular draft/buy/load/depart call.
    if (json.ok === false && typeof json.error === 'string' && /slow down/i.test(json.error) && attempt < RATE_LIMIT_RETRY_DELAYS_MS.length) {
      await sleep(RATE_LIMIT_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    return json;
  }
}

/**
 * Best-effort cleanup for a shipment that got drafted (and possibly loaded) but
 * can't be completed — the game only allows one shipment "being loaded" at a time,
 * so leaving this one open blocks every pet still queued behind it in this run,
 * and every pet in the *next* run too (see the startup cleanup in
 * `executeCourierBatch`). Only swallows an *ordinary* rejection (logs it, since
 * the account may still be stuck and that's worth knowing) — a
 * `SystemicActionError` here is just as real a signal as one from any other call,
 * so it's left to propagate to the caller's own catch rather than being absorbed
 * into a generic message it wouldn't recognise as "stop everything."
 */
async function cancelShipment(shipmentId: number, petName: string, summary: CourierRunSummary): Promise<void> {
  const resp = await postAction('/actions/smuggling.php', { action: 'v2_cancel', shipment_id: shipmentId });
  // Module-level function, called with `summary` passed explicitly — `pushError`
  // is a closure local to `executeCourierBatch` and isn't reachable from here, so
  // this pushes directly (and skips the live-progress broadcast for this one,
  // rare, cleanup-only case rather than threading emitProgress through as well).
  if (!resp?.ok) summary.errors.push(`could not cancel ${petName}'s stuck shipment — it may still be blocking new drafts`);
}

function pickItem(blackMarket: BlackMarketItem[]): BlackMarketItem | null {
  const buyable = blackMarket.filter((i) => i.buyableHere);
  if (buyable.length === 0) return null;
  return buyable.reduce((best, item) => (item.price > best.price ? item : best));
}

/** Prefers whichever open destination isn't level-locked; if both are open, the
 *  shorter `with courier` time — gets the pet back into service sooner. Sale rate
 *  is a flat ×1.20 everywhere (see docs/smuggling-v2-plan.md), so there's no profit
 *  difference between the two to weigh against travel time. */
function pickDestination(destinations: DestinationOption[]): DestinationOption | null {
  const open = destinations.filter((d) => !d.locked);
  if (open.length === 0) return null;
  return open.reduce((best, d) => (d.courierMinutes < best.courierMinutes ? d : best));
}

/**
 * Offloads every fleet entry that's arrived — shared between the full batch run
 * and the standalone offload-only action (see `runOffloadBatch`), since collecting
 * arrived shipments is identical work either way. Returns a stop reason if a
 * systemic error hit partway through; ordinary per-shipment rejections are pushed
 * as errors and don't stop the loop, since one pet's cargo failing to sell doesn't
 * mean the next one's will too.
 */
async function offloadReady(
  fleet: FleetEntry[],
  pushOffloaded: (entry: CourierRunSummary['offloaded'][number]) => void,
  pushError: (message: string) => void,
): Promise<CourierRunSummary['stoppedReason']> {
  for (const entry of fleet.filter((f) => f.status === 'ready-to-offload')) {
    try {
      const resp = await postAction('/actions/smuggling.php', { action: 'v2_offload', shipment_id: entry.shipmentId, qty: '' });
      if (resp?.ok) {
        pushOffloaded({ petName: entry.petName, profit: Number(resp.net_profit) || 0 });
      } else {
        pushError(`offload failed for ${entry.petName}: ${resp?.error ?? 'unknown error'}`);
      }
    } catch (err) {
      if (err instanceof SystemicActionError) {
        pushError(err.message);
        return err.kind === 'auth' ? 'session-error' : 'shape-changed';
      }
      pushError(`offload failed for ${entry.petName}: ${String(err)}`);
    }
  }
  return null;
}

/**
 * Sweeps whatever cash is currently on hand into the bank — cash sitting on hand
 * is what gets taken in a mugging, so this runs at the end of *every* batch
 * (full run or offload-only), not just when a run itself earned or spent
 * anything. Best-effort: a failure here doesn't change `stoppedReason` or fail
 * the batch, since by this point the batch's own substantive work is already
 * done (or already gave up) — this is just protecting whatever's left standing.
 *
 * The request shape mirrors the confirmed `withdraw` action 1:1
 * (`action=withdraw&amount=...` — see docs/smuggling-v2-plan.md) on the
 * assumption `bank.php` supports the mirror `action=deposit` the same way. This
 * specific call has never actually been captured, so unlike everything else in
 * this file, it's an inference from symmetry, not a confirmed shape — worth
 * double-checking against a real response the first time it runs.
 */
async function depositLeftoverCash(summary: CourierRunSummary): Promise<void> {
  const funds = await fetchCashAndDistrict();
  if (!funds || funds.cash <= 0) return;

  try {
    const resp = await postAction('/actions/bank.php', { action: 'deposit', amount: funds.cash.toLocaleString('en-US') });
    if (resp?.ok) {
      summary.cashDeposited = funds.cash;
      emitProgress({ kind: 'deposited', amount: funds.cash });
    } else {
      const message = `deposit failed: ${resp?.error ?? 'unknown error'}`;
      summary.errors.push(message);
      emitProgress({ kind: 'error', message });
    }
  } catch (err) {
    const message = err instanceof SystemicActionError ? err.message : `deposit failed: ${String(err)}`;
    summary.errors.push(message);
    emitProgress({ kind: 'error', message });
  }
}

/** Persists the summary regardless of which path produced it, so a reopened popup
 *  can show "last run" even if the run happened (or crashed) while it was closed. */
export async function runCourierBatch(): Promise<CourierRunSummary> {
  emitProgress({ kind: 'started' });
  const summary = await executeCourierBatch();
  // Skipped when the session/CSRF itself is already known broken — the deposit
  // call would just fail the exact same way and add a redundant error line.
  if (summary.stoppedReason !== 'session-error') await depositLeftoverCash(summary);
  await storage.setLastCourierRun(summary).catch((err) => console.error(LOG_PREFIX, 'setLastCourierRun failed', err));
  emitProgress({ kind: 'finished' });
  return summary;
}

/** The lighter counterpart to `runCourierBatch` — just collects whatever's
 *  arrived and banks the proceeds, without touching the buy/load/depart cycle.
 *  Shares `executeCourierBatch`'s summary shape (mostly empty here) so both
 *  surfaces can render either kind of run through the same display code. */
export async function runOffloadBatch(): Promise<CourierRunSummary> {
  emitProgress({ kind: 'started' });
  const summary = await executeOffloadBatch();
  if (summary.stoppedReason !== 'session-error') await depositLeftoverCash(summary);
  await storage.setLastCourierRun(summary).catch((err) => console.error(LOG_PREFIX, 'setLastCourierRun failed', err));
  emitProgress({ kind: 'finished' });
  return summary;
}

async function executeOffloadBatch(): Promise<CourierRunSummary> {
  const summary: CourierRunSummary = {
    timestamp: Date.now(),
    offloaded: [],
    sent: [],
    skipped: [],
    cashWithdrawn: 0,
    cashDeposited: 0,
    stoppedReason: null,
    errors: [],
  };

  const pushError = (message: string) => {
    summary.errors.push(message);
    emitProgress({ kind: 'error', message });
  };
  const pushOffloaded = (entry: CourierRunSummary['offloaded'][number]) => {
    summary.offloaded.push(entry);
    emitProgress({ kind: 'offloaded', ...entry });
  };

  try {
    const snapshot = await fetchPanel();
    if (!snapshot) {
      pushError('could not read the smuggling panel');
      return summary;
    }

    const stopReason = await offloadReady(snapshot.fleet, pushOffloaded, pushError);
    if (stopReason) summary.stoppedReason = stopReason;
    return summary;
  } catch (err) {
    if (err instanceof SystemicActionError) {
      pushError(err.message);
      summary.stoppedReason = err.kind === 'auth' ? 'session-error' : 'shape-changed';
      return summary;
    }
    console.error(LOG_PREFIX, 'offload batch failed', err);
    pushError(String(err));
    return summary;
  }
}

async function executeCourierBatch(): Promise<CourierRunSummary> {
  const summary: CourierRunSummary = {
    timestamp: Date.now(),
    offloaded: [],
    sent: [],
    skipped: [],
    cashWithdrawn: 0,
    cashDeposited: 0,
    stoppedReason: null,
    errors: [],
  };

  // Each of these both mutates the authoritative `summary` (what actually gets
  // persisted/returned) and broadcasts the same fact live — one call site per
  // event instead of a separate `emitProgress` sprinkled next to every `.push`,
  // so the two can't drift apart by a call site someone forgets to pair up.
  const pushError = (message: string) => {
    summary.errors.push(message);
    emitProgress({ kind: 'error', message });
  };
  const pushOffloaded = (entry: CourierRunSummary['offloaded'][number]) => {
    summary.offloaded.push(entry);
    emitProgress({ kind: 'offloaded', ...entry });
  };
  const pushSent = (entry: CourierRunSummary['sent'][number]) => {
    summary.sent.push(entry);
    emitProgress({ kind: 'sent', ...entry });
  };
  const pushSkipped = (entry: CourierRunSummary['skipped'][number]) => {
    summary.skipped.push(entry);
    emitProgress({ kind: 'skipped', ...entry });
  };

  try {
    let snapshot = await fetchPanel();
    if (!snapshot) {
      pushError('could not read the smuggling panel');
      return summary;
    }

    // Every district has always had 3 buyable items — the envelope unwrapping and
    // the grid parsing are separate steps, so an empty grid on an otherwise-parsed
    // panel means the `.sv2-card`/`data-sv2-here` markup changed shape, not that
    // there's genuinely nothing to buy. Caught here, before anything is spent,
    // rather than surfacing later as "nothing buyable" (which reads as routine).
    if (snapshot.blackMarket.length === 0) {
      pushError('the black-market grid parsed empty — the panel markup may have changed shape');
      summary.stoppedReason = 'shape-changed';
      return summary;
    }

    // "Hidden Cargo" is the account-wide stash cap — buying without knowing it
    // means buying blind into a limit that's routinely smaller than a single
    // pet's own capacity (George's 30 vs. a 21-slot stash, confirmed on this
    // account). Same treatment as the black-market check above: this monitor is
    // always present on a real capture, so a missing one means the markup
    // changed, not that the account genuinely has no cargo stat.
    if (!snapshot.hiddenCargo) {
      pushError('the Hidden Cargo monitor parsed empty — the panel markup may have changed shape');
      summary.stoppedReason = 'shape-changed';
      return summary;
    }

    // Opportunistic — see docs/smuggling-v2-plan.md's "Pet roster discovery" note.
    // Most runs won't have anything to learn here (the roster only shows once
    // shipments exist), which is exactly why the persisted mapping below matters.
    if (snapshot.roster.length > 0) await upsertRoster(snapshot.roster);

    // A shipment left in `drafting` state means an earlier run (or this account,
    // manually) got partway through loading a pet and never departed or cancelled
    // it — and since the game only allows one shipment "being loaded" at a time,
    // it silently blocks every draft attempt below with the exact same rejection,
    // no matter which pet is tried. Cleared before anything else runs rather than
    // discovered pet-by-pet the way it was the first time this happened.
    const stuck = snapshot.fleet.find((f) => f.status === 'drafting');
    if (stuck) {
      await cancelShipment(stuck.shipmentId, stuck.petName, summary);
      const fresh = await fetchPanel();
      if (fresh) snapshot = fresh;
    }

    // Free up pets and realize the previous run's profit before spending anything
    // new — also means the daily-cap check right after reflects today's true
    // remaining headroom.
    const offloadStop = await offloadReady(snapshot.fleet, pushOffloaded, pushError);
    if (offloadStop) {
      summary.stoppedReason = offloadStop;
      return summary;
    }

    if (summary.offloaded.length > 0) {
      const fresh = await fetchPanel();
      if (fresh) snapshot = fresh;
    }

    if (snapshot.dailyProfitCapRemaining !== null && snapshot.dailyProfitCapRemaining < DAILY_CAP_STOP_THRESHOLD) {
      summary.stoppedReason = 'daily-cap-reached';
      return summary;
    }

    const roster = await getRoster();
    const activeNames = new Set(snapshot.fleet.map((f) => f.petName));
    const idlePets = roster.filter((p) => !activeNames.has(p.name));

    if (idlePets.length === 0) {
      summary.stoppedReason = 'no-idle-pets';
      return summary;
    }

    const item = pickItem(snapshot.blackMarket);
    if (!item) {
      pushError('nothing buyable in the current district');
      return summary;
    }

    const funds = await fetchCashAndDistrict();
    if (!funds) {
      pushError('could not read cash/bank balance');
      return summary;
    }

    // Keep the highest-capacity pets first when funds fall short — they carry the
    // most profit per trip, so they're the last thing worth cutting.
    const ordered = [...idlePets].sort((a, b) => b.capacity - a.capacity);
    const totalAvailable = funds.cash + funds.bank;
    const included: typeof ordered = [];
    let runningCost = 0;
    for (const pet of ordered) {
      const cost = pet.capacity * item.price;
      if (runningCost + cost > totalAvailable) {
        pushSkipped({ petName: pet.name, reason: 'insufficient funds' });
        continue;
      }
      runningCost += cost;
      included.push(pet);
    }

    if (included.length === 0) {
      summary.stoppedReason = 'insufficient-funds';
      return summary;
    }

    if (runningCost > funds.cash) {
      const shortfall = runningCost - funds.cash;
      try {
        // Comma-formatted, matching the exact request shape confirmed in the
        // archive (`amount=1,000,000`) — not confirmed that a plain digit string
        // is also accepted, so this doesn't guess.
        const resp = await postAction('/actions/bank.php', { action: 'withdraw', amount: shortfall.toLocaleString('en-US') });
        if (!resp?.ok) {
          pushError(`withdrawal failed: ${resp?.error ?? 'unknown error'}`);
          summary.stoppedReason = 'insufficient-funds';
          return summary;
        }
        summary.cashWithdrawn = shortfall;
      } catch (err) {
        if (err instanceof SystemicActionError) {
          pushError(err.message);
          summary.stoppedReason = err.kind === 'auth' ? 'session-error' : 'shape-changed';
          return summary;
        }
        pushError(`withdrawal failed: ${String(err)}`);
        summary.stoppedReason = 'insufficient-funds';
        return summary;
      }
    }

    // Learned once, from the first pet's draft — the destination pair is
    // account-wide, not per-shipment, and won't rotate mid-batch (see the doc's
    // confirmed 60-minute rotation).
    let destination: DestinationOption | null = null;

    // `snapshot` may have been reassigned since the hiddenCargo check above (the
    // stuck-draft cleanup and offload passes both refetch it) — re-validated here
    // against whichever fetch is actually current, rather than trusting the
    // earlier check still describes this snapshot.
    if (!snapshot.hiddenCargo) {
      pushError('the Hidden Cargo monitor parsed empty on the latest fetch — the panel markup may have changed shape');
      summary.stoppedReason = 'shape-changed';
      return summary;
    }
    // Tracked locally rather than re-fetched before every buy — a `buy` fills
    // this and a `v2_load` frees it right back up, both confirmed from real
    // captures, so the running total stays accurate without paying a network
    // round trip per chunk. Shared across every pet in this batch, not reset per
    // pet, because the stash itself is account-wide, not per-pet.
    let stashUsed = snapshot.hiddenCargo.current;
    const stashMax = snapshot.hiddenCargo.max;

    // Whatever's already sitting in the stash from before this run started — a
    // previous failed attempt (a buy that succeeded but a later step didn't,
    // confirmed to happen: it's exactly how the stash ended up full enough to
    // block every pet in the run right before this fix) or just leftover from
    // manual play. Drained into whichever pet processes first, ahead of any new
    // buying, rather than left to sit there blocking the whole stash indefinitely.
    // A shipment carrying a mix of items is normal — confirmed from a real
    // `v2_offload` response with two different `lines[]` entries.
    const leftoverStash = new Map(snapshot.blackMarket.filter((i) => i.stash > 0).map((i) => [i.itemId, { name: i.name, qty: i.stash }]));

    for (const pet of included) {
      // Tracked outside the try block so the `catch` below can clean up a draft
      // that got this far before something later failed — the game only allows
      // one shipment "being loaded" at a time (confirmed the hard way: leaving one
      // stranded here blocked every pet queued after it with "You already have a
      // delivery being loaded."). `shipmentId` stays null until `v2_draft`
      // actually succeeds, so there's nothing to cancel if it never got that far.
      let shipmentId: number | null = null;
      emitProgress({ kind: 'drafting', petName: pet.name });
      try {
        const draft = await postAction('/actions/smuggling.php', { action: 'v2_draft', user_pet_id: pet.userPetId });
        if (!draft?.ok) {
          pushError(`draft failed for ${pet.name}: ${draft?.error ?? 'unknown error'}`);
          continue;
        }
        shipmentId = Number(draft.shipment_id);

        let qty = 0;
        const loadedItems = new Map<string, number>(); // item name -> qty, merges if the same item shows up from both draining and buying

        // Drain existing stash first — a straight transfer (stash → manifest, no
        // purchase involved), so it only costs pet capacity, never stash room.
        for (const [itemId, entry] of leftoverStash) {
          if (qty >= pet.capacity || entry.qty <= 0) continue;
          const loadQty = Math.min(pet.capacity - qty, entry.qty);
          const load = await postAction('/actions/smuggling.php', { action: 'v2_load', shipment_id: shipmentId, item_id: itemId, qty: loadQty });
          if (!load?.ok) {
            pushError(`load (from existing stash) failed for ${pet.name}: ${load?.error ?? 'unknown error'}`);
            continue; // this one item didn't work — still worth trying the rest of the stash, and then buying fresh
          }
          stashUsed -= loadQty;
          entry.qty -= loadQty;
          qty += loadQty;
          loadedItems.set(entry.name, (loadedItems.get(entry.name) ?? 0) + loadQty);
        }

        // A pet's own capacity routinely exceeds the shared stash cap (George's 30
        // vs. a 21-slot stash, confirmed on this account) — buying it in one shot,
        // an earlier version of this loop, fails outright rather than partially,
        // every time the pet's capacity alone is bigger than the stash. Cycling
        // buy→load in stash-sized chunks is the same flow the UI itself uses (see
        // docs/smuggling-v2-plan.md's confirmed action table).
        while (qty < pet.capacity) {
          const remainingNeeded = pet.capacity - qty;
          const availableRoom = stashMax - stashUsed;
          if (availableRoom <= 0) {
            // Not an error by itself — a still-nonzero `qty` means the drain step
            // above (or an earlier round this same pet) already loaded something
            // worth departing with; only truly a dead end if nothing was ever
            // loaded at all (handled just below).
            break;
          }

          const buyQty = Math.min(remainingNeeded, availableRoom);
          const buy = await postAction('/actions/smuggling.php', { action: 'buy', item_id: item.itemId, qty: buyQty });
          if (!buy?.ok) {
            pushError(`buy failed for ${pet.name}: ${buy?.error ?? 'unknown error'}`);
            break;
          }
          const boughtQty = Number(buy.qty ?? buy.qty_requested ?? buyQty);
          stashUsed += boughtQty;

          const load = await postAction('/actions/smuggling.php', { action: 'v2_load', shipment_id: shipmentId, item_id: item.itemId, qty: boughtQty });
          if (!load?.ok) {
            // Bought but not loaded — still genuinely sitting in the stash, so
            // `stashUsed` stays incremented rather than being rolled back here.
            pushError(`load failed for ${pet.name}: ${load?.error ?? 'unknown error'}`);
            break;
          }
          stashUsed -= boughtQty; // moved from stash onto this pet's manifest, freeing the room back up
          qty += boughtQty;
          loadedItems.set(item.name, (loadedItems.get(item.name) ?? 0) + boughtQty);
        }

        if (qty === 0) {
          pushError(`could not load anything for ${pet.name}`);
          await cancelShipment(shipmentId, pet.name, summary);
          continue;
        }

        if (!destination) {
          // One retry with a short pause before giving up — the panel is fetched
          // fresh milliseconds after `v2_load` returns, and confirmed real captures
          // show destinations only render once the load has actually registered
          // server-side, so a single immediate check landing just ahead of that is
          // plausible where a real player's own pace never would.
          for (let attempt = 0; attempt < 2 && !destination; attempt++) {
            if (attempt > 0) await sleep(1500);
            const afterDraft = await fetchPanel();
            destination = afterDraft ? pickDestination(afterDraft.destinations) : null;
          }
          if (!destination) {
            // The destination pair is account-wide, not per-pet — every pet still
            // queued behind this one would see the exact same two (still-locked)
            // cells, so retrying per pet would just cancel each one in turn while
            // repeating an already-known answer. Stopping here once, instead of
            // once per remaining pet, was confirmed necessary the first time this
            // ran: it produced the identical "no destination" outcome for every
            // pet after the first, just discovered the slow way.
            pushError(`no open destination available for ${pet.name} — the two open this hour are locked or unresolvable for every pet, not just this one`);
            await cancelShipment(shipmentId, pet.name, summary);
            summary.stoppedReason = 'no-destination-available';
            return summary;
          }
        }

        const districtRow = await db.districts.where('name').equals(destination.district).first();
        if (!districtRow) {
          pushError(`unknown district "${destination.district}" — not in the local district table yet`);
          await cancelShipment(shipmentId, pet.name, summary);
          continue;
        }

        const depart = await postAction('/actions/smuggling.php', { action: 'v2_depart', shipment_id: shipmentId, destination_city_id: districtRow.id });
        if (!depart?.ok) {
          pushError(`depart failed for ${pet.name}: ${depart?.error ?? 'unknown error'}`);
          await cancelShipment(shipmentId, pet.name, summary);
          continue;
        }

        pushSent({
          petName: pet.name,
          items: [...loadedItems].map(([name, itemQty]) => ({ item: name, qty: itemQty })),
          destination: destination.district,
        });
      } catch (err) {
        if (err instanceof SystemicActionError) {
          pushError(err.message);
          summary.stoppedReason = err.kind === 'auth' ? 'session-error' : 'shape-changed';
          return summary;
        }
        if (shipmentId !== null) await cancelShipment(shipmentId, pet.name, summary);
        pushError(`run failed for ${pet.name}: ${String(err)}`);
      }
    }

    return summary;
  } catch (err) {
    // Catches anything thrown outside the per-pet loop's own handling — notably
    // the startup stuck-draft cleanup, which isn't wrapped individually since a
    // `SystemicActionError` there is exactly as real a stop-everything signal as
    // one from inside the loop.
    if (err instanceof SystemicActionError) {
      pushError(err.message);
      summary.stoppedReason = err.kind === 'auth' ? 'session-error' : 'shape-changed';
      return summary;
    }
    console.error(LOG_PREFIX, 'courier batch failed', err);
    pushError(String(err));
    return summary;
  }
}
