import type { PlayerIntelMods } from '@/shared/streetIntelPredict';

/**
 * The player's Street Intel bonuses as the game's own Street Intel page shows
 * them, so pre-scout odds stay current without scouting.
 *
 * The page carries, near the top:
 * - "Intel Rank 6/6 · Prestige 5/5 · +12% rank bonus · +31.5% recon"
 * - an Active Bonuses row of pills ("+12% Rank", "+10% Prestige",
 *   "+15% Prestige Loot", "+16% Robbery", ... one per card type).
 *
 * These are the same numbers a scout reports as `rank`, `prestige`, `recon`
 * and `mastery`: replaying every archived scout since 2026-08-21 with the
 * newest page seen before it (and collection from scouts) gave the game's
 * revealed odds exactly on 22,519 of 22,520 approaches without a boost
 * active. Collection isn't on the page, so it stays from scouts.
 *
 * Regex only (the background has no DOM). Anything not found is left out, so
 * a changed layout can't overwrite a known value with a wrong one.
 */
export interface PageBonuses {
  rank: number;
  recon: number;
  prestige: number | null;
  /** Only the card types whose pill was found. */
  mastery: Record<string, number>;
}

const CATEGORIES = ['Robbery', 'Interception', 'Extortion', 'Exploitation', 'Leverage'] as const;
/** How far past the Active Bonuses marker its pills reach (they're a short row). */
const PILLS_SPAN = 6000;

function text(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&middot;|&#183;/g, '·')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : null;
}

/** The Active Bonuses row itself: an element with the class, not the page's
 *  own CSS rule for it (which comes first in the page). */
const PILLS_ROW = /class="[^"]*\bsi-bonuses\b/;

/** Null when the page doesn't carry the rank line (another page, or a changed layout). */
export function parsePageBonuses(html: string): PageBonuses | null {
  const i = html.search(PILLS_ROW);
  if (i < 0) return null;
  const all = text(html);
  const rank = num(all.match(/\+([\d.]+)% rank bonus/)?.[1]);
  const recon = num(all.match(/\+([\d.]+)% recon\b/)?.[1]);
  if (rank === null || recon === null) return null;
  const pills = text(html.slice(i, i + PILLS_SPAN));
  const prestige = num(pills.match(/\+([\d.]+)% Prestige(?! Loot)/)?.[1]);
  const mastery: Record<string, number> = {};
  for (const c of CATEGORIES) {
    const v = num(pills.match(new RegExp(`\\+([\\d.]+)% ${c}\\b`))?.[1]);
    if (v !== null) mastery[c] = v;
  }
  return { rank, recon, prestige, mastery };
}

/**
 * Folds a page read into the stored bonuses. Needs a scout first (for
 * collection); skips a page older than what's stored; keeps any value the
 * page didn't show. Returns `prev` itself when nothing would change.
 */
export function foldPageBonuses(prev: PlayerIntelMods | null, page: PageBonuses, at: number): PlayerIntelMods | null {
  if (!prev || prev.updatedAt > at) return prev;
  const mastery = { ...prev.mastery, ...page.mastery };
  const prestige = page.prestige ?? prev.prestige;
  const same =
    prev.rank === page.rank &&
    prev.recon === page.recon &&
    prev.prestige === prestige &&
    Object.keys(mastery).every((k) => prev.mastery[k] === mastery[k]);
  if (same) return prev;
  return { ...prev, rank: page.rank, recon: page.recon, prestige, mastery, updatedAt: at };
}
