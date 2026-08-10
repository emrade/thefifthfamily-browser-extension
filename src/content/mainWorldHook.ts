/**
 * Runs in the page's own JS context (manifest "world": "MAIN"), injected at
 * document_start — before the game's own scripts run. This is the only place that
 * can see the game's real `fetch`/`XMLHttpRequest` calls; the isolated content-script
 * world has its own `window` and cannot observe or override the page's network calls.
 *
 * This file does no parsing at all — it only forwards raw request/response bytes to
 * the isolated-world content script via window.postMessage. All parsing lives behind
 * adapters in content/features/tradeAssistant/adapters, run on the other side of that
 * bridge, so the game changing its markup only ever requires updating one adapter.
 */

import { LOG_PREFIX } from '@/shared/log';
import { REQUEST_LOG_MAX_BODY_BYTES } from '@/shared/constants';

const TRACKED_PATH = /^\/(api|actions)\//;

export interface ResolvedCapture {
  href: string;
  /** True for the `/api/` and `/actions/` paths the feature adapters parse. The
   *  archive takes everything same-origin; only feature dispatch is gated on this. */
  tracked: boolean;
}

/**
 * The game calls at least some of its endpoints with bare relative URLs — confirmed
 * from its own injected travel script: `fetch("api/travel.php", ...)`, no leading
 * slash. A regex tested against that raw string would never match `/api/` or
 * `/actions/` (no slash before "api"). Resolving against location first normalizes
 * relative, absolute-path, and full-URL forms alike before we ever test the pattern.
 *
 * Cross-origin requests are dropped outright. They are not the game's own API, and
 * capturing them would put third-party traffic into a file that is meant to be
 * exported and shared.
 */
function resolveCapture(rawUrl: string): ResolvedCapture | null {
  try {
    const resolved = new URL(rawUrl, window.location.href);
    if (resolved.origin !== window.location.origin) return null;
    return { href: resolved.href, tracked: TRACKED_PATH.test(resolved.pathname) };
  } catch {
    return null;
  }
}

/**
 * Bodies are capped here, at the earliest possible point, rather than in the
 * background worker. An oversized response would otherwise be held as a string in
 * the page, copied through structured clone across two message hops, and only then
 * discarded — so trimming late would pay the entire memory cost anyway.
 */
function capBody(text: string): { text: string; truncated: boolean } {
  if (text.length <= REQUEST_LOG_MAX_BODY_BYTES) return { text, truncated: false };
  return { text: text.slice(0, REQUEST_LOG_MAX_BODY_BYTES), truncated: true };
}

function post(
  method: string,
  capture: ResolvedCapture,
  requestBody: string | null,
  responseText: string,
  status: number | null,
  startedAt: number,
) {
  const { text, truncated } = capBody(responseText);
  window.postMessage(
    {
      source: 'ff-network-hook',
      method: method.toUpperCase(),
      url: capture.href,
      tracked: capture.tracked,
      requestBody,
      responseText: text,
      truncated,
      status,
      durationMs: Date.now() - startedAt,
      timestamp: startedAt,
    },
    window.location.origin,
  );
}

async function formDataToString(body: unknown): Promise<string | null> {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    const parts: string[] = [];
    body.forEach((value, key) => {
      parts.push(`${key}=${typeof value === 'string' ? value : '[file]'}`);
    });
    return parts.join('&');
  }
  return null;
}

function installFetchHook() {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = Date.now();
    const response = await originalFetch(input, init);

    try {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const capture = resolveCapture(rawUrl);
      if (capture) {
        // `init.method` misses the method when the caller passes a Request object
        // instead of a URL + init pair, which is legal and which the game may use
        // for any endpoint the adapters don't already cover.
        const method =
          init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET');
        const requestBody = await formDataToString(init?.body);
        const cloned = response.clone();
        cloned.text()
          .then((text) => post(method, capture, requestBody, text, response.status, startedAt))
          .catch((err) => console.error(LOG_PREFIX, 'failed to read response body for', capture.href, err));
      }
    } catch (err) {
      // Never let capture failures break the page's own network calls — but still
      // surface them, since a silent catch here is exactly what let a real bug
      // (relative-URL matching) go undiagnosed until a player noticed missing data.
      console.error(LOG_PREFIX, 'fetch hook error', err);
    }

    return response;
  };
}

function installXhrHook() {
  const OriginalXHR = window.XMLHttpRequest;
  const originalOpen = OriginalXHR.prototype.open;
  const originalSend = OriginalXHR.prototype.send;

  OriginalXHR.prototype.open = function (this: XMLHttpRequest, method: string, url: string, ...rest: unknown[]) {
    (this as unknown as { __ffMethod: string; __ffUrl: string }).__ffMethod = method.toUpperCase();
    (this as unknown as { __ffMethod: string; __ffUrl: string }).__ffUrl = url;
    // @ts-expect-error — forwarding the original variadic signature
    return originalOpen.call(this, method, url, ...rest);
  };

  OriginalXHR.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const self = this as unknown as { __ffMethod?: string; __ffUrl?: string };
    const method = self.__ffMethod ?? 'GET';
    const rawUrl = self.__ffUrl ?? '';
    const capture = resolveCapture(rawUrl);
    const startedAt = Date.now();

    if (capture) {
      this.addEventListener('loadend', () => {
        // `responseText` throws if responseType was set to anything non-text
        // (blob/arraybuffer/json). Harmless for the endpoints the adapters parse,
        // but now that every same-origin XHR is captured, a single such call would
        // otherwise throw inside the game's own loadend handling.
        let responseText: string;
        try {
          responseText = this.responseText;
        } catch {
          return;
        }

        formDataToString(body)
          .then((requestBody) => post(method, capture, requestBody, responseText, this.status, startedAt))
          .catch((err) => console.error(LOG_PREFIX, 'XHR hook error for', capture.href, err));
      });
    }

    return originalSend.call(this, body ?? null);
  };
}

/**
 * Guards against installing the hooks more than once in the same document. Without
 * this, reloading the extension during development while the game tab stays open
 * leaves the old copy of this script still running — it has no chrome.* API calls,
 * so it's never invalidated — and it keeps wrapping fetch/XHR forever. A freshly
 * injected copy then wraps them again on top, so every real request gets posted
 * once per stacked layer (confirmed: a single bribe got recorded 6 times this way).
 */
const INSTALL_FLAG = '__ffNetworkHookInstalled';

if ((window as unknown as Record<string, boolean>)[INSTALL_FLAG]) {
  // This guard only stops *this* injection from stacking a second time — it can't
  // undo hooks a previous injection already installed earlier in this same document
  // (e.g. an unguarded pre-fix version, or any copy from before this tab's last real
  // page load). If you see this, the fix is a full page reload of the game tab, not
  // just re-enabling the extension — only a fresh navigation clears old wrapped
  // fetch/XHR closures still attached to this window.
  console.error(LOG_PREFIX, 'network hook already installed in this document — reload the page to clear stale copies');
} else {
  (window as unknown as Record<string, boolean>)[INSTALL_FLAG] = true;
  installFetchHook();
  installXhrHook();
}
