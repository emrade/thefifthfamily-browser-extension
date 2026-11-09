import { STAT_KEYS, type Breakdown, type CarRace, type Quad, type StatSources } from './statBreakdown';

/**
 * Dashboard → Stats → Advisor. Estimates what a change would do to the
 * player's totals.
 *
 * The estimate: a change of X flat points in a stat changes the total by
 * about X × (total ÷ flat sources) for that stat, the player's own bonus
 * rate (Strength ≈ ×1.44 on 2026-11-09). Exact if the percentage bonuses
 * multiply every flat source equally; how they stack isn't published, and
 * source-specific ones (e.g. Bloodline "gear STR %") make it approximate. So
 * the numbers are shown as estimates.
 */

/** Per-stat multiplier from flat points to total. */
export function bonusRates(b: Breakdown): Quad {
  const rate: Quad = { str: 1, def: 1, agi: 1, dex: 1 };
  for (const k of STAT_KEYS) {
    const flat = b.parts.reduce((s, p) => s + p.values[k], 0);
    rate[k] = flat > 0 ? b.total[k] / flat : 1;
  }
  return rate;
}

export interface Crossing {
  /** Which chance moves, and to what. */
  label: string;
  direction: 'up' | 'down';
}

/** Chances a change would push up a step, using the Gym page's own "+N for
 *  the next %" figures. */
export function crossings(src: StatSources, delta: Quad): Crossing[] {
  const g = src.gym;
  if (!g) return [];
  const out: Crossing[] = [];
  const rolls: [keyof Quad, typeof g.block, string][] = [
    ['def', g.block, 'block'],
    ['agi', g.dodge, 'dodge'],
    ['dex', g.crit, 'crit'],
  ];
  for (const [k, roll, what] of rolls) {
    if (!roll) continue;
    const d = Math.round(delta[k]);
    // Losses aren't listed: the Gym only publishes the next step up, so a
    // "may drop" guess appeared on nearly every row and drowned out real gains.
    if (roll.next && d >= roll.next.need) out.push({ label: `reaches ${roll.next.pct}% ${what}`, direction: 'up' });
  }
  return out;
}

export interface VehicleOption {
  name: string;
  vehicleClass: string;
  status: 'equipped' | 'owned' | 'dealer';
  priceCash: number;
  pricePlatinum: number;
  /** False only for an owned car missing parts. */
  complete: boolean;
  stats: Quad;
  /** Estimated change to each total if equipped instead of the current car. */
  delta: Quad;
  powerDelta: number;
  race: CarRace;
  crossings: Crossing[];
}

export function vehicleOptions(src: StatSources, b: Breakdown): VehicleOption[] | null {
  const car = src.car;
  if (!car?.garage || !car.dealer) return null;
  const rate = bonusRates(b);
  const current = car.stats;

  const build = (o: Omit<VehicleOption, 'delta' | 'powerDelta' | 'crossings'>): VehicleOption => {
    const delta: Quad = { str: 0, def: 0, agi: 0, dex: 0 };
    for (const k of STAT_KEYS) delta[k] = (o.stats[k] - current[k]) * rate[k];
    const powerDelta = STAT_KEYS.reduce((s, k) => s + delta[k], 0);
    return { ...o, delta, powerDelta, crossings: o.status === 'equipped' ? [] : crossings(src, delta) };
  };

  // One row per model: the player's copy (best one: equipped, else complete)
  // when owned, otherwise the dealer's.
  const byName = new Map<string, VehicleOption>();
  for (const c of car.garage) {
    const status = c.equipped ? 'equipped' : 'owned';
    const prev = byName.get(c.name);
    if (prev && (prev.status === 'equipped' || (prev.complete && !c.complete)) && !c.equipped) continue;
    byName.set(c.name, build({ name: c.name, vehicleClass: c.vehicleClass, status, priceCash: 0, pricePlatinum: 0, complete: c.complete, stats: c.stats, race: c.race }));
  }
  for (const d of car.dealer) {
    if (byName.has(d.name)) continue;
    byName.set(d.name, build({ name: d.name, vehicleClass: d.vehicleClass, status: 'dealer', priceCash: d.priceCash, pricePlatinum: d.pricePlatinum, complete: true, stats: d.stats, race: d.race }));
  }
  return [...byName.values()].sort((a, b) => (a.status === 'equipped' ? -1 : b.status === 'equipped' ? 1 : b.powerDelta - a.powerDelta));
}
