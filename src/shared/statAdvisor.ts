import { STAT_KEYS, type Breakdown, type CarRace, type Quad, type StatKey, type StatSources } from './statBreakdown';
import { BLOODLINE_NODES, nodeKey } from './statAdvisorSources';
import petCatalog from './data/petCatalog.json';

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

// ── Effects ────────────────────────────────────────────────────────────

export type EffectTarget = 'all' | 'gear' | 'pet';

/** What one "+X% Something" bonus does to the four stats, or which fight
 *  number it moves. Economy bonuses (income, smuggling...) return null. */
export type Effect =
  | { kind: 'stat'; target: EffectTarget; stats: StatKey[]; pct: number; label: string }
  | { kind: 'fight'; pct: number; label: string };

const STAT_WORD: Record<string, StatKey> = { strength: 'str', str: 'str', defence: 'def', def: 'def', agility: 'agi', agi: 'agi', dexterity: 'dex', dex: 'dex' };
const FIGHT_WORDS = /damage|block|dodge|crit|efficiency|def pen|penetration|first.strike|max vitality|vitality/;

export function parseEffects(text: string): Effect[] {
  const out: Effect[] = [];
  // "+7% Strength + +3% Attack Damage" (wiki) or "Strength +1.5%" (game page).
  const parts = text.includes('%') ? text.split(/\s\+\s(?=\+)/) : [];
  for (const raw of parts) {
    const m = /\+([\d.]+)\s*(%|pp)\s*(.+)/.exec(raw) ?? /(.+?)\s*\+([\d.]+)\s*(%|pp)/.exec(raw);
    if (!m) continue;
    const [pct, label] = m[1] && /^\d/.test(m[1]) ? [Number(m[1]), m[3]] : [Number(m[2]), m[1]];
    const l = label.trim().toLowerCase().replace(/\s*(%|pct)$/, '').trim();
    let g: RegExpExecArray | null;
    if (l === 'all combat') out.push({ kind: 'stat', target: 'all', stats: [...STAT_KEYS], pct, label: label.trim() });
    else if (STAT_WORD[l]) out.push({ kind: 'stat', target: 'all', stats: [STAT_WORD[l]], pct, label: label.trim() });
    else if (/^all gear stats?$/.test(l)) out.push({ kind: 'stat', target: 'gear', stats: [...STAT_KEYS], pct, label: label.trim() });
    else if (/^all pet stats?$/.test(l)) out.push({ kind: 'stat', target: 'pet', stats: [...STAT_KEYS], pct, label: label.trim() });
    else if ((g = /^gear (str|def|agi|dex)$/.exec(l))) out.push({ kind: 'stat', target: 'gear', stats: [STAT_WORD[g[1]]], pct, label: label.trim() });
    else if ((g = /^pet (str|def|agi|dex)$/.exec(l))) out.push({ kind: 'stat', target: 'pet', stats: [STAT_WORD[g[1]]], pct, label: label.trim() });
    else if (FIGHT_WORDS.test(l)) out.push({ kind: 'fight', pct, label: label.trim() });
  }
  return out;
}

/** Estimated Combat Power from stat effects. A "+X% Strength" adds about X%
 *  of the flat Strength (exact if percentage bonuses share one pool); a gear
 *  or pet % adds X% of that source, which the stat bonuses then multiply. */
export function effectPower(effects: Effect[], b: Breakdown): number | null {
  const rate = bonusRates(b);
  const part = (key: string) => b.parts.find((p) => p.key === key)?.values;
  let total = 0;
  let any = false;
  for (const e of effects) {
    if (e.kind !== 'stat') continue;
    any = true;
    for (const k of e.stats) {
      if (e.target === 'all') total += b.parts.reduce((s, p) => s + p.values[k], 0) * (e.pct / 100);
      else total += (part(e.target)?.[k] ?? 0) * (e.pct / 100) * rate[k];
    }
  }
  return any ? total : null;
}

export function describeEffects(effects: Effect[]): string {
  return effects.map((e) => `+${Number(e.pct.toFixed(2))}% ${e.label}`).join(', ');
}

// ── Bonuses you could still get ────────────────────────────────────────

export type GainStatus = 'now' | 'progress' | 'later' | 'blocked';

export interface Gain {
  source: 'Academy' | 'Bloodline' | 'Career';
  title: string;
  /** For Bloodline tiers: the three choices, best first. */
  choices?: { name: string; effect: string; power: number | null }[];
  effect: string;
  power: number | null;
  /** Bonuses that act in the fight but don't change the four stats. */
  fight: string | null;
  status: GainStatus;
  when: string;
  cost: string | null;
  /** Careers only: the reward comes with your next rank there, so its
   *  shift count is known. Later ranks' thresholds aren't shown by the game. */
  nextRank?: boolean;
}

const money = (v: number) => (v >= 1e6 ? `$${Number((v / 1e6).toFixed(1))}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${v}`);
const hoursText = (h: number) => (h >= 48 ? `${Number((h / 24).toFixed(1))} days` : `${h} h`);

export function bonusGains(src: StatSources, b: Breakdown): Gain[] {
  const level = src.bloodline?.level ?? src.loadout?.level ?? null;
  const gains: Gain[] = [];
  const fightOf = (effects: Effect[]) => {
    const f = effects.filter((e) => e.kind === 'fight');
    return f.length ? describeEffects(f) : null;
  };

  for (const lane of src.academy?.lanes ?? []) {
    const n = lane.next;
    if (!n) continue;
    const effects = parseEffects(n.reward);
    if (!effects.length) continue;
    const tooLow = n.level !== null && level !== null && n.level > level;
    gains.push({
      source: 'Academy',
      title: `${lane.name}: ${n.name}`,
      effect: n.reward,
      power: effectPower(effects, b),
      fight: fightOf(effects),
      status: n.state === 'studying' ? 'progress' : n.state === 'locked' || tooLow ? 'later' : 'now',
      when:
        n.state === 'studying'
          ? 'Studying now'
          : tooLow
            ? `At level ${n.level}`
            : `Course ${lane.done + 1} of ${lane.total}${n.hours ? `, ${hoursText(n.hours)}` : ''}`,
      cost: [n.cash ? money(n.cash) : null, n.gold ? `${n.gold} gold` : null].filter(Boolean).join(' + ') || null,
    });
  }

  if (src.bloodline) {
    const active = new Set(src.bloodline.active);
    const lp = src.bloodline.lpAvailable ?? 0;
    const trees = [...new Set(BLOODLINE_NODES.map((x) => x.tree))];
    for (const tree of trees) {
      const nodes = BLOODLINE_NODES.filter((x) => x.tree === tree);
      const tiers = [...new Set(nodes.map((x) => x.tier))].sort((x, y) => x - y);
      const open = tiers.filter((t) => !nodes.some((x) => x.tier === t && active.has(nodeKey(x))));
      // Every tier you can already reach but haven't taken, plus the next
      // one above your level.
      const reachable = open.filter((t) => level === null || nodes.find((x) => x.tier === t)!.level <= level);
      const nextLocked = open.find((t) => level !== null && nodes.find((x) => x.tier === t)!.level > level);
      for (const t of [...reachable, ...(nextLocked !== undefined ? [nextLocked] : [])]) {
        const opts = nodes.filter((x) => x.tier === t);
        const choices = opts
          .map((x) => {
            const effects = parseEffects(x.effect);
            return { name: x.name, effect: x.effect, power: effectPower(effects, b), combat: effects.length > 0 };
          })
          .sort((x, y) => (y.power ?? (y.combat ? 0 : -1)) - (x.power ?? (x.combat ? 0 : -1)));
        if (!choices.some((c) => c.combat)) continue;
        const cost = opts[0].lp;
        const lvl = opts[0].level;
        const best = choices[0];
        gains.push({
          source: 'Bloodline',
          title: `${tree}, tier ${t}`,
          choices: choices.map(({ name, effect, power }) => ({ name, effect, power })),
          effect: `${best.name}: ${best.effect}`,
          power: best.power,
          fight: best.power === null ? best.effect : null,
          status: level !== null && lvl > level ? 'later' : lp >= cost ? 'now' : 'blocked',
          when: level !== null && lvl > level ? `At level ${lvl}` : lp >= cost ? 'Pick one now' : `Needs ${cost} LP, you have ${lp}`,
          cost: `${cost} LP`,
        });
      }
    }
  }

  for (const job of src.careers?.jobs ?? []) {
    const reward = job.rewards.find((r) => !r.unlocked && parseEffects(r.text).length > 0);
    if (!reward) continue;
    const effects = parseEffects(reward.text);
    const tooLow = job.level !== null && level !== null && job.level > level;
    const nextRankNum = job.rewards.find((r) => !r.unlocked)?.rank ?? null;
    const isNext = nextRankNum === reward.rank && job.next;
    const rankNow = job.rewards.filter((r) => r.unlocked).length;
    gains.push({
      source: 'Career',
      title: job.name,
      effect: `R${reward.rank}: ${reward.text}`,
      power: effectPower(effects, b),
      fight: fightOf(effects),
      status: tooLow ? 'later' : 'progress',
      when: tooLow
        ? `Job unlocks at level ${job.level}`
        : isNext
          ? `${Math.max(0, job.next!.need - job.next!.done)} shifts to ${job.next!.rankName}`
          : rankNow === 0
            ? `Rank ${reward.rank}, job not started`
            : `Rank ${reward.rank}, you're rank ${rankNow} (${job.rankName})`,
      cost: null,
      nextRank: !tooLow && !!isNext,
    });
  }

  const order: Record<GainStatus, number> = { now: 0, progress: 1, blocked: 2, later: 3 };
  return gains.sort(
    (x, y) => order[x.status] - order[y.status] || Number(!!y.nextRank) - Number(!!x.nextRank) || (y.power ?? -1) - (x.power ?? -1),
  );
}

// ── Pets ───────────────────────────────────────────────────────────────

export interface CatalogPet {
  name: string;
  rarity: string;
  group: string;
  price: number | null;
  stats: Quad;
  carries: number | null;
  travel: number | null;
}

export const PET_CATALOG = petCatalog as CatalogPet[];

export interface PetOption {
  name: string;
  rarity: string;
  status: 'active' | 'owned' | 'shop';
  /** Estimated "In Combat" stats (null when the wiki doesn't list the pet). */
  combat: Quad | null;
  delta: Quad | null;
  powerDelta: number | null;
  points: number | null;
  grownPct: number | null;
  perk: string | null;
  price: number | null;
  group: string | null;
}

/** Pet bonus per stat: the active pet's "In Combat" over its own stats. */
function petRates(src: StatSources): Quad {
  const r: Quad = { str: 1, def: 1, agi: 1, dex: 1 };
  const p = src.pet;
  if (!p) return r;
  const known = STAT_KEYS.filter((k) => p.trained[k] >= 5);
  const avg = known.length ? known.reduce((s, k) => s + p.inCombat[k] / p.trained[k], 0) / known.length : 1;
  for (const k of STAT_KEYS) r[k] = p.trained[k] >= 5 ? p.inCombat[k] / p.trained[k] : avg;
  return r;
}

export function petOptions(src: StatSources, b: Breakdown): { options: PetOption[]; spend: { points: number; stat: StatKey; power: number } | null } | null {
  const pet = src.pet;
  if (!pet) return null;
  const rate = bonusRates(b);
  const pr = petRates(src);
  const find = (name: string) => PET_CATALOG.find((c) => c.name.toLowerCase() === name.toLowerCase());
  const build = (o: Omit<PetOption, 'delta' | 'powerDelta'>): PetOption => {
    if (!o.combat || o.status === 'active') return { ...o, delta: null, powerDelta: null };
    const delta: Quad = { str: 0, def: 0, agi: 0, dex: 0 };
    for (const k of STAT_KEYS) delta[k] = (o.combat[k] - pet.inCombat[k]) * rate[k];
    return { ...o, delta, powerDelta: STAT_KEYS.reduce((s, k) => s + delta[k], 0) };
  };
  const scaled = (q: Quad): Quad => ({ str: q.str * pr.str, def: q.def * pr.def, agi: q.agi * pr.agi, dex: q.dex * pr.dex });

  const options: PetOption[] = [];
  const activeCat = find(pet.name);
  options.push(build({ name: pet.name, rarity: pet.rarity, status: 'active', combat: pet.inCombat, points: pet.roster?.activePoints ?? null, grownPct: null, perk: null, price: null, group: activeCat?.group ?? null }));
  for (const o of pet.roster?.others ?? []) {
    const c = find(o.name);
    options.push(build({ name: o.name, rarity: o.rarity, status: 'owned', combat: c ? scaled(c.stats) : null, points: o.points, grownPct: o.grownPct, perk: o.perk, price: null, group: c?.group ?? null }));
  }
  const owned = new Set(options.map((o) => o.name.toLowerCase()));
  for (const c of PET_CATALOG) {
    if (owned.has(c.name.toLowerCase()) || !c.price) continue;
    options.push(build({ name: c.name, rarity: c.rarity, status: 'shop', combat: scaled(c.stats), points: null, grownPct: null, perk: null, price: c.price, group: c.group }));
  }

  // Spare stat points on the active pet: best stat is the one your bonuses
  // multiply most.
  const ready = pet.roster?.activeStatPointsReady ?? 0;
  const bestStat = STAT_KEYS.reduce((best, k) => (pr[k] * rate[k] > pr[best] * rate[best] ? k : best), 'str' as StatKey);
  const spend = ready > 0 ? { points: ready, stat: bestStat, power: ready * pr[bestStat] * rate[bestStat] } : null;
  return { options, spend };
}
