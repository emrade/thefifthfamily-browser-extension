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
import { hideHover, injectDetailStyles, openModal, showHover, type FightDetail } from './fightDetails';

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
const BADGE_CLASS = 'ff-arv-strip';

// Colours follow the game's own palette: green/amber/red accents on a dark
// tinted fill, uppercase spaced labels like its BOUNTY / PASSIVE tags.
const CSS = `
.${BADGE_CLASS} {
  display: flex; align-items: center; gap: 8px;
  margin: 12px 0 10px; padding: 7px 10px;
  border-radius: 6px; border: 1px solid; border-left-width: 3px;
  font-size: 0.68rem; line-height: 1; cursor: pointer;
  transition: filter 0.12s;
}
.${BADGE_CLASS}:hover, .${BADGE_CLASS}:focus-visible { filter: brightness(1.25); outline: none; }
.${BADGE_CLASS} .ff-arv-verdict {
  font-weight: 800; text-transform: uppercase; letter-spacing: 1.4px;
}
.${BADGE_CLASS} .ff-arv-detail {
  margin-left: auto; color: #a8a098; font-weight: 600; letter-spacing: 0.3px; white-space: nowrap;
}
.ff-arv-order {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 18px; height: 18px; border-radius: 50%;
  border: 1px solid currentColor; font-size: 0.62rem; font-weight: 800;
}
.ff-arv-beatable { color: #4ade80; background: rgba(34,197,94,0.08); border-color: rgba(74,222,128,0.35); }
.ff-arv-coinflip { color: #fbbf24; background: rgba(245,158,11,0.08); border-color: rgba(251,191,36,0.35); }
.ff-arv-avoid    { color: #f87171; background: rgba(239,68,68,0.08); border-color: rgba(248,113,113,0.35); }
.${BADGE_CLASS}.ff-arv-beatable { border-left-color: #4ade80; }
.${BADGE_CLASS}.ff-arv-coinflip { border-left-color: #fbbf24; }
.${BADGE_CLASS}.ff-arv-avoid    { border-left-color: #f87171; }

#${BANNER_ID} {
  margin: 0 0 14px; padding: 12px 16px; border-radius: 10px;
  background: linear-gradient(90deg, rgba(212,175,55,0.08), rgba(10,10,15,0.55));
  border: 1px solid rgba(212,175,55,0.28);
  font-size: 0.78rem; line-height: 1.5; color: #e7dcc0;
}
#${BANNER_ID} .ff-arv-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 3px 0; }
#${BANNER_ID} .ff-arv-label {
  color: #fbbf24; font-weight: 800; text-transform: uppercase; letter-spacing: 1.2px; font-size: 0.66rem;
  min-width: 96px;
}
#${BANNER_ID} .ff-arv-text { flex: 1 1 320px; min-width: 0; }
#${BANNER_ID} .ff-arv-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px 3px 4px; border-radius: 999px; border: 1px solid; font-weight: 700;
}
#${BANNER_ID} .ff-arv-chip { cursor: pointer; }
#${BANNER_ID} .ff-arv-chip .ff-arv-name { color: #f1ede2; }
#${BANNER_ID} .ff-arv-arrow { color: #6b6455; }
#${BANNER_ID} .ff-arv-word { font-weight: 800; }
#${BANNER_ID} .ff-arv-word.ff-arv-beatable,
#${BANNER_ID} .ff-arv-word.ff-arv-coinflip,
#${BANNER_ID} .ff-arv-word.ff-arv-avoid { background: none; }
#${BANNER_ID} .ff-arv-note { color: #8b8578; font-size: 0.68rem; margin-top: 6px; }
#${BANNER_ID} .ff-arv-warn { color: #f87171; font-weight: 700; }
`;

let profile: ArenaMyProfile | null = null;
/** The boss's quoted % from the latest `open_next_page` (never rendered by
 *  the game), keyed by name so a stale value never lands on a new boss. */
let bossQuote: { name: string; pct: number } | null = null;
let enabled = false;
let paintQueued = false;
/** Detail behind each strip and attack-order chip, for the hover card and
 *  the click-through modal (fightDetails.ts). */
const details = new WeakMap<Element, FightDetail>();

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

function verdictWord(v: ArenaVerdict): string {
  return v.kind === 'beatable' ? 'Beatable' : v.kind === 'avoid' ? 'Avoid' : 'Coin-flip';
}

/** Short right-hand detail on a card's strip. */
function verdictDetail(v: ArenaVerdict): string {
  const score = v.score > 3 ? 'score 3+' : `score ${v.score.toFixed(2)}`;
  return v.kind === 'coinflip' ? `leans ${v.leansWin ? 'win' : 'loss'} · ${score}` : score;
}

function paintBadge(c: CardOnPage, v: ArenaVerdict, order: number | null): void {
  const meta = c.el.querySelector('.ar-opp-meta');
  if (!meta || !profile) return;
  const inner =
    (order !== null ? `<span class="ff-arv-order">${order}</span>` : '') +
    `<span class="ff-arv-verdict">${verdictWord(v)}</span>` +
    `<span class="ff-arv-detail">${verdictDetail(v)}</span>`;
  const sig = `${v.kind}|${inner}|${v.score}|${c.card.quotedPct}`;
  const detail: FightDetail = { card: c.card, familyLabel: c.familyLabel, verdict: v, order, profile };
  const existing = c.el.querySelector<HTMLElement>(`.${BADGE_CLASS}`);
  if (existing?.dataset.sig === sig && existing.nextElementSibling === meta) {
    details.set(existing, detail);
    return;
  }
  existing?.remove();

  // Its own full-width strip just above the bounty/chance row, so it never
  // competes with the game's own tags for space.
  const strip = document.createElement('div');
  strip.className = `${BADGE_CLASS} ff-arv-${v.kind}`;
  strip.dataset.sig = sig;
  strip.setAttribute('role', 'button');
  strip.tabIndex = 0;
  details.set(strip, detail);
  strip.innerHTML = inner;
  meta.parentElement?.insertBefore(strip, meta);
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
      '<div class="ff-arv-line"><span class="ff-arv-label">Fight Advisor</span><span class="ff-arv-text">Waiting for your season stats. Fight any one opponent on this computer (or lock in here) and the badges appear.</span></div>',
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
    const order = live
      .map(
        ({ c, v }, i) =>
          `<span class="ff-arv-chip ff-arv-${v.kind}" data-ff-order="${i + 1}"><span class="ff-arv-order">${i + 1}</span><span class="ff-arv-name">${escapeHtml(c.card.name)}</span></span>`,
      )
      .join('<span class="ff-arv-arrow">→</span>');
    lines.push(`<div class="ff-arv-line"><span class="ff-arv-label">Attack order</span>${order}</div>`);
  }

  if (boss && bossVerdict) {
    const fam = boss.familyLabel ? `${escapeHtml(boss.familyLabel)}, ` : '';
    const word = `<span class="ff-arv-word ff-arv-${bossVerdict.kind}">${verdictWord(bossVerdict)}</span>`;
    const what = isRecommended(bossVerdict)
      ? `${word} — fight it${boss.bossLocked ? ' once it unlocks' : ''}.`
      : `${word} — <span class="ff-arv-warn">bank and skip it</span>. A boss loss forfeits the whole pot.`;
    lines.push(
      `<div class="ff-arv-line"><span class="ff-arv-label">Boss</span><span class="ff-arv-text">${escapeHtml(boss.card.name)} (${fam}STR ${fmt(boss.card.strength)}, your break-even ~${fmt(bossVerdict.maxStrength)}): ${what}</span></div>`,
    );
  }

  const noneFoughtYet = regulars.length > 0 && regulars.every((c) => c.live);
  const avoidCount = live.filter(({ v }) => v.kind === 'avoid').length;
  if (noneFoughtYet && avoidCount >= 2 && freeRefreshAvailable()) {
    lines.push(
      `<div class="ff-arv-line"><span class="ff-arv-label">Tip</span><span class="ff-arv-text">${avoidCount} opponents are Avoid. The free Refresh re-rolls all four opponents (not the boss), and it locks once you attack.</span></div>`,
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
  document.getElementById(BANNER_ID)?.querySelectorAll<HTMLElement>('.ff-arv-chip[data-ff-order]').forEach((chip) => {
    const i = Number(chip.dataset.ffOrder) - 1;
    const x = live[i];
    if (x) details.set(chip, { card: x.c.card, familyLabel: x.c.familyLabel, verdict: x.v, order: i + 1, profile: profile! });
  });
}

function schedulePaint(): void {
  if (!enabled || paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(paint);
}

function detailTarget(e: Event): HTMLElement | null {
  const t = (e.target as Element | null)?.closest?.(`.${BADGE_CLASS}, #${BANNER_ID} .ff-arv-chip`);
  return t instanceof HTMLElement && details.has(t) ? t : null;
}

function wireDetailEvents(): void {
  document.addEventListener('mouseover', (e) => {
    const t = detailTarget(e);
    if (t) showHover(t, details.get(t)!);
  });
  document.addEventListener('mouseout', (e) => {
    const t = detailTarget(e);
    if (t && !t.contains(e.relatedTarget as Node | null)) hideHover();
  });
  document.addEventListener('scroll', hideHover, true);
  // Capture phase, so the game's own card handlers never see the click.
  document.addEventListener(
    'click',
    (e) => {
      const t = detailTarget(e);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      openModal(details.get(t)!);
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = detailTarget(e);
    if (!t) return;
    e.preventDefault();
    openModal(details.get(t)!);
  });
}

export function initArenaFightAdvisor(): void {
  enabled = true;
  injectStyleOnce(STYLE_ID, CSS);
  injectDetailStyles();
  wireDetailEvents();
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
