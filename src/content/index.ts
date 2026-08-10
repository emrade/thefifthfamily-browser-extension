import type { CapturedRequest } from '@/shared/messaging';
import { sendMessage } from '@/shared/messaging';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { STORAGE_KEYS } from '@/shared/constants';
import { DEFAULT_REQUEST_LOG_PREFERENCES } from '@/shared/requestLog/preferences';
import { isExcluded } from '@/shared/requestLog/policy';
import { handleCapturedRequest as handlePlayerStats } from './features/playerStats';
import { handleCapturedRequest as handleTradeAssistant } from './features/tradeAssistant';
import { handleCapturedRequest as handleFightClub, initFightClubControls } from './features/fightClub';
import { handleCapturedRequest as handleStreetIntel, initStreetIntelHighlights } from './features/streetIntel';

// Each feature owns the paths it cares about and no-ops on everything else, so every
// captured request is simply offered to all of them — see background/index.ts for the
// matching dispatch on the message side.
const handlers = [handlePlayerStats, handleTradeAssistant, handleFightClub, handleStreetIntel];

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

  // Read once at load and kept current via onChanged, rather than awaited per
  // request. Every captured request would otherwise pay a chrome.storage round-trip
  // before it could be forwarded, on a path that fires for every call the game
  // makes. Starting from the default (enabled) means captures during the first
  // moments of page load aren't dropped while the real value is still in flight.
  let requestLogEnabled = DEFAULT_REQUEST_LOG_PREFERENCES.enabled;
  storage.getRequestLogPreferences().then((prefs) => {
    requestLogEnabled = prefs.enabled;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEYS.REQUEST_LOG_PREFERENCES]) return;
    const next = changes[STORAGE_KEYS.REQUEST_LOG_PREFERENCES].newValue as { enabled?: boolean } | undefined;
    requestLogEnabled = next?.enabled ?? DEFAULT_REQUEST_LOG_PREFERENCES.enabled;
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as Partial<CapturedRequest> | undefined;
    if (!data || data.source !== 'ff-network-hook') return;

    const captured = data as CapturedRequest;

    // Feature adapters see only the `/api/` + `/actions/` paths they were written
    // for. They each re-check the exact pathname anyway, so this gate is an
    // optimization rather than a correctness guard — but without it every image
    // and fragment fetch would be run past four adapters for nothing.
    if (captured.tracked) {
      for (const handle of handlers) handle(captured);
    }

    // The archive, by contrast, deliberately takes everything same-origin: an
    // endpoint no adapter knows about yet is exactly the kind of thing worth
    // having a record of once it turns out to matter.
    // Excluded endpoints are filtered here as well as in the background worker.
    // The worker is authoritative, but chat.php and the announcement poll alone
    // account for roughly 40% of all requests, and there is no reason to pay a
    // structured-clone of every response body just to discard it on arrival.
    if (requestLogEnabled && !isExcluded(captured.url)) {
      sendMessage({
        type: 'request-log',
        method: captured.method,
        url: captured.url,
        requestBody: captured.requestBody,
        responseText: captured.responseText,
        truncated: captured.truncated,
        status: captured.status,
        durationMs: captured.durationMs,
        timestamp: captured.timestamp,
      });
    }
  });

  // Gated by the player's own Settings toggles — each in-page feature only starts
  // watching/injecting into the live page if enabled, checked once at content-script
  // load. Toggling takes effect on the next page load, not live, since it's an
  // init-time decision (whether to start the MutationObserver at all), not
  // something checked per-action the way notification prefs are.
  storage.getPageFeaturePreferences().then((prefs) => {
    if (prefs.fightClubToolbar) {
      initFightClubControls().catch((err) => console.error(LOG_PREFIX, 'initFightClubControls failed', err));
    }
    if (prefs.streetIntelHighlights) {
      initStreetIntelHighlights();
    }
  });
}
