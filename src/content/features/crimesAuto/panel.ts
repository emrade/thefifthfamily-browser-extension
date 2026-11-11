import { dashboardLinkHtml } from '@/content/shared/dashboardLink';
import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { STORAGE_KEYS } from '@/shared/constants';
import { storage } from '@/shared/storage';
import type { CrimesAutoConfig, CrimesAutoStatus } from '@/shared/types';

/**
 * Crimes Auto on Crime Alley itself, same badge-that-expands shape as the
 * Career Auto panel, with what the popup's Crimes Auto tab has: the Auto-Run
 * switch, Check Now, the stopped / district-mastered notes, next check and
 * the running totals. Reads and writes the same `chrome.storage` config and
 * status as the popup and the background runner, and follows their changes
 * live. The alarm (Next check) is asked of the background.
 */

const CONTAINER_ID = 'ff-crimes-auto-panel';
const STYLE_ID = 'ff-crimes-auto-panel-style';
const CARD_SELECTOR = '.crime-card[id^="crime-card-"]';

const PANEL_CSS = `
#${CONTAINER_ID} {
  position: fixed; bottom: 20px; right: 20px; z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif; display: none;
}
#${CONTAINER_ID}.ff-crp-visible { display: block; }

#${CONTAINER_ID} .ff-crp-badge {
  display: flex; align-items: center; gap: 10px; width: auto; margin: 0; padding: 10px 16px;
  background: linear-gradient(180deg, rgba(20,20,28,0.96), rgba(10,10,15,0.96));
  border: 1px solid rgba(201,168,76,0.45); border-radius: 999px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5); cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
#${CONTAINER_ID} .ff-crp-badge:hover { border-color: rgba(201,168,76,0.8); transform: translateY(-1px); }
.ff-crp-badge-label { font-size: 10.5px; color: #d9c48a; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }

.ff-crp-panel {
  display: none; width: 300px; max-height: 75vh; overflow-y: auto; padding: 16px;
  background: linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98));
  border: 1px solid rgba(201,168,76,0.45); border-radius: 14px;
  box-shadow: 0 10px 34px rgba(0,0,0,0.6); color: #ccc;
}
#${CONTAINER_ID}.ff-crp-expanded .ff-crp-panel { display: block; }
#${CONTAINER_ID}.ff-crp-expanded .ff-crp-badge { display: none; }

.ff-crp-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
#${CONTAINER_ID} .ff-crp-close {
  width: auto; margin: 0; background: none; border: none; color: #8b8f9e;
  font-size: 16px; line-height: 1; cursor: pointer; padding: 2px 6px;
}
#${CONTAINER_ID} .ff-crp-close:hover { color: #fff; }

.ff-crp-toggle-row {
  display: flex; align-items: center; gap: 12px; padding: 11px 12px; margin-bottom: 12px;
  background: #17130e; border: 1px solid rgba(201,168,76,0.16); border-radius: 10px; cursor: pointer;
}
.ff-crp-toggle-row__text { flex: 1; min-width: 0; }
.ff-crp-toggle-row__title { font-weight: 700; font-size: 12.5px; color: #f1ede2; }
.ff-crp-toggle-row__status { font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 9.5px; color: #6b6455; margin-top: 1px; line-height: 1.4; }
#${CONTAINER_ID} .ff-crp-toggle {
  flex-shrink: 0; appearance: none; -webkit-appearance: none; display: block; box-sizing: border-box;
  width: 34px; height: 20px; min-width: 0; margin: 0; padding: 0; border-radius: 10px;
  background: rgba(0,0,0,0.5); border: 1px solid rgba(201,168,76,0.34);
  position: relative; cursor: pointer; transition: background 0.15s, border-color 0.15s;
}
#${CONTAINER_ID} .ff-crp-toggle::before {
  content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: #6b6455; transition: transform 0.15s cubic-bezier(.22,1,.36,1), background 0.15s;
}
#${CONTAINER_ID} .ff-crp-toggle:checked { background: rgba(251,191,36,0.18); border-color: #fbbf24; }
#${CONTAINER_ID} .ff-crp-toggle:checked::before { transform: translateX(14px); background: #fbbf24; box-shadow: 0 0 6px rgba(251,191,36,0.5); }

.ff-crp-alert {
  padding: 8px 10px; margin-bottom: 12px; font-size: 10px; line-height: 1.5;
  background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.35); border-radius: 7px; color: #fca5a5;
}
.ff-crp-alert--gold { background: rgba(201,168,76,0.08); border-color: rgba(201,168,76,0.4); color: #e8d9a8; }
.ff-crp-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b6455; margin: 12px 0 5px; }
.ff-crp-hint { font-size: 9.5px; color: #8b8578; line-height: 1.45; margin-top: 5px; }
#${CONTAINER_ID} .ff-crp-run {
  box-sizing: border-box; display: block; width: 100%; height: auto; margin: 0; padding: 7px 10px; border-radius: 8px;
  font-size: 11px; font-weight: 700; line-height: 1.2; cursor: pointer;
  background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.5); color: #d9c48a;
}
#${CONTAINER_ID} .ff-crp-run:hover:not(:disabled) { border-color: #c9a84c; }
#${CONTAINER_ID} .ff-crp-run:disabled { opacity: 0.45; cursor: default; }

.ff-crp-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.ff-crp-stat-tile { padding: 8px 4px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; text-align: center; min-width: 0; }
.ff-crp-stat-tile__value { font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 11.5px; font-weight: 700; color: #f1ede2; overflow-wrap: anywhere; }
.ff-crp-stat-tile__label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b6455; margin-top: 3px; }
.ff-crp-row { font-size: 10px; color: #a1a1aa; padding: 8px 0 0; line-height: 1.4; }
.ff-crp-empty { font-size: 10.5px; color: #6b6455; padding: 4px 0; }
`;

let panelEl: HTMLDivElement | null = null;
let expanded = false;
let config: CrimesAutoConfig | null = null;
let status: CrimesAutoStatus | null = null;
let nextAlarmAt: number | null = null;
let checking = false;
let checkError: string | null = null;
let lastBodyHtml = '';
let tickTimer: ReturnType<typeof setInterval> | null = null;
let ticks = 0;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** "4:15 PM · in 3:42", same as the popup's Next Check tile. */
function formatNextRun(nextRunAt: number, now: number): string {
  const clock = new Date(nextRunAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const remainingSeconds = Math.max(0, Math.round((nextRunAt - now) / 1000));
  if (remainingSeconds === 0) return `${clock} · due now`;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${clock} · in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatOutcome(outcome: NonNullable<CrimesAutoStatus['lastAttempt']>['outcome']): string {
  switch (outcome) {
    case 'success':
      return 'Success';
    case 'busted-clean':
      return 'Busted, slipped away';
    case 'busted-bailed':
      return 'Busted, bailed out';
  }
}

async function setEnabled(enabling: boolean): Promise<void> {
  if (!config) return;
  config = { ...config, enabled: enabling };
  renderPanel();
  try {
    await storage.setCrimesAutoConfig(config);
    // Same as the popup: switching back on clears a stale "stopped" or
    // "district mastered" note.
    if (enabling && status && (status.pausedReason || status.districtMasteredAt)) {
      status = { ...status, pausedReason: null, pausedMessage: null, pausedAt: null, districtMasteredAt: null };
      await storage.setCrimesAutoStatus(status);
    }
  } catch (err) {
    console.error(LOG_PREFIX, 'crimes auto panel config write failed', err);
  }
}

/** Check Now: one check right now, even with Auto-Run off (e.g. after using
 *  a Nerve item in-game). Same message as the popup's button. */
async function checkNow(): Promise<void> {
  checking = true;
  checkError = null;
  renderPanel();
  try {
    status = (await chrome.runtime.sendMessage({ type: 'crimes-check-requested' })) as CrimesAutoStatus | null;
  } catch (err) {
    console.error(LOG_PREFIX, 'crimes auto panel check-now failed', err);
    checkError = 'Could not reach the background service. Try again in a moment.';
  } finally {
    checking = false;
    await refreshNextAlarm();
    renderPanel();
  }
}

async function refreshNextAlarm(): Promise<void> {
  if (!config?.enabled) {
    nextAlarmAt = null;
    return;
  }
  try {
    nextAlarmAt = (await chrome.runtime.sendMessage({ type: 'crimes-auto-next-check-requested' })) as number | null;
  } catch (err) {
    console.error(LOG_PREFIX, 'crimes auto panel next-check read failed', err);
  }
  renderPanel();
}

function badgeLabel(): string {
  if (status?.pausedReason) return 'Stopped';
  if (!config?.enabled) return 'Off';
  if (status?.districtMasteredAt) return 'District mastered';
  const n = status?.attempts ?? 0;
  return `${n} attempt${n === 1 ? '' : 's'} · $${(status?.cashEarned ?? 0).toLocaleString()}`;
}

function bodyHtml(now: number): string {
  if (!config) return '<div class="ff-crp-empty">Loading…</div>';
  const parts: string[] = [];

  parts.push(`
    <label class="ff-crp-toggle-row">
      <div class="ff-crp-toggle-row__text">
        <div class="ff-crp-toggle-row__title">Auto-Run</div>
        <div class="ff-crp-toggle-row__status">${
          config.enabled ? "Working this district's crimes until every one is Mastered." : 'Off: nothing will run.'
        }</div>
      </div>
      <input class="ff-crp-toggle" type="checkbox" data-ff-field="enabled" ${config.enabled ? 'checked' : ''}>
    </label>`);

  if (status?.pausedReason) {
    parts.push(
      `<div class="ff-crp-alert"><strong>Crimes Auto stopped</strong>${
        status.pausedMessage ? `<br>"${escapeHtml(status.pausedMessage)}"` : ''
      }<br>Check Crime Alley, then switch Auto-Run back on above.</div>`,
    );
  } else if (status?.districtMasteredAt) {
    parts.push(
      `<div class="ff-crp-alert ff-crp-alert--gold"><strong>Nothing left in this district</strong><br>Every crime here has been Mastered since ${escapeHtml(
        new Date(status.districtMasteredAt).toLocaleString(),
      )}. ${
        config.enabled
          ? "Auto-Run stays on: it checks every 5 minutes and carries on by itself in a district with unfinished crimes."
          : 'Switch Auto-Run on when you are in a district with unfinished crimes.'
      }</div>`,
    );
  }

  parts.push(`<button class="ff-crp-run" type="button" data-ff-act="check" ${checking ? 'disabled' : ''}>${checking ? 'Checking…' : 'Check Now'}</button>`);
  parts.push('<div class="ff-crp-hint">Runs one check right now, even with Auto-Run off. Handy after using a Nerve item.</div>');
  if (checkError) parts.push(`<div class="ff-crp-hint">${escapeHtml(checkError)}</div>`);

  parts.push('<div class="ff-crp-label">Status</div>');
  const nextRunAt = config.enabled ? nextAlarmAt : null;
  const s = status;
  const tile = (value: string, label: string, color = '#f1ede2') =>
    `<div class="ff-crp-stat-tile"><div class="ff-crp-stat-tile__value" style="color:${color}">${value}</div><div class="ff-crp-stat-tile__label">${label}</div></div>`;
  parts.push(`<div class="ff-crp-stat-grid">
    ${tile(nextRunAt ? formatNextRun(nextRunAt, now) : '—', 'Next check')}
    ${tile(String(s?.attempts ?? 0), 'Attempts')}
    ${tile(String(s?.successes ?? 0), 'Successes', '#4ade80')}
    ${tile(String(s?.busts ?? 0), 'Busts', '#f87171')}
    ${tile(`$${(s?.cashEarned ?? 0).toLocaleString()}`, 'Cash', '#4ade80')}
    ${tile((s?.xpEarned ?? 0).toLocaleString(), 'XP', '#a78bfa')}
    ${tile(`${s?.bailsPaid ?? 0} · $${(s?.bailCashSpent ?? 0).toLocaleString()}`, 'Bails')}
    ${tile(`${s?.bribesPaid ?? 0} · $${(s?.bribeCashSpent ?? 0).toLocaleString()}`, 'Bribes')}
  </div>`);

  const last = s?.lastAttempt;
  if (last) {
    const gain = last.outcome === 'success' ? ` · $${last.cashGained.toLocaleString()} · +${last.xpGained} XP` : '';
    parts.push(
      `<div class="ff-crp-row">${escapeHtml(last.crimeName)}: ${formatOutcome(last.outcome)}${gain} · ${escapeHtml(new Date(last.timestamp).toLocaleString())}</div>`,
    );
  } else {
    parts.push('<div class="ff-crp-empty">No attempts yet.</div>');
  }
  return parts.join('');
}

function renderPanel(): void {
  if (!panelEl) return;
  const label = panelEl.querySelector('.ff-crp-badge-label');
  if (label) label.textContent = badgeLabel();
  if (!expanded) return;
  const body = panelEl.querySelector('.ff-crp-body');
  if (!body) return;
  const html = bodyHtml(Date.now());
  if (html === lastBodyHtml) return;
  lastBodyHtml = html;
  body.innerHTML = html;
}

function setExpanded(next: boolean): void {
  expanded = next;
  panelEl?.classList.toggle('ff-crp-expanded', expanded);
  if (expanded) {
    lastBodyHtml = '';
    void refreshNextAlarm();
    renderPanel();
    // The countdown ticks each second; the alarm is re-read every 5 s, since
    // a check can reschedule without writing status.
    if (tickTimer === null) {
      tickTimer = setInterval(() => {
        if (++ticks % 5 === 0) void refreshNextAlarm();
        else renderPanel();
      }, 1_000);
    }
  } else if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.innerHTML = `
    <button class="ff-crp-badge" type="button">
      ${brandBadgeHtml('Crimes Auto')}
      <span class="ff-crp-badge-label">Loading…</span>
    </button>
    <div class="ff-crp-panel">
      <div class="ff-crp-head">
        ${brandBadgeHtml('Crimes Auto')}
        ${dashboardLinkHtml('automations/crimes-auto')}
        <button class="ff-crp-close" type="button" title="Collapse">✕</button>
      </div>
      <div class="ff-crp-body"><div class="ff-crp-empty">Loading…</div></div>
    </div>
  `;
  el.querySelector('.ff-crp-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-crp-close')?.addEventListener('click', () => setExpanded(false));
  // Delegated: the body is rebuilt on every change.
  el.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.getAttribute('data-ff-field') === 'enabled') void setEnabled(target.checked);
  });
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-ff-act="check"]')) void checkNow();
  });
  return el;
}

function updateVisibility(): void {
  if (!panelEl) return;
  const visible = document.querySelector(CARD_SELECTOR) != null;
  panelEl.classList.toggle('ff-crp-visible', visible);
  if (!visible && expanded) setExpanded(false);
}

export function initCrimesAutoPanel(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + PANEL_CSS);
  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);

  Promise.all([storage.getCrimesAutoConfig(), storage.getCrimesAutoStatus()])
    .then(([c, s]) => {
      config = c;
      status = s;
      updateVisibility();
      renderPanel();
    })
    .catch((err) => console.error(LOG_PREFIX, 'crimes auto panel load failed', err));

  // The background writes status after every attempt and can switch Auto-Run
  // off when it stops; the popup can change both too.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const configChanged = STORAGE_KEYS.CRIMES_AUTO_CONFIG in changes;
    const statusChanged = STORAGE_KEYS.CRIMES_AUTO_STATUS in changes;
    if (configChanged) config = changes[STORAGE_KEYS.CRIMES_AUTO_CONFIG].newValue ?? config;
    if (statusChanged) status = changes[STORAGE_KEYS.CRIMES_AUTO_STATUS].newValue ?? null;
    if (!configChanged && !statusChanged) return;
    renderPanel();
    if (expanded) void refreshNextAlarm();
  });

  // The game swaps page content in place, so a mutation is the only sign
  // Crime Alley has appeared or gone. Batched to one pass per frame.
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      updateVisibility();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
