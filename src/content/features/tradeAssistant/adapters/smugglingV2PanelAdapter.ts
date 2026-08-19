import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';
import type {
  AssignedCourier,
  BlackMarketItem,
  DestinationOption,
  FleetEntry,
  PetRosterEntry,
  SmugglingV2Snapshot,
} from '@/shared/types';

/**
 * Parses `GET /api/panel.php?type=smuggling&smug_tab=proto` — the real dashboard
 * behind the pet (courier) system, replacing the dead `.sgl-*` model
 * `smugglingPanelAdapter.ts` was built for (that one now only ever sees the
 * tab-switcher stub or the sv2 markup it doesn't understand — left as-is,
 * dormant, per docs/smuggling-v2-plan.md's "bundled cleanup" note).
 *
 * One response, several optional sections depending on shipment state — see the
 * doc's "Panel views" for the confirmed shape of each. Every field here is
 * independently optional/empty for exactly that reason; callers should not assume
 * `destinations` or `roster` are populated.
 */
export function parseSmugglingV2Panel(responseText: string): SmugglingV2Snapshot | null {
  const envelope = unwrapPanelEnvelope(responseText);
  if (!envelope) return null;

  const doc = new DOMParser().parseFromString(envelope.html, 'text/html');
  const timestamp = Date.now();

  return {
    fleet: parseFleet(doc),
    roster: parseRoster(doc, timestamp),
    blackMarket: parseBlackMarket(doc),
    destinations: parseDestinations(doc),
    assignedCourier: parseAssignedCourier(doc),
    dailyProfitCapRemaining: parseDailyCapRemaining(doc),
    hiddenCargo: parseHiddenCargo(doc),
  };
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').trim();
}

function numberFrom(text: string): number {
  const n = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Extracts the arguments of a `Game.<fn>(...)` onclick handler as raw strings —
 *  callers pick out the ones they need by position. Quoted string args keep their
 *  quotes stripped; everything else (numeric ids) is returned as-is. */
function onclickArgs(el: Element | null, fnName: string): string[] | null {
  const onclick = el?.getAttribute('onclick');
  if (!onclick) return null;
  const m = onclick.match(new RegExp(`${fnName}\\(([^)]*)\\)`));
  if (!m) return null;
  return m[1].split(',').map((arg) => arg.trim().replace(/^'(.*)'$/, '$1'));
}

function parseFleet(doc: Document): FleetEntry[] {
  const entries: FleetEntry[] = [];
  for (const el of Array.from(doc.querySelectorAll('.sv2-fleet > .sv2-fl'))) {
    if (el.classList.contains('new')) continue; // the "New delivery" card, not a real shipment
    const args = onclickArgs(el, 'Game\\.smugV2Focus');
    const shipmentId = args ? Number(args[0]) : NaN;
    if (!Number.isFinite(shipmentId)) continue;

    const petName = textOf(el.querySelector('.sv2-fl-txt b'));
    const etaEl = el.querySelector('.sv2-fl-eta[data-seconds]');
    const etaSeconds = etaEl ? Number(etaEl.getAttribute('data-seconds')) : null;
    const status: FleetEntry['status'] = el.classList.contains('draft')
      ? 'drafting'
      : el.classList.contains('ready')
        ? 'ready-to-offload'
        : 'moving';

    entries.push({ shipmentId, petName, status, etaSeconds: Number.isFinite(etaSeconds) ? etaSeconds : null });
  }
  return entries;
}

/**
 * Only non-empty when the account has zero active shipments anywhere — see
 * docs/smuggling-v2-plan.md's "Pet roster discovery" note. This is the *only*
 * confirmed source of a pet's `user_pet_id`, which is why `petRoster.ts` persists
 * whatever this returns rather than re-deriving it each run.
 */
function parseRoster(doc: Document, timestamp: number): PetRosterEntry[] {
  const entries: PetRosterEntry[] = [];
  for (const card of Array.from(doc.querySelectorAll('.sv2-crew .sv2-cc'))) {
    const args = onclickArgs(card.querySelector('.sv2-go'), 'Game\\.smugV2Draft');
    const userPetId = args ? Number(args[0]) : NaN;
    if (!Number.isFinite(userPetId)) continue;

    const name = textOf(card.querySelector('.sv2-cc-name'));
    const tier = textOf(card.querySelector('.sv2-cc-role'));
    const stats = Array.from(card.querySelectorAll('.sv2-cs-v'));
    const capacity = numberFrom(textOf(stats[0] ?? null));
    const travelPenaltyPct = numberFrom(textOf(stats[1] ?? null));

    entries.push({ userPetId, name, tier, capacity, travelPenaltyPct, lastSeen: timestamp });
  }
  return entries;
}

function parseBlackMarket(doc: Document): BlackMarketItem[] {
  const items: BlackMarketItem[] = [];
  for (const card of Array.from(doc.querySelectorAll('#sv2-contraband-grid .sv2-card'))) {
    const buyBtn = card.querySelector('.sv2-btn-buy');
    const args = buyBtn ? onclickArgs(buyBtn, 'Game\\.buyContraband') : null;
    const itemId = args ? Number(args[0]) : NaN;
    if (!Number.isFinite(itemId)) continue; // locked cards carry no buy handler at all

    items.push({
      itemId,
      name: textOf(card.querySelector('.sv2-card-name')),
      family: textOf(card.querySelector('.sv2-fam-pill')),
      originDistrict: textOf(card.querySelector('.sv2-origin-pill')),
      price: numberFrom(textOf(card.querySelector('.sv2-card-price'))),
      buyableHere: card.getAttribute('data-sv2-here') === '1',
      stash: numberFrom(textOf(card.querySelector('.sv2-card-stash b'))),
    });
  }
  return items;
}

/** Reads a `.sv2-drow` by its label rather than position — the row order isn't
 *  contractually guaranteed, and matching by label is exactly as cheap. */
function drowValue(cell: Element, label: string): string {
  for (const row of Array.from(cell.querySelectorAll('.sv2-drow'))) {
    if (textOf(row.querySelector('.sv2-dlbl')) === label) return textOf(row.querySelector('.sv2-dval'));
  }
  return '';
}

/** Only non-empty once a shipment draft exists — see the "Destination picker" note
 *  in docs/smuggling-v2-plan.md. Always exactly 2 cells when present, one of which
 *  may be `.locked`. */
function parseDestinations(doc: Document): DestinationOption[] {
  const options: DestinationOption[] = [];
  for (const cell of Array.from(doc.querySelectorAll('.sv2-dest .sv2-dcell'))) {
    const district = textOf(cell.querySelector('.sv2-dname'));
    if (!district) continue;

    options.push({
      district,
      locked: cell.classList.contains('locked'),
      baseMinutes: numberFrom(drowValue(cell, 'Base')),
      courierMinutes: numberFrom(drowValue(cell, 'With courier')),
      saleRateMult: numberFrom(drowValue(cell, 'Sale Rate')),
      stateBadge: textOf(cell.querySelector('.sv2-dstate')) || null,
    });
  }
  return options;
}

/** Only present once a shipment draft exists — the pet currently assigned to it. */
function parseAssignedCourier(doc: Document): AssignedCourier | null {
  const banner = doc.querySelector('.sv2-load');
  if (!banner) return null;

  const cancelBtn = Array.from(doc.querySelectorAll('button')).find((b) => b.getAttribute('onclick')?.includes('smugV2Cancel'));
  const args = cancelBtn ? onclickArgs(cancelBtn, 'Game\\.smugV2Cancel') : null;
  const shipmentId = args ? Number(args[0]) : NaN;
  if (!Number.isFinite(shipmentId)) return null;

  const nums = Array.from(banner.querySelectorAll('.sv2-load-n'));

  return {
    shipmentId,
    petName: textOf(banner.querySelector('.sv2-load-name')),
    capacity: numberFrom(textOf(nums[0]?.querySelector('b') ?? null)),
    travelPenaltyPct: numberFrom(textOf(nums[1]?.querySelector('b') ?? null)),
    // `.sv2-man-count` renders as "X / Y" (loaded / capacity) — numberFrom's
    // digit-only strip would otherwise concatenate both sides into one bogus
    // number (e.g. "30 / 30" -> 3030), so pull just the leading count.
    manifestCount: Number(textOf(doc.querySelector('.sv2-man-count')).match(/^\d+/)?.[0] ?? 0),
  };
}

/** Reads the "$X left" line under the Daily Profit monitor — the same figure
 *  `v2_offload` returns as `cap_remaining`, but available here without needing an
 *  offload to have happened first. Null (not 0) when the monitor board itself isn't
 *  present, so callers can tell "unknown" from "genuinely zero left". */
function parseDailyCapRemaining(doc: Document): number | null {
  const monitors = Array.from(doc.querySelectorAll('.sv2-monitor'));
  const dailyProfit = monitors.find((m) => textOf(m.querySelector('.sv2-m-lbl')).includes('Daily Profit'));
  if (!dailyProfit) return null;
  const match = textOf(dailyProfit).match(/\$([\d,]+)\s*left/);
  return match ? numberFrom(match[1]) : null;
}

/** Reads "Hidden Cargo" — `.sv2-m-val` renders as `"21 / 21"` once the nested
 *  `<span>` for the max is included in `textContent`. Scales with player level
 *  (confirmed: "20 base at level 63... = 21"), so this is read fresh each time
 *  rather than assumed constant. */
function parseHiddenCargo(doc: Document): { current: number; max: number } | null {
  const monitors = Array.from(doc.querySelectorAll('.sv2-monitor'));
  const cargo = monitors.find((m) => textOf(m.querySelector('.sv2-m-lbl')).includes('Hidden Cargo'));
  if (!cargo) return null;

  const valText = textOf(cargo.querySelector('.sv2-m-val'));
  const ratio = valText.match(/(\d+)\s*\/\s*(\d+)/);
  if (ratio) return { current: Number(ratio[1]), max: Number(ratio[2]) };

  // Overflow state, confirmed real: cancelling or unloading a shipment returns
  // its cargo to the stash without clamping to the cap, so the stash can end up
  // holding *more* than its own max — "load a pet, buy more, then unload it"
  // reliably reproduces this. The monitor then reads "30 held" instead of a
  // ratio, with a warning nearby ("Only 21 can ship per run — 9 stays in your
  // stash") that's the only place `max` still appears in this state.
  const held = valText.match(/(\d+)\s*held/);
  if (held) {
    const capMatch = textOf(cargo).match(/Only (\d+) can ship/);
    if (capMatch) return { current: Number(held[1]), max: Number(capMatch[1]) };
  }

  return null;
}
