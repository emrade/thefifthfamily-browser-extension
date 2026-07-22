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

const TRACKED_PATH = /\/(api|actions)\//;

function post(method: 'GET' | 'POST', url: string, requestBody: string | null, responseText: string) {
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
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (TRACKED_PATH.test(url)) {
        const method = ((init?.method ?? 'GET').toUpperCase() as 'GET' | 'POST');
        const requestBody = await formDataToString(init?.body);
        const cloned = response.clone();
        cloned.text().then((text) => post(method, url, requestBody, text)).catch(() => {});
      }
    } catch {
      // Never let capture failures break the page's own network calls.
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
    const url = self.__ffUrl ?? '';

    if (TRACKED_PATH.test(url)) {
      this.addEventListener('loadend', () => {
        try {
          formDataToString(body).then((requestBody) => post(method, url, requestBody, this.responseText));
        } catch {
          // Ignore capture failures.
        }
      });
    }

    return originalSend.call(this, body ?? null);
  };
}

installFetchHook();
installXhrHook();
