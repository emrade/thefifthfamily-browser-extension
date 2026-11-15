/**
 * Archive relay for the game's embedded frames.
 *
 * Several casino games (Blackjack, Baccarat, Roulette, Mines, Plinko) run in
 * same-origin iframes (`/bj/?embed=1`, `/mines/?embed=1`, ...) whose requests
 * the top page never sees. The MAIN-world hook (mainWorldHook.ts) is injected
 * into every frame (`all_frames`), and this script, also in every frame,
 * forwards what it captures inside a frame to the HTTP archive.
 *
 * Archive only: no feature adapters, no page features and no CSRF hand-off run
 * here. The top page keeps all of that in content/index.ts, so nothing a
 * feature does changes because a frame is open. In the top frame this script
 * does nothing; index.ts already relays the top page's requests.
 */

import type { CapturedRequest } from '@/shared/messaging';
import { createArchiveForwarder } from './shared/archiveForwarder';

// Same re-injection guard as index.ts: a dev-time extension reload with the game
// tab left open would otherwise register this listener twice in the frame.
const INSTALL_FLAG = '__ffFrameRelayInstalled';

if (window !== window.top && !(window as unknown as Record<string, boolean>)[INSTALL_FLAG]) {
  (window as unknown as Record<string, boolean>)[INSTALL_FLAG] = true;
  const forward = createArchiveForwarder();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as Partial<CapturedRequest> | undefined;
    if (!data || data.source !== 'ff-network-hook') return;
    forward(data as CapturedRequest);
  });
}
