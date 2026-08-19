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
 * A DOM-free reimplementation of content/features/tradeAssistant/adapters/
 * smugglingV2PanelAdapter.ts, for the pet-courier automation's own background
 * fetches — MV3 service workers don't reliably have `DOMParser`, same reasoning as
 * smugglingHtmlRegexParser.ts. Fields are read by splitting the HTML on each
 * element's own opening tag and bounding the search to that one chunk, rather than
 * one whole-document regex per field — verified against real captured payloads
 * (see docs/smuggling-v2-plan.md) before being wired in.
 */
export function parseSmugglingV2PanelRegex(responseText: string): SmugglingV2Snapshot | null {
  const envelope = unwrapPanelEnvelope(responseText);
  if (!envelope) return null;

  const html = envelope.html;
  const timestamp = Date.now();

  return {
    fleet: parseFleet(html),
    roster: parseRoster(html, timestamp),
    blackMarket: parseBlackMarket(html),
    destinations: parseDestinations(html),
    assignedCourier: parseAssignedCourier(html),
    dailyProfitCapRemaining: parseDailyCapRemaining(html),
    hiddenCargo: parseHiddenCargo(html),
  };
}

function numberFrom(text: string | null | undefined): number {
  const n = Number((text ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseFleet(html: string): FleetEntry[] {
  const entries: FleetEntry[] = [];
  const chunks = html.split('<button class="sv2-fl ').slice(1);
  for (const raw of chunks) {
    const chunk = raw.split('</button>')[0];
    if (chunk.includes('Game.smugV2Focus(-1)')) continue; // the "New delivery" card

    const classList = chunk.slice(0, chunk.indexOf('"'));
    const idMatch = chunk.match(/Game\.smugV2Focus\((\d+)\)/);
    if (!idMatch) continue;

    const nameMatch = chunk.match(/<b>([^<]+)<\/b>/);
    const etaMatch = chunk.match(/data-seconds="(\d+)"/);

    entries.push({
      shipmentId: Number(idMatch[1]),
      petName: nameMatch ? nameMatch[1] : '',
      status: classList.includes('draft') ? 'drafting' : classList.includes('ready') ? 'ready-to-offload' : 'moving',
      etaSeconds: etaMatch ? Number(etaMatch[1]) : null,
    });
  }
  return entries;
}

/** Only non-empty when the account has zero active shipments — see
 *  docs/smuggling-v2-plan.md's "Pet roster discovery" note. */
function parseRoster(html: string, timestamp: number): PetRosterEntry[] {
  const entries: PetRosterEntry[] = [];
  const chunks = html.split('<div class="sv2-cc">').slice(1);
  for (const raw of chunks) {
    const chunk = raw.split('<div class="sv2-cc">')[0]; // next card (if any) is a hard stop

    const idMatch = chunk.match(/Game\.smugV2Draft\((\d+),'([^']+)'\)/);
    if (!idMatch) continue;

    const roleMatch = chunk.match(/sv2-cc-role">([^<]+)</);
    const stats = [...chunk.matchAll(/sv2-cs-v[^"]*">([^<]+)</g)].map((m) => m[1]);

    entries.push({
      userPetId: Number(idMatch[1]),
      name: idMatch[2],
      tier: roleMatch ? roleMatch[1] : '',
      capacity: numberFrom(stats[0]),
      travelPenaltyPct: numberFrom(stats[1]),
      lastSeen: timestamp,
    });
  }
  return entries;
}

function parseBlackMarket(html: string): BlackMarketItem[] {
  const items: BlackMarketItem[] = [];
  const gridStart = html.indexOf('sv2-contraband-grid');
  if (gridStart === -1) return items;

  const chunks = html.slice(gridStart).split('sv2-card"').slice(1);
  for (const chunk of chunks) {
    const idMatch = chunk.match(/Game\.buyContraband\((\d+)\)/);
    if (!idMatch) continue; // locked cards carry no buy handler at all

    const nameMatch = chunk.match(/sv2-card-name">([^<]+)</);
    const familyMatch = chunk.match(/sv2-fam-pill">([^<]+)</);
    const originMatch = chunk.match(/sv2-origin-pill">([^<]+)</);
    const priceMatch = chunk.match(/sv2-card-price[^>]*>\$([\d,]+)/);
    const stashMatch = chunk.match(/sv2-card-stash"><b>([^<]+)</);
    const hereMatch = chunk.match(/data-sv2-here="(\d)"/);

    items.push({
      itemId: Number(idMatch[1]),
      name: nameMatch ? nameMatch[1] : '',
      family: familyMatch ? familyMatch[1] : '',
      originDistrict: originMatch ? originMatch[1] : '',
      price: numberFrom(priceMatch?.[1]),
      buyableHere: hereMatch ? hereMatch[1] === '1' : true, // buyable cards (with a handler) omit the attribute entirely — see sample HTML
      stash: numberFrom(stashMatch?.[1]),
    });
  }
  return items;
}

function drowValue(chunk: string, label: string): string {
  const rows = chunk.split('sv2-drow"').slice(1);
  for (const row of rows) {
    if (row.includes(`sv2-dlbl">${label}<`)) {
      const m = row.match(/sv2-dval[^>]*>([^<]+)</);
      return m ? m[1] : '';
    }
  }
  return '';
}

/** Only non-empty once a shipment draft exists. Always exactly 2 cells when
 *  present, one of which may be `.locked`. */
function parseDestinations(html: string): DestinationOption[] {
  const options: DestinationOption[] = [];
  const destStart = html.indexOf('class="sv2-dest');
  if (destStart === -1) return options;

  const section = html.slice(destStart, html.indexOf('</details>', destStart));
  const chunks = section.split('sv2-dcell').slice(1);
  for (const chunk of chunks) {
    const nameMatch = chunk.match(/sv2-dname">([^<]+)</);
    if (!nameMatch) continue;

    options.push({
      district: nameMatch[1],
      // Not trimmed — the class attribute is `sv2-dcell locked"` for a locked cell
      // vs `sv2-dcell"` for an open one, so the leading space is the signal itself;
      // trimming it away first (an earlier version of this did) makes the check
      // always false.
      locked: chunk.startsWith(' locked'),
      baseMinutes: numberFrom(drowValue(chunk, 'Base')),
      courierMinutes: numberFrom(drowValue(chunk, 'With courier')),
      saleRateMult: numberFrom(drowValue(chunk, 'Sale Rate')),
      stateBadge: (chunk.match(/sv2-dstate">([^<]+)</)?.[1]) ?? null,
    });
  }
  return options;
}

/** Only present once a shipment draft exists — the pet currently assigned to it. */
function parseAssignedCourier(html: string): AssignedCourier | null {
  const idx = html.indexOf('class="sv2-load"');
  if (idx === -1) return null;
  // Bounded by the next section's own heading rather than a nesting-depth guess —
  // the banner's own closing tags are too shallow to find reliably by counting
  // `</div>`s, and `sv2-man-head` (Manifest) reliably follows it in every capture.
  const end = html.indexOf('sv2-man-head', idx);
  const chunk = html.slice(idx, end === -1 ? idx + 1000 : end);

  const cancelMatch = html.match(/Game\.smugV2Cancel\((\d+)\)/);
  if (!cancelMatch) return null;

  const nameMatch = chunk.match(/sv2-load-name">([^<]+)</);
  const nums = [...chunk.matchAll(/sv2-load-n"><b[^>]*>([^<]+)</g)].map((m) => m[1]);
  // Text is "X / Y" (loaded / capacity) — capture only the leading count, since
  // numberFrom's digit-only strip would otherwise concatenate both sides into one
  // bogus number (e.g. "30 / 30" -> 3030).
  const manifestMatch = html.match(/sv2-man-count[^"]*">\s*(\d+)/);

  return {
    shipmentId: Number(cancelMatch[1]),
    petName: nameMatch ? nameMatch[1] : '',
    capacity: numberFrom(nums[0]),
    travelPenaltyPct: numberFrom(nums[1]),
    manifestCount: numberFrom(manifestMatch?.[1]),
  };
}

/** Reads the "$X left" line under the Daily Profit monitor. Null (not 0) when the
 *  monitor board isn't present, so callers can tell "unknown" from "genuinely zero
 *  left". */
function parseDailyCapRemaining(html: string): number | null {
  const idx = html.indexOf('Daily Profit');
  if (idx === -1) return null;
  const window = html.slice(idx, idx + 800);
  const match = window.match(/\$([\d,]+)\s*left/);
  return match ? numberFrom(match[1]) : null;
}

/** Reads "Hidden Cargo" — the same account-wide stash cap the DOM adapter reads,
 *  here via a bounded window rather than a scoped element lookup. Scales with
 *  player level, so read fresh each time rather than assumed constant. */
function parseHiddenCargo(html: string): { current: number; max: number } | null {
  const idx = html.indexOf('Hidden Cargo');
  if (idx === -1) return null;
  const window = html.slice(idx, idx + 300);

  const ratio = window.match(/sv2-m-val[^>]*>\s*(\d+)\s*<span[^>]*>\s*\/\s*(\d+)/);
  if (ratio) return { current: Number(ratio[1]), max: Number(ratio[2]) };

  // Overflow state, confirmed real: cancelling/unloading a shipment returns its
  // cargo to the stash without clamping to the cap, so the stash can end up
  // holding *more* than its own max. The monitor then reads "30 held" instead of
  // a ratio, with a warning nearby ("Only 21 can ship per run — 9 stays in your
  // stash") that's the only place `max` still appears in this state — search a
  // wider window since the warning sits outside the monitor tile itself.
  const held = window.match(/sv2-m-val[^>]*>\s*(\d+)\s*<span[^>]*>\s*held/);
  if (held) {
    const capMatch = html.slice(idx, idx + 600).match(/Only (\d+) can ship/);
    if (capMatch) return { current: Number(held[1]), max: Number(capMatch[1]) };
  }

  return null;
}
