import type { CapturedRequest } from '@/shared/messaging';
import { handleCapturedRequest } from './features/tradeAssistant';

// Bridge from the MAIN-world fetch/XHR hook (mainWorldHook.ts) — that script has no
// chrome.* API access, so it can only forward raw bytes via postMessage; all parsing
// and messaging to the background worker happens here, in the isolated world.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as Partial<CapturedRequest> | undefined;
  if (!data || data.source !== 'ff-network-hook') return;

  handleCapturedRequest(data as CapturedRequest);
});
