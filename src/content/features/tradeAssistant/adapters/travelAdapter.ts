import type { ExtensionMessage } from '@/shared/messaging';
import type { District } from '@/shared/types';

/**
 * Parses `POST /api/travel.php` — a separate file from panel.php/actions/smuggling.php,
 * called directly by inline page script rather than through either of those patterns.
 * Three `action=` values observed: `get_cities` (the authoritative District reference
 * data, fetched passively whenever Travel is opened), `travel` (start a trip), and
 * `cancel`.
 */
export function parseTravelAction(
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
    case 'get_cities':
      return parseGetCities(json);
    case 'travel':
      return parseTravel(json, params, timestamp);
    case 'cancel':
      return json.ok ? { type: 'travel-cancelled', timestamp } : null;
    default:
      return null;
  }
}

function parseGetCities(json: any): ExtensionMessage | null {
  if (!json?.ok || !Array.isArray(json.cities)) return null;

  const districts: District[] = json.cities.map((c: any) => ({
    id: Number(c.id),
    name: String(c.name),
    slug: String(c.slug),
    nativeItem: null, // learned separately from smuggling-panel captures, preserved by background on upsert
    smugglingBonus: Number(c.smuggling_bonus) || 0,
    bossLocked: Boolean(c.boss_locked),
    levelRequired: Number(c.level_required) || 0,
    travelTimeWalk: Number(c.travel_time_walk) || 0,
    travelTimeTaxi: Number(c.travel_time_taxi) || 0,
    travelCostTaxi: Number(c.travel_cost_taxi) || 0,
  }));

  return { type: 'district-catalog', districts };
}

function parseTravel(json: any, params: URLSearchParams, timestamp: number): ExtensionMessage | null {
  if (!json?.ok) return null;
  const cityId = Number(params.get('city_id'));
  const method = params.get('method');
  if (!Number.isFinite(cityId) || (method !== 'walk' && method !== 'taxi')) return null;

  return {
    type: 'travel-started',
    destinationCityId: cityId,
    method,
    travelTimeSeconds: Number(json.travel_time) || 0,
    timestamp,
  };
}
