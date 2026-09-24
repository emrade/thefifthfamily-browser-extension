import type { CapturedRequest } from '@/shared/messaging';
import { injectStyleOnce } from '@/content/shared/injectStyle';
import { LOG_PREFIX } from '@/shared/log';
import { STORAGE_KEYS } from '@/shared/constants';
import { storage } from '@/shared/storage';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import {
  foldFight,
  isRecommended,
  profileFromPreview,
  sampleFromAttack,
  verdictFor,
  type ArenaOpponentCard,
  type ArenaVerdict,
} from '@/shared/arenaCombat';
import type { ArenaMyProfile } from '@/shared/types';

/**
 * The Arena fight advisor: badges every live opponent and the boss
 * Beatable / Coin-flip / Avoid from the stats already on their card, numbers
 * the attack order (riskiest first, the player's own way of playing: an
 * early loss only costs a small pot), and puts a one-line plan above the
 * cards: the order, what to do about the boss, and when the free Refresh is
 * worth it. The model and its evidence are in docs/arena-combat-mechanics.md
 * and shared/arenaCombat.ts. The game's own "% CHANCE" badge is left alone;
 * it's repeated in each badge's hover text.
 *
 * The player's own season numbers come from captured responses: the season
 * lock-in's `preview_loadout` gives an estimate, and every `attack`
 * response's combat log gives the real values, which replace it from the
 * first fight on. Captured regardless of whether the badges are switched on,
 * so the Arena panel can show them too.
 *
 * Read-only: nothing here sends a request.
 */

const FEATURE_KEY = 'arena';
const STYLE_ID = 'ff-arena-advisor-style';
const BANNER_ID = 'ff-arv-banner';
const BADGE_CLASS = 'ff-arv-badge';

const CSS = `
.${BADGE_CLASS} {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 7px; margin-left: 6px; border-radius: 4px;
  font-size: 0.62rem; font-weight: 800; letter-spacing: 0.3px; white-space: nowrap;
  border: 1px solid transparent; cursor: help;
}
.${BADGE_CLASS} .ff-arv-order {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 15px; height: 15px; border-radius: 50%;
  background: rgba(0,0,0,0.45); color: #fff; font-size: 0.58rem;
}
.ff-arv-beatable { color: #86efac; background: rgba(34,197,94,0.14); border-color: rgba(34,197,94,0.45); }
.ff-arv-coinflip { color: #fcd34d; background: rgba(245,158,11,0.14); border-color: rgba(245,158,11,0.45); }
.ff-arv-avoid    { color: #fca5a5; background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.45); }
#${BANNER_ID} {
  margin: 0 0 12px; padding: 10px 14px; border-radius: 10px;
  background: linear-gradient(90deg, rgba(212,175,55,0.10), rgba(10,10,15,0.6));
  border: 1px solid rgba(212,175,55,0.30);
  font-size: 0.74rem; line-height: 1.55; color: #e7dcc0;
}
#${BANNER_ID} b { color: #fbbf24; }
#${BANNER_ID} .ff-arv-line { margin: 2px 0; }
#${BANNER_ID} .ff-arv-note { color: #a8a098; font-size: 0.66rem; margin-top: 4px; }
#${BANNER_ID} .ff-arv-warn { color: #fca5a5; }
`;

let profile: ArenaMyProfile | null = null;
/** The boss's quoted % from the latest `open_next_page` (never rendered by
 *  the game), keyed by name so a stale value never lands on a new boss. */
let bossQuote: { name: string; pct: number } | null = null;
let enabled = false;
let paintQueued = false;

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function saveProfile(next: ArenaMyProfile): Promise<void> {
  profile = next;
  await storage.setArenaMyProfile(next);
  schedulePaint();
}

export function handleCapturedRequest(req: CapturedRequest): void {
  if (req.method !== 'POST' || !req.url.includes('/actions/arena_v2.php')) return;
  const action = new URLSearchParams(req.requestBody ?? '').get('action');
  if (action !== 'preview_loadout' && action !== 'attack' && action !== 'open_next_page') return;

  let data: any;
  try {
    data = JSON.parse(req.responseText);
  } catch {
    recordParseFailure(FEATURE_KEY);
    return;
  }
  if (data?.ok !== true) return;

  void (async () => {
    if (profile === null) profile = await storage.getArenaMyProfile();

    if (action === 'preview_loadout') {
      const fs = data.fighting_stats;
      if (!fs || typeof fs.strength !== 'number' || typeof data.max_hp !== 'number') {
        recordParseFailure(FEATURE_KEY);
        return;
      }
      recordParseSuccess(FEATURE_KEY);
      const stats = { strength: fs.strength, defence: fs.defence, agility: fs.agility, dexterity: fs.dexterity };
      // A mid-season look at the loadout shouldn't throw away measured
      // numbers for the same locked HP; it only fills in the stats.
      if (profile?.source === 'fights' && profile.maxHp === data.max_hp) {
        await saveProfile({ ...profile, lockedStats: stats });
      } else {
        await saveProfile(profileFromPreview(stats, data.max_hp));
      }
      return;
    }

    if (action === 'attack') {
      const sample = sampleFromAttack(data);
      if (!sample) {
        recordParseFailure(FEATURE_KEY);
        return;
      }
      recordParseSuccess(FEATURE_KEY);
      await saveProfile(foldFight(profile, sample));
      return;
    }

    const boss = data?.new_page?.boss_data;
    if (boss && typeof boss.name === 'string' && typeof boss.win_pct === 'number') {
      bossQuote = { name: boss.name, pct: boss.win_pct };
      schedulePaint();
    }
  })().catch((err) => console.error(LOG_PREFIX, 'arena advisor capture failed', err));
}

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

interface CardOnPage {
  el: HTMLElement;
  card: ArenaOpponentCard;
  familyLabel: string | null;
  /** Regular opponent still to fight, or a boss not yet fought. */
  live: boolean;
  bossLocked: boolean;
}

function num(text: string | null | undefined): number | null {
  const m = text?.replace(/,/g, '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

function readCard(el: HTMLElement): CardOnPage | null {
  const isBoss = el.classList.contains('ar-opp-boss');
  const name = el.querySelector('.ar-opp-name')?.textContent?.trim() ?? '';
  const level = num(el.querySelector('.ar-opp-lvl')?.textContent?.match(/L[vV]\.\s*[\d,]+/)?.[0]);
  const strength = num(el.querySelector('.ar-opp-stat-str')?.textContent);
  const defence = num(el.querySelector('.ar-opp-stat-def')?.textContent);
  const agility = num(el.querySelector('.ar-opp-stat-agi')?.textContent);
  const dexterity = num(el.querySelector('.ar-opp-stat-dex')?.textContent);
  if (!name || level === null || strength === null || defence === null || agility === null || dexterity === null) return null;

  const quotedEl = el.querySelector('.ar-opp-winpct');
  const quotedPct = isBoss ? (bossQuote?.name === name ? bossQuote.pct : null) : num(quotedEl?.textContent);
  const family = isBoss ? ([...el.classList].find((c) => c.startsWith('ar-opp-boss-'))?.slice('ar-opp-boss-'.length) ?? null) : null;

  const btn = el.querySelector('.ar-opp-btn');
  const bossLocked = isBoss && /Locked/i.test(btn?.textContent ?? '');
  const bossEngageable = isBoss && (btn?.getAttribute('onclick') ?? '').includes('av2_arenaAttack(0,');
  const live = isBoss ? bossLocked || bossEngageable : !el.classList.contains('fought');

  return {
    el,
    card: {
      name, isBoss, level, strength, defence, agility, dexterity,
      passive: el.querySelector('.ar-opp-passive') !== null,
      quotedPct, family,
    },
    familyLabel: isBoss ? el.querySelector('.ar-opp-boss-fam')?.textContent?.trim() ?? null : null,
    live,
    bossLocked,
  };
}

/** "Locked Max HP" on the page's own loadout summary. A mismatch with the
 *  stored profile means it's from a previous season. */
function readLockedMaxHp(): number | null {
  for (const el of document.querySelectorAll<HTMLElement>('.ar-page div')) {
    if (el.childElementCount <= 1 && el.textContent?.trim() === 'Locked Max HP') {
      return num(el.nextElementSibling?.textContent);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function verdictLabel(v: ArenaVerdict): string {
  if (v.kind === 'beatable') return '✅ Beatable';
  if (v.kind === 'avoid') return '⛔ Avoid';
  return `⚖️ Coin-flip · lean ${v.leansWin ? 'win' : 'loss'}`;
}

function tooltip(c: CardOnPage, v: ArenaVerdict): string {
  const lines = [
    `Kill-race score ${v.score.toFixed(2)} (1.2+ beatable, under 0.8 avoid)`,
    `STR ${fmt(c.card.strength)} at level ${c.card.level} (~${fmt(v.opponentHp)} HP). Your limit at this level and DEF: ~${fmt(v.maxStrength)} STR.`,
  ];
  if (v.breaksThrough) lines.push(`Your hits get past their DEF ${fmt(c.card.defence)}, so you deal real damage, not the minimum.`);
  if (c.card.passive) lines.push('Passive: they haven’t fought this season, so they fight weaker than the card shows.');
  if (c.card.isBoss) {
    if (c.familyLabel) lines.push(`${c.familyLabel} boss.${c.card.family === 'iron_river' ? ' Iron River bosses are built on STR.' : ''}`);
    lines.push('Losing to the boss forfeits your unbanked pot.');
  }
  lines.push(c.card.quotedPct !== null ? `Game’s quoted chance: ${c.card.quotedPct}%` : 'Game’s quoted chance: not seen for this boss');
  return lines.join('\n');
}

function paintBadge(c: CardOnPage, v: ArenaVerdict, order: number | null): void {
  const meta = c.el.querySelector('.ar-opp-meta');
  if (!meta) return;
  const text = verdictLabel(v);
  const title = tooltip(c, v);
  const sig = `${order ?? ''}|${text}|${title}`;
  const existing = meta.querySelector<HTMLElement>(`.${BADGE_CLASS}`);
  if (existing?.dataset.sig === sig) return;
  existing?.remove();

  const span = document.createElement('span');
  span.className = `${BADGE_CLASS} ff-arv-${v.kind}`;
  span.dataset.sig = sig;
  span.title = title;
  span.innerHTML = `${order !== null ? `<span class="ff-arv-order">${order}</span>` : ''}${text}`;
  meta.appendChild(span);
}

function clearBadges(root: ParentNode): void {
  root.querySelectorAll(`.${BADGE_CLASS}`).forEach((b) => b.remove());
}

function setBanner(anchor: HTMLElement, html: string | null): void {
  let banner = document.getElementById(BANNER_ID);
  if (html === null) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = BANNER_ID;
  }
  if (banner.nextElementSibling !== anchor) anchor.parentElement?.insertBefore(banner, anchor);
  if (banner.dataset.sig !== html) {
    banner.dataset.sig = html;
    banner.innerHTML = html;
  }
}

function freeRefreshAvailable(): boolean {
  const btn = document.querySelector<HTMLButtonElement>('.ar-actbtn[onclick*="av2_arenaRefresh"]');
  if (!btn || btn.disabled) return false;
  return /free/i.test(btn.querySelector('.ar-cost')?.textContent ?? '');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

function paint(): void {
  paintQueued = false;
  const root = document.querySelector<HTMLElement>('.ar-opps');
  if (!root) {
    setBanner(document.body, null);
    return;
  }

  if (!profile) {
    clearBadges(root);
    setBanner(
      root,
      '<div class="ff-arv-line"><b>Fight Advisor</b> is waiting for your season stats. They’re read from the season lock-in screen, or from your first fight.</div>',
    );
    return;
  }

  const cards = [...root.querySelectorAll<HTMLElement>('.ar-opp')].map(readCard).filter((c): c is CardOnPage => c !== null);
  const regulars = cards.filter((c) => !c.card.isBoss);
  const boss = cards.find((c) => c.card.isBoss) ?? null;

  const live = regulars
    .filter((c) => c.live)
    .map((c) => ({ c, v: verdictFor(c.card, profile!) }))
    .sort((a, b) => a.v.score - b.v.score);

  for (const c of cards.filter((x) => !x.live)) c.el.querySelector(`.${BADGE_CLASS}`)?.remove();
  live.forEach(({ c, v }, i) => paintBadge(c, v, i + 1));
  const bossVerdict = boss?.live ? verdictFor(boss.card, profile) : null;
  if (boss && bossVerdict) paintBadge(boss, bossVerdict, null);

  // --- the plan line -------------------------------------------------------
  const lines: string[] = [];
  if (live.length > 0) {
    const order = live.map(({ c, v }, i) => `${i + 1}. ${escapeHtml(c.card.name)} ${verdictLabel(v).split(' ')[0]}`).join(' → ');
    lines.push(`<div class="ff-arv-line"><b>Attack order</b> (riskiest first): ${order}</div>`);
  }

  if (boss && bossVerdict) {
    const fam = boss.familyLabel ? `${escapeHtml(boss.familyLabel)}, ` : '';
    const what = isRecommended(bossVerdict)
      ? `${verdictLabel(bossVerdict)}: fight it${boss.bossLocked ? ' once it unlocks' : ''}.`
      : `${verdictLabel(bossVerdict)}: <span class="ff-arv-warn">bank and skip it</span>. A boss loss forfeits the whole pot.`;
    lines.push(
      `<div class="ff-arv-line"><b>Boss</b> (${fam}STR ${fmt(boss.card.strength)}, break-even ~${fmt(bossVerdict.maxStrength)}): ${what}</div>`,
    );
  }

  const noneFoughtYet = regulars.length > 0 && regulars.every((c) => c.live);
  const avoidCount = live.filter(({ v }) => v.kind === 'avoid').length;
  if (noneFoughtYet && avoidCount >= 2 && freeRefreshAvailable()) {
    lines.push(
      `<div class="ff-arv-line"><b>Tip:</b> ${avoidCount} opponents are Avoid. The free Refresh re-rolls all four opponents (not the boss), and it locks once you attack.</div>`,
    );
  }

  const lockedHp = readLockedMaxHp();
  const stale = lockedHp !== null && lockedHp !== profile.maxHp;
  const source =
    profile.source === 'fights'
      ? `measured from ${profile.fightCount} fight${profile.fightCount === 1 ? '' : 's'}`
      : 'estimated from your lock-in; updates after your first fight';
  lines.push(
    `<div class="ff-arv-note">Your numbers: ${fmt(profile.maxHp)} HP · ~${fmt(profile.baseDamage)} damage · ~${fmt(profile.reduction)} armour (${source}).${
      stale ? ' <span class="ff-arv-warn">These look like last season’s (locked HP is ' + fmt(lockedHp!) + '); they update after your first fight.</span>' : ''
    }</div>`,
  );

  setBanner(root, lines.join(''));
}

function schedulePaint(): void {
  if (!enabled || paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(paint);
}

export function initArenaFightAdvisor(): void {
  enabled = true;
  injectStyleOnce(STYLE_ID, CSS);
  storage
    .getArenaMyProfile()
    .then((p) => {
      profile = p;
      schedulePaint();
    })
    .catch((err) => console.error(LOG_PREFIX, 'arena advisor profile read failed', err));

  const observer = new MutationObserver(() => schedulePaint());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });

  // Another tab (or this one's capture path) updating the profile.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEYS.ARENA_MY_PROFILE in changes)) return;
    profile = (changes[STORAGE_KEYS.ARENA_MY_PROFILE].newValue as ArenaMyProfile | undefined) ?? null;
    schedulePaint();
  });
}
