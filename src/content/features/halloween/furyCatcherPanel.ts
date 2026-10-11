import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { STORAGE_KEYS } from '@/shared/constants';
import { storage } from '@/shared/storage';
import type { FuryCatcherConfig, FuryCatcherStatus } from '@/shared/types';

/**
 * A floating panel on the Halloween event page — the Fury Catcher's full
 * control surface, same as the popup's FuryCatcherHome: the Auto-Catch
 * toggle, the Energy floor and daily Energy Drink cap, Check Now, the pause
 * banner, and the bank/boss/today/all-time numbers. Same badge-and-expand
 * shape as streetIntel/statusPanel.ts.
 *
 * Config and status live in `chrome.storage.local`, which a content script
 * reads and writes directly; `nextCheckAt` is mirrored into status by the
 * runner so no alarm lookup is needed. Check Now goes through background.
 */

const CONTAINER_ID = 'ff-fury-panel';
const STYLE_ID = 'ff-fury-panel-style';
const HALLOWEEN_MARKER = '#hw26';

const PANEL_CSS = `
#${CONTAINER_ID} {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif;
  display: none;
}
#${CONTAINER_ID}.ff-fyp-visible { display: block; }

.ff-fyp-badge {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px;
  background: linear-gradient(180deg, rgba(20,20,28,0.96), rgba(10,10,15,0.96));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 999px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.ff-fyp-badge:hover { border-color: rgba(201,168,76,0.8); transform: translateY(-1px); }
.ff-fyp-badge-label { font-size: 10.5px; color: #d9c48a; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }

.ff-fyp-panel {
  display: none;
  width: 300px;
  max-height: 74vh;
  overflow-y: auto;
  padding: 16px;
  background: linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 14px;
  box-shadow: 0 10px 34px rgba(0,0,0,0.6);
  color: #ccc;
}
#${CONTAINER_ID}.ff-fyp-expanded .ff-fyp-panel { display: block; }
#${CONTAINER_ID}.ff-fyp-expanded .ff-fyp-badge { display: none; }

.ff-fyp-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.ff-fyp-close { background: none; border: none; color: #8b8f9e; font-size: 16px; line-height: 1; cursor: pointer; padding: 2px 6px; }
.ff-fyp-close:hover { color: #fff; }

.ff-fyp-toggle-row {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 11px 12px; margin-bottom: 10px;
  background: #17130e; border: 1px solid rgba(201,168,76,0.16);
  border-radius: 10px; cursor: pointer;
}
.ff-fyp-toggle-row__text { flex: 1; min-width: 0; }
.ff-fyp-toggle-row__title { font-weight: 700; font-size: 12.5px; color: #f1ede2; }
.ff-fyp-toggle-row__status { font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 9.5px; color: #6b6455; margin-top: 1px; line-height: 1.4; }
.ff-fyp-toggle {
  flex-shrink: 0; appearance: none; -webkit-appearance: none;
  width: 34px; height: 20px; border-radius: 10px;
  background: rgba(0,0,0,0.5); border: 1px solid rgba(201,168,76,0.34);
  position: relative; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.ff-fyp-toggle::before {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #6b6455;
  transition: transform 0.15s cubic-bezier(.22,1,.36,1), background 0.15s;
}
.ff-fyp-toggle:checked { background: rgba(251,191,36,0.18); border-color: #fbbf24; }
.ff-fyp-toggle:checked::before { transform: translateX(14px); background: #fbbf24; box-shadow: 0 0 6px rgba(251,191,36,0.5); }

.ff-fyp-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
.ff-fyp-field label { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b6455; margin-bottom: 4px; }
.ff-fyp-field input {
  width: 100%; box-sizing: border-box; padding: 6px 8px;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(201,168,76,0.25); border-radius: 6px;
  color: #f1ede2; font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 12px;
}
.ff-fyp-hint { font-size: 9.5px; color: #6b6455; line-height: 1.45; margin-bottom: 10px; }

.ff-fyp-btn {
  width: 100%; padding: 7px 10px; margin-bottom: 10px;
  background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.35); border-radius: 8px;
  color: #d9c48a; font-size: 11px; font-weight: 700; cursor: pointer;
}
.ff-fyp-btn:hover:not(:disabled) { background: rgba(201,168,76,0.16); }
.ff-fyp-btn:disabled { opacity: 0.5; cursor: default; }

.ff-fyp-alert {
  padding: 8px 10px; margin-bottom: 10px; font-size: 10px; line-height: 1.5;
  background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.3);
  border-radius: 7px; color: #ccc;
}

.ff-fyp-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
.ff-fyp-stat-tile { padding: 9px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; text-align: center; }
.ff-fyp-stat-tile__value { font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 13px; font-weight: 700; color: #f1ede2; }
.ff-fyp-stat-tile__label { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b6455; margin-top: 3px; }

.ff-fyp-row { font-size: 10.5px; color: #ccc; padding: 2px 0 6px; line-height: 1.4; }
`;

let panelEl: HTMLDivElement | null = null;
let expanded = false;
let config: FuryCatcherConfig | null = null;
let status: FuryCatcherStatus | null = null;
let checking = false;
let checkError: string | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** "4:15 PM · in 3:42" — same as the popup's `formatNextRun`. */
function formatNextRun(nextRunAt: number, now: number): string {
  const clock = new Date(nextRunAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const remainingSeconds = Math.max(0, Math.round((nextRunAt - now) / 1000));
  if (remainingSeconds === 0) return `${clock} · due now`;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${clock} · in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function badgeLabel(): string {
  const bank = status?.bank != null ? `${status.bank} Fury` : 'Fury';
  return config?.enabled ? `${bank} · catching` : `${bank} · off`;
}

function renderStatus(): string {
  if (!config) return '<div class="ff-fyp-row">Loading…</div>';
  const now = Date.now();
  const parts: string[] = [];

  if (checkError) parts.push(`<div class="ff-fyp-alert">${escapeHtml(checkError)}</div>`);

  if (status?.pausedReason) {
    const title = status.pausedReason === 'event-over' ? 'Fury Catcher finished' : 'Fury Catcher stopped';
    const after = status.pausedReason === 'error' ? '<br>Check the boss in-game, then flip Auto-Catch back on.' : '';
    parts.push(
      `<div class="ff-fyp-alert"><strong>${title}</strong>${status.pausedMessage ? `<br>"${escapeHtml(status.pausedMessage)}"` : ''}${after}</div>`,
    );
  }

  if (config.enabled && status?.note) parts.push(`<div class="ff-fyp-row">${escapeHtml(status.note)}</div>`);

  const boss = status?.boss;
  if (boss) {
    const line =
      boss.status === 'dead'
        ? `Boss #${boss.number} down${boss.respawnAt ? ` — next rises ${formatNextRun(boss.respawnAt, now)}` : ''}`
        : `Boss #${boss.number} · wave ${boss.wave} · ${boss.maxHp > 0 ? Math.round((boss.hp / boss.maxHp) * 100) : 0}% HP · ${boss.furyCount} Fury out`;
    parts.push(`<div class="ff-fyp-row">${line}</div>`);
  }

  const nextRunAt = config.enabled ? status?.nextCheckAt ?? null : null;
  const tile = (value: string, label: string, color = '#f1ede2') =>
    `<div class="ff-fyp-stat-tile"><div class="ff-fyp-stat-tile__value" style="color:${color}">${value}</div><div class="ff-fyp-stat-tile__label">${label}</div></div>`;
  parts.push('<div class="ff-fyp-stat-grid">');
  parts.push(tile(status?.bank != null ? String(status.bank) : '—', 'Fury Banked', '#fbbf24'));
  parts.push(tile(nextRunAt ? formatNextRun(nextRunAt, now) : '—', 'Next Check'));
  parts.push(tile(`${status?.today.caught ?? 0} / ${status?.today.chases ?? 0}`, 'Caught Today', '#4ade80'));
  parts.push(tile(`${status?.today.drinksUsed ?? 0} / ${config.dailyDrinkCap}`, 'Drinks Today'));
  parts.push(tile(`${status?.lifetime.caught ?? 0} / ${status?.lifetime.chases ?? 0}`, 'Caught All-Time', '#4ade80'));
  parts.push(tile(String(status?.lifetime.drinksUsed ?? 0), 'Drinks All-Time'));
  parts.push('</div>');

  if (status?.lastChase) {
    const c = status.lastChase;
    parts.push(
      `<div class="ff-fyp-row">Last chase: ${c.won ? 'caught' : 'got away'}${c.treatName ? ` · found ${escapeHtml(c.treatName)}` : ''} · ${new Date(c.timestamp).toLocaleTimeString()}</div>`,
    );
  }

  return parts.join('');
}

function renderControls(): void {
  if (!panelEl || !config) return;
  const toggle = panelEl.querySelector<HTMLInputElement>('.ff-fyp-auto-toggle');
  if (toggle) toggle.checked = config.enabled;
  const statusText = panelEl.querySelector('.ff-fyp-auto-status');
  if (statusText) statusText.textContent = config.enabled ? `Chasing every ready Fury, keeping ${config.energyFloor} Energy spare.` : 'Off — nothing will run.';

  // Don't overwrite a field the player is typing in.
  for (const [cls, value] of [
    ['.ff-fyp-floor', config.energyFloor],
    ['.ff-fyp-cap', config.dailyDrinkCap],
  ] as const) {
    const input = panelEl.querySelector<HTMLInputElement>(cls);
    if (input && document.activeElement !== input) input.value = String(value);
  }

  const btn = panelEl.querySelector<HTMLButtonElement>('.ff-fyp-check');
  if (btn) {
    btn.disabled = checking;
    btn.textContent = checking ? 'Checking…' : 'Check Now';
  }
}

function renderAll(): void {
  if (!panelEl) return;
  renderControls();
  const statusEl = panelEl.querySelector('.ff-fyp-status');
  if (statusEl) statusEl.innerHTML = renderStatus();
  const badgeLabelEl = panelEl.querySelector('.ff-fyp-badge-label');
  if (badgeLabelEl) badgeLabelEl.textContent = badgeLabel();
}

async function refresh(): Promise<void> {
  try {
    [config, status] = await Promise.all([storage.getFuryCatcherConfig(), storage.getFuryCatcherStatus()]);
    renderAll();
  } catch (err) {
    console.error(LOG_PREFIX, 'fury catcher panel refresh failed', err);
  }
}

function setExpanded(next: boolean): void {
  expanded = next;
  panelEl?.classList.toggle('ff-fyp-expanded', expanded);
  if (expanded) {
    refresh();
    if (tickTimer === null) tickTimer = setInterval(() => renderAll(), 1_000);
  } else if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

async function writeConfig(patch: Partial<FuryCatcherConfig>): Promise<void> {
  if (!config) return;
  const enabling = patch.enabled === true && !config.enabled;
  config = { ...config, ...patch };
  renderAll();
  try {
    await storage.setFuryCatcherConfig(config);
    // Re-enabling clears the stale "stopped" banner, same as the popup.
    if (enabling && status?.pausedReason) {
      status = { ...status, pausedReason: null, pausedMessage: null, pausedAt: null };
      await storage.setFuryCatcherStatus(status);
    }
  } catch (err) {
    console.error(LOG_PREFIX, 'fury catcher panel config write failed', err);
  }
}

async function checkNow(): Promise<void> {
  checking = true;
  checkError = null;
  renderAll();
  try {
    status = (await chrome.runtime.sendMessage({ type: 'fury-catcher-check-requested' })) as FuryCatcherStatus | null;
  } catch (err) {
    console.error(LOG_PREFIX, 'fury catcher panel check-now failed', err);
    checkError = 'Could not reach the background service — try again in a moment.';
  } finally {
    checking = false;
    renderAll();
  }
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.innerHTML = `
    <button class="ff-fyp-badge" type="button">
      ${brandBadgeHtml('Fury Catcher')}
      <span class="ff-fyp-badge-label">Loading…</span>
    </button>
    <div class="ff-fyp-panel">
      <div class="ff-fyp-head">
        ${brandBadgeHtml('Fury Catcher')}
        <button class="ff-fyp-close" type="button" title="Collapse">✕</button>
      </div>
      <label class="ff-fyp-toggle-row">
        <div class="ff-fyp-toggle-row__text">
          <div class="ff-fyp-toggle-row__title">Auto-Catch Fury</div>
          <div class="ff-fyp-toggle-row__status ff-fyp-auto-status">Loading…</div>
        </div>
        <input class="ff-fyp-auto-toggle ff-fyp-toggle" type="checkbox">
      </label>
      <div class="ff-fyp-fields">
        <div class="ff-fyp-field">
          <label>Energy floor</label>
          <input class="ff-fyp-floor" type="number" min="0" max="100">
        </div>
        <div class="ff-fyp-field">
          <label>Drinks / day</label>
          <input class="ff-fyp-cap" type="number" min="0" max="200">
        </div>
      </div>
      <div class="ff-fyp-hint">
        Never spends the floor. When Energy runs short and a Fury is ready, drinks an Energy Drink (+10, two chases),
        up to the daily cap (resets 23:00 UTC; 0 = never). Caught Fury is banked — firing stays up to you.
      </div>
      <button class="ff-fyp-btn ff-fyp-check" type="button">Check Now</button>
      <div class="ff-fyp-status"><div class="ff-fyp-row">Loading…</div></div>
    </div>
  `;

  el.querySelector('.ff-fyp-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-fyp-close')?.addEventListener('click', () => setExpanded(false));

  const toggle = el.querySelector<HTMLInputElement>('.ff-fyp-auto-toggle');
  toggle?.addEventListener('change', () => writeConfig({ enabled: toggle.checked }));

  const bindNumber = (cls: string, field: 'energyFloor' | 'dailyDrinkCap', max: number) => {
    const input = el.querySelector<HTMLInputElement>(cls);
    input?.addEventListener('change', () => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || input.value.trim() === '') {
        renderAll();
        return;
      }
      writeConfig({ [field]: Math.min(max, Math.max(0, Math.round(value))) });
    });
  };
  bindNumber('.ff-fyp-floor', 'energyFloor', 100);
  bindNumber('.ff-fyp-cap', 'dailyDrinkCap', 200);

  el.querySelector('.ff-fyp-check')?.addEventListener('click', () => checkNow());

  return el;
}

function updateVisibility(): void {
  if (!panelEl) return;
  const visible = document.querySelector(HALLOWEEN_MARKER) != null;
  panelEl.classList.toggle('ff-fyp-visible', visible);
  if (!visible && expanded) setExpanded(false);
}

export function initFuryCatcherPanel(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + PANEL_CSS);

  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);
  updateVisibility();
  refresh();

  // Background writes status after every chase/drink, and its own pause
  // turns `enabled` off — both have to show up here without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (STORAGE_KEYS.FURY_CATCHER_STATUS in changes) {
      status = changes[STORAGE_KEYS.FURY_CATCHER_STATUS].newValue ?? null;
      renderAll();
    }
    if (STORAGE_KEYS.FURY_CATCHER_CONFIG in changes) {
      config = changes[STORAGE_KEYS.FURY_CATCHER_CONFIG].newValue ?? null;
      renderAll();
    }
  });

  // The game swaps panel content in place — no navigation — so watch for the
  // event page coming and going, same as the other floating panels.
  const observer = new MutationObserver(() => updateVisibility());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}
