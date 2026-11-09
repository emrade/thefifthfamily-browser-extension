/**
 * Where the player's four combat stats come from, read from the game's own
 * pages. Feeds Dashboard → Stats.
 *
 * Sources (each stored on its own, with the time it was read):
 * - Gym page (`panel.php?type=gym`): the game's own totals ("after gym, gear,
 *   vehicle, perks & bloodline"), trained base stats, Combat Power and what
 *   each stat buys (block / dodge / crit chance, DEF penetration, DEF
 *   efficiency).
 * - Inventory (`panel.php?type=inventory`): every equipped item's stats
 *   (forge enhancement already included) and the page's gear totals.
 * - Menagerie care tab (`panel.php?type=menagerie&men_tab=care`): the active
 *   pet, whose "In Combat" stats are what the Arena counts.
 * - Chop Shop catalog (`chop_shop_proto.php action=catalog`): the equipped
 *   car's flat bonus to each stat.
 * - Arena lock-in (`arena_v2.php action=preview_loadout`): the stats locked
 *   for the season and the game's full bonus list (Bloodline, Career, Academy,
 *   Family, Vault, Estate, Pets, V2 Vigilantes...). Only sent once a season,
 *   at the lock-in, so it's captured, never requested.
 *
 * Checked 2026-11-09 against the archive and the wiki: an item's stats are its
 * wiki base stats × (1 + forge bonus) (Omertà Rifle +9: 126 → 290 STR); the
 * active pet's "In Combat" stats equal the Arena's "Pets" bonus; Combat Power
 * is the sum of the four totals. How the percentage bonuses stack (one pool or
 * several multipliers) is not settled: several orders fit within 0.6%, so the
 * breakdown shows the game's own total and treats everything the flat sources
 * don't explain as "bonuses", instead of computing a total of its own.
 */

import type { AcademySnapshot, BloodlineSnapshot, CareersSnapshot, PetRoster } from './statAdvisorSources';

export type StatKey = 'str' | 'def' | 'agi' | 'dex';
export const STAT_KEYS: StatKey[] = ['str', 'def', 'agi', 'dex'];
export type Quad = Record<StatKey, number>;

export interface RollChance {
  /** Chance the stat gives right now, %. */
  pct: number;
  tier: number;
  /** Points of the stat still needed for the next whole %, and that %. */
  next: { need: number; pct: number } | null;
}

export interface GymSnapshot {
  at: number;
  total: Quad;
  base: Quad;
  combatPower: number | null;
  combatTier: string | null;
  block: RollChance | null;
  dodge: RollChance | null;
  crit: RollChance | null;
  defPenPct: number | null;
  defEfficiencyPct: number | null;
}

export interface GearItem {
  name: string;
  slot: string;
  enhancement: number;
  stats: Quad;
}

export interface GearSnapshot {
  at: number;
  items: GearItem[];
  /** The inventory's own gear totals and the extra figure beside each. */
  shown: Quad | null;
  shownExtra: Quad | null;
}

export interface PetSnapshot {
  at: number;
  name: string;
  rarity: string;
  trained: Quad;
  inCombat: Quad;
  /** The care tab's point counts and other pets (statAdvisorSources.ts). */
  roster?: PetRoster;
}

export interface CarRace {
  speed: number;
  accel: number;
  handling: number;
}

/** A car the player owns (Chop Shop `cars`). */
export interface GarageCar {
  name: string;
  vehicleClass: string;
  equipped: boolean;
  /** All five parts fitted. Whether an unfinished car still gives its stat
   *  bonus isn't stated anywhere (wiki or archive), so the advisor flags it. */
  complete: boolean;
  stats: Quad;
  race: CarRace;
}

/** A model the dealer sells (Chop Shop `dealer`). */
export interface DealerCar {
  name: string;
  vehicleClass: string;
  stats: Quad;
  race: CarRace;
  priceCash: number;
  pricePlatinum: number;
  owned: boolean;
}

export interface CarSnapshot {
  at: number;
  name: string;
  stats: Quad;
  /** Absent on readings stored before the advisor existed. */
  race?: CarRace;
  garage?: GarageCar[];
  dealer?: DealerCar[];
}

export interface LoadoutBonus {
  type: string;
  value: number;
  source: string;
}

export interface LoadoutSnapshot {
  at: number;
  fighting: Quad;
  level: number | null;
  maxHp: number | null;
  bonuses: LoadoutBonus[];
}

export interface StatSources {
  gym: GymSnapshot | null;
  gear: GearSnapshot | null;
  pet: PetSnapshot | null;
  car: CarSnapshot | null;
  loadout: LoadoutSnapshot | null;
  academy: AcademySnapshot | null;
  bloodline: BloodlineSnapshot | null;
  careers: CareersSnapshot | null;
}

// ── Page text ───────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', middot: '·', times: '×', rsquo: '’', lsquo: '‘', hellip: '…',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Visible text of a page: scripts and styles dropped, tags to spaces,
 *  entities decoded, whitespace collapsed. The game's pages style inline and
 *  carry few classes, so their wording is the steadiest thing to read. */
export function pageText(html: string): string {
  const stripped = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped).replace(/\s+/g, ' ').trim();
}

/** The `html` of a `panel.php` reply. A capture cut at the archive's size
 *  limit isn't valid JSON, so the string is recovered up to the cut. */
export function panelHtml(responseText: string): string | null {
  try {
    const json = JSON.parse(responseText);
    return typeof json?.html === 'string' ? json.html : null;
  } catch {
    const start = responseText.indexOf('"html":"');
    if (start === -1) return null;
    let rest = responseText.slice(start + 8);
    const end = rest.lastIndexOf('"}');
    if (end !== -1 && end > rest.length - 4) rest = rest.slice(0, end);
    // Drop a half-written escape at the cut.
    rest = rest.replace(/\\u[0-9a-fA-F]{0,3}$/, '').replace(/(^|[^\\])(\\\\)*\\$/, '$1$2');
    try {
      return JSON.parse(`"${rest}"`);
    } catch {
      return null;
    }
  }
}

const num = (s: string): number => Number(s.replace(/,/g, ''));

// ── Gym ─────────────────────────────────────────────────────────────────

function rollChance(text: string, roll: string, statName: string): RollChance | null {
  const m = new RegExp(`${roll} Tier (\\d+)/\\d+ ([\\d.]+)% Total ${statName} [\\d,]+(?: / [\\d,]+ \\S* need \\+([\\d,]+) more to reach ([\\d.]+)% ${roll})?`).exec(text);
  if (!m) return null;
  return { pct: Number(m[2]), tier: Number(m[1]), next: m[3] ? { need: num(m[3]), pct: Number(m[4]) } : null };
}

export function parseGym(html: string, at: number): GymSnapshot | null {
  const text = pageText(html);
  const m = /([\d,]+) Strength Base ([\d,]+) ([\d,]+) Defence Base ([\d,]+) ([\d,]+) Agility Base ([\d,]+) ([\d,]+) Dexterity Base ([\d,]+)/.exec(text);
  if (!m) return null;
  const v = m.slice(1).map(num);
  const power = /Combat Power ([\d,]+)/.exec(text);
  const tier = /Combat Tier ([A-Za-z]+)/.exec(text);
  const pen = /DEF Penetration \(Strength\) ([\d.]+)%/.exec(text);
  const eff = /DEF Efficiency \+?([\d.]+)%/.exec(text);
  return {
    at,
    total: { str: v[0], def: v[2], agi: v[4], dex: v[6] },
    base: { str: v[1], def: v[3], agi: v[5], dex: v[7] },
    combatPower: power ? num(power[1]) : null,
    combatTier: tier ? tier[1] : null,
    block: rollChance(text, 'Block', 'Defence'),
    dodge: rollChance(text, 'Dodge', 'Agility'),
    crit: rollChance(text, 'Crit', 'Dexterity'),
    defPenPct: pen ? Number(pen[1]) : null,
    defEfficiencyPct: eff ? Number(eff[1]) : null,
  };
}

// ── Inventory ───────────────────────────────────────────────────────────

const SHORT: Record<string, StatKey> = { STR: 'str', DEF: 'def', AGI: 'agi', DEX: 'dex' };

/** `undefined` when the equipped items couldn't all be read (a capture cut
 *  short before the item list ended), so the caller keeps the copy it has. */
export function parseGear(html: string, at: number): GearSnapshot | undefined {
  const shown: Partial<Quad> = {};
  const extra: Partial<Quad> = {};
  for (const m of html.matchAll(/iv2-tcl"[^>]*>(?:<i[^>]*><\/i>)?\s*(STR|DEF|AGI|DEX)\s*<\/span>\s*<b>([\d,]+)<\/b>(?:\s*<em>\+?([\d,]+)<\/em>)?/g)) {
    shown[SHORT[m[1]]] = num(m[2]);
    if (m[3]) extra[SHORT[m[1]]] = num(m[3]);
  }
  const loadout = /Loadout\s*(?:<[^>]+>\s*)*(\d+)\s*\/\s*(\d+)/.exec(html);
  const expected = loadout ? Number(loadout[1]) : null;

  const items: GearItem[] = [];
  const seen = new Set<number>();
  for (const m of html.matchAll(/\{"id":(\d+),"iid":\d+,"n":"(?:[^"\\]|\\.)*"[^{}]*\}/g)) {
    let o: any;
    try {
      o = JSON.parse(m[0]);
    } catch {
      continue;
    }
    if (o.eq !== 1 || o.k !== 'gear' || !Array.isArray(o.st) || o.st.length !== 4 || seen.has(o.id)) continue;
    seen.add(o.id);
    items.push({
      name: String(o.n),
      slot: String(o.sl ?? o.t ?? ''),
      enhancement: Number(o.e) || 0,
      stats: { str: Number(o.st[0]) || 0, def: Number(o.st[1]) || 0, agi: Number(o.st[2]) || 0, dex: Number(o.st[3]) || 0 },
    });
  }
  if (items.length === 0 || (expected !== null && items.length < expected)) return undefined;
  const full = (q: Partial<Quad>): Quad | null => (STAT_KEYS.every((k) => typeof q[k] === 'number') ? (q as Quad) : null);
  return { at, items, shown: full(shown), shownExtra: full(extra) };
}

// ── Menagerie (care tab) ────────────────────────────────────────────────

/** The active pet, from the care tab's own classes (`men-active-name`,
 *  `men-statline`, `men-buffed-row`). The wording around it (the Feed/Train
 *  buttons) changes with what's been done that day, so it isn't relied on:
 *  the first version keyed off "+180 pts" and failed once the pets were
 *  trained (2026-11-09). */
export function parseActivePet(html: string, at: number): PetSnapshot | null {
  const name = /class="men-active-name"[^>]*>([^<]+)</.exec(html);
  if (!name) return null;
  const rarity = /class="men-active-rarity"[^>]*>([^<]+)</.exec(html);
  const trained: Partial<Quad> = {};
  for (const m of html.matchAll(/men-statline-name"[^>]*>\s*(STR|DEF|AGI|DEX)\s*<[\s\S]*?men-statline-nums"[^>]*>\s*([\d,]+)/g)) {
    trained[SHORT[m[1]]] ??= num(m[2]);
  }
  const combat: Partial<Quad> = {};
  for (const m of html.matchAll(/men-buffed-lbl"[^>]*>\s*(STR|DEF|AGI|DEX)\s*<\/div>([\s\S]*?)<\/div>\s*<\/div>/g)) {
    // With no bonus the row may show only one number.
    const val = /men-buffed-val"[^>]*>\s*([\d,]+)/.exec(m[2]) ?? /men-buffed-raw"[^>]*>\s*([\d,]+)/.exec(m[2]);
    if (val) combat[SHORT[m[1]]] ??= num(val[1]);
  }
  const full = (q: Partial<Quad>): Quad | null => (STAT_KEYS.every((k) => typeof q[k] === 'number') ? (q as Quad) : null);
  const inCombat = full(combat) ?? full(trained);
  if (!inCombat) return null;
  return { at, name: decodeEntities(name[1]).trim(), rarity: rarity ? decodeEntities(rarity[1]).trim() : '', trained: full(trained) ?? inCombat, inCombat };
}

// ── Chop Shop catalog ───────────────────────────────────────────────────

const carStats = (c: any): Quad => ({ str: Number(c.bonus_str) || 0, def: Number(c.bonus_def) || 0, agi: Number(c.bonus_agl) || 0, dex: Number(c.bonus_dex) || 0 });

export function parseEquippedCar(json: any, at: number): CarSnapshot | null {
  const cars: any[] = Array.isArray(json?.cars) ? json.cars : [];
  const car = cars.find((c) => Number(c?.is_equipped) === 1);
  if (!car) return null;
  const race = (c: any): CarRace => ({
    speed: Number(c.race_speed ?? c.base_speed) || 0,
    accel: Number(c.race_accel ?? c.base_accel) || 0,
    handling: Number(c.race_handling ?? c.base_handling) || 0,
  });
  const garage: GarageCar[] = cars.map((c) => ({
    name: String(c.name ?? 'Car'),
    vehicleClass: String(c.vehicle_class ?? ''),
    equipped: Number(c.is_equipped) === 1,
    complete: c.complete === true || Number(c.parts_fitted) >= 5,
    stats: carStats(c),
    race: race(c),
  }));
  const dealer: DealerCar[] = (Array.isArray(json?.dealer) ? json.dealer : []).map((c: any) => ({
    name: String(c.name ?? 'Car'),
    vehicleClass: String(c.vehicle_class ?? ''),
    stats: carStats(c),
    race: { speed: Number(c.base_speed) || 0, accel: Number(c.base_accel) || 0, handling: Number(c.base_handling) || 0 },
    priceCash: Number(c.price_cash) || 0,
    pricePlatinum: Number(c.price_platinum) || 0,
    owned: c.owned === true,
  }));
  return { at, name: String(car.name ?? 'Car'), stats: carStats(car), race: race(car), garage, dealer };
}

// ── Arena lock-in ───────────────────────────────────────────────────────

export function parseLoadout(json: any, at: number): LoadoutSnapshot | null {
  const fs = json?.fighting_stats;
  if (!fs || typeof fs.strength !== 'number') return null;
  const bonuses: LoadoutBonus[] = (Array.isArray(json.bonuses) ? json.bonuses : [])
    .filter((b: any) => typeof b?.type === 'string' && typeof b?.value === 'number')
    .map((b: any) => ({ type: b.type, value: b.value, source: String(b.source ?? '') }));
  return {
    at,
    fighting: { str: fs.strength, def: fs.defence, agi: fs.agility, dex: fs.dexterity },
    level: typeof json.level === 'number' ? json.level : null,
    maxHp: typeof json.max_hp === 'number' ? json.max_hp : null,
    bonuses,
  };
}

// ── Breakdown ───────────────────────────────────────────────────────────

const STAT_OF: Record<string, StatKey> = {
  str: 'str', strength: 'str', def: 'def', defence: 'def', agi: 'agi', agl: 'agi', agility: 'agi', dex: 'dex', dexterity: 'dex',
};

export type BonusKind = 'stat-pct' | 'gear-pct' | 'pet-pct' | 'pet-flat' | 'vigilante-flat' | 'fight' | 'other';

/** What a bonus entry does, and to which stat(s). The type names come from
 *  the game (`combat_str`, `strength`, `vault_strength`, `all_combat`,
 *  `gear_str_pct`, `pet_def_pct`, `pet_str`, `v2vigi_agi`, ...). */
export function classifyBonus(type: string): { kind: BonusKind; stats: StatKey[] } {
  let m: RegExpExecArray | null;
  if (type === 'all_combat') return { kind: 'stat-pct', stats: [...STAT_KEYS] };
  if ((m = /^v2vigi_([a-z]+)$/.exec(type)) && STAT_OF[m[1]]) return { kind: 'vigilante-flat', stats: [STAT_OF[m[1]]] };
  if ((m = /^pet_([a-z]+)_pct$/.exec(type)) && STAT_OF[m[1]]) return { kind: 'pet-pct', stats: [STAT_OF[m[1]]] };
  if ((m = /^pet_([a-z]+)$/.exec(type)) && STAT_OF[m[1]]) return { kind: 'pet-flat', stats: [STAT_OF[m[1]]] };
  if ((m = /^gear_([a-z]+)_pct$/.exec(type)) && STAT_OF[m[1]]) return { kind: 'gear-pct', stats: [STAT_OF[m[1]]] };
  if ((m = /^(?:combat|vault|mastery)_([a-z]+)$/.exec(type)) && STAT_OF[m[1]]) return { kind: 'stat-pct', stats: [STAT_OF[m[1]]] };
  if (STAT_OF[type] && type.length > 3) return { kind: 'stat-pct', stats: [STAT_OF[type]] };
  if (/damage|def_|block|dodge|crit|first_strike|pen|vitality|hp/.test(type)) return { kind: 'fight', stats: [] };
  return { kind: 'other', stats: [] };
}

/** "Bloodline: Heavy Hands" → "Bloodline"; "Pets" → "Pets". */
export function bonusOrigin(source: string): string {
  const i = source.indexOf(':');
  return (i === -1 ? source : source.slice(0, i)).trim();
}

export interface FlatPart {
  key: 'trained' | 'gear' | 'car' | 'pet' | 'vigilantes';
  label: string;
  values: Quad;
  /** When this part was read. */
  at: number;
}

export interface Breakdown {
  total: Quad;
  totalAt: number;
  parts: FlatPart[];
  /** Total minus the flat parts: what the percentage bonuses (and anything
   *  not read yet) add. */
  bonus: Quad;
  /** Percentage bonuses per stat, summed by origin, from the Arena lock-in. */
  pct: Record<StatKey, { origin: string; value: number; entries: LoadoutBonus[] }[]>;
  pctTotal: Quad;
  missing: string[];
}

export function buildBreakdown(src: StatSources): Breakdown | null {
  if (!src.gym) return null;
  const zero = (): Quad => ({ str: 0, def: 0, agi: 0, dex: 0 });
  const parts: FlatPart[] = [{ key: 'trained', label: 'Trained (Gym)', values: src.gym.base, at: src.gym.at }];
  const missing: string[] = [];

  if (src.gear) {
    // The inventory's own totals include an extra figure beyond the items
    // themselves; use them when present so the part matches the game's page.
    const items = zero();
    for (const it of src.gear.items) for (const k of STAT_KEYS) items[k] += it.stats[k];
    parts.push({ key: 'gear', label: 'Gear', values: src.gear.shown ?? items, at: src.gear.at });
  } else missing.push('Inventory');

  if (src.car) parts.push({ key: 'car', label: src.car.name, values: src.car.stats, at: src.car.at });
  else missing.push('Chop Shop');

  if (src.pet) parts.push({ key: 'pet', label: `${src.pet.name} (pet)`, values: src.pet.inCombat, at: src.pet.at });
  else missing.push('Menagerie (Care tab)');

  const vig = zero();
  let hasVig = false;
  const pct: Breakdown['pct'] = { str: [], def: [], agi: [], dex: [] };
  const pctTotal = zero();
  if (src.loadout) {
    for (const b of src.loadout.bonuses) {
      const c = classifyBonus(b.type);
      if (c.kind === 'vigilante-flat') {
        hasVig = true;
        for (const k of c.stats) vig[k] += b.value;
      } else if (c.kind === 'stat-pct') {
        for (const k of c.stats) {
          const origin = b.type === 'all_combat' ? `${bonusOrigin(b.source)} (all stats)` : bonusOrigin(b.source);
          let g = pct[k].find((x) => x.origin === origin);
          if (!g) pct[k].push((g = { origin, value: 0, entries: [] }));
          g.value += b.value;
          g.entries.push(b);
          pctTotal[k] += b.value;
        }
      }
    }
    for (const k of STAT_KEYS) pct[k].sort((a, b) => b.value - a.value);
  } else missing.push('Arena season lock-in');
  if (hasVig && src.loadout) parts.push({ key: 'vigilantes', label: 'V2 Vigilantes', values: vig, at: src.loadout.at });

  const bonus = zero();
  for (const k of STAT_KEYS) bonus[k] = src.gym.total[k] - parts.reduce((s, p) => s + p.values[k], 0);
  return { total: src.gym.total, totalAt: src.gym.at, parts, bonus, pct, pctTotal, missing };
}
