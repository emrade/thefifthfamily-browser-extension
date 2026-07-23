import type { CapturedRequest, ExtensionMessage } from '@/shared/messaging';
import { parseStatsPayload } from './adapters/statsAdapter';
import { parseSmugglingPanel } from './adapters/smugglingPanelAdapter';
import { parseSmugglingAction } from './adapters/smugglingActionAdapter';
import { parseTravelAction } from './adapters/travelAdapter';

const LOG_PREFIX = '[FifthFamily]';

function send(message: ExtensionMessage) {
  chrome.runtime.sendMessage(message).catch((err) => {
    // "Could not establish connection" right after install/reload is expected and
    // harmless (background wasn't ready yet) — anything else is worth seeing.
    console.debug(LOG_PREFIX, 'sendMessage failed for', message.type, err);
  });
}

export function handleCapturedRequest(req: CapturedRequest) {
  const url = new URL(req.url, window.location.origin);
  const path = url.pathname;

  if (path.endsWith('/api/stats.php') && req.method === 'GET') {
    const snapshot = parseStatsPayload(req.responseText, req.timestamp);
    if (snapshot) send({ type: 'player-stats', snapshot });
    else console.warn(LOG_PREFIX, 'stats.php captured but failed to parse', req.responseText.slice(0, 200));
    return;
  }

  if (path.endsWith('/api/panel.php') && url.searchParams.get('type') === 'smuggling') {
    const result = parseSmugglingPanel(req.responseText);
    if (!result) {
      console.warn(LOG_PREFIX, 'smuggling panel captured but failed to parse', req.responseText.slice(0, 200));
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
    else console.debug(LOG_PREFIX, 'smuggling action captured but not a recognized outcome', req.requestBody);
    return;
  }

  if (path.endsWith('/api/travel.php') && req.method === 'POST') {
    const message = parseTravelAction(req.requestBody, req.responseText, req.timestamp);
    if (message) send(message);
    else console.debug(LOG_PREFIX, 'travel action captured but not a recognized outcome', req.requestBody);
    return;
  }

  console.debug(LOG_PREFIX, 'tracked path captured but no adapter claimed it', path);
}
