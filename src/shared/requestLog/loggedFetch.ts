import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { enqueueRecord } from './queue';

/**
 * Drop-in `fetch` replacement for the background pollers.
 *
 * The MAIN-world hook can only see requests the *page* makes. The market poller,
 * the street-intel poller, and the travel-arrival confirmer all call `fetch`
 * directly from the service worker, so roughly 430 requests a day — a third of all
 * traffic, and the only traffic that exists while the game tab is closed — would
 * be missing from the archive if it were fed by the page hook alone.
 *
 * Logging never affects the caller: the response is returned as soon as it
 * arrives, the body is read from a clone, and every failure below is swallowed
 * after being reported. A broken archive must not break a poller.
 */
export async function loggedFetch(url: string, init?: RequestInit): Promise<Response> {
  const startedAt = Date.now();
  const response = await fetch(url, init);

  void captureInBackground(url, init, response, startedAt);

  return response;
}

async function captureInBackground(url: string, init: RequestInit | undefined, response: Response, startedAt: number): Promise<void> {
  try {
    const { enabled } = await storage.getRequestLogPreferences();
    if (!enabled) return;

    // Cloned before the caller has a chance to consume the original — a Response
    // body is a one-shot stream, and reading it here directly would leave the
    // poller with an already-consumed body.
    const responseText = await response.clone().text();

    enqueueRecord({
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      requestBody: typeof init?.body === 'string' ? init.body : null,
      responseText,
      status: response.status,
      durationMs: Date.now() - startedAt,
      origin: 'background',
      timestamp: startedAt,
    });
  } catch (err) {
    console.error(LOG_PREFIX, 'request log capture failed for background fetch', url, err);
  }
}
