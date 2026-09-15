import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { GAME_ORIGIN } from '@/shared/constants';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import { LOG_PREFIX } from '@/shared/log';
import type { FightClubRecon } from '@/shared/types';
import { parseRecon } from './adapters/reconAdapter';

/**
 * A floating panel on the live Fight Club page, same "badge + expand" shape as
 * `streetRacing/overlay.ts`, built around `attack.php?type=recon` — see that
 * type's own doc in shared/types.ts for what the endpoint actually returns.
 *
 * Two separate ways data reaches this panel — both one-target-at-a-time,
 * deliberately never a batch:
 *
 * 1. **Passive.** `showObservedRecon()` is called by `../index.ts` every time
 *    the *game's own* client JS fires a recon call — confirmed real: opening
 *    a target's attack view triggers exactly one of these before the Attack
 *    button becomes clickable. That call's response already carries
 *    everything this panel shows, the game just doesn't render the numbers
 *    anywhere — so surfacing it here costs nothing extra: no new request,
 *    just reading a capture that was already happening.
 * 2. **Active.** A small "Recon" button on each `.fc-p-card` fetches for just
 *    that one target when clicked. A batch "scan the whole page" version of
 *    this was built and then deliberately dropped (confirmed player
 *    concern): a burst of 20-40 sequential recon calls at a uniform pace
 *    across every card in view is a request pattern no manual browsing
 *    session produces, and would stick out in the game's own server logs the
 *    same way it'd stick out in this player's own HTTP archive. A single
 *    button press per target — the same call the game itself fires when you
 *    open that target's attack view, at whatever pace a human actually
 *    clicks through profiles — is indistinguishable from that.
 *
 * Card badges and the panel's "Currently Viewing" section share one
 * `recon`-by-`targetId` cache, so either source can populate or refresh the
 * other's view of the same target.
 */

const CONTAINER_ID = 'ff-fc-recon-panel';
const STYLE_ID = 'ff-fc-recon-style';
const GRID_SELECTOR = '.fc-player-grid';
const CARD_SELECTOR = ':scope > .fc-p-card';
const CARD_BUTTON_CLASS = 'ff-fc-recon-btn';
const VISIBILITY_MARKER = '.fc-hero'; // the hero scoreboard — present on the Targets/Combat Log/Top Fighters list view

// The individual target's own attack-confirmation screen (confirmed real,
// screenshot 2026-09) is a separate full route — back/home nav, no `.fc-hero`
// anywhere — so it needs its own signal. It has no confirmed CSS hook (it
// wasn't in any captured panel.php HTML; every field on it — Respect, Combat
// Rating, Potential Loot, Attacks Today, Stamina Cost, gear — maps straight
// onto `attack.php?type=recon`'s own fields, so it's rendered client-side
// from that response rather than fetched as its own panel). Matched on text
// instead: "Target Recon" (its own heading) and "Engage Combat" (its submit
// button) are specific enough neither should appear as incidental copy
// elsewhere in the game. This is also the screen with the "Buy Intel on this
// target first" paywall prompt — exactly the page this panel needs to reach.
const RECON_PAGE_TEXT_MARKERS = ['Target Recon', 'Engage Combat'];

// Keyed by target id — shared between card badges and the panel's own
// "Currently Viewing" section regardless of which source (passive capture or
// a card's own Recon button) last populated an entry.
const reconCache = new Map<number, FightClubRecon>();

// A target just recon'd is re-usable for a short while without re-hitting the
// network — covers an accidental double-click, or clicking back onto the same
// card after checking a couple of others. Short enough that a target who
// healed up or changed gear since doesn't show a stale read for the rest of
// the session; the button always re-fetches (bypassing this) on an explicit
// click anyway, so this only ever shortcuts the *first* look at a target.
const RECON_CACHE_TTL_MS = 3 * 60_000;

let panelEl: HTMLDivElement | null = null;
let expanded = false;
let lastObserved: FightClubRecon | null = null;

const THREAT_COLORS: Record<string, string> = {
  'Easy Pickings': '#4ade80',
  Favorable: '#34d399',
  'Even Match': '#fbbf24',
  Dangerous: '#ef4444',
};
const DEFAULT_THREAT_COLOR = '#9ca3af';

function threatColor(threatLevel: string): string {
  return THREAT_COLORS[threatLevel] ?? DEFAULT_THREAT_COLOR;
}

function extractTargetId(card: Element): number | null {
  const onclick = card.querySelector('.fc-p-attack')?.getAttribute('onclick') ?? '';
  const match = /Game\.attackPlayer\((\d+)\)/.exec(onclick);
  return match ? Number(match[1]) : null;
}

const PANEL_CSS = `
#${CONTAINER_ID} {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif;
  display: none;
}
#${CONTAINER_ID}.ff-fcr-visible { display: block; }

.ff-fcr-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 280px;
  padding: 10px 16px;
  background: linear-gradient(180deg, rgba(20,20,28,0.96), rgba(10,10,15,0.96));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 999px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.ff-fcr-badge:hover { border-color: rgba(201,168,76,0.8); transform: translateY(-1px); }
.ff-fcr-badge-label { font-size: 10.5px; color: #d9c48a; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.ff-fcr-panel {
  display: none;
  width: 320px;
  max-height: 74vh;
  overflow-y: auto;
  padding: 16px;
  background: linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 14px;
  box-shadow: 0 10px 34px rgba(0,0,0,0.6);
  color: #ccc;
}
#${CONTAINER_ID}.ff-fcr-expanded .ff-fcr-panel { display: block; }
#${CONTAINER_ID}.ff-fcr-expanded .ff-fcr-badge { display: none; }

.ff-fcr-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
.ff-fcr-close { background: none; border: none; color: #8b8f9e; font-size: 16px; line-height: 1; cursor: pointer; padding: 2px 6px; }
.ff-fcr-close:hover { color: #fff; }

.ff-fcr-section-title { font-size: 8.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #8a7548; margin: 12px 0 6px; }
.ff-fcr-section-title:first-of-type { margin-top: 0; }

.ff-fcr-empty { font-size: 10px; color: #6b6455; line-height: 1.5; }

.ff-fcr-current { padding: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; }
.ff-fcr-current-name { font-size: 12px; font-weight: 700; color: #f1ede2; margin-bottom: 2px; }
.ff-fcr-current-meta { font-size: 9px; color: #9ca3af; margin-bottom: 8px; }
.ff-fcr-stat-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.ff-fcr-pct { font-family: 'SF Mono', 'Roboto Mono', ui-monospace, Menlo, monospace; font-size: 20px; font-weight: 800; }
.ff-fcr-chip { font-size: 9.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--ff-fcr-chip-color, #9ca3af) 20%, transparent); color: var(--ff-fcr-chip-color, #9ca3af); border: 1px solid color-mix(in srgb, var(--ff-fcr-chip-color, #9ca3af) 45%, transparent); }
.ff-fcr-line { font-size: 9.5px; color: #9ca3af; margin-top: 2px; }
.ff-fcr-flag { color: #f87171; font-weight: 700; }

.ff-fc-recon { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 5px 7px; margin: -2px 0 2px; border-radius: 6px; background: color-mix(in srgb, var(--ff-fc-recon-color, #9ca3af) 10%, rgba(0,0,0,0.2)); border: 1px solid color-mix(in srgb, var(--ff-fc-recon-color, #9ca3af) 35%, transparent); }
.ff-fc-recon-pct { font-family: 'SF Mono', 'Roboto Mono', ui-monospace, Menlo, monospace; font-size: 11px; font-weight: 800; color: var(--ff-fc-recon-color, #9ca3af); }
.ff-fc-recon-threat { font-size: 8.5px; font-weight: 700; color: var(--ff-fc-recon-color, #9ca3af); text-transform: uppercase; letter-spacing: 0.03em; }
.ff-fc-recon-steal { font-size: 8px; color: #9ca3af; white-space: nowrap; }

.${CARD_BUTTON_CLASS} {
  width: 100%; min-height: 26px; margin-bottom: 6px;
  background: linear-gradient(180deg, rgba(212,175,55,0.18), rgba(212,175,55,0.06));
  border: 1px solid rgba(212,175,55,0.4); color: #d9c48a;
  padding: 5px 8px; border-radius: 6px; font-weight: 800; font-size: 0.62rem;
  text-transform: uppercase; letter-spacing: 1.1px; cursor: pointer;
  font-family: inherit; transition: background 0.15s ease, border-color 0.15s ease;
}
.${CARD_BUTTON_CLASS}:hover:not(:disabled) { border-color: rgba(212,175,55,0.75); }
.${CARD_BUTTON_CLASS}:disabled { opacity: 0.55; cursor: default; }
`;

function reconMetaLine(r: FightClubRecon): string {
  const bits = [`Lv.${r.level}`, r.family || 'Unaffiliated'];
  if (r.jailed) bits.push('<span class="ff-fcr-flag">Jailed</span>');
  if (r.hospitalized) bits.push('<span class="ff-fcr-flag">Hospitalized</span>');
  return bits.join(' · ');
}

function renderCurrent(): string {
  if (!lastObserved) {
    return '<div class="ff-fcr-empty">Click <strong>Recon</strong> on any target card, or open a target’s attack view in-game — either way, the odds the game already computes for that matchup show up here.</div>';
  }
  const r = lastObserved;
  const color = threatColor(r.threatLevel);
  return `
    <div class="ff-fcr-current">
      <div class="ff-fcr-current-name">${r.username}</div>
      <div class="ff-fcr-current-meta">${reconMetaLine(r)}</div>
      <div class="ff-fcr-stat-row">
        <span class="ff-fcr-pct" style="color:${color}">${r.successChance}%</span>
        <span class="ff-fcr-chip" style="--ff-fcr-chip-color:${color}">${r.threatLevel || 'Unknown'}</span>
      </div>
      <div class="ff-fcr-line">Steal estimate: <strong>${r.stealEstimate || 'Unknown'}</strong></div>
      <div class="ff-fcr-line">Combat rating: ${r.combatRating.toLocaleString()} · Attacks today: ${r.dailyAttacks}/${r.dailyLimit}</div>
    </div>
  `;
}

function renderBody(): string {
  return '<div class="ff-fcr-section-title">Currently Viewing</div>' + renderCurrent();
}

function badgeLabel(): string {
  if (lastObserved) return `${lastObserved.username} · ${lastObserved.successChance}% · ${lastObserved.threatLevel || 'Unknown'}`;
  return 'Fight Club Recon';
}

function renderAll(): void {
  if (!panelEl) return;
  const bodyEl = panelEl.querySelector('.ff-fcr-body');
  if (bodyEl) bodyEl.innerHTML = renderBody();
  const labelEl = panelEl.querySelector('.ff-fcr-badge-label');
  if (labelEl) labelEl.textContent = badgeLabel();
}

function setExpanded(next: boolean): void {
  expanded = next;
  panelEl?.classList.toggle('ff-fcr-expanded', expanded);
  if (expanded) renderAll();
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.innerHTML = `
    <button class="ff-fcr-badge" type="button">
      ${brandBadgeHtml('Recon')}
      <span class="ff-fcr-badge-label">Fight Club Recon</span>
    </button>
    <div class="ff-fcr-panel">
      <div class="ff-fcr-head">
        ${brandBadgeHtml('Recon')}
        <button class="ff-fcr-close" type="button" title="Collapse">✕</button>
      </div>
      <div class="ff-fcr-body"></div>
    </div>
  `;
  el.querySelector('.ff-fcr-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-fcr-close')?.addEventListener('click', () => setExpanded(false));
  return el;
}

/** Cheap element check first (the common case — the target list); only falls
 *  through to scanning rendered text (forces layout, so not done on every
 *  single mutation tick — see the observer's debounce in
 *  `initFightClubReconOverlay`) for the attack-confirmation screen, which has
 *  no known selector to check instead. */
function looksLikeFightClub(): boolean {
  if (document.querySelector(VISIBILITY_MARKER)) return true;
  const text = document.body?.innerText ?? '';
  return RECON_PAGE_TEXT_MARKERS.some((marker) => text.includes(marker));
}

function updateVisibility(): void {
  if (!panelEl) return;
  const visible = looksLikeFightClub();
  panelEl.classList.toggle('ff-fcr-visible', visible);
  if (!visible && expanded) setExpanded(false);
}

/** Injects (or refreshes) the odds badge on whichever `.fc-p-card` matches
 *  `recon.targetId` — a no-op if that card isn't currently in the DOM (the
 *  target may have scrolled off a paginated list, or this recon came from
 *  the individual attack view rather than this card's own button). */
function paintCardBadge(recon: FightClubRecon): void {
  const grid = document.querySelector(GRID_SELECTOR);
  if (!grid) return;

  for (const card of grid.querySelectorAll(CARD_SELECTOR)) {
    if (extractTargetId(card) !== recon.targetId) continue;

    const color = threatColor(recon.threatLevel);
    const html = `
      <span class="ff-fc-recon-pct">${recon.successChance}%</span>
      <span class="ff-fc-recon-threat">${recon.threatLevel || 'Unknown'}</span>
      <span class="ff-fc-recon-steal">${recon.stealEstimate || 'Unknown'}</span>
    `;

    let badge = card.querySelector('.ff-fc-recon');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'ff-fc-recon';
      const btn = card.querySelector(`.${CARD_BUTTON_CLASS}`);
      btn?.parentElement?.insertBefore(badge, btn);
    }
    (badge as HTMLElement).style.setProperty('--ff-fc-recon-color', color);
    badge.innerHTML = html;

    const btn = card.querySelector<HTMLButtonElement>(`.${CARD_BUTTON_CLASS}`);
    if (btn && !btn.disabled) btn.textContent = 'Rescan';
    break;
  }
}

/** Called by `../index.ts` for every recon response the *game's own* client JS
 *  triggers — see this module's own doc for why nothing here fetches on its
 *  own to populate this path. */
export function showObservedRecon(recon: FightClubRecon): void {
  reconCache.set(recon.targetId, recon);
  lastObserved = recon;
  paintCardBadge(recon);
  renderAll();
  // Don't wait for the debounced MutationObserver tick — a recon capture
  // arriving at all means we're on a fight-club-relevant page right now
  // (this is what fires when the attack-confirmation screen loads), so the
  // panel should reflect that immediately rather than trail it.
  updateVisibility();
}

async function fetchRecon(targetId: number, options: { force?: boolean } = {}): Promise<FightClubRecon | null> {
  if (!options.force) {
    const cached = reconCache.get(targetId);
    if (cached && Date.now() - cached.timestamp < RECON_CACHE_TTL_MS) return cached;
  }

  try {
    const res = await fetch(`${GAME_ORIGIN}/actions/attack.php?type=recon&target_id=${targetId}`, { credentials: 'include' });
    const text = await res.text();
    const recon = parseRecon(text, Date.now());
    if (!recon) {
      recordParseFailure('fightClub');
      return null;
    }
    recordParseSuccess('fightClub');
    reconCache.set(targetId, recon);
    return recon;
  } catch (err) {
    console.error(LOG_PREFIX, 'fight club recon fetch failed', err);
    return null;
  }
}

/** Handles one card's own Recon/Rescan button — always a single fetch for
 *  that one target, never a loop over other cards. `force: true` so a
 *  repeat click (the button relabels to "Rescan" once a target is known)
 *  gets a fresh read instead of silently replaying the cached one — the
 *  whole point of clicking again is that the target may have healed or
 *  regeared since. */
async function handleCardButtonClick(targetId: number, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  btn.textContent = 'Scouting…';

  const recon = await fetchRecon(targetId, { force: true });

  btn.disabled = false;
  btn.textContent = recon ? 'Rescan' : 'Recon';
  if (recon) showObservedRecon(recon);
}

/** Adds a Recon button to any `.fc-p-card` that doesn't already have one, and
 *  repaints a cached badge onto any card that's missing it (covers a
 *  pagination swap bringing back a target already recon'd earlier this
 *  session). Safe to call repeatedly — both checks are no-ops once done. */
function ensureCardButtons(grid: Element): void {
  for (const card of grid.querySelectorAll(CARD_SELECTOR)) {
    const targetId = extractTargetId(card);
    if (targetId == null) continue;

    const cached = reconCache.get(targetId);
    if (cached && !card.querySelector('.ff-fc-recon')) paintCardBadge(cached);

    if (card.querySelector(`.${CARD_BUTTON_CLASS}`)) continue;
    const attackBtn = card.querySelector('.fc-p-attack');
    if (!attackBtn) continue;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = CARD_BUTTON_CLASS;
    btn.textContent = cached ? 'Rescan' : 'Recon';
    btn.addEventListener('click', () => void handleCardButtonClick(targetId, btn));
    attackBtn.parentElement?.insertBefore(btn, attackBtn);
  }
}

// `looksLikeFightClub()` reads `body.innerText` when the cheap selector check
// misses (i.e. whenever we're not on the list view), which forces a layout —
// fine once per navigation, not fine on every single mutation tick a busy SPA
// produces (a live-updating chat widget alone fires plenty). Trailing-debounced
// so a burst of mutations from one DOM update (e.g. the recon page swapping
// in) settles into a single check shortly after, not one per mutation record.
const VISIBILITY_DEBOUNCE_MS = 200;
let visibilityDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleVisibilityCheck(): void {
  if (visibilityDebounceTimer != null) return;
  visibilityDebounceTimer = setTimeout(() => {
    visibilityDebounceTimer = null;
    updateVisibility();
    const grid = document.querySelector(GRID_SELECTOR);
    if (grid) ensureCardButtons(grid);
  }, VISIBILITY_DEBOUNCE_MS);
}

export function initFightClubReconOverlay(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + PANEL_CSS);

  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);
  updateVisibility();

  const observer = new MutationObserver(() => scheduleVisibilityCheck());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}
