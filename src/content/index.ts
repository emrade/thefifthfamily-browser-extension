import type { CapturedRequest } from '@/shared/messaging';
import { handleCapturedRequest } from './features/tradeAssistant';

// Bridge from the MAIN-world fetch/XHR hook (mainWorldHook.ts) — that script has no
// chrome.* API access, so it can only forward raw bytes via postMessage; all parsing
// and messaging to the background worker happens here, in the isolated world.
//
// Guarded the same way as mainWorldHook.ts: content scripts in the isolated world for
// a given frame share one global object across re-injections, so without this flag a
// dev-time extension reload (with the game tab left open) would leave this listener
// registered twice, double-handling every captured request.
const INSTALL_FLAG = '__ffCapturedRequestListenerInstalled';

if (!(window as unknown as Record<string, boolean>)[INSTALL_FLAG]) {
  (window as unknown as Record<string, boolean>)[INSTALL_FLAG] = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as Partial<CapturedRequest> | undefined;
    if (!data || data.source !== 'ff-network-hook') return;

    handleCapturedRequest(data as CapturedRequest);
  });
}
