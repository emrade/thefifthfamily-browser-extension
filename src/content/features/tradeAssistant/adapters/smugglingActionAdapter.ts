import type { ExtensionMessage } from '@/shared/messaging';

/**
 * Parses `POST /actions/smuggling.php` — buy, sell, and the three customs
 * resolutions all share this one endpoint, distinguished by the request body's
 * `action=` field. Every action responds with either `{"ok":true,"message":"..."}`
 * or `{"ok":false,"error":"..."}` — confirmed consistent across buy/sell/customs_run,
 * so we always check `ok` first rather than assuming a `message` field exists.
 */
export function parseSmugglingAction(
  requestBody: string | null,
  responseText: string,
  timestamp: number,
): ExtensionMessage | null {
  if (!requestBody) return null;

  const params = new URLSearchParams(requestBody);
  const action = params.get('action');
  if (!action) return null;

  let json: any;
  try {
    json = JSON.parse(responseText);
  } catch {
    return null;
  }

  switch (action) {
    case 'buy':
      return parseBuy(json, params, timestamp);
    case 'sell':
      return parseSell(json, timestamp);
    case 'customs_bribe':
      return json.ok ? { type: 'customs-resolved', resolution: 'bribe', caught: false, cargoLost: false, jailSeconds: null, timestamp } : null;
    case 'customs_run':
      return parseCustomsRun(json, timestamp);
    case 'customs_surrender':
      return json.ok ? { type: 'customs-resolved', resolution: 'surrender', caught: false, cargoLost: true, jailSeconds: null, timestamp } : null;
    default:
      return null;
  }
}

function parseBuy(json: any, params: URLSearchParams, timestamp: number): ExtensionMessage | null {
  if (!json.ok) return null;
  const qty = Number(params.get('qty'));
  const message: string = json.message ?? '';
  const nameMatch = message.match(/Secured\s+\d+\s+(.+?)!/);
  if (!nameMatch || !Number.isFinite(qty) || qty <= 0) return null;
  return { type: 'trade-buy', item: nameMatch[1].trim(), quantity: qty, timestamp };
}

function parseSell(json: any, timestamp: number): ExtensionMessage | null {
  if (!json.ok) return null;
  const message: string = json.message ?? '';
  const match = message.match(/Sold\s+(\d+)\s+(.+?)\s+for\s+\$([\d,]+)\s*\(\$([\d,]+)\s*profit\)/);
  if (!match) return null;
  return {
    type: 'trade-sell',
    quantity: Number(match[1]),
    item: match[2].trim(),
    sellTotal: Number(match[3].replace(/,/g, '')),
    grossProfit: Number(match[4].replace(/,/g, '')),
    timestamp,
  };
}

function parseCustomsRun(json: any, timestamp: number): ExtensionMessage | null {
  if (json.ok) {
    return { type: 'customs-resolved', resolution: 'run', caught: false, cargoLost: false, jailSeconds: null, timestamp };
  }

  const error: string = json.error ?? '';
  // A precondition failure (e.g. "Need 50 Energy to bolt!") means the attempt never
  // happened — nothing to record. Only a real "caught" outcome is a resolution.
  if (!/busted/i.test(error)) return null;

  const jailMatch = error.match(/Jailed for (\d+)h (\d+)m/);
  const jailSeconds = jailMatch ? Number(jailMatch[1]) * 3600 + Number(jailMatch[2]) * 60 : null;

  return { type: 'customs-resolved', resolution: 'run', caught: true, cargoLost: true, jailSeconds, timestamp };
}
