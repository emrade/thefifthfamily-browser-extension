import { db } from '@/shared/db';
import { GAME_ORIGIN } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { storage } from '@/shared/storage';
import { getRoster, upsertRoster } from '@/shared/petRoster';
import { getCsrfToken } from '../../csrfToken';
import { parseSmugglingV2PanelRegex } from './smugglingV2RegexParser';
import type { BlackMarketItem, CourierRunSummary, DestinationOption, SmugglingV2Snapshot } from '@/shared/types';

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

async function fetchPanel(): Promise<SmugglingV2Snapshot | null> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?type=smuggling&smug_tab=proto&_t=${Date.now()}`, {
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

async function postAction(path: string, params: Record<string, string | number>): Promise<any> {
  const csrf = await getCsrfToken();
  if (!csrf) throw new SystemicActionError('no CSRF token observed yet — open the game tab and view any panel first, then run again', 'auth');

  const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), _csrf: csrf });
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

  return json;
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

/** Persists the summary regardless of which path produced it, so a reopened popup
 *  can show "last run" even if the run happened (or crashed) while it was closed. */
export async function runCourierBatch(): Promise<CourierRunSummary> {
  const summary = await executeCourierBatch();
  await storage.setLastCourierRun(summary).catch((err) => console.error(LOG_PREFIX, 'setLastCourierRun failed', err));
  return summary;
}

async function executeCourierBatch(): Promise<CourierRunSummary> {
  const summary: CourierRunSummary = {
    timestamp: Date.now(),
    offloaded: [],
    sent: [],
    skipped: [],
    cashWithdrawn: 0,
    stoppedReason: null,
    errors: [],
  };

  try {
    let snapshot = await fetchPanel();
    if (!snapshot) {
      summary.errors.push('could not read the smuggling panel');
      return summary;
    }

    // Every district has always had 3 buyable items — the envelope unwrapping and
    // the grid parsing are separate steps, so an empty grid on an otherwise-parsed
    // panel means the `.sv2-card`/`data-sv2-here` markup changed shape, not that
    // there's genuinely nothing to buy. Caught here, before anything is spent,
    // rather than surfacing later as "nothing buyable" (which reads as routine).
    if (snapshot.blackMarket.length === 0) {
      summary.errors.push('the black-market grid parsed empty — the panel markup may have changed shape');
      summary.stoppedReason = 'shape-changed';
      return summary;
    }

    // Opportunistic — see docs/smuggling-v2-plan.md's "Pet roster discovery" note.
    // Most runs won't have anything to learn here (the roster only shows once
    // shipments exist), which is exactly why the persisted mapping below matters.
    if (snapshot.roster.length > 0) await upsertRoster(snapshot.roster);

    // Free up pets and realize the previous run's profit before spending anything
    // new — also means the daily-cap check right after reflects today's true
    // remaining headroom.
    for (const entry of snapshot.fleet.filter((f) => f.status === 'ready-to-offload')) {
      try {
        const resp = await postAction('/actions/smuggling.php', { action: 'v2_offload', shipment_id: entry.shipmentId, qty: '' });
        if (resp?.ok) {
          summary.offloaded.push({ petName: entry.petName, profit: Number(resp.net_profit) || 0 });
        } else {
          summary.errors.push(`offload failed for ${entry.petName}: ${resp?.error ?? 'unknown error'}`);
        }
      } catch (err) {
        if (err instanceof SystemicActionError) {
          summary.errors.push(err.message);
          summary.stoppedReason = err.kind === 'auth' ? 'session-error' : 'shape-changed';
          return summary;
        }
        summary.errors.push(`offload failed for ${entry.petName}: ${String(err)}`);
      }
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
      summary.errors.push('nothing buyable in the current district');
      return summary;
    }

    const funds = await fetchCashAndDistrict();
    if (!funds) {
      summary.errors.push('could not read cash/bank balance');
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
        summary.skipped.push({ petName: pet.name, reason: 'insufficient funds' });
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
          summary.errors.push(`withdrawal failed: ${resp?.error ?? 'unknown error'}`);
          summary.stoppedReason = 'insufficient-funds';
          return summary;
        }
        summary.cashWithdrawn = shortfall;
      } catch (err) {
        if (err instanceof SystemicActionError) {
          summary.errors.push(err.message);
          summary.stoppedReason = err.kind === 'auth' ? 'session-error' : 'shape-changed';
          return summary;
        }
        summary.errors.push(`withdrawal failed: ${String(err)}`);
        summary.stoppedReason = 'insufficient-funds';
        return summary;
      }
    }

    // Learned once, from the first pet's draft — the destination pair is
    // account-wide, not per-shipment, and won't rotate mid-batch (see the doc's
    // confirmed 60-minute rotation).
    let destination: DestinationOption | null = null;

    for (const pet of included) {
      try {
        const draft = await postAction('/actions/smuggling.php', { action: 'v2_draft', user_pet_id: pet.userPetId });
        if (!draft?.ok) {
          summary.errors.push(`draft failed for ${pet.name}: ${draft?.error ?? 'unknown error'}`);
          continue;
        }
        const shipmentId = Number(draft.shipment_id);

        const buy = await postAction('/actions/smuggling.php', { action: 'buy', item_id: item.itemId, qty: pet.capacity });
        if (!buy?.ok) {
          summary.errors.push(`buy failed for ${pet.name}: ${buy?.error ?? 'unknown error'}`);
          continue;
        }
        const qty = Number(buy.qty ?? buy.qty_requested ?? pet.capacity);

        const load = await postAction('/actions/smuggling.php', { action: 'v2_load', shipment_id: shipmentId, item_id: item.itemId, qty });
        if (!load?.ok) {
          summary.errors.push(`load failed for ${pet.name}: ${load?.error ?? 'unknown error'}`);
          continue;
        }

        if (!destination) {
          const afterDraft = await fetchPanel();
          destination = afterDraft ? pickDestination(afterDraft.destinations) : null;
          if (!destination) {
            summary.errors.push(`no open destination available for ${pet.name}`);
            continue;
          }
        }

        const districtRow = await db.districts.where('name').equals(destination.district).first();
        if (!districtRow) {
          summary.errors.push(`unknown district "${destination.district}" — not in the local district table yet`);
          continue;
        }

        const depart = await postAction('/actions/smuggling.php', { action: 'v2_depart', shipment_id: shipmentId, destination_city_id: districtRow.id });
        if (!depart?.ok) {
          summary.errors.push(`depart failed for ${pet.name}: ${depart?.error ?? 'unknown error'}`);
          continue;
        }

        summary.sent.push({ petName: pet.name, item: item.name, qty, destination: destination.district });
      } catch (err) {
        if (err instanceof SystemicActionError) {
          summary.errors.push(err.message);
          summary.stoppedReason = err.kind === 'auth' ? 'session-error' : 'shape-changed';
          return summary;
        }
        summary.errors.push(`run failed for ${pet.name}: ${String(err)}`);
      }
    }

    return summary;
  } catch (err) {
    console.error(LOG_PREFIX, 'courier batch failed', err);
    summary.errors.push(String(err));
    return summary;
  }
}
