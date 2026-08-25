import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';
import type { CareerCatalogEntry } from '@/shared/types';

/**
 * DOM-free regex parser for `GET /api/panel.php?type=careers`, same style and
 * same reason as `tradeAssistant/smugglingV2RegexParser.ts` — this runs in the
 * MV3 background service worker, which doesn't reliably have `DOMParser`.
 *
 * Every job is rendered as one `<div class="cv2-card" id="career-card-<id>" ...>`
 * — splitting on that id attribute isolates each card's markup with no need to
 * balance tags, exactly like the black-market grid's `.sv2-card` cards.
 *
 * Two things confirmed directly against a real captured panel, not assumed:
 * - A job's Overtime button (`cv2-ot-btn`, carrying its own `data-cost`) simply
 *   doesn't exist in the markup until that job reaches rank 2 — a never-worked
 *   job's card has only the normal Work Shift button. `otAvailable`/
 *   `otEnergyCost` reflect that directly rather than assuming OT is always an
 *   option.
 * - A level-gated card (player level below the job's requirement) renders
 *   `<button class="cv2-work-btn" disabled>...Lv N Required</button>` — no
 *   `onclick`, no `data-cost`, no id reference in it at all. Presence of
 *   `Game.doCareer(<id>)` is what distinguishes a card that's actually workable
 *   right now from one that only exists in the catalog.
 */
export function parseCareersCatalog(responseText: string): CareerCatalogEntry[] {
  const envelope = unwrapPanelEnvelope(responseText);
  if (!envelope) return [];

  // Keyed by careerId, not pushed to an array directly — a worked job (like the
  // account's own "Recent" pick) is rendered twice: once in its own "Recent"
  // section, once again under its family's tab. Both copies are identical, so
  // the first one seen wins rather than showing the same job twice in a picker.
  const byId = new Map<number, CareerCatalogEntry>();
  const chunks = envelope.html.split('id="career-card-').slice(1);

  for (const chunk of chunks) {
    const idMatch = chunk.match(/^(\d+)"/);
    if (!idMatch) continue;
    const careerId = Number(idMatch[1]);
    if (byId.has(careerId)) continue;

    // No `Game.doCareer(id)` handler at all means this card is level-locked —
    // not offered as a choice, since attempting it would fail regardless of
    // what career_id/accuracy/overtime the automation sent.
    if (!chunk.includes(`Game.doCareer(${careerId})`)) continue;

    const nameMatch = chunk.match(/cv2-card-name">([^<]+)</);
    if (!nameMatch) continue;

    const energyMatch = chunk.match(/class="work-btn cv2-work-btn"[^>]*?data-cost="(\d+)"/);
    if (!energyMatch) continue;

    const otMatch = chunk.match(/class="cv2-ot-btn"[^>]*?data-cost="(\d+)"/);

    byId.set(careerId, {
      careerId,
      name: nameMatch[1].trim(),
      energyCost: Number(energyMatch[1]),
      otEnergyCost: otMatch ? Number(otMatch[1]) : null,
      otAvailable: otMatch != null,
    });
  }

  return [...byId.values()];
}
