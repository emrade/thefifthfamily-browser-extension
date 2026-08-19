/**
 * The freshest `_csrf` token observed on any captured request, for the pet-courier
 * automation's own outgoing action calls — see docs/smuggling-v2-plan.md's "CSRF"
 * note and content/index.ts's `csrf-observed` relay.
 *
 * Backed by `chrome.storage.session` (cleared on browser close, survives a
 * service-worker restart mid-session) rather than a plain module-level variable —
 * MV3 kills an idle worker and a fresh one starts with empty module state, which
 * would otherwise silently lose a token the automation still needs minutes later.
 */
const SESSION_KEY = 'ff_csrf_token';

let cached: string | null = null;

export async function setCsrfToken(token: string): Promise<void> {
  if (token === cached) return;
  cached = token;
  await chrome.storage.session.set({ [SESSION_KEY]: token });
}

export async function getCsrfToken(): Promise<string | null> {
  if (cached) return cached;
  const result = await chrome.storage.session.get(SESSION_KEY);
  cached = (result[SESSION_KEY] as string | undefined) ?? null;
  return cached;
}
