import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { enqueueRecord } from './queue';

/**
 * Drop-in `fetch` replacement for the background pollers.
 *
 * The MAIN-world hook can only see requests the *page* makes. The market poller,
 * the street-intel poller, the travel-arrival confirmer, and the career/street-intel
 * auto-runners all call `fetch` directly from the service worker, so this traffic —
 * the only traffic that exists while the game tab is closed — would be missing from
 * the archive if it were fed by the page hook alone.
 *
 * Logging never affects the caller: the response is returned as soon as it
 * arrives, the body is read from a clone, and every failure below is swallowed
 * after being reported. A broken archive must not break a poller.
 *
 * **Bug fixed here**: the clone used to happen *inside* `captureInBackground`,
 * after an `await storage.getRequestLogPreferences()` — i.e. after control had
 * already been yielded back to this function's own caller, who (every real
 * caller does this) immediately calls `.json()`/`.text()` on the response the
 * moment it gets it back. `Response.clone()` throws once the body is locked/
 * consumed, so that await was a race this side reliably lost: every single
 * background-initiated request, confirmed against a real archive export,
 * showed 0 of 571 rows as `origin: "background"` — 100%, not intermittent,
 * because the caller's own body-read function is always synchronously right
 * there and always wins. The clone now happens synchronously, before this
 * function even returns the response to its caller, so there's no race left
 * to lose.
 */
export async function loggedFetch(url: string, init?: RequestInit): Promise<Response> {
  const startedAt = Date.now();
  const response = await fetch(url, init);

  // Cloned *before* returning to the caller — by the time captureInBackground
  // gets around to reading it (after an await), the original may already be
  // locked or fully consumed by whatever the caller did with it in the
  // meantime, but this clone has its own independent, untouched body.
  const clonedForLog = response.clone();
  void captureInBackground(url, init, clonedForLog, startedAt);

  return response;
}

async function captureInBackground(url: string, init: RequestInit | undefined, clonedResponse: Response, startedAt: number): Promise<void> {
  try {
    const { enabled } = await storage.getRequestLogPreferences();
    if (!enabled) return;

    const responseText = await clonedResponse.text();

    enqueueRecord({
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      requestBody: typeof init?.body === 'string' ? init.body : null,
      responseText,
      status: clonedResponse.status,
      durationMs: Date.now() - startedAt,
      origin: 'background',
      timestamp: startedAt,
    });
  } catch (err) {
    console.error(LOG_PREFIX, 'request log capture failed for background fetch', url, err);
  }
}
