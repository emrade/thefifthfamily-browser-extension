import type { CapturedRequest } from '@/shared/messaging';
import { sendMessage } from '@/shared/messaging';
import { storage } from '@/shared/storage';
import { STORAGE_KEYS } from '@/shared/constants';
import { DEFAULT_REQUEST_LOG_PREFERENCES } from '@/shared/requestLog/preferences';
import { isExcluded } from '@/shared/requestLog/policy';

/**
 * Sends captured requests to the HTTP archive, honouring the player's archive
 * on/off setting and the excluded endpoints. Shared by the top-page relay
 * (content/index.ts) and the game-frame relay (content/frameRelay.ts), so both
 * apply the same rules.
 *
 * The setting is read once and kept current via onChanged, rather than awaited
 * per request: every captured request would otherwise pay a chrome.storage
 * round-trip first. Starting from the default (enabled) means captures in the
 * first moments of page load aren't dropped while the real value is in flight.
 */
export function createArchiveForwarder(): (captured: CapturedRequest) => void {
  let requestLogEnabled = DEFAULT_REQUEST_LOG_PREFERENCES.enabled;
  storage.getRequestLogPreferences().then((prefs) => {
    requestLogEnabled = prefs.enabled;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEYS.REQUEST_LOG_PREFERENCES]) return;
    const next = changes[STORAGE_KEYS.REQUEST_LOG_PREFERENCES].newValue as { enabled?: boolean } | undefined;
    requestLogEnabled = next?.enabled ?? DEFAULT_REQUEST_LOG_PREFERENCES.enabled;
  });

  return (captured) => {
    // Excluded endpoints are filtered here as well as in the background worker.
    // The worker is authoritative, but chat.php and the announcement poll alone
    // account for roughly 40% of all requests, and there is no reason to pay a
    // structured-clone of every response body just to discard it on arrival.
    if (!requestLogEnabled || isExcluded(captured.url)) return;
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
  };
}
