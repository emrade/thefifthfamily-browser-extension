import type { CareerJob, CareersSnapshot } from './statAdvisorSources';
import type { CareerGoal } from './types';

/**
 * Career Advisor: which jobs give which perks, how far each is, and what the
 * player already has. Reads the Careers page snapshot (statAdvisorSources'
 * `parseCareers`). See docs/career-advisor-plan.md.
 */

/** Total shifts a job needs for each rank. Checked on every `career.php`
 *  response in the archives (Aug 10 – Nov 10 2026): promotions to rank 2/3/4/5
 *  came at shifts 10/35/85/185, and rank 1 shows from shift 1. The counts are
 *  running totals: some jobs that were already Expert show a low count toward
 *  Master (their count restarted), so shifts left = threshold − the card's
 *  own count, never derived from the rank. */
export const RANK_SHIFTS: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 1, 2: 10, 3: 35, 4: 85, 5: 185 };

export interface Perk {
  label: string;
  value: number;
  /** '%', 'pp', or '' for a flat amount. */
  unit: string;
}

/** "+4.00% Crime Success", "+1 pp Casino Odds", "+50 Max Vitality Flat". The
 *  R5 row ("Exclusive: <gear>") is not a perk and reads as null. */
export function parsePerk(text: string): Perk | null {
  const m = /^\+\s*([\d.]+)\s*(%|pp)?\s+(.+)$/.exec(text.trim());
  if (!m) return null;
  return { value: Number(m[1]), unit: m[2] ?? '', label: m[3].trim() };
}

/** Caps on each bonus's total from all sources (careers, Academy, Bloodline,
 *  Family Tree, …), from the game's wiki, fetched 2026-11-10. Academy's
 *  "Working Cap" matches the in-game Properties page exactly (Property Income
 *  75%, Passive Income 90%), so it is the cap on the total. Labels are the
 *  Careers page's own. `null` = the wiki says there is no cap. Missing = the
 *  wiki doesn't list one. Re-check with `wiki.py diff academy theft combat`. */
export const PERK_CAPS: Record<string, { cap: number | null; note: string }> = {
  Strength: { cap: 150, note: 'Academy working cap' },
  Defence: { cap: 150, note: 'Academy working cap' },
  Agility: { cap: 150, note: 'Academy working cap' },
  Dexterity: { cap: 150, note: 'Academy working cap' },
  'Max Vitality %': { cap: 200, note: 'Academy working cap' },
  'Crime Success': { cap: 150, note: 'Academy working cap (points)' },
  'Career Pay': { cap: 75, note: 'Academy working cap' },
  'Crime Payout': { cap: 75, note: 'Academy working cap' },
  'Racket Income': { cap: 75, note: 'Academy working cap' },
  'Property Income': { cap: 75, note: 'Academy working cap' },
  'Casino Payout': { cap: 75, note: 'Academy working cap' },
  'Active Income': { cap: 90, note: 'Academy working cap' },
  'Passive Income': { cap: 90, note: 'Academy working cap' },
  'Smuggling Capacity': { cap: 45, note: 'Academy working cap' },
  'Casino Odds': { cap: 5, note: 'Academy working cap (points)' },
  'Gym Speed': { cap: 40, note: 'Academy working cap' },
  'All Gear Stats %': { cap: 12.5, note: 'Academy working cap' },
  'All Pet Stats %': { cap: 12.5, note: 'Academy working cap' },
  'Black Market Discount': { cap: 25, note: 'Academy working cap' },
  'Steal Yield': { cap: 200, note: 'Theft: yield cap' },
  'Steal Protection': { cap: 75, note: 'Theft: protection cap' },
  'Dodge Chance': { cap: 30, note: 'Combat: the whole chance is capped at 30% (family Cap Breakers raise it)' },
  'Block Chance': { cap: 30, note: 'Combat: the whole chance is capped at 30% (family Cap Breakers raise it)' },
  'Critical Chance': { cap: 30, note: 'Combat: the whole chance is capped at 30%' },
  'DEF Efficiency': { cap: null, note: 'Combat: no cap' },
};

/** Families as the wiki and the in-game tabs shorten them. */
export function familyShort(family: string | undefined): string {
  if (!family) return '—';
  if (/^Society for Balance/i.test(family)) return 'SBP';
  if (/^Iron River/i.test(family)) return 'Iron River';
  return family;
}

/** Shifts the job has counted so far: the card's own "Next: X a / b", or
 *  past Master when there's no next rank. */
export function shiftsDone(job: CareerJob): number {
  if (job.next) return job.next.done;
  return job.rewards.length && job.rewards.every((r) => r.unlocked) ? RANK_SHIFTS[5] : 0;
}

export function shiftsLeft(job: CareerJob, targetRank: 1 | 2 | 3 | 4 | 5): number {
  const reward = job.rewards.find((r) => r.rank === targetRank);
  if (reward?.unlocked) return 0;
  return Math.max(0, RANK_SHIFTS[targetRank] - shiftsDone(job));
}

/** Highest rank whose reward row is ticked. */
export function rankReached(job: CareerJob): number {
  return job.rewards.filter((r) => r.unlocked).reduce((m, r) => Math.max(m, r.rank), 0);
}

export function isLocked(job: CareerJob, level: number | null): boolean {
  return job.level !== null && level !== null && job.level > level;
}

export interface Live {
  level: number;
  energy: number;
  maxEnergy: number;
  energyRegenSeconds: number;
}

export interface Estimate {
  shifts: number;
  energy: number | null;
  /** Hours on energy regen alone, counting the energy on hand now. */
  regenHours: number | null;
  /** Hours if energy is never short (items/refills), cooldown alone. */
  fastestHours: number | null;
}

export function estimate(job: CareerJob, targetRank: 1 | 2 | 3 | 4 | 5, live: Live | null): Estimate {
  const shifts = shiftsLeft(job, targetRank);
  const energy = job.energy !== undefined ? shifts * job.energy : null;
  const regenHours =
    energy === null || !live || live.energyRegenSeconds <= 0 ? null : (Math.max(0, energy - live.energy) * live.energyRegenSeconds) / 3600;
  const fastestHours = job.cooldownMin != null ? (Math.max(0, shifts - 1) * job.cooldownMin) / 60 : null;
  return { shifts, energy, regenHours, fastestHours };
}

export interface PerkRow {
  job: CareerJob;
  rank: 1 | 2 | 3 | 4;
  perk: Perk;
  earned: boolean;
  locked: boolean;
  est: Estimate;
  /** Other perks of this job, not yet earned, that come before this one. */
  onTheWay: string[];
}

/** One row per job × perk, R1–R4 only. */
export function perkRows(snapshot: CareersSnapshot | null, live: Live | null): PerkRow[] {
  const rows: PerkRow[] = [];
  for (const job of snapshot?.jobs ?? []) {
    for (const r of job.rewards) {
      if (r.rank < 1 || r.rank > 4) continue;
      const perk = parsePerk(r.text);
      if (!perk) continue;
      const rank = r.rank as 1 | 2 | 3 | 4;
      rows.push({
        job,
        rank,
        perk,
        earned: r.unlocked,
        locked: isLocked(job, live?.level ?? null),
        est: estimate(job, rank, live),
        onTheWay: job.rewards.filter((o) => o.rank < rank && !o.unlocked).map((o) => `R${o.rank} ${o.text}`),
      });
    }
  }
  return rows;
}

export interface PerkTotal {
  label: string;
  unit: string;
  earned: number;
  /** Earned plus everything in jobs open at the player's level. */
  reachable: number;
  /** Every job, at any level. */
  all: number;
  jobs: number;
  jobsEarned: number;
  cap: { cap: number | null; note: string } | undefined;
}

export function perkTotals(rows: PerkRow[]): PerkTotal[] {
  const by = new Map<string, PerkTotal>();
  for (const r of rows) {
    const key = r.perk.label;
    const t =
      by.get(key) ??
      { label: key, unit: r.perk.unit, earned: 0, reachable: 0, all: 0, jobs: 0, jobsEarned: 0, cap: PERK_CAPS[key] };
    t.all += r.perk.value;
    t.jobs += 1;
    if (r.earned) {
      t.earned += r.perk.value;
      t.jobsEarned += 1;
    }
    if (r.earned || !r.locked) t.reachable += r.perk.value;
    by.set(key, t);
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return [...by.values()].map((t) => ({ ...t, earned: round(t.earned), reachable: round(t.reachable), all: round(t.all) }));
}

/** Game day key: the game's day turns over at 23:00 UTC (player midnight,
 *  WAT), so shift by an hour before taking the UTC date. */
export function gameDay(at = Date.now()): string {
  return new Date(at + 3_600_000).toISOString().slice(0, 10);
}

export type GoalState =
  | { kind: 'done' }
  | { kind: 'locked'; level: number }
  | { kind: 'missing' }
  | { kind: 'open'; job: CareerJob };

export function goalState(goal: CareerGoal, snapshot: CareersSnapshot | null, level: number | null): GoalState {
  const job = snapshot?.jobs.find((j) => j.id === goal.careerId);
  if (!job) return { kind: 'missing' };
  if (job.rewards.find((r) => r.rank === goal.targetRank)?.unlocked) return { kind: 'done' };
  if (isLocked(job, level)) return { kind: 'locked', level: job.level! };
  return { kind: 'open', job };
}

export function perkTextAt(job: CareerJob | undefined, rank: number): string {
  return job?.rewards.find((r) => r.rank === rank)?.text ?? `R${rank} perk`;
}

export function formatHours(h: number | null): string {
  if (h === null) return '—';
  if (h <= 0) return 'now';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Number(h.toFixed(1))} h`;
  return `${Number((h / 24).toFixed(1))} days`;
}

export function formatPerkValue(value: number, unit: string): string {
  const v = Number(value.toFixed(2));
  return unit === '%' ? `${v}%` : unit === 'pp' ? `${v} pp` : `${v}`;
}
