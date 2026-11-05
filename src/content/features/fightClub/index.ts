import type { CapturedRequest } from '@/shared/messaging';
import { sendMessage as send } from '@/shared/messaging';
import { parseAttackHubHeroStats } from './adapters/attackHubAdapter';
import { parseRecon } from '@/shared/fightClubRecon';
import { parseFightResult } from '@/shared/goldRun';
import { showObservedRecon } from './reconOverlay';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';

export { initFightClubControls } from './targetControls';
export { initFightClubReconOverlay } from './reconOverlay';

/**
 * Parses `GET /api/panel.php?type=attack_hub` for the player's own hero stats
 * (shown in the popup), and `GET /actions/attack.php?type=recon` for whichever
 * target the player is currently scouting in-game — see reconOverlay.ts for
 * why the latter is worth capturing passively. The target list itself is
 * handled separately, live in the game page's DOM — see targetControls.ts —
 * not through this network-capture path, since sorting/filtering the real
 * cards in place (so Attack buttons stay live) needs to act on the actual
 * rendered elements, not a parsed copy of the response.
 */
export function handleCapturedRequest(req: CapturedRequest) {
  const url = new URL(req.url, window.location.origin);

  // A fight made in the game itself, so Gold Run's counter stays right. Losses
  // and rejections are its to sort out; anything unrecognised is ignored here,
  // since nothing is being spent on the strength of it.
  if (req.method === 'POST' && url.pathname.endsWith('/actions/attack.php')) {
    const targetId = Number(new URLSearchParams(req.requestBody ?? '').get('target_id'));
    let json: unknown = null;
    try {
      json = JSON.parse(req.responseText);
    } catch {
      return;
    }
    const result = parseFightResult(json);
    if (result && targetId) send({ type: 'gold-run-attack-observed', targetId, result });
    return;
  }

  if (req.method !== 'GET') return;

  if (url.pathname.endsWith('/api/panel.php') && url.searchParams.get('type') === 'attack_hub') {
    send({ type: 'gold-run-hub-observed', url: req.url });
    const heroStats = parseAttackHubHeroStats(req.responseText);
    if (heroStats) {
      send({ type: 'fight-stats', heroStats, timestamp: req.timestamp });
      recordParseSuccess('fightClub');
    } else {
      recordParseFailure('fightClub');
    }
    return;
  }

  if (url.pathname.endsWith('/actions/attack.php') && url.searchParams.get('type') === 'recon') {
    const recon = parseRecon(req.responseText, req.timestamp);
    if (recon) {
      showObservedRecon(recon);
      recordParseSuccess('fightClub');
    } else {
      recordParseFailure('fightClub');
    }
  }
}
