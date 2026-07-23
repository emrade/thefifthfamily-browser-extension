import type { RawStatsPayload } from '@/shared/types';

/** Parses `GET /api/stats.php` — polled frequently by the game itself. */
export function parseStatsPayload(responseText: string, timestamp: number): RawStatsPayload | null {
  let json: any;
  try {
    json = JSON.parse(responseText);
  } catch {
    return null;
  }
  if (!json?.ok || !json.stats) return null;

  const s = json.stats;
  const status = json.status ?? {};
  const travelDestId = Number(status.travel_destination);

  return {
    timestamp,
    cash: Number(s.cash) || 0,
    bank: Number(s.bank) || 0,
    energy: Number(s.energy) || 0,
    maxEnergy: Number(s.max_energy) || 0,
    stamina: Number(s.stamina) || 0,
    maxStamina: Number(s.max_stamina) || 0,
    nerve: Number(s.nerve) || 0,
    maxNerve: Number(s.max_nerve) || 0,
    vitality: Number(s.vitality) || 0,
    maxVitality: Number(s.max_vitality) || 0,
    level: Number(s.level) || 0,
    xp: Number(s.xp) || 0,
    xpToNext: Number(s.xp_to_next) || 0,
    heat: Number(s.heat) || 0,
    currentCityId: Number(s.current_city) || 0,
    travelling: Boolean(status.travelling),
    travelDestinationId: Number.isFinite(travelDestId) && travelDestId > 0 ? travelDestId : null,
    travelSecondsRemaining: Number(status.travel_seconds) || 0,
    jailed: Boolean(status.jailed),
    hospitalized: Boolean(status.hospitalized),
  };
}
