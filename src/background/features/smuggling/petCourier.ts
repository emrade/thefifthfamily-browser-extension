import { db } from '@/shared/db';
import { GAME_ORIGIN } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { storage } from '@/shared/storage';
import { getRoster, upsertRoster } from '@/shared/petRoster';
import { SystemicActionError, depositCashOnHand, postAction } from '../../gameAction';
import { parseSmugglingV2PanelRegex } from './smugglingPanelRegexParser';
import type { BlackMarketItem, CourierProgressEvent, CourierRunSummary, FleetEntry, PetRosterEntry, SmugglingV2Snapshot } from '@/shared/types';

/**
 * Set for the duration of one run, to the tab that asked for it — see
 * `runCourierBatch`/`runOffloadBatch`. `emitProgress` needs it because
 * `chrome.tabs.sendMessage` (unlike `chrome.runtime.sendMessage`) is targeted:
 * it's the only way to reach a *content script*'s `runtime.onMessage` listener,
 * which is what the in-page floating panel is. `chrome.runtime.sendMessage`
 * only reaches other extension pages (popup, options) — never content scripts —
 * which is why progress broadcast that way silently never arrived at the panel.
 */
let progressTabId: number | undefined;

/**
 * Broadcasts one step of the run as it happens, so the in-page floating panel
 * can show progress live instead of going quiet until the whole batch finishes
 * and the final `CourierRunSummary` resolves. Best-effort and fire-and-forget
 * on purpose — the panel may not be on screen, and that's fine, since nothing
 * here is relied on for correctness; the final summary is still the record of
 * what actually happened.
 */
function emitProgress(event: CourierProgressEvent): void {
  if (progressTabId == null) return;
  chrome.tabs.sendMessage(progressTabId, { type: 'courier-run-progress', event }).catch(() => {});
}

/** Below this, further sales wouldn't pay out anyway — not worth spending on cargo
 *  that would just sit there past the daily cap. */
const DAILY_CAP_STOP_THRESHOLD = 1000;

/**
 * Deliberately matches the *live client's* actual URL, not a hardcoded guess —
 * confirmed 2026-08-19 that the game dropped `smug_tab=proto` from normal use
 * entirely; the bare URL now returns the full dashboard directly (see
 * docs/smuggling-v2-plan.md). Explicitly requesting `smug_tab=proto` still might
 * "work" in the sense of returning 200, but nothing confirms it behaves
 * identically to what the real client gets now that the game stopped sending it —
 * matching the client exactly removes that as a variable.
 */
export async function fetchPanel(): Promise<SmugglingV2Snapshot | null> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?type=smuggling&_t=${Date.now()}`, {
    credentials: 'include',
  });
  return parseSmugglingV2PanelRegex(await res.text());
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
 *
 * Takes a `pushError` callback rather than a whole `CourierRunSummary` so a
 * caller with no batch summary of its own (the courier auto-watch's
 * destination probe — see `courierWatch.ts` — drafts and immediately cancels
 * a shipment just to read the destination list, outside any batch run) can
 * reuse this without constructing a throwaway summary just to satisfy it.
 */
export async function cancelShipment(shipmentId: number, petName: string, pushError: (message: string) => void): Promise<void> {
  const resp = await postAction('/actions/smuggling.php', { action: 'v2_cancel', shipment_id: shipmentId });
  if (!resp?.ok) pushError(`could not cancel ${petName}'s stuck shipment — it may still be blocking new drafts`);
}

function pickItem(blackMarket: BlackMarketItem[]): BlackMarketItem | null {
  const buyable = blackMarket.filter((i) => i.buyableHere);
  if (buyable.length === 0) return null;
  return buyable.reduce((best, item) => (item.price > best.price ? item : best));
}

/**
 * POSTs `v2_launch` — sends every included idle pet in one call, with the
 * server buying the cargo inline (`buy=1`). Replaces what used to be a
 * draft→buy→load→depart sequence repeated once per pet — see
 * docs/smuggling-bulk-actions-plan.md's confirmed request shape. Only ever
 * called from `executeCourierBatch`, after that caller has already confirmed
 * `snapshot.launchAvailability.available` on the live fetch — this function
 * itself does no gating.
 *
 * `user_pet_ids` is comma-joined, not sent as repeated params — confirmed
 * from the real capture that `postAction`'s plain string params URL-encode
 * commas correctly, matching the real request byte-for-byte.
 */
async function runLaunch(pets: PetRosterEntry[], item: BlackMarketItem, destination: { cityId: number; name: string }, maxSpend: number): Promise<any> {
  return postAction('/actions/smuggling.php', {
    action: 'v2_launch',
    user_pet_ids: pets.map((p) => p.userPetId).join(','),
    item_id: item.itemId,
    destination_city_id: destination.cityId,
    buy: 1,
    max_spend: maxSpend,
  });
}

/**
 * POSTs `v2_offload_all` — sweeps every already-landed, unbanked delivery
 * account-wide in one call, no parameters beyond auth. Only ever called from
 * `offloadWhatIsReady` once it's confirmed `snapshot.offloadAllCount` is
 * non-null on the live fetch (2+ ready deliveries — the real button's own
 * confirmed threshold), so `count` isn't part of the request itself; it's
 * accepted here only so the caller's own gating condition stays visible at
 * the call site rather than implicit.
 */
async function runOffloadAll(count: number): Promise<any> {
  return postAction('/actions/smuggling.php', { action: 'v2_offload_all' });
}

/** Maps a `SystemicActionError` to the batch's own `stoppedReason` vocabulary.
 *  `'status-blocked'` (jailed/hospitalized/travelling right now) is kept
 *  distinct from `'shape-changed'` — see gameAction.ts's `SystemicActionError`
 *  doc for the confirmed real incident this distinction fixes: a status
 *  block is recoverable and expected, not a sign the game's response format
 *  changed, so a caller (courierWatch's auto-dispatch) must not treat the two
 *  the same way. */
function classifyStop(err: SystemicActionError): CourierRunSummary['stoppedReason'] {
  if (err.kind === 'auth') return 'session-error';
  if (err.kind === 'status-blocked') return 'status-blocked';
  return 'shape-changed';
}

/**
 * Offloads every fleet entry that's arrived, one `v2_offload` per shipment —
 * the single-shipment fallback `offloadWhatIsReady` below routes to whenever
 * `v2_offload_all` isn't offered (0 or 1 ready deliveries; see that
 * function's own doc). Returns a stop reason if a systemic error hit
 * partway through; ordinary per-shipment rejections are pushed as errors and
 * don't stop the loop, since one pet's cargo failing to sell doesn't mean
 * the next one's will too.
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
        return classifyStop(err);
      }
      pushError(`offload failed for ${entry.petName}: ${String(err)}`);
    }
  }
  return null;
}

/**
 * Offloads whatever's landed — shared between the full batch run and the
 * standalone offload-only action (see `runOffloadBatch`), since collecting
 * arrived shipments is identical work either way regardless of which
 * action triggered it. Routes to the bulk `v2_offload_all` call whenever the
 * real UI would offer that button (`snapshot.offloadAllCount !== null` — 2+
 * ready deliveries, confirmed from the archive), falling through to the
 * existing per-shipment `offloadReady` loop otherwise, which already handles
 * 0 or 1 ready shipments correctly. Never calls `v2_offload_all` below that
 * threshold — there is no legitimate path to construct that request below
 * it (see docs/smuggling-bulk-actions-plan.md's design-requirement section),
 * so this doesn't try.
 */
async function offloadWhatIsReady(
  snapshot: SmugglingV2Snapshot,
  pushOffloaded: (entry: CourierRunSummary['offloaded'][number]) => void,
  pushError: (message: string) => void,
  summary: CourierRunSummary,
): Promise<CourierRunSummary['stoppedReason']> {
  if (snapshot.offloadAllCount === null) {
    return offloadReady(snapshot.fleet, pushOffloaded, pushError);
  }

  try {
    const resp = await runOffloadAll(snapshot.offloadAllCount);
    if (resp?.ok) {
      summary.offloadedBatch = {
        runsCollected: Number(resp.runs_collected) || 0,
        unitsSold: Number(resp.units_sold) || 0,
        cashReceived: Number(resp.cash_received) || 0,
        netProfit: Number(resp.net_profit) || 0,
      };
    } else {
      pushError(`offload-all failed: ${resp?.error ?? 'unknown error'}`);
    }
    return null;
  } catch (err) {
    if (err instanceof SystemicActionError) {
      pushError(err.message);
      return classifyStop(err);
    }
    pushError(`offload-all failed: ${String(err)}`);
    return null;
  }
}

/**
 * Sweeps whatever cash is currently on hand into the bank — cash sitting on hand
 * is what gets taken in a mugging, so this runs at the end of *every* batch
 * (full run or offload-only), not just when a run itself earned or spent
 * anything. Best-effort: a failure here doesn't change `stoppedReason` or fail
 * the batch, since by this point the batch's own substantive work is already
 * done (or already gave up) — this is just protecting whatever's left standing.
 *
 * The actual request (`depositCashOnHand()`, in gameAction.ts) sends
 * `amount=ALL` — confirmed from 279 real deposit calls in the archive, all
 * identical, none using a specific figure. An earlier version of this
 * guessed a comma-formatted amount by mirroring `withdraw`'s shape, which
 * turned out wrong once actually checked against real traffic.
 */
async function depositLeftoverCash(summary: CourierRunSummary): Promise<void> {
  const funds = await fetchCashAndDistrict();
  if (!funds || funds.cash <= 0) return;

  try {
    const resp = await depositCashOnHand();
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

/** Persists the summary regardless of which path produced it, so a reopened panel
 *  can show "last run" even if the run happened (or crashed) while it was closed.
 *  `tabId` (the tab that asked for the run, from the message `sender`) is stashed
 *  in `progressTabId` for the duration so `emitProgress` knows where to send
 *  live updates — see its comment. */
export async function runCourierBatch(tabId?: number): Promise<CourierRunSummary> {
  progressTabId = tabId;
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
export async function runOffloadBatch(tabId?: number): Promise<CourierRunSummary> {
  progressTabId = tabId;
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
    launched: null,
    offloadedBatch: null,
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

    const stopReason = await offloadWhatIsReady(snapshot, pushOffloaded, pushError, summary);
    if (stopReason) summary.stoppedReason = stopReason;
    return summary;
  } catch (err) {
    if (err instanceof SystemicActionError) {
      pushError(err.message);
      summary.stoppedReason = classifyStop(err);
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
    launched: null,
    offloadedBatch: null,
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
      await cancelShipment(stuck.shipmentId, stuck.petName, pushError);
      const fresh = await fetchPanel();
      if (fresh) snapshot = fresh;
    }

    // Free up pets and realize the previous run's profit before spending anything
    // new — also means the daily-cap check right after reflects today's true
    // remaining headroom.
    const offloadStop = await offloadWhatIsReady(snapshot, pushOffloaded, pushError, summary);
    if (offloadStop) {
      summary.stoppedReason = offloadStop;
      return summary;
    }

    if (summary.offloaded.length > 0 || summary.offloadedBatch) {
      const fresh = await fetchPanel();
      if (fresh) snapshot = fresh;
    }

    if (snapshot.dailyProfitCapRemaining !== null && snapshot.dailyProfitCapRemaining < DAILY_CAP_STOP_THRESHOLD) {
      summary.stoppedReason = 'daily-cap-reached';
      return summary;
    }

    const roster = await getRoster();
    const activeNames = new Set(snapshot.fleet.map((f) => f.petName));
    // Not in the active fleet isn't the same as actually draftable — a pet
    // can be sitting out idle on the smuggling side while still rejected by
    // `v2_draft` for an unrelated reason (confirmed: equipping a pet as your
    // Fight Club combat pet blocks it here too — "Pigeon is deployed as your
    // combat pet. Unequip it first."). Checked here, before ever attempting a
    // draft, rather than discovered per-pet as a wasted failed request the
    // way it was the first time this happened — see `PetRosterEntry.draftBlockedReason`.
    for (const pet of roster) {
      if (!activeNames.has(pet.name) && pet.draftBlockedReason) {
        pushSkipped({ petName: pet.name, reason: pet.draftBlockedReason });
      }
    }
    const idlePets = roster.filter((p) => !activeNames.has(p.name) && !p.draftBlockedReason);

    // Never construct `v2_launch` in a state the real UI wouldn't offer the
    // button for — see docs/smuggling-bulk-actions-plan.md's design
    // requirement. `launchAvailability` is read live off this same fetch
    // (re-fetched above if the offload step or the stuck-draft cleanup ran),
    // and checked *before* `idlePets.length` below — the class check on the
    // panel is the authoritative signal for whether the button exists at
    // all, and the locally-cached roster diff (`idlePets`, from `getRoster()`)
    // can lag it: the roster only gets a fresh write when a fetch happens to
    // show the full crew (zero active shipments), so it can still read empty
    // for a beat after a pet actually becomes draftable server-side. Checking
    // `availability` first means a real "no idle pets" verdict always comes
    // from the server's own signal, never from a stale local cache.
    const availability = snapshot.launchAvailability;
    if (!availability.available) {
      switch (availability.reasonKind) {
        case 'no-idle-pets':
          summary.stoppedReason = 'no-idle-pets';
          break;
        case 'destination-locked':
          summary.stoppedReason = 'no-destination-available';
          break;
        case 'stuck-draft':
        case 'unknown':
        default:
          // A stuck draft here means the cleanup step above either didn't
          // clear it or something re-created one between then and this read
          // — worth surfacing as a real error rather than the routine
          // no-idle/no-destination cases just above.
          pushError(availability.reasonText);
          summary.stoppedReason = 'shape-changed';
      }
      return summary;
    }

    if (idlePets.length === 0) {
      // The server just confirmed a courier is available, but the local
      // roster cache disagrees — a desync worth surfacing on its own rather
      // than quietly filed under the routine "no idle pets" case above
      // (which this contradicts, since `availability.available` already
      // ruled that out from the server's own point of view).
      pushError('the panel reports an idle courier available, but the local pet roster shows none — the roster cache may be stale');
      summary.stoppedReason = 'shape-changed';
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
          summary.stoppedReason = classifyStop(err);
          return summary;
        }
        pushError(`withdrawal failed: ${String(err)}`);
        summary.stoppedReason = 'insufficient-funds';
        return summary;
      }
    }

    try {
      // Re-read live state immediately before sending — the funds check and
      // (possibly) the withdrawal just above each made a real network call,
      // so the `availability` captured earlier could be stale by the time
      // execution actually gets here. Same discipline as Career Auto's live
      // cooldown cross-check, and the exact rule
      // docs/smuggling-bulk-actions-plan.md's design-requirement section
      // spells out: a stale earlier read must never reach the network as a
      // `v2_launch` call the real client couldn't have sent (e.g. a
      // destination that rotated locked in the few seconds this took).
      const recheck = await fetchPanel();
      if (!recheck) {
        pushError('could not re-read the smuggling panel immediately before launch');
        summary.stoppedReason = 'shape-changed';
        return summary;
      }
      const liveAvailability = recheck.launchAvailability;
      if (!liveAvailability.available) {
        switch (liveAvailability.reasonKind) {
          case 'no-idle-pets':
            summary.stoppedReason = 'no-idle-pets';
            break;
          case 'destination-locked':
            summary.stoppedReason = 'no-destination-available';
            break;
          case 'stuck-draft':
          case 'unknown':
          default:
            pushError(liveAvailability.reasonText);
            summary.stoppedReason = 'shape-changed';
        }
        return summary;
      }

      let launch = await runLaunch(included, item, liveAvailability.destination, runningCost);

      // Confirmed real (2026-08-29, the old per-pet buy loop's own incident):
      // a second, independent browser session logged into the same account
      // can sweep cash-on-hand to the bank (e.g. Street Intel's own
      // `depositCashOnHand` cleanup) in the moments between this batch's
      // withdrawal and this call, zeroing out the exact cash `max_spend` was
      // just sized against. Nothing here can see or coordinate with that
      // other session, so the only real fix is reacting live to whatever
      // cash actually turns out to be there: one top-up withdrawal, then one
      // retry of this exact call — the same recovery the old buy loop used,
      // ported to the one call that replaced it.
      if (!launch?.ok && typeof launch?.error === 'string' && /ran out of cash for more cargo/i.test(launch.error)) {
        const fundsNow = await fetchCashAndDistrict();
        if (fundsNow && fundsNow.cash < runningCost && fundsNow.bank > 0) {
          const topUp = Math.min(fundsNow.bank, runningCost - fundsNow.cash);
          const withdraw = await postAction('/actions/bank.php', { action: 'withdraw', amount: topUp.toLocaleString('en-US') });
          if (withdraw?.ok) {
            summary.cashWithdrawn += topUp;
            launch = await runLaunch(included, item, liveAvailability.destination, runningCost);
          }
        }
      }

      if (launch?.ok) {
        summary.launched = {
          petCount: Number(launch.sent) || included.length,
          unitsSent: Number(launch.units_sent) || 0,
          unitsBought: Number(launch.units_bought) || 0,
          cashSpent: Number(launch.cash_spent) || 0,
          item: item.name,
          destination: typeof launch.destination === 'string' ? launch.destination : liveAvailability.destination.name,
        };
      } else {
        pushError(`launch failed: ${launch?.error ?? 'unknown error'}`);
        summary.stoppedReason = 'shape-changed';
      }
    } catch (err) {
      if (err instanceof SystemicActionError) {
        pushError(err.message);
        summary.stoppedReason = classifyStop(err);
        return summary;
      }
      pushError(`launch failed: ${String(err)}`);
      summary.stoppedReason = 'shape-changed';
    }

    return summary;
  } catch (err) {
    // Catches anything thrown outside the try blocks above — notably the
    // startup stuck-draft cleanup, which isn't wrapped individually since a
    // `SystemicActionError` there is exactly as real a stop-everything signal
    // as one from anywhere else in this function.
    if (err instanceof SystemicActionError) {
      pushError(err.message);
      summary.stoppedReason = classifyStop(err);
      return summary;
    }
    console.error(LOG_PREFIX, 'courier batch failed', err);
    pushError(String(err));
    return summary;
  }
}
