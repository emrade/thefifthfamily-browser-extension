import type { ExtensionMessage } from '@/shared/messaging';

/**
 * Parses `POST /actions/street_intel.php` — scout/attempt/complication all share
 * this one endpoint, distinguished by the request body's `action=` field, same
 * pattern as smuggling.php. Only `attempt` is tracked here, purely as a signal that
 * the player is actively using Street Intel (see the 'street-intel-viewed' message).
 */
export function parseStreetIntelAction(
  requestBody: string | null,
  responseText: string,
  timestamp: number,
): ExtensionMessage | null {
  if (!requestBody) return null;
  if (new URLSearchParams(requestBody).get('action') !== 'attempt') return null;

  let json: any;
  try {
    json = JSON.parse(responseText);
  } catch {
    return null;
  }

  return json?.ok ? { type: 'street-intel-viewed', timestamp } : null;
}
