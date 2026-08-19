import type { CapturedRequest } from '@/shared/messaging';
import { sendMessage as send } from '@/shared/messaging';
import { LOG_PREFIX } from '@/shared/log';
import { parseSmugglingPanel } from './adapters/smugglingPanelAdapter';
import { parseSmugglingV2Panel } from './adapters/smugglingV2PanelAdapter';
import { parseSmugglingAction } from './adapters/smugglingActionAdapter';
import { parseTravelAction, TRACKED_TRAVEL_ACTIONS } from './adapters/travelAdapter';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';

export function handleCapturedRequest(req: CapturedRequest) {
  const url = new URL(req.url, window.location.origin);
  const path = url.pathname;

  if (path.endsWith('/api/panel.php') && url.searchParams.get('type') === 'smuggling' && url.searchParams.get('smug_tab') === 'proto') {
    const snapshot = parseSmugglingV2Panel(req.responseText);
    if (!snapshot) {
      recordParseFailure('tradeAssistant');
      return;
    }
    recordParseSuccess('tradeAssistant');
    // Most captures don't show the roster at all (see the adapter's own doc
    // comment) — only send when there's actually something to persist.
    if (snapshot.roster.length > 0) {
      send({ type: 'pet-roster-observed', entries: snapshot.roster });
    }
    return;
  }

  if (path.endsWith('/api/panel.php') && url.searchParams.get('type') === 'smuggling') {
    const result = parseSmugglingPanel(req.responseText);
    if (!result) {
      recordParseFailure('tradeAssistant');
      console.error(LOG_PREFIX, 'smuggling panel captured but failed to parse', req.responseText.slice(0, 200));
      return;
    }
    recordParseSuccess('tradeAssistant');

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

  if (path.endsWith('/actions/travel_proto.php') && req.method === 'POST') {
    const message = parseTravelAction(req.requestBody, req.responseText, req.timestamp);
    if (message) {
      send(message);
      recordParseSuccess('tradeAssistant');
    } else if (req.requestBody && TRACKED_TRAVEL_ACTIONS.has(new URLSearchParams(req.requestBody).get('action') ?? '')) {
      // A recognised action (get_state/start_trip) that still failed to parse is a
      // real signal — anything else (an untracked action, or `cancel`, whose name
      // survived the rename unverified) is routine, same as the smuggling-action
      // branch above.
      recordParseFailure('tradeAssistant');
    }
    return;
  }
}
