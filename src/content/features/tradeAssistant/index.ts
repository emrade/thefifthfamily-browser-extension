import type { CapturedRequest, ExtensionMessage } from '@/shared/messaging';
import { parseStatsPayload } from './adapters/statsAdapter';
import { parseSmugglingPanel } from './adapters/smugglingPanelAdapter';
import { parseSmugglingAction } from './adapters/smugglingActionAdapter';
import { parseTravelAction } from './adapters/travelAdapter';

const LOG_PREFIX = '[FifthFamily]';

function send(message: ExtensionMessage) {
  chrome.runtime.sendMessage(message).catch((err) => {
    console.error(LOG_PREFIX, 'sendMessage failed for', message.type, err);
  });
}

export function handleCapturedRequest(req: CapturedRequest) {
  const url = new URL(req.url, window.location.origin);
  const path = url.pathname;

  if (path.endsWith('/api/stats.php') && req.method === 'GET') {
    const snapshot = parseStatsPayload(req.responseText, req.timestamp);
    if (snapshot) send({ type: 'player-stats', snapshot });
    else console.error(LOG_PREFIX, 'stats.php captured but failed to parse', req.responseText.slice(0, 200));
    return;
  }

  if (path.endsWith('/api/panel.php') && url.searchParams.get('type') === 'smuggling') {
    const result = parseSmugglingPanel(req.responseText);
    if (!result) {
      console.error(LOG_PREFIX, 'smuggling panel captured but failed to parse', req.responseText.slice(0, 200));
      return;
    }

    if (result.kind === 'raid') {
      send({ type: 'customs-raid-detected', district: result.district, bribe: result.bribe, timestamp: req.timestamp });
      return;
    }

    send({
      type: 'price-snapshot',
      district: result.district,
      timestamp: req.timestamp,
      borderSeizureRisk: result.borderSeizureRisk,
      hiddenCargo: result.hiddenCargo,
      marketShiftSeconds: result.marketShiftSeconds,
      entries: result.entries.map((e) => ({
        item: e.item,
        price: e.price,
        type: e.isLocal ? 'buy' : 'sell',
        trendPct: e.trendPct,
        stash: e.stash,
      })),
    });
    return;
  }

  if (path.endsWith('/actions/smuggling.php') && req.method === 'POST') {
    const message = parseSmugglingAction(req.requestBody, req.responseText, req.timestamp);
    if (message) send(message);
    // No `else` log here — a null result just means this particular action outcome
    // isn't one we track (e.g. a precondition failure like insufficient cash), which
    // is routine, not an error.
    return;
  }

  if (path.endsWith('/api/travel.php') && req.method === 'POST') {
    const message = parseTravelAction(req.requestBody, req.responseText, req.timestamp);
    if (message) send(message);
    return;
  }
}
