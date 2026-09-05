import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';
import type { CrimeCatalogEntry } from '@/shared/types';

/**
 * DOM-free regex parser for `GET /api/panel.php?type=crimes` — same style and
 * same reason as `careerAuto/careersPanelParser.ts`: this runs in the MV3
 * background service worker, which doesn't reliably have `DOMParser`.
 *
 * Every crime is rendered as one
 * `<div class="crime-card{ maxed}? v2 v2-fam-<family>" id="crime-card-<id>" ...>`
 * — a mastered crime gets the extra ` maxed` class (confirmed from real
 * captures: `"crime-card maxed v2 v2-fam-viola"` vs `"crime-card  v2
 * v2-fam-kito_gumi"`, the latter's doubled space being exactly the space
 * `maxed` would otherwise occupy). Splitting on `'<div class="crime-card '`
 * (the one space common to both forms) isolates each card the same way
 * `careersPanelParser.ts` splits on `id="career-card-`, and only the
 * player's *current*, unlocked district's crimes ever appear in this markup
 * at all — the next district's cards simply don't exist in the HTML until
 * this one's boss is beaten, which is what lets `runner.ts` treat "every
 * card on this page is maxed" as "district complete" with no separate
 * district/boss state to track.
 */
export function parseCrimesCatalog(responseText: string): CrimeCatalogEntry[] {
  const envelope = unwrapPanelEnvelope(responseText);
  if (!envelope) return [];

  const entries: CrimeCatalogEntry[] = [];
  const chunks = envelope.html.split('<div class="crime-card ').slice(1);

  for (const chunk of chunks) {
    const idMatch = chunk.match(/id="crime-card-(\d+)"/);
    if (!idMatch) continue;

    const familyMatch = chunk.match(/v2-fam-([a-z_]+)"/);
    const nameMatch = chunk.match(/crime-name">([^<]+)</);
    const nerveMatch = chunk.match(/data-cost-stat="nerve" data-cost="(\d+)"/);
    if (!nameMatch || !nerveMatch) continue;

    entries.push({
      crimeId: Number(idMatch[1]),
      name: nameMatch[1],
      family: familyMatch ? familyMatch[1] : '',
      nerveCost: Number(nerveMatch[1]),
      // Only the non-maxed form has a second space here (`"crime-card  v2`) —
      // the maxed form's single space is immediately followed by `maxed`, so
      // this chunk (post-split) starts with the literal word rather than
      // another space. See this file's own doc comment for the confirmed
      // real markup this depends on.
      maxed: chunk.startsWith('maxed'),
    });
  }

  return entries;
}
