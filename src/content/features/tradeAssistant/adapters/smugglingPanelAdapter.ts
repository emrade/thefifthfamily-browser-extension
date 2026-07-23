import { unwrapPanelEnvelope } from '@/content/adapters/panelEnvelope';

/**
 * Parses `GET /api/panel.php?type=smuggling`. This one endpoint returns two distinct
 * response *shapes* for the same `type=` — a normal market listing, or a customs raid
 * screen — decided server-side at fetch time (confirmed: the raid screen is not tied
 * to any particular action, it can come back from a plain reload). We branch on the
 * presence of an actual `class="sgl-raid-screen"` *element* (not just the CSS rule
 * that always ships in the inlined <style> block, which would give a false positive).
 */

export interface SmugglingListing {
  kind: 'listing';
  district: string;
  hiddenCargo: { current: number; max: number };
  borderSeizureRisk: number;
  marketShiftSeconds: number | null;
  entries: {
    item: string;
    isLocal: boolean;
    price: number;
    trendPct: number | null;
    stash: number;
  }[];
}

export interface SmugglingRaid {
  kind: 'raid';
  district: string;
  bribe: number;
}

export type SmugglingPanelResult = SmugglingListing | SmugglingRaid | null;

/**
 * Takes the raw `panel.php` response body (the JSON envelope, not a pre-extracted
 * fragment) — unwrapped via the shared panelEnvelope helper, consistent with every
 * other adapter, all of which receive raw responseText and unwrap it themselves.
 */
export function parseSmugglingPanel(responseText: string): SmugglingPanelResult {
  const envelope = unwrapPanelEnvelope(responseText);
  if (!envelope) return null;

  const html = envelope.html;
  if (html.includes('class="sgl-raid-screen"')) {
    return parseRaidScreen(html);
  }
  return parseListing(html);
}

function parseRaidScreen(html: string): SmugglingRaid | null {
  const districtMatch = html.match(/touching down in\s*<strong[^>]*>([^<]+)<\/strong>/);
  const bribeMatch = html.match(/Bribe Guard\s*\(\$([\d,]+)\)/);
  if (!districtMatch || !bribeMatch) return null;
  return {
    kind: 'raid',
    district: districtMatch[1].trim(),
    bribe: Number(bribeMatch[1].replace(/,/g, '')),
  };
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').trim();
}

function monitorValue(doc: Document, labelSubstring: string): string | null {
  const monitors = Array.from(doc.querySelectorAll('.sgl-monitor'));
  for (const monitor of monitors) {
    const label = monitor.querySelector('.sgl-m-lbl');
    if (label && textOf(label).includes(labelSubstring)) {
      return textOf(monitor.querySelector('.sgl-m-val'));
    }
  }
  return null;
}

function parseListing(html: string): SmugglingListing | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const sectionHeader = textOf(doc.querySelector('.sgl-section'));
  const districtMatch = sectionHeader.match(/Black Market Contacts:\s*(.+)/);
  if (!districtMatch) return null;
  const district = districtMatch[1].trim();

  const cargoRaw = monitorValue(doc, 'Hidden Cargo') ?? '';
  const cargoMatch = cargoRaw.match(/(\d+)\s*\/\s*(\d+)/);
  const hiddenCargo = cargoMatch
    ? { current: Number(cargoMatch[1]), max: Number(cargoMatch[2]) }
    : { current: 0, max: 0 };

  const riskRaw = monitorValue(doc, 'Border Seizure Risk') ?? '';
  const borderSeizureRisk = Number(riskRaw.replace('%', '').trim()) || 0;

  const timerEl = doc.querySelector('#smug-price-timer');
  const marketShiftSeconds = timerEl ? Number(timerEl.getAttribute('data-seconds')) || null : null;

  const entries: SmugglingListing['entries'] = [];
  for (const card of Array.from(doc.querySelectorAll('.sgl-card'))) {
    const item = textOf(card.querySelector('.sgl-c-name'));
    if (!item) continue;

    const origin = textOf(card.querySelector('.sgl-c-origin'));
    const isLocal = origin.includes('You are here');

    const priceText = textOf(card.querySelector('.sgl-c-price'));
    const priceMatch = priceText.match(/\$([\d,]+)/);
    if (!priceMatch) continue;
    const price = Number(priceMatch[1].replace(/,/g, ''));

    const midText = textOf(card.querySelector('.sgl-c-mid'));
    const trendMatch = midText.match(/\(([+-]?\d+)%\)\s*vs wholesale/);
    const trendPct = trendMatch ? Number(trendMatch[1]) : null;

    const stashText = textOf(card.querySelector('.sgl-c-owned strong'));
    const stash = /^\d+$/.test(stashText) ? Number(stashText) : 0;

    entries.push({ item, isLocal, price, trendPct, stash });
  }

  return { kind: 'listing', district, hiddenCargo, borderSeizureRisk, marketShiftSeconds, entries };
}
