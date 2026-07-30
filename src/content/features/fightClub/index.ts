import type { CapturedRequest } from '@/shared/messaging';
import { sendMessage as send } from '@/shared/messaging';
import { parseAttackHubHeroStats } from './adapters/attackHubAdapter';

export { initFightClubControls } from './targetControls';

/**
 * Parses `GET /api/panel.php?type=attack_hub` for the player's own hero stats
 * (shown in the popup). The target list itself is handled separately, live in the
 * game page's DOM — see targetControls.ts — not through this network-capture path, since
 * sorting/filtering the real cards in place (so Attack buttons stay live) needs to
 * act on the actual rendered elements, not a parsed copy of the response.
 */
export function handleCapturedRequest(req: CapturedRequest) {
  if (req.method !== 'GET') return;

  const url = new URL(req.url, window.location.origin);
  if (!url.pathname.endsWith('/api/panel.php') || url.searchParams.get('type') !== 'attack_hub') return;

  const heroStats = parseAttackHubHeroStats(req.responseText);
  if (heroStats) send({ type: 'fight-stats', heroStats, timestamp: req.timestamp });
}
