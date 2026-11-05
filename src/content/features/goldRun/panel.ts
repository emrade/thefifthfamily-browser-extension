import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { STORAGE_KEYS } from '@/shared/constants';
import { DEFAULT_GOLD_RUN_CONFIG, emptyGoldRunState, estimateRemaining, nextCandidate, withCurrentDay } from '@/shared/goldRun';
import { LOG_PREFIX } from '@/shared/log';
import type { ExtensionMessage } from '@/shared/messaging';
import { storage } from '@/shared/storage';
import type { GoldRunConfig, GoldRunState, GoldRunTarget } from '@/shared/types';

/**
 * Gold Run on the Fight Club page: gold, Stamina and HP, the district's targets
 * in one list, a Fight button, and Run to Cap once its switch is on. Everything
 * that touches the game happens in background/features/goldRun; this only draws
 * its state and asks for things. Design: docs/gold-run-plan.md.
 *
 * Follows `chrome.storage` live, so a pause from the background shows at once.
 * Sends nothing to the game until the panel is opened.
 */

const CONTAINER_ID = 'ff-gold-run-panel';
const STYLE_ID = 'ff-gold-run-style';
const HIT_CLASS = 'ff-gr-hit';
const VISIBILITY_MARKER = '.fc-hero';
const CARD_SELECTOR = '.fc-p-card';
const DEBOUNCE_MS = 200;

const PANEL_CSS = `
#${CONTAINER_ID} {
  position: fixed; bottom: 20px; left: 20px; z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif; display: none;
}
#${CONTAINER_ID}.ff-gr-visible { display: block; }
#${CONTAINER_ID} .ff-gr-badge {
  display: flex; align-items: center; gap: 10px; width: auto; margin: 0; padding: 10px 16px;
  background: linear-gradient(180deg, rgba(20,20,28,0.96), rgba(10,10,15,0.96));
  border: 1px solid rgba(201,168,76,0.45); border-radius: 999px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5); cursor: pointer;
}
.ff-gr-badge-label { font-size: 10.5px; color: #d9c48a; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }
.ff-gr-panel {
  display: none; width: 320px; max-height: 80vh; overflow-y: auto; padding: 14px;
  background: linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98));
  border: 1px solid rgba(201,168,76,0.45); border-radius: 14px;
  box-shadow: 0 10px 34px rgba(0,0,0,0.6); color: #ccc; font-size: 11.5px;
}
#${CONTAINER_ID}.ff-gr-expanded .ff-gr-panel { display: block; }
#${CONTAINER_ID}.ff-gr-expanded .ff-gr-badge { display: none; }
.ff-gr-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
#${CONTAINER_ID} .ff-gr-close { width: auto; margin: 0; background: none; border: none; color: #8b8f9e; font-size: 16px; line-height: 1; cursor: pointer; padding: 2px 6px; }
.ff-gr-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px; }
.ff-gr-stat { padding: 6px 4px; text-align: center; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(201,168,76,0.14); }
.ff-gr-stat-num { font-family: 'SF Mono', 'Roboto Mono', ui-monospace, Menlo, monospace; font-size: 12.5px; font-weight: 800; color: #f1ede2; }
.ff-gr-stat-label { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #8b8f9e; margin-top: 1px; }
.ff-gr-need { margin-bottom: 8px; line-height: 1.45; }
.ff-gr-need strong { color: #fbbf24; }
.ff-gr-notice { margin-bottom: 8px; padding: 7px 9px; border-radius: 8px; line-height: 1.4; background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.3); color: #f1ede2; }
.ff-gr-notice.ff-gr-paused { background: rgba(248,113,113,0.1); border-color: rgba(248,113,113,0.45); }
.ff-gr-actions { display: flex; gap: 6px; margin-bottom: 8px; }
#${CONTAINER_ID} .ff-gr-btn {
  flex: 1; width: auto; margin: 0; padding: 8px 6px; border-radius: 8px; cursor: pointer;
  font: inherit; font-size: 10.5px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
  color: #d9c48a; background: rgba(212,175,55,0.1); border: 1px solid rgba(212,175,55,0.4);
}
#${CONTAINER_ID} .ff-gr-btn-main { color: #14110a; background: #d4af37; border-color: #d4af37; }
#${CONTAINER_ID} .ff-gr-btn:disabled { opacity: 0.45; cursor: default; }
.ff-gr-section { margin: 10px 0 5px; font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #8b8f9e; }
.ff-gr-list { max-height: 210px; overflow-y: auto; border-radius: 8px; border: 1px solid rgba(201,168,76,0.14); }
.ff-gr-row { display: flex; align-items: center; gap: 6px; padding: 5px 7px; border-bottom: 1px solid rgba(255,255,255,0.04); }
.ff-gr-row:last-child { border-bottom: none; }
.ff-gr-row.ff-gr-off { opacity: 0.5; }
.ff-gr-lvl { flex: 0 0 26px; font-family: 'SF Mono', 'Roboto Mono', ui-monospace, Menlo, monospace; font-size: 10.5px; font-weight: 800; color: #fbbf24; }
.ff-gr-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #f1ede2; }
.ff-gr-why { font-size: 9.5px; color: #8b8f9e; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${CONTAINER_ID} .ff-gr-row-btn { width: auto; margin: 0; padding: 3px 8px; font: inherit; font-size: 9.5px; font-weight: 800; border-radius: 6px; cursor: pointer; color: #d9c48a; background: rgba(212,175,55,0.1); border: 1px solid rgba(212,175,55,0.4); }
#${CONTAINER_ID} .ff-gr-row-btn:disabled { opacity: 0.45; cursor: default; }
.ff-gr-empty { padding: 10px; text-align: center; color: #8b8f9e; }
.ff-gr-log { line-height: 1.5; font-size: 10.5px; }
.ff-gr-log-won { color: #34d399; } .ff-gr-log-lost { color: #f87171; } .ff-gr-log-skipped { color: #8b8f9e; }
.ff-gr-settings { display: flex; gap: 10px; margin-top: 4px; }
.ff-gr-settings label { flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 10.5px; }
#${CONTAINER_ID} .ff-gr-input { width: 46px; margin: 0; padding: 3px 5px; font: inherit; font-size: 11px; text-align: right; color: #f1ede2; background: rgba(0,0,0,0.3); border: 1px solid rgba(201,168,76,0.3); border-radius: 6px; }
.ff-gr-auto { display: flex; align-items: flex-start; gap: 8px; margin-top: 9px; line-height: 1.4; font-size: 10.5px; }
#${CONTAINER_ID} .ff-gr-auto input { width: auto; margin: 2px 0 0; accent-color: #d4af37; }
.${HIT_CLASS} { display: none !important; }
`;

let panelEl: HTMLDivElement | null = null;
let expanded = false;
let state: GoldRunState = emptyGoldRunState(Date.now());
let config: GoldRunConfig = DEFAULT_GOLD_RUN_CONFIG;

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function ask(message: ExtensionMessage): void {
  chrome.runtime.sendMessage(message).catch((err) => console.error(LOG_PREFIX, 'gold run request failed', message.type, err));
}

function current(): GoldRunState {
  return withCurrentDay(state, Date.now());
}

function renderNeed(s: GoldRunState): string {
  const estimate = estimateRemaining(s);
  if (estimate.goldLeft === 0) return 'Gold cap reached for today.';
  const need = `About <strong>${estimate.staminaNeeded.toLocaleString()} Stamina</strong> (${estimate.fightsLeft} fights) for the remaining ${estimate.goldLeft} gold.`;
  if (estimate.topUp === null) return need;
  return estimate.topUp > 0 ? `${need} You have ${s.stamina}: <strong>top up ${estimate.topUp}</strong>.` : `${need} You have ${s.stamina}, which is enough.`;
}

function renderRow(t: GoldRunTarget, disabled: boolean): string {
  const off = t.online || t.skipped !== null;
  const why = t.online ? 'Online' : (t.skipped ?? (t.chance !== null ? `${t.chance}%` : ''));
  const action = off ? '' : `<button class="ff-gr-row-btn" type="button" data-fight="${t.id}" ${disabled ? 'disabled' : ''}>Fight</button>`;
  return `<div class="ff-gr-row${off ? ' ff-gr-off' : ''}">
    <span class="ff-gr-lvl">${t.level}</span>
    <span class="ff-gr-name" title="${esc(t.name)}, rating ${t.rating.toLocaleString()}">${esc(t.name)}</span>
    ${why ? `<span class="ff-gr-why" title="${esc(why)}">${esc(why)}</span>` : ''}
    ${action}
  </div>`;
}

function renderActions(s: GoldRunState, disabled: boolean): string {
  const main = `<button class="ff-gr-btn ff-gr-btn-main" type="button" data-act="fight" ${disabled || !nextCandidate(s.targets) ? 'disabled' : ''}>Fight next</button>`;
  const refresh = `<button class="ff-gr-btn" type="button" data-act="refresh" ${disabled ? 'disabled' : ''}>Refresh</button>`;
  const manual = `<div class="ff-gr-actions">${main}${refresh}</div>`;
  if (!config.automationEnabled && s.run === 'idle') return manual;
  if (s.run === 'running') {
    return `<div class="ff-gr-actions"><button class="ff-gr-btn" type="button" data-act="pause">Pause</button><button class="ff-gr-btn" type="button" data-act="stop">Stop</button></div>`;
  }
  if (s.run === 'paused') {
    return `<div class="ff-gr-actions"><button class="ff-gr-btn ff-gr-btn-main" type="button" data-act="resume">Resume</button><button class="ff-gr-btn" type="button" data-act="stop">Stop</button></div>${manual}`;
  }
  return `<div class="ff-gr-actions"><button class="ff-gr-btn ff-gr-btn-main" type="button" data-act="start" ${disabled ? 'disabled' : ''}>Run to cap</button></div>${manual}`;
}

function renderLive(): void {
  if (!panelEl) return;
  const s = current();

  const label = panelEl.querySelector('.ff-gr-badge-label');
  if (label) {
    const suffix = s.run === 'running' ? ' · running' : s.run === 'paused' ? ' · paused' : '';
    label.textContent = `Gold ${s.goldToday}/${s.goldCap}${suffix}`;
  }
  const live = panelEl.querySelector('.ff-gr-live');
  if (!live || !expanded) return;

  const disabled = s.busy || s.run === 'running';
  const left = s.targets.filter((t) => !t.skipped && !t.online).length;
  const stat = (num: string, name: string) => `<div class="ff-gr-stat"><div class="ff-gr-stat-num">${num}</div><div class="ff-gr-stat-label">${name}</div></div>`;
  const log = s.log
    .map((e) => `<div class="ff-gr-log-${e.outcome}">${esc(e.name)} (Lv.${e.level}${e.chance !== null ? `, ${e.chance}%` : ''}): ${esc(e.detail)}</div>`)
    .join('');

  live.innerHTML = `
    <div class="ff-gr-stats">
      ${stat(`${s.goldToday}/${s.goldCap}`, 'Gold today')}
      ${stat(s.stamina === null ? '–' : `${s.stamina}/${s.maxStamina}`, 'Stamina')}
      ${stat(s.hp === null ? '–' : `${s.hp}/${s.maxHp}`, 'HP')}
    </div>
    <div class="ff-gr-need">${renderNeed(s)}</div>
    ${s.notice ? `<div class="ff-gr-notice${s.run === 'paused' ? ' ff-gr-paused' : ''}">${esc(s.notice)}</div>` : ''}
    ${renderActions(s, disabled)}
    <div class="ff-gr-section">Targets here: ${left} to try, of ${s.targets.length}</div>
    <div class="ff-gr-list">${s.targets.length ? (left === 0 ? '<div class="ff-gr-empty">Nobody left here at your odds. Travel, or Refresh to re-check the skipped ones.</div>' : '') + s.targets.map((t) => renderRow(t, disabled)).join('') : `<div class="ff-gr-empty">${s.busy ? 'Reading the list…' : s.targetsAt ? 'Nobody left here. Travel, then press Refresh.' : 'No targets loaded. Press Refresh.'}</div>`}</div>
    ${log ? `<div class="ff-gr-section">Recent</div><div class="ff-gr-log">${log}</div>` : ''}
  `;
}

/** Kept out of `renderLive`, so a state change can't overwrite a number the
 *  player is still typing. */
function syncSettings(): void {
  if (!panelEl) return;
  const set = (selector: string, value: number) => {
    const input = panelEl?.querySelector<HTMLInputElement>(selector);
    if (input && document.activeElement !== input) input.value = String(value);
  };
  set('[data-setting="minChancePct"]', config.minChancePct);
  set('[data-setting="healFloorPct"]', config.healFloorPct);
  const toggle = panelEl.querySelector<HTMLInputElement>('[data-setting="automationEnabled"]');
  if (toggle) toggle.checked = config.automationEnabled;
}

function saveSetting(key: 'minChancePct' | 'healFloorPct', raw: string): void {
  const value = Math.round(Number(raw));
  if (raw.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100) {
    config = { ...config, [key]: value };
    storage.setGoldRunConfig(config).catch((err) => console.error(LOG_PREFIX, 'gold run settings save failed', err));
  }
  syncSettings();
}

function setExpanded(next: boolean): void {
  expanded = next;
  panelEl?.classList.toggle('ff-gr-expanded', expanded);
  if (expanded) {
    renderLive();
    ask({ type: 'gold-run-panel-opened' });
  }
}

function handleClick(event: Event): void {
  const el = event.target as HTMLElement;
  const fight = el.closest<HTMLElement>('[data-fight]');
  if (fight) {
    ask({ type: 'gold-run-fight-requested', targetId: Number(fight.dataset.fight) });
    return;
  }
  const action = el.closest<HTMLElement>('[data-act]')?.dataset.act;
  if (action === 'fight') ask({ type: 'gold-run-fight-requested' });
  else if (action === 'refresh') ask({ type: 'gold-run-refresh-requested' });
  else if (action === 'start') ask({ type: 'gold-run-start-requested' });
  else if (action === 'pause') ask({ type: 'gold-run-pause-requested' });
  else if (action === 'resume') ask({ type: 'gold-run-resume-requested' });
  else if (action === 'stop') ask({ type: 'gold-run-stop-requested' });
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.innerHTML = `
    <button class="ff-gr-badge" type="button">
      ${brandBadgeHtml('Gold Run')}
      <span class="ff-gr-badge-label">Gold</span>
    </button>
    <div class="ff-gr-panel">
      <div class="ff-gr-head">
        ${brandBadgeHtml('Gold Run')}
        <button class="ff-gr-close" type="button" title="Collapse">✕</button>
      </div>
      <div class="ff-gr-live"></div>
      <div class="ff-gr-section">Settings</div>
      <div class="ff-gr-settings">
        <label>Min odds % <input class="ff-gr-input" type="number" min="0" max="100" data-setting="minChancePct"></label>
        <label>Heal below % <input class="ff-gr-input" type="number" min="0" max="100" data-setting="healFloorPct"></label>
      </div>
      <label class="ff-gr-auto">
        <input type="checkbox" data-setting="automationEnabled">
        <span>Run to Cap: fights for you until the gold cap, pausing when it needs you. Street Intel Auto holds off during a run.</span>
      </label>
    </div>
  `;
  el.querySelector('.ff-gr-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-gr-close')?.addEventListener('click', () => setExpanded(false));
  el.querySelector('.ff-gr-live')?.addEventListener('click', handleClick);
  el.querySelectorAll<HTMLInputElement>('.ff-gr-input').forEach((input) => {
    input.addEventListener('change', () => saveSetting(input.dataset.setting as 'minChancePct' | 'healFloorPct', input.value));
  });
  el.querySelector<HTMLInputElement>('[data-setting="automationEnabled"]')?.addEventListener('change', (event) => {
    config = { ...config, automationEnabled: (event.target as HTMLInputElement).checked };
    storage.setGoldRunConfig(config).catch((err) => console.error(LOG_PREFIX, 'gold run settings save failed', err));
    renderLive();
  });
  return el;
}

/** The game's own cards for anyone fought from here stay on its page until it
 *  next reloads the list, and attacking them would only be refused. */
function hideFoughtCards(): void {
  const fought = new Set(current().attackedIds);
  for (const card of document.querySelectorAll<HTMLElement>(CARD_SELECTOR)) {
    const id = /attackPlayer\((\d+)\)/.exec(card.querySelector('.fc-p-attack')?.getAttribute('onclick') ?? '');
    card.classList.toggle(HIT_CLASS, !!id && fought.has(Number(id[1])));
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onPageChanged(): void {
  if (debounceTimer != null) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const visible = !!document.querySelector(VISIBILITY_MARKER);
    panelEl?.classList.toggle('ff-gr-visible', visible);
    if (!visible && expanded) setExpanded(false);
    if (visible) hideFoughtCards();
  }, DEBOUNCE_MS);
}

export function initGoldRunPanel(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + PANEL_CSS);
  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);
  syncSettings();

  Promise.all([storage.getGoldRunState(), storage.getGoldRunConfig()])
    .then(([savedState, savedConfig]) => {
      if (savedState) state = savedState;
      config = savedConfig;
      syncSettings();
      renderLive();
    })
    .catch((err) => console.error(LOG_PREFIX, 'gold run panel load failed', err));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (STORAGE_KEYS.GOLD_RUN_CONFIG in changes) {
      config = { ...DEFAULT_GOLD_RUN_CONFIG, ...changes[STORAGE_KEYS.GOLD_RUN_CONFIG].newValue };
      syncSettings();
    }
    if (STORAGE_KEYS.GOLD_RUN_STATE in changes) {
      state = changes[STORAGE_KEYS.GOLD_RUN_STATE].newValue ?? emptyGoldRunState(Date.now());
      hideFoughtCards();
    }
    renderLive();
  });

  const observer = new MutationObserver(onPageChanged);
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  onPageChanged();
}
