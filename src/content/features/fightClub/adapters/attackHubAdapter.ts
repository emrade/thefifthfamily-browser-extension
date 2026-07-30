import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';
import type { FightClubHeroStats } from '@/shared/types';

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').trim();
}

function parseIntSafe(text: string): number {
  const n = Number(text.replace(/[^0-9-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parses the hero scoreboard out of `GET /api/panel.php?type=attack_hub` — the
 * player's own Rating/Hits/Lethality/Hall-of-Fame standing, for the popup's
 * quick-glance view. The target list itself isn't parsed here — sorting/filtering
 * targets happens live in the game page's own DOM (see pageSort.ts), not through
 * this network-capture path.
 */
export function parseAttackHubHeroStats(responseText: string): FightClubHeroStats | null {
  const envelope = unwrapPanelEnvelope(responseText);
  if (!envelope) return null;

  const doc = new DOMParser().parseFromString(envelope.html, 'text/html');
  const ratingText = textOf(doc.querySelector('.fc-hero-cell.rating .fc-hero-cell-num'));
  if (!ratingText) return null;

  const rankText = textOf(doc.querySelector('.fc-myrank-pos'));
  const rankMatch = rankText.match(/(\d+)/);

  return {
    rating: parseIntSafe(ratingText),
    hitsLanded: parseIntSafe(textOf(doc.querySelector('.fc-hero-cell.win .fc-hero-cell-num'))),
    hitsFailed: parseIntSafe(textOf(doc.querySelector('.fc-hero-cell.loss .fc-hero-cell-num'))),
    lethalityPct: parseIntSafe(textOf(doc.querySelector('.fc-hero-cell.acc .fc-hero-cell-num'))),
    hallOfFameRank: rankMatch ? Number(rankMatch[1]) : null,
  };
}
