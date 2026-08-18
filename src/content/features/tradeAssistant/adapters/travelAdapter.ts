import type { ExtensionMessage } from '@/shared/messaging';
import type { District } from '@/shared/types';

/** Action values this adapter actually parses — used by the dispatcher to tell "we
 *  recognised this action and failed" from "routine action we don't track" (e.g. an
 *  unverified rename of `cancel`), so only the former counts against feature health. */
export const TRACKED_TRAVEL_ACTIONS = new Set(['get_state', 'start_trip']);

/**
 * Parses `POST /actions/travel_proto.php` — the replacement for `/api/travel.php`
 * since the 2026-08-11 upgrade (see docs/http-archive.md, "When the game changes").
 * Same three-action shape as the endpoint it replaced, but renamed and restructured:
 * `get_cities` → `get_state` (now bundles `current_city`/`now` alongside the city
 * list), `travel` → `start_trip` (keyed by destination **name** in `to=`, not a
 * `city_id` — resolving that name to an id needs the district table, which only
 * background has, so `travel-started` now carries the name and background resolves
 * it in travelNotifier.ts). `cancel` is carried over unverified: no capture of it
 * exists post-upgrade to confirm the action name survived the rename, but an
 * unmatched action just falls through to `default: return null`, same as any other
 * action this adapter doesn't track — so a wrong guess here is silent, not broken.
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
    case 'get_state':
      return parseGetState(json);
    case 'start_trip':
      return parseStartTrip(json, params, timestamp);
    case 'cancel':
      return json.ok ? { type: 'travel-cancelled', timestamp } : null;
    default:
      return null;
  }
}

function parseGetState(json: any): ExtensionMessage | null {
  if (!json?.ok || !Array.isArray(json.cities)) return null;

  const districts: District[] = json.cities.map((c: any) => ({
    id: Number(c.id),
    name: String(c.name),
    slug: String(c.slug),
    nativeItem: null, // learned separately from smuggling-panel captures, preserved by background on upsert
    smugglingBonus: Number(c.smuggling_bonus) || 0,
    bossLocked: Boolean(c.boss_locked),
    levelRequired: Number(c.level_required) || 0,
    // `walk_seconds`/`taxi_minutes`/`taxi_cost` are null for the player's current
    // city (no travel data needed to reach where you already are) — `Number(null)`
    // is 0, so the `|| 0` fallback already does the right thing without special-casing it.
    travelTimeWalk: Number(c.walk_seconds) || 0,
    travelTimeTaxi: Math.round((Number(c.taxi_minutes) || 0) * 60),
    travelCostTaxi: Number(c.taxi_cost) || 0,
  }));

  return { type: 'district-catalog', districts };
}

function parseStartTrip(json: any, params: URLSearchParams, timestamp: number): ExtensionMessage | null {
  if (!json?.ok) return null;
  const method = params.get('method');
  const destinationCityName = typeof json.to === 'string' ? json.to : null;
  if (!destinationCityName || (method !== 'walk' && method !== 'taxi')) return null;

  return {
    type: 'travel-started',
    destinationCityName,
    method,
    // `seconds_remaining` is the response's own precise countdown at capture time —
    // preferred over deriving it from `travel_minutes` (a rounded display value).
    travelTimeSeconds: Number(json.seconds_remaining) || 0,
    timestamp,
  };
}
