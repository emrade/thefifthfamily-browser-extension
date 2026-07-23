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

const TRACKED_PATH = /^\/(api|actions)\//;
const LOG_PREFIX = '[FifthFamily]';

/**
 * The game calls at least some of its endpoints with bare relative URLs — confirmed
 * from its own injected travel script: `fetch("api/travel.php", ...)`, no leading
 * slash. A regex tested against that raw string would never match `/api/` or
 * `/actions/` (no slash before "api"). Resolving against location first normalizes
 * relative, absolute-path, and full-URL forms alike before we ever test the pattern.
 */
function resolveTrackedPath(rawUrl: string): string | null {
  try {
    const resolved = new URL(rawUrl, window.location.href);
    return TRACKED_PATH.test(resolved.pathname) ? resolved.href : null;
  } catch {
    return null;
  }
}

function post(method: 'GET' | 'POST', url: string, requestBody: string | null, responseText: string) {
  console.debug(LOG_PREFIX, 'captured', method, url);
  window.postMessage(
    {
      source: 'ff-network-hook',
      method,
      url,
      requestBody,
      responseText,
      timestamp: Date.now(),
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
    const response = await originalFetch(input, init);

    try {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const resolvedUrl = resolveTrackedPath(rawUrl);
      if (resolvedUrl) {
        const method = ((init?.method ?? 'GET').toUpperCase() as 'GET' | 'POST');
        const requestBody = await formDataToString(init?.body);
        const cloned = response.clone();
        cloned.text()
          .then((text) => post(method, resolvedUrl, requestBody, text))
          .catch((err) => console.error(LOG_PREFIX, 'failed to read response body for', resolvedUrl, err));
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
    const method = (self.__ffMethod ?? 'GET') as 'GET' | 'POST';
    const rawUrl = self.__ffUrl ?? '';
    const resolvedUrl = resolveTrackedPath(rawUrl);

    if (resolvedUrl) {
      this.addEventListener('loadend', () => {
        formDataToString(body)
          .then((requestBody) => post(method, resolvedUrl, requestBody, this.responseText))
          .catch((err) => console.error(LOG_PREFIX, 'XHR hook error for', resolvedUrl, err));
      });
    }

    return originalSend.call(this, body ?? null);
  };
}

installFetchHook();
installXhrHook();
