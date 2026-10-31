import rosterData from '@/shared/data/arenaRoster.json';

/**
 * Arena Mastery: clearing every boss of one tier in a family pays a permanent
 * bonus to that family's stat (Iron River STR, SBP DEF, Kito-gumi DEX, Viola
 * AGI: +1/+2/+3/+4% for Commons/Uncommons/Rares/Legendary; Volkskaya all
 * combat stats, +0.25/+0.5/+0.75/+1%). Partial tiers pay nothing. Clearing a
 * tier also adds the family's next tier to the boss pool, so the only bosses
 * a family can offer are those of its lowest uncleared tier and below.
 *
 * Which bosses are beaten is the game's own record: the Ticket Exchange page
 * (`panel.php?type=arena&av2_view=shop`) marks each boss's exclusive unlocked
 * once that boss is beaten (`data-unlocked="1"`), and states each family's
 * tier counts and Mastery earned. Read whenever the player opens it; each
 * boss win after that is folded in live (content/features/arena/mastery.ts).
 * Tiers and draw % come from the game's wiki (`arenaRoster.json`, built by
 * verification/arena/build_arena_roster.py) — the Exchange shows the
 * exclusive's rarity, which isn't the boss's tier.
 */

export type MasteryTier = 'common' | 'uncommon' | 'rare' | 'legendary';
export const MASTERY_TIERS: MasteryTier[] = ['common', 'uncommon', 'rare', 'legendary'];
export const MASTERY_TIER_LABEL: Record<MasteryTier, string> = {
  common: 'Commons',
  uncommon: 'Uncommons',
  rare: 'Rares',
  legendary: 'Legendary',
};

export interface RosterFamily {
  name: string;
  /** "STR", "DEF", "AGI", "DEX" or "All Combat". */
  stat: string;
  max: number;
  tierBonus: Record<MasteryTier, number>;
}

export interface RosterBoss {
  name: string;
  family: string;
  tier: MasteryTier;
  item: string | null;
  slot: string;
  rarity: string;
  stats: { str: number; def: number; agi: number; dex: number };
  tickets: number;
  /** Chance of being the page's boss, % (the wiki's "Draw"). */
  draw: number;
}

const ROSTER = rosterData as { families: RosterFamily[]; bosses: RosterBoss[] };
export const ROSTER_FAMILIES = ROSTER.families;
export const ROSTER_BOSSES = ROSTER.bosses;
const BOSS_BY_NAME = new Map(ROSTER.bosses.map((b) => [normalizeName(b.name), b]));

function normalizeName(name: string): string {
  return name.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

export function rosterBoss(name: string): RosterBoss | null {
  return BOSS_BY_NAME.get(normalizeName(name)) ?? null;
}

/** Stored in chrome.storage.local (see `storage.getArenaMastery`). */
export interface ArenaMasteryState {
  /** When the Ticket Exchange was last read — null until it has been once. */
  syncedAt: number | null;
  ticketsHeld: number | null;
  /** Roster names of every boss beaten (the Exchange's record, plus wins since). */
  beaten: string[];
  /** Boss wins recorded live since the last Exchange read, for the tab's note. */
  winsSinceSync: number;
}

export const EMPTY_ARENA_MASTERY: ArenaMasteryState = { syncedAt: null, ticketsHeld: null, beaten: [], winsSinceSync: 0 };

export interface ExchangeSnapshot {
  ticketsHeld: number | null;
  /** Every boss card on the page, by the boss's name ("taken from …"). */
  bosses: { name: string; beaten: boolean }[];
  /** The page's own per-family tier counts, for a sanity check against the roster. */
  families: { name: string; tiers: Partial<Record<MasteryTier, { done: number; total: number }>> }[];
}

function decode(text: string): string {
  return text
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&middot;/g, '·')
    .trim();
}

const CHIP_TIER: Record<string, MasteryTier> = { Commons: 'common', Uncommons: 'uncommon', Rares: 'rare', Legendary: 'legendary' };

/** DOM-free read of the Ticket Exchange page's HTML (the panel's `html`).
 *  Null when it doesn't look like the Exchange at all. */
export function parseTicketExchange(html: string): ExchangeSnapshot | null {
  if (!html.includes('tx-card') || !html.includes('tx-fam')) return null;
  const tickets = html.match(/class="tx-counter"><b>([\d,]+)<\/b>/);
  const snapshot: ExchangeSnapshot = { ticketsHeld: tickets ? Number(tickets[1].replace(/,/g, '')) : null, bosses: [], families: [] };

  for (const section of html.split('<div class="tx-fam"').slice(1)) {
    const name = section.match(/<h3>([^<]+)<\/h3>/);
    if (!name) continue;
    const tiers: ExchangeSnapshot['families'][number]['tiers'] = {};
    for (const chip of section.matchAll(/<span class="mc-t">([^<]+)<\/span><span class="mc-c">(\d+)\/(\d+)<\/span>/g)) {
      const tier = CHIP_TIER[chip[1].trim()];
      if (tier) tiers[tier] = { done: Number(chip[2]), total: Number(chip[3]) };
    }
    snapshot.families.push({ name: decode(name[1]), tiers });
    for (const card of section.split('<div class="tx-card').slice(1)) {
      const boss = card.match(/class="tx-took">taken from<b>([^<]+)<\/b>/);
      const unlocked = card.match(/data-unlocked="(\d)"/);
      if (boss && unlocked) snapshot.bosses.push({ name: decode(boss[1]), beaten: unlocked[1] === '1' });
    }
  }
  return snapshot.bosses.length ? snapshot : null;
}

/** The state after reading the Exchange: its record replaces ours. */
export function stateFromExchange(snapshot: ExchangeSnapshot, at: number): ArenaMasteryState {
  const beaten = snapshot.bosses.filter((b) => b.beaten).map((b) => rosterBoss(b.name)?.name ?? b.name);
  return { syncedAt: at, ticketsHeld: snapshot.ticketsHeld, beaten: [...new Set(beaten)], winsSinceSync: 0 };
}

/** A boss win seen live. Unknown names (not in the roster) are ignored. */
export function stateWithWin(state: ArenaMasteryState, bossName: string): ArenaMasteryState {
  const boss = rosterBoss(bossName);
  if (!boss || state.beaten.includes(boss.name)) return state;
  return { ...state, beaten: [...state.beaten, boss.name], winsSinceSync: state.winsSinceSync + 1 };
}

export interface FamilyMastery {
  family: RosterFamily;
  /** Bonus earned: the sum of every fully cleared tier's. */
  earned: number;
  tiers: { tier: MasteryTier; done: number; total: number; bonus: number; complete: boolean; unlocked: boolean }[];
  /** The lowest uncleared tier (bosses of higher tiers can't be drawn yet); null when all four are clear. */
  current: MasteryTier | null;
  /** Unbeaten bosses of `current`, most often drawn first. */
  needed: RosterBoss[];
}

export function familyMastery(state: ArenaMasteryState): FamilyMastery[] {
  const beaten = new Set(state.beaten);
  return ROSTER_FAMILIES.map((family) => {
    let earned = 0;
    let current: MasteryTier | null = null;
    const tiers = MASTERY_TIERS.map((tier) => {
      const bosses = ROSTER_BOSSES.filter((b) => b.family === family.name && b.tier === tier);
      const done = bosses.filter((b) => beaten.has(b.name)).length;
      const complete = done === bosses.length;
      const unlocked = current === null; // every tier up to and including the first uncleared one
      if (complete && current === null) earned += family.tierBonus[tier];
      else if (current === null) current = tier;
      return { tier, done, total: bosses.length, bonus: family.tierBonus[tier], complete, unlocked };
    });
    const needed = current
      ? ROSTER_BOSSES.filter((b) => b.family === family.name && b.tier === current && !beaten.has(b.name)).sort((a, b) => b.draw - a.draw)
      : [];
    return { family, earned, tiers, current, needed };
  });
}

/** Whether beating `bossName` moves its family's Mastery forward — it's an
 *  unbeaten boss of the family's current tier. Null otherwise, or before the
 *  Exchange has been read (an incomplete record would mislabel bosses). */
export function neededForMastery(
  state: ArenaMasteryState | null,
  bossName: string,
): { family: RosterFamily; tier: MasteryTier; bonus: number; left: number } | null {
  if (!state?.syncedAt) return null;
  const boss = rosterBoss(bossName);
  if (!boss) return null;
  const fm = familyMastery(state).find((f) => f.family.name === boss.family);
  if (!fm || fm.current !== boss.tier || !fm.needed.some((b) => b.name === boss.name)) return null;
  return { family: fm.family, tier: boss.tier, bonus: fm.family.tierBonus[boss.tier], left: fm.needed.length };
}
