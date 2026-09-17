import { injectStyleOnce } from './injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from './brandBadge';
import type { AchievementPageScope } from '@/shared/achievementPageMap';
import type { AchievementCategory, AchievementLine, AchievementTierLabel } from '@/shared/types';

/**
 * A near-transparent icon fixed at the top-right of the live game page —
 * deliberately not the bottom-right "badge + expand" shape every other
 * overlay in this codebase uses (Garage, Street Racing, …), since those are
 * built to stay open *during* an action; this is read-only, glanced-at
 * info, and top-right avoids colliding with whichever of those tools is
 * already sitting bottom-right on the same page. Clicking opens a modal —
 * more room than an inline panel for a handful of lines each with their own
 * progress bar, and a modal has no "stay open while I do something else"
 * state to manage, unlike a running batch.
 *
 * One instance covers every page: `initAchievementChip` takes the *whole*
 * `ACHIEVEMENT_PAGE_SCOPES` list, not one scope per call, and a single
 * shared `MutationObserver` figures out which scope (if any) currently
 * matches — cheaper than each of the ~13 pages running its own observer for
 * something that's only ever showing one page's data at a time anyway.
 *
 * Lines are shown Ready-to-claim first, then in-progress sorted by closest
 * to their next tier, then fully-maxed lines last — the same "what should I
 * actually do next" ordering the native "Within Reach" panel uses, just
 * scoped to this one page's own lines instead of the whole game.
 */

const CONTAINER_ID = 'ff-ach-chip';
const MODAL_ID = 'ff-ach-modal';
const STYLE_ID = 'ff-ach-chip-style';

let chipEl: HTMLDivElement | null = null;
let modalEl: HTMLDivElement | null = null;
let scopes: AchievementPageScope[] = [];
let activeScope: AchievementPageScope | null = null;

let loading = false;
let loadError: string | null = null;
let category: AchievementCategory | null = null;

function tierLabel(tier: AchievementTierLabel): string {
  return tier === 'unproven' ? 'Unproven' : tier[0].toUpperCase() + tier.slice(1);
}

/** Ready lines first (actionable right now), then in-progress lines closest
 *  to their next tier, then fully-maxed lines last. */
function sortLines(lines: AchievementLine[]): AchievementLine[] {
  const rank = (l: AchievementLine) => (l.ready ? 0 : l.allTiersComplete ? 2 : 1);
  const fraction = (l: AchievementLine) => (l.next && l.next.target > 0 ? l.next.current / l.next.target : 0);
  return [...lines].sort((a, b) => rank(a) - rank(b) || fraction(b) - fraction(a));
}

function renderLine(line: AchievementLine): string {
  let stateHtml = '';
  if (line.ready) {
    stateHtml = `
      <div class="ff-ach-ready">
        <span>Ready — ${line.ready.rewardText}</span>
        <button class="ff-ach-claim-btn" type="button" data-line-id="${line.ready.lineId}">Claim</button>
      </div>
    `;
  } else if (line.allTiersComplete) {
    stateHtml = `<div class="ff-ach-maxed">All tiers claimed</div>`;
  } else if (line.next) {
    const pct = line.next.target > 0 ? Math.min(100, Math.round((line.next.current / line.next.target) * 100)) : 0;
    stateHtml = `
      <div class="ff-ach-progress-track"><div class="ff-ach-progress-fill" style="width:${pct}%"></div></div>
      <div class="ff-ach-progress-label">${line.next.requirementText} — ${line.next.current.toLocaleString()} / ${line.next.target.toLocaleString()} (${pct}%)</div>
      <div class="ff-ach-next-reward">Pays ${line.next.rewardText}</div>
    `;
  }

  return `
    <div class="ff-ach-line">
      <div class="ff-ach-line-head">
        <span class="ff-ach-line-name">${line.name}</span>
        <span class="ff-ach-tier ff-ach-tier-${line.tier}">${tierLabel(line.tier)}</span>
      </div>
      <div class="ff-ach-line-desc">${line.description}</div>
      ${stateHtml}
    </div>
  `;
}

function filteredLines(): AchievementLine[] {
  if (!category || !activeScope) return [];
  const lines = activeScope.lineNames === 'all' ? category.lines : category.lines.filter((l) => (activeScope!.lineNames as string[]).includes(l.name));
  return sortLines(lines);
}

function renderModalBody(): void {
  const bodyEl = modalEl?.querySelector('.ff-ach-modal-body');
  if (!bodyEl) return;

  if (loading) {
    bodyEl.innerHTML = `<div class="ff-ach-loading"><span class="ff-ach-spinner" aria-hidden="true"></span>Loading achievements…</div>`;
    return;
  }
  if (loadError) {
    bodyEl.innerHTML = `<div class="ff-ach-error">${loadError}</div>`;
    return;
  }
  const lines = filteredLines();
  if (!lines.length) {
    bodyEl.innerHTML = `<div class="ff-ach-empty">No tracked achievements here yet.</div>`;
    return;
  }

  bodyEl.innerHTML = lines.map(renderLine).join('');
  bodyEl.querySelectorAll<HTMLButtonElement>('[data-line-id]').forEach((btn) => {
    btn.addEventListener('click', () => void handleClaim(btn.dataset.lineId ?? ''));
  });
}

async function loadCategory(): Promise<void> {
  if (!activeScope) return;
  loading = true;
  loadError = null;
  renderModalBody();
  try {
    category = (await chrome.runtime.sendMessage({ type: 'achievements-category-requested', category: activeScope.category })) as AchievementCategory;
  } catch {
    loadError = 'Could not load achievements — try again.';
  }
  loading = false;
  renderModalBody();
}

async function handleClaim(lineId: string): Promise<void> {
  if (!lineId) return;
  const btn = modalEl?.querySelector<HTMLButtonElement>(`[data-line-id="${lineId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Claiming…';
  }
  try {
    await chrome.runtime.sendMessage({ type: 'achievements-claim-line-requested', lineId });
    // Re-fetch the whole category rather than patching just this line — a
    // further tier on the same line may already be Ready too, and there's
    // no reason to guess at that instead of reading the real post-claim
    // state.
    await loadCategory();
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Claim';
    }
    console.error('[FifthFamily]', 'achievement claim failed', err);
  }
}

function escHandler(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeModal();
}

function closeModal(): void {
  if (!modalEl) return;
  document.removeEventListener('keydown', escHandler);
  modalEl.remove();
  modalEl = null;
}

function openModal(): void {
  if (!activeScope || modalEl) return;

  modalEl = document.createElement('div');
  modalEl.id = MODAL_ID;
  modalEl.innerHTML = `
    <div class="ff-ach-backdrop"></div>
    <div class="ff-ach-modal">
      <div class="ff-ach-modal-head">
        ${brandBadgeHtml(activeScope.category)}
        <button class="ff-ach-modal-close" type="button" title="Close">✕</button>
      </div>
      <div class="ff-ach-modal-body"></div>
    </div>
  `;
  modalEl.querySelector('.ff-ach-backdrop')?.addEventListener('click', closeModal);
  modalEl.querySelector('.ff-ach-modal-close')?.addEventListener('click', closeModal);
  document.addEventListener('keydown', escHandler);
  (document.body ?? document.documentElement).appendChild(modalEl);

  void loadCategory();
}

function currentScope(): AchievementPageScope | null {
  return scopes.find((s) => document.querySelector(s.marker) != null) ?? null;
}

function updateVisibility(): void {
  activeScope = currentScope();
  chipEl?.classList.toggle('ff-ach-visible', activeScope != null);
  if (!activeScope) closeModal();
}

function buildChip(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.innerHTML = `<button class="ff-ach-chip-btn" type="button" title="Achievements on this page">🏆</button>`;
  el.querySelector('.ff-ach-chip-btn')?.addEventListener('click', openModal);
  return el;
}

const STYLE = `
#${CONTAINER_ID} {
  position: fixed;
  /* 14px sat right inside the game's own header row (stats bar/profile),
     confirmed from a real screenshot — pushed down another 5% of the
     viewport height to clear it. */
  top: calc(14px + 5vh);
  right: 14px;
  z-index: 999998;
  opacity: 0.32;
  transition: opacity 0.18s ease;
  display: none;
}
#${CONTAINER_ID}.ff-ach-visible { display: block; }
#${CONTAINER_ID}:hover { opacity: 1; }
.ff-ach-chip-btn {
  width: 30px; height: 30px; border-radius: 50%;
  background: linear-gradient(180deg, rgba(20,20,28,0.9), rgba(10,10,15,0.9));
  border: 1px solid rgba(201,168,76,0.5);
  color: #e8c766;
  font-size: 14px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 10px rgba(0,0,0,0.4);
}

#${MODAL_ID} { position: fixed; inset: 0; z-index: 9999999; font-family: 'Inter', system-ui, sans-serif; }
.ff-ach-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.62); }
.ff-ach-modal {
  position: relative; max-width: 440px; width: calc(100% - 32px); max-height: 80vh; overflow-y: auto;
  margin: 8vh auto 0; padding: 18px; border-radius: 14px;
  background: linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98));
  border: 1px solid rgba(201,168,76,0.45); box-shadow: 0 12px 40px rgba(0,0,0,0.65); color: #ccc;
}
.ff-ach-modal-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
.ff-ach-modal-close { background: none; border: none; color: #8b8f9e; font-size: 16px; cursor: pointer; padding: 2px 6px; }
.ff-ach-modal-close:hover { color: #fff; }

.ff-ach-loading, .ff-ach-empty {
  font-size: 11px; color: #6b6455; padding: 20px 4px; text-align: center;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.ff-ach-error {
  font-size: 11px; color: #fca5a5; background: rgba(239,68,68,0.08);
  border: 1px solid rgba(239,68,68,0.3); border-radius: 7px; padding: 10px;
}
.ff-ach-spinner {
  width: 11px; height: 11px; border-radius: 50%;
  border: 2px solid rgba(212,175,55,0.25); border-top-color: #fbbf24;
  animation: ff-ach-spin 0.7s linear infinite;
}
@keyframes ff-ach-spin { to { transform: rotate(360deg); } }

.ff-ach-line { padding: 11px 12px; margin-bottom: 8px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); }
.ff-ach-line:last-child { margin-bottom: 0; }
.ff-ach-line-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.ff-ach-line-name { font-size: 11.5px; font-weight: 700; color: #f1ede2; }
.ff-ach-line-desc { font-size: 9.5px; color: #8b8578; margin-top: 3px; line-height: 1.5; }

/* Same tier colors the live achievements page itself uses, not invented
   ones — recognizable to the player from the native panel. */
.ff-ach-tier { font-size: 8px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; flex-shrink: 0; }
.ff-ach-tier-unproven { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); color: #6b6455; }
.ff-ach-tier-bronze { background: rgba(184,115,51,0.16); border: 1px solid rgba(184,115,51,0.4); color: #d38a54; }
.ff-ach-tier-silver { background: rgba(192,200,208,0.14); border: 1px solid rgba(192,200,208,0.4); color: #c0c8d0; }
.ff-ach-tier-gold { background: rgba(196,78,114,0.14); border: 1px solid rgba(196,78,114,0.4); color: #C44E72; }
.ff-ach-tier-crown { background: rgba(168,85,247,0.16); border: 1px solid rgba(168,85,247,0.4); color: #a855f7; }

.ff-ach-progress-track { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.08); margin-top: 9px; overflow: hidden; }
.ff-ach-progress-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, rgba(212,175,55,0.5), rgba(251,191,36,0.95)); }
.ff-ach-progress-label { font-size: 9px; color: #9ca3af; margin-top: 5px; }
.ff-ach-next-reward { font-size: 9.5px; color: #d9c48a; margin-top: 3px; font-weight: 700; }

.ff-ach-ready {
  margin-top: 9px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 10px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.35); border-radius: 8px;
}
.ff-ach-ready span { font-size: 10px; color: #6ee7b7; font-weight: 700; }
.ff-ach-claim-btn {
  padding: 5px 12px; border-radius: 7px; background: rgba(16,185,129,0.22); border: 1px solid rgba(16,185,129,0.5);
  color: #6ee7b7; font-size: 9.5px; font-weight: 800; letter-spacing: 0.03em; cursor: pointer; flex-shrink: 0;
}
.ff-ach-claim-btn:disabled { opacity: 0.5; cursor: default; }
.ff-ach-maxed { margin-top: 9px; font-size: 9.5px; color: #a855f7; font-weight: 700; }
`;

/** Called once, with the whole page-scope list — see the module doc for why
 *  this isn't one call per page. */
export function initAchievementChip(pageScopes: AchievementPageScope[]): void {
  scopes = pageScopes;
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + STYLE);

  chipEl = buildChip();
  (document.body ?? document.documentElement).appendChild(chipEl);
  updateVisibility();

  const observer = new MutationObserver(() => updateVisibility());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}
