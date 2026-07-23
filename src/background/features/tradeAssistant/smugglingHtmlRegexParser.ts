import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';
import type { SmugglingListing, SmugglingRaid, SmugglingPanelResult } from '@/shared/types';

/**
 * A DOM-free reimplementation of content/features/tradeAssistant/adapters/
 * smugglingPanelAdapter.ts's parsing logic, for use by the background market poller.
 * MV3 service workers don't reliably have `DOMParser` (it's a Window-only API in most
 * engines), so background-initiated fetches can't reuse the content script's
 * DOMParser-based adapter. Verified to produce identical output to the DOM-based
 * parser against real captured payloads before being wired in.
 */
export function parseSmugglingPanelRegex(responseText: string): SmugglingPanelResult {
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

function parseListing(html: string): SmugglingListing | null {
  const districtMatch = html.match(/Black Market Contacts:\s*([^<]+)/);
  if (!districtMatch) return null;
  const district = districtMatch[1].trim();

  const cargoMatch = html.match(/Hidden Cargo[\s\S]*?sgl-m-val"[^>]*>\s*(\d+)\s*<span[^>]*>\s*\/\s*(\d+)/);
  const hiddenCargo = cargoMatch
    ? { current: Number(cargoMatch[1]), max: Number(cargoMatch[2]) }
    : { current: 0, max: 0 };

  const riskMatch = html.match(/Border Seizure Risk[\s\S]*?sgl-m-val"[^>]*>\s*(\d+)%/);
  const borderSeizureRisk = riskMatch ? Number(riskMatch[1]) : 0;

  const timerMatch = html.match(/data-seconds="(\d+)"/);
  const marketShiftSeconds = timerMatch ? Number(timerMatch[1]) : null;

  // Splitting on the literal attribute string isolates each card's inner content
  // between delimiters regardless of nested-tag depth — no need to balance tags,
  // since `.sgl-card` blocks are never nested inside one another.
  const entries: SmugglingListing['entries'] = [];
  const cardChunks = html.split('class="sgl-card"').slice(1);
  for (const chunk of cardChunks) {
    const nameMatch = chunk.match(/sgl-c-name">([^<]+)</);
    if (!nameMatch) continue;
    const item = nameMatch[1].trim();

    const originMatch = chunk.match(/class="sgl-c-origin"[^>]*>([\s\S]*?)<\/div>/);
    const originText = originMatch ? originMatch[1] : '';
    const isLocal = originText.includes('You are here');

    const priceMatch = chunk.match(/class="sgl-c-price"[^>]*>[\s\S]*?\$([\d,]+)/);
    if (!priceMatch) continue;
    const price = Number(priceMatch[1].replace(/,/g, ''));

    const trendMatch = chunk.match(/\(([+-]?\d+)%\)\s*vs wholesale/);
    const trendPct = trendMatch ? Number(trendMatch[1]) : null;

    const stashMatch = chunk.match(/sgl-c-owned"[^>]*>[\s\S]*?<strong[^>]*>([^<]+)</);
    const stashText = stashMatch ? stashMatch[1].trim() : '';
    const stash = /^\d+$/.test(stashText) ? Number(stashText) : 0;

    entries.push({ item, isLocal, price, trendPct, stash });
  }

  return { kind: 'listing', district, hiddenCargo, borderSeizureRisk, marketShiftSeconds, entries };
}
