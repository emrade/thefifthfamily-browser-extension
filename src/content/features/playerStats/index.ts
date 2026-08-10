import type { CapturedRequest } from '@/shared/messaging';
import { sendMessage as send } from '@/shared/messaging';
import { LOG_PREFIX } from '@/shared/log';
import { parseStatsPayload } from './adapters/statsAdapter';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';

/**
 * Parses `GET /api/stats.php` — lives outside tradeAssistant since the player's
 * current stats/location (surfaced in the always-visible LiveStats view) are used
 * app-wide, not just by the trade loop.
 */
export function handleCapturedRequest(req: CapturedRequest) {
  if (req.method !== 'GET') return;

  const url = new URL(req.url, window.location.origin);
  if (!url.pathname.endsWith('/api/stats.php')) return;

  const snapshot = parseStatsPayload(req.responseText, req.timestamp);
  if (snapshot) {
    send({ type: 'player-stats', snapshot });
    recordParseSuccess('playerStats');
  } else {
    recordParseFailure('playerStats');
    console.error(LOG_PREFIX, 'stats.php captured but failed to parse', req.responseText.slice(0, 200));
  }
}
