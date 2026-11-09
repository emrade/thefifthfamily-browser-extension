/**
 * Readers for the game pages behind Dashboard → Combat Stats → Advisor's Pet and
 * Bonuses tabs: the Menagerie care tab's other pets, the Academy, the
 * Bloodline and the Careers page. Each keys off the page's own classes where
 * it has them; the Bloodline page has none (inline styles only), so it's
 * matched by node name against the wiki catalogue (data/bloodlineCatalog.json,
 * built by verification/wiki/build_stat_catalogs.py).
 *
 * Checked against real captures from 2026-11-06..09.
 */
import bloodlineCatalog from './data/bloodlineCatalog.json';
import { pageText } from './statBreakdown';

const num = (s: string): number => Number(s.replace(/[$,]/g, ''));

function decode(s: string): string {
  return pageText(s);
}

// ── Pets (care tab: points and the other pets) ──────────────────────────

export interface OtherPet {
  /** The game's id for the pet (from its "Set Active" button). */
  id: number | null;
  name: string;
  rarity: string;
  grownPct: number | null;
  /** Unspent pet points (5 buy 1 stat point). */
  points: number | null;
  perk: string | null;
}

export interface PetRoster {
  /** The active pet's id (from its own Feed button), null if not found. */
  activeId: number | null;
  activePoints: number | null;
  activeStatPointsReady: number | null;
  others: OtherPet[];
}

export function parsePetRoster(html: string): PetRoster {
  const big = [...html.matchAll(/men-points-big"[^>]*>\s*([\d,]+)\s*<\/div>\s*<div class="men-points-lbl"[^>]*>([^<]+)</g)];
  const pick = (label: RegExp) => {
    const m = big.find((b) => label.test(b[2]));
    return m ? num(m[1]) : null;
  };
  const others: OtherPet[] = [];
  for (const m of html.matchAll(/class="men-other-pet"[\s\S]*?(?=class="men-other-pet"|<\/div><\/div><\/div>\s*$|$)/g)) {
    const chunk = m[0];
    const name = /men-other-name"[^>]*>([^<]+)</.exec(chunk);
    if (!name) continue;
    const sub = /men-other-sub"[^>]*>([^<]+)</.exec(chunk);
    const subText = sub ? decode(sub[1]) : '';
    const parts = subText.split('·').map((x) => x.trim());
    const grown = /([\d.]+)% grown/.exec(subText);
    const pts = /([\d,]+) pts/.exec(subText);
    const perk = /men-other-passive"[^>]*>([\s\S]*?)<\/div>/.exec(chunk);
    const id = /menSetActive\((\d+)\)/.exec(chunk);
    others.push({
      id: id ? Number(id[1]) : null,
      name: decode(name[1]),
      rarity: parts[0] ?? '',
      grownPct: grown ? Number(grown[1]) : null,
      points: pts ? num(pts[1]) : null,
      perk: perk ? decode(perk[1]) || null : null,
    });
  }
  // The active pet's own Feed button (menFeed(id)) comes before the list of
  // other pets, which each have one too.
  const listAt = html.indexOf('class="men-other-list"');
  const activeFeed = /menFeed\((\d+)\)/.exec(listAt === -1 ? html : html.slice(0, listAt));
  return { activeId: activeFeed ? Number(activeFeed[1]) : null, activePoints: pick(/PET POINTS/i), activeStatPointsReady: pick(/STAT POINTS/i), others };
}

// ── Academy ─────────────────────────────────────────────────────────────

export type CourseState = 'available' | 'studying' | 'locked';

export interface AcademyLane {
  name: string;
  done: number;
  total: number;
  /** e.g. "+16.00% Strength": the lane's total once complete. */
  fullTotal: string;
  next: {
    name: string;
    reward: string;
    hours: number | null;
    level: number | null;
    cash: number | null;
    gold: number | null;
    state: CourseState;
  } | null;
}

export interface AcademySnapshot {
  at: number;
  lanes: AcademyLane[];
}

export function parseAcademy(html: string, at: number): AcademySnapshot | null {
  const lanes: AcademyLane[] = [];
  const starts = [...html.matchAll(/<details class="acd-drop"[^>]*data-name="([^"]+)"/g)];
  starts.forEach((s, i) => {
    const chunk = html.slice(s.index!, i + 1 < starts.length ? starts[i + 1].index : undefined);
    const prog = /aca-degree-progress"[^>]*>\s*(\d+)\s*\/\s*(\d+)/.exec(chunk);
    const pill = /aca-degree-bonus-pill"[^>]*>([\s\S]*?)<\/div>/.exec(chunk);
    let next: AcademyLane['next'] = null;
    for (const c of chunk.split('<div class="aca-card"').slice(1)) {
      if (/status-done/.test(c)) continue;
      const name = /aca-name"[^>]*>([^<]+)</.exec(c);
      const reward = /title="Reward"[^>]*>([^<]+)</.exec(c);
      const hours = /fa-clock"><\/i>\s*([\d.]+)h/.exec(c);
      const level = /Lv\.(\d+)/.exec(c);
      const cash = /title="Cash tuition"[\s\S]*?\$([\d,]+)/.exec(c);
      const gold = /title="Gold tuition"[\s\S]*?([\d,]+)g\s*</.exec(c);
      const state: CourseState = /academyV2Enroll|>\s*Enroll\s*</.test(c) ? 'available' : /Previous course required|Requires/i.test(c) ? 'locked' : 'studying';
      if (name) {
        next = {
          name: decode(name[1]),
          reward: reward ? decode(reward[1]) : '',
          hours: hours ? Number(hours[1]) : null,
          level: level ? Number(level[1]) : null,
          cash: cash ? num(cash[1]) : null,
          gold: gold ? num(gold[1]) : null,
          state,
        };
      }
      break;
    }
    lanes.push({
      name: decode(s[1]),
      done: prog ? Number(prog[1]) : 0,
      total: prog ? Number(prog[2]) : 0,
      fullTotal: pill ? decode(pill[1]) : '',
      next,
    });
  });
  return lanes.length ? { at, lanes } : null;
}

// ── Bloodline ───────────────────────────────────────────────────────────

export interface BloodlineNode {
  tree: string;
  path: string;
  tier: number;
  name: string;
  category: string;
  capstone: boolean;
  effect: string;
  lp: number;
  level: number;
}

export const BLOODLINE_NODES = bloodlineCatalog as BloodlineNode[];
export const nodeKey = (n: Pick<BloodlineNode, 'tree' | 'tier' | 'name'>) => `${n.tree}|${n.tier}|${n.name}`;

export interface BloodlineSnapshot {
  at: number;
  level: number | null;
  lpAvailable: number | null;
  /** `nodeKey`s of the nodes marked Active. */
  active: string[];
}

/** The page lists, per tier, each node's name and effect and marks the chosen
 *  one "Active". Matched by name from the catalogue: a node is active when
 *  "Active" appears between its name and the next node's. */
export function parseBloodline(html: string, at: number): BloodlineSnapshot | null {
  const text = pageText(html);
  const lp = /Legacy Points .*?(\d+) \/ \d+ Available/.exec(text);
  const level = /Available \d+ spent Level (\d+)/.exec(text) ?? /\bLevel (\d+)\b/.exec(text);
  const found: { node: BloodlineNode; at: number }[] = [];
  for (const node of BLOODLINE_NODES) {
    const i = text.indexOf(`${node.name} `);
    if (i !== -1) found.push({ node, at: i });
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.at - b.at);
  const active: string[] = [];
  found.forEach((f, i) => {
    const end = i + 1 < found.length ? found[i + 1].at : text.length;
    // The marker follows the effect's percentage ("Strength +1.5% Active").
    // Matching a bare "Active" picked up effects like "Active Income +3%".
    if (/\+[\d.]+(?:%|pp)?\s+Active\b/.test(text.slice(f.at + f.node.name.length, Math.min(end, f.at + f.node.name.length + 120)))) active.push(nodeKey(f.node));
  });
  return { at, level: level ? Number(level[1]) : null, lpAvailable: lp ? Number(lp[1]) : null, active };
}

// ── Careers ─────────────────────────────────────────────────────────────

export interface CareerReward {
  rank: number;
  text: string;
  unlocked: boolean;
}

export interface CareerJob {
  id: number;
  name: string;
  level: number | null;
  rankName: string;
  next: { rankName: string; done: number; need: number } | null;
  rewards: CareerReward[];
}

export interface CareersSnapshot {
  at: number;
  jobs: CareerJob[];
}

export function parseCareers(html: string, at: number): CareersSnapshot | null {
  const starts = [...html.matchAll(/id="career-card-(\d+)"/g)];
  const jobs: CareerJob[] = [];
  starts.forEach((s, i) => {
    const chunk = html.slice(s.index!, i + 1 < starts.length ? starts[i + 1].index : undefined);
    const name = /cv2-card-name"[^>]*>([^<]+)</.exec(chunk);
    if (!name) return;
    const lv = /cv2-card-lv"[^>]*>\s*Level (\d+)/.exec(chunk);
    const badge = /cv2-rank-badge"[^>]*>([^<]+)</.exec(chunk);
    const prog = /cv2-prog-head"[^>]*>\s*<span>\s*Next:\s*([^<]+)<\/span>\s*<span>\s*([\d,]+)\s*\/\s*([\d,]+)/.exec(chunk);
    const rewards: CareerReward[] = [];
    for (const r of chunk.matchAll(/<div class="cv2-passive-row([^"]*)"[\s\S]*?cv2-passive-rank"[^>]*>R(\d)<\/span>\s*<div class="cv2-passive-text"[^>]*>([\s\S]*?)<\/div>/g)) {
      rewards.push({ rank: Number(r[2]), text: decode(r[3]), unlocked: !/\blocked\b/.test(r[1]) });
    }
    // A card appears twice when it's also under "Recent": keep the first.
    if (jobs.some((j) => j.id === Number(s[1]))) return;
    jobs.push({
      id: Number(s[1]),
      name: decode(name[1]),
      level: lv ? Number(lv[1]) : null,
      rankName: badge ? decode(badge[1]) : '',
      next: prog ? { rankName: decode(prog[1]), done: num(prog[2]), need: num(prog[3]) } : null,
      rewards,
    });
  });
  return jobs.length ? { at, jobs } : null;
}
