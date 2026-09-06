import type { CapturedRequest } from '@/shared/messaging';
import { sendMessage as send } from '@/shared/messaging';
import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';
import { parseStreetIntelAction } from './adapters/streetIntelActionAdapter';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import { recordScoutResponse } from './pageHighlights';

export { initStreetIntelHighlights } from './pageHighlights';

export function handleCapturedRequest(req: CapturedRequest) {
  const url = new URL(req.url, window.location.origin);

  if (req.method === 'POST' && url.pathname.endsWith('/actions/street_intel.php')) {
    // Purely local to this tab's own in-page highlighting (see
    // pageHighlights.ts's `annotateHiddenApproaches`) — never sent to
    // background, unlike the message below.
    if (req.requestBody) recordScoutResponse(req.requestBody, req.responseText);

    const message = parseStreetIntelAction(req.requestBody, req.responseText, req.timestamp);
    if (message) send(message);
    return;
  }

  if (req.method === 'GET' && url.pathname.endsWith('/api/panel.php') && url.searchParams.get('type') === 'street_intel') {
    if (unwrapPanelEnvelope(req.responseText)) {
      send({ type: 'street-intel-viewed', timestamp: req.timestamp });
      recordParseSuccess('streetIntel');
    } else {
      recordParseFailure('streetIntel');
    }
  }
}
