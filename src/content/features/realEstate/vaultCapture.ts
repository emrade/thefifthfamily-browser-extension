import type { CapturedRequest } from '@/shared/messaging';
import { sendMessage } from '@/shared/messaging';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import { parsePropertyVaults, unwrapPanelHtml } from '@/shared/realEstateVaults';

const FEATURE_KEY = 'realEstate';

/**
 * Feeds the Real Estate vault reminder (background/features/realEstate):
 * each Properties panel the game loads (`type=properties`, with or without
 * `properties_tab=v2`; both show the live vault amounts) and each successful
 * Collect / Collect All. Read-only: nothing here sends a game request.
 */
export function handleCapturedRequest(req: CapturedRequest): void {
  const url = new URL(req.url, window.location.origin);
  const path = url.pathname;

  if (req.method === 'GET' && path.endsWith('/api/panel.php') && url.searchParams.get('type') === 'properties') {
    const html = unwrapPanelHtml(req.responseText);
    const vaults = html ? parsePropertyVaults(html) : [];
    if (vaults.length === 0) {
      // A panel with no owned card parsed: either nothing's owned yet or the
      // markup moved. Only the second is a failure worth flagging.
      if (html?.includes('rev2-card owned')) recordParseFailure(FEATURE_KEY);
      return;
    }
    recordParseSuccess(FEATURE_KEY);
    sendMessage({ type: 'real-estate-vaults-observed', at: req.timestamp, vaults });
    return;
  }

  if (req.method === 'POST' && path.endsWith('/actions/properties_v2.php')) {
    const body = new URLSearchParams(req.requestBody ?? '');
    const action = body.get('action');
    if (action !== 'collect_all' && action !== 'collect') return;
    let ok = false;
    try {
      ok = JSON.parse(req.responseText)?.ok === true;
    } catch {
      return;
    }
    if (!ok) return;
    sendMessage({ type: 'real-estate-collected', at: req.timestamp, propertyKey: action === 'collect' ? body.get('property_id') : null });
  }
}
