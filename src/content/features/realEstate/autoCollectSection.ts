import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { REAL_ESTATE_AUTO_MAX_INTERVAL_HOURS, REAL_ESTATE_AUTO_MIN_INTERVAL_HOURS, STORAGE_KEYS } from '@/shared/constants';
import type { RealEstateAutoConfig, RealEstateAutoStatus } from '@/shared/types';

/**
 * The Auto-Collect controls inside the Real Estate Advisor panel: the same
 * switch, interval, Check Now and collected/banked record as the popup's
 * Real Estate Auto-Collect page, on the panel's own tab (the player prefers in-page controls, since a
 * popup closes on any click outside it). Both read and write the same
 * storage, and each listens for the other's (and the background's) changes.
 */

/**
 * Controls are scoped under the panel's id: the game styles bare inputs and
 * buttons (full width, large padding), which a class alone doesn't outrank.
 */
export function autoSectionStyle(scope: string): string {
  return `
.ff-re-auto-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ff-re-auto-title { font-size: 12px; font-weight: 800; color: #f4d160; }
.ff-re-auto-state { margin-left: 6px; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: #71717a; }
.ff-re-auto-state[data-ff-state="on"] { color: #6ee7b7; }
.ff-re-auto-state[data-ff-state="stopped"] { color: #f87171; }
.ff-re-auto-sub { margin-top: 4px; font-size: 10px; color: #a1a1aa; line-height: 1.5; }
${scope} .ff-re-auto-toggle {
  appearance: none; -webkit-appearance: none; display: block; box-sizing: border-box;
  width: 32px; height: 18px; min-width: 0; margin: 0; padding: 0; border: none; border-radius: 999px;
  background: rgba(255,255,255,0.12); position: relative; cursor: pointer; flex: none; transition: background 0.15s;
}
${scope} .ff-re-auto-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #e4e4e7; transition: left 0.15s; }
${scope} .ff-re-auto-toggle:checked { background: #10b981; }
${scope} .ff-re-auto-toggle:checked::after { left: 16px; }
.ff-re-auto-setting {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: 12px; padding: 9px 10px; border-radius: 8px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
  font-size: 10.5px; color: #d4d4d8; line-height: 1.4;
}
${scope} .ff-re-auto-hours {
  box-sizing: border-box; width: 42px; height: 22px; min-width: 0; margin: 0; padding: 0 4px;
  border-radius: 6px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.18);
  color: #fff; font-size: 11px; font-weight: 800; line-height: 20px; text-align: center;
  font-family: 'Courier New', ui-monospace, monospace; -moz-appearance: textfield;
}
${scope} .ff-re-auto-hours:focus { outline: none; border-color: rgba(201,168,76,0.6); }
${scope} .ff-re-auto-check {
  box-sizing: border-box; width: auto; height: auto; margin: 0 0 0 auto; padding: 4px 10px;
  border-radius: 999px; font-size: 9.5px; font-weight: 800; line-height: 1.2; white-space: nowrap;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.14); color: #d9c48a; cursor: pointer;
}
${scope} .ff-re-auto-check:hover:not(:disabled) { border-color: rgba(201,168,76,0.5); }
${scope} .ff-re-auto-check:disabled { opacity: 0.45; cursor: default; }
.ff-re-auto-hint { margin-top: 6px; font-size: 9.5px; color: #8b8578; line-height: 1.45; }
.ff-re-auto-warn { margin-top: 6px; font-size: 9.5px; color: #fbbf24; line-height: 1.45; }
.ff-re-auto-stopped { margin-top: 10px; padding: 7px 9px; border-radius: 7px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.35); font-size: 10px; color: #fca5a5; line-height: 1.45; }
.ff-re-auto-note { margin-top: 8px; font-size: 9.5px; color: #a1a1aa; line-height: 1.45; }
.ff-re-auto-h { margin: 14px 0 6px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b6455; }
.ff-re-auto-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.ff-re-auto-stat { padding: 7px 9px; border-radius: 7px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); }
.ff-re-auto-stat-v { font-family: 'Courier New', ui-monospace, monospace; font-size: 12px; font-weight: 800; color: #fff; white-space: nowrap; }
.ff-re-auto-stat-l { font-size: 9px; color: #71717a; margin-top: 2px; }
.ff-re-auto-run { font-size: 9.5px; color: #a1a1aa; line-height: 1.45; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.04); }
.ff-re-auto-h + .ff-re-auto-run { border-top: none; }
.ff-re-auto-run b { color: #e4e4e7; font-family: 'Courier New', ui-monospace, monospace; }
.ff-re-auto-empty { font-size: 9.5px; color: #6b6455; }
`;
}

const RUNS_SHOWN = 5;

function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

function when(at: number): string {
  return new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function ago(at: number): string {
  const h = (Date.now() - at) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : `${h.toFixed(1)}h ago`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

let root: HTMLElement | null = null;
/** The panel's Auto-Collect tab, which shows on/off/stopped as a dot. */
let tabEl: HTMLElement | null = null;
let config: RealEstateAutoConfig | null = null;
let status: RealEstateAutoStatus | null = null;
let checking = false;
let lastHtml = '';
/** The first vault worth caring about and when it fills after a collection,
 *  from the advisor's own card parse. */
let firstFill: { hours: number; name: string } | null = null;

export function setFirstFill(next: { hours: number; name: string } | null): void {
  if (next?.name === firstFill?.name && next?.hours === firstFill?.hours) return;
  firstFill = next;
  render();
}

async function writeConfig(patch: Partial<RealEstateAutoConfig>): Promise<void> {
  if (!config) return;
  const next = { ...config, ...patch };
  config = next;
  try {
    await storage.setRealEstateAutoConfig(next);
    if (patch.enabled && status?.pausedMessage) {
      status = { ...status, pausedMessage: null, pausedAt: null };
      await storage.setRealEstateAutoStatus(status);
    }
  } catch (err) {
    console.error(LOG_PREFIX, 'failed to save real estate auto config', err);
  }
  render();
}

async function checkNow(): Promise<void> {
  checking = true;
  render();
  try {
    status = (await chrome.runtime.sendMessage({ type: 'real-estate-auto-check-requested' })) as RealEstateAutoStatus | null;
  } catch (err) {
    console.error(LOG_PREFIX, 'real estate auto check-now failed', err);
  } finally {
    checking = false;
    render();
  }
}

function render(): void {
  if (!root || !config) return;
  const on = config.enabled;
  const state = status?.pausedMessage ? 'stopped' : on ? 'on' : 'off';
  tabEl?.setAttribute('data-ff-state', state);
  const tooLong = firstFill !== null && config.intervalHours >= firstFill.hours;
  const runs = status?.history.slice(0, RUNS_SHOWN) ?? [];

  const sub = on
    ? 'Collects and banks for you when nobody has collected in the hours below. Every collection you make restarts the countdown.'
    : 'A safety net for days you miss: when nobody has collected in the hours below, it collects everything and banks the cash.';

  const stat = (value: string, label: string, color = '#fff') =>
    `<div class="ff-re-auto-stat"><div class="ff-re-auto-stat-v" style="color:${color}">${value}</div><div class="ff-re-auto-stat-l">${label}</div></div>`;
  const stats = `
    <div class="ff-re-auto-stats">
      ${stat(money(status?.today.collected ?? 0), 'Collected today', '#6ee7b7')}
      ${stat(money(status?.today.banked ?? 0), 'Banked today', '#f4d160')}
      ${stat(money(status?.lifetime.collected ?? 0), 'Collected all-time', '#6ee7b7')}
      ${stat(String(status?.lifetime.runs ?? 0), 'Times it stepped in')}
      ${stat(status?.lastCollectionAt ? ago(status.lastCollectionAt) : '—', 'Last collection (anyone)')}
      ${stat(on && status?.nextCheckAt ? when(status.nextCheckAt) : '—', 'Next check')}
    </div>`;

  const runRows = runs
    .map(
      (r) =>
        `<div class="ff-re-auto-run">${escapeHtml(when(r.at))} · after ${r.afterHours.toFixed(1)}h · collected <b>${money(r.collected)}</b> · ${
          r.banked !== null ? `banked <b>${money(r.banked)}</b>` : 'not banked'
        }</div>`,
    )
    .join('');

  const hint =
    tooLong && firstFill
      ? `<div class="ff-re-auto-warn">Too long: an empty ${escapeHtml(firstFill.name)} vault is full after ${firstFill.hours.toFixed(1)}h, so by ${config.intervalHours}h it's already losing money. Set it under ${Math.floor(firstFill.hours)}h.</div>`
      : firstFill
        ? `<div class="ff-re-auto-hint">✓ Good: an empty ${escapeHtml(firstFill.name)} vault takes ${firstFill.hours.toFixed(1)}h to fill (your first to fill), so ${config.intervalHours}h collects before anything is lost.</div>`
        : '';

  const html = `
    <div class="ff-re-auto-top">
      <div><span class="ff-re-auto-title">Auto-Collect</span><span class="ff-re-auto-state" data-ff-state="${state}">${state}</span></div>
      <input class="ff-re-auto-toggle" type="checkbox" ${on ? 'checked' : ''} title="Turn Auto-Collect on or off">
    </div>
    <div class="ff-re-auto-sub">${sub}</div>
    ${
      status?.pausedMessage
        ? `<div class="ff-re-auto-stopped"><b>Stopped:</b> ${escapeHtml(status.pausedMessage)}<br>Collect by hand, then switch it back on.</div>`
        : ''
    }
    <div class="ff-re-auto-setting">
      Collect after <input class="ff-re-auto-hours" type="number" min="${REAL_ESTATE_AUTO_MIN_INTERVAL_HOURS}" max="${REAL_ESTATE_AUTO_MAX_INTERVAL_HOURS}" value="${config.intervalHours}"> hours
      <button class="ff-re-auto-check" type="button" ${checking ? 'disabled' : ''}>${checking ? 'Checking…' : 'Check now'}</button>
    </div>
    ${hint}
    ${on && status?.note ? `<div class="ff-re-auto-note">${escapeHtml(status.note)}</div>` : ''}
    <div class="ff-re-auto-h">What it's done</div>
    ${stats}
    <div class="ff-re-auto-h">Recent runs</div>
    ${runs.length ? runRows : '<div class="ff-re-auto-empty">None yet. It only steps in when a collection is overdue.</div>'}
  `;

  // Don't rebuild under the player while they're typing a new interval.
  if (root.contains(document.activeElement) && document.activeElement?.classList.contains('ff-re-auto-hours')) return;
  if (html === lastHtml) return;
  lastHtml = html;
  root.innerHTML = html;

  root.querySelector<HTMLInputElement>('.ff-re-auto-toggle')?.addEventListener('change', (e) => {
    void writeConfig({ enabled: (e.target as HTMLInputElement).checked });
  });
  const hours = root.querySelector<HTMLInputElement>('.ff-re-auto-hours');
  hours?.addEventListener('change', () => {
    const v = Math.round(Number(hours.value));
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(REAL_ESTATE_AUTO_MAX_INTERVAL_HOURS, Math.max(REAL_ESTATE_AUTO_MIN_INTERVAL_HOURS, v));
    hours.blur();
    void writeConfig({ intervalHours: clamped });
  });
  hours?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hours.blur();
  });
  root.querySelector('.ff-re-auto-check')?.addEventListener('click', () => void checkNow());
}

export async function mountAutoCollect(el: HTMLElement, tab: HTMLElement | null = null): Promise<void> {
  root = el;
  tabEl = tab;
  try {
    [config, status] = await Promise.all([storage.getRealEstateAutoConfig(), storage.getRealEstateAutoStatus()]);
  } catch (err) {
    console.error(LOG_PREFIX, 'failed to load real estate auto state', err);
    return;
  }
  render();

  // The background writes status after each check and turns the switch off
  // when it pauses; the popup can change both too.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (STORAGE_KEYS.REAL_ESTATE_AUTO_CONFIG in changes) config = changes[STORAGE_KEYS.REAL_ESTATE_AUTO_CONFIG].newValue ?? config;
    if (STORAGE_KEYS.REAL_ESTATE_AUTO_STATUS in changes) status = changes[STORAGE_KEYS.REAL_ESTATE_AUTO_STATUS].newValue ?? null;
    if (STORAGE_KEYS.REAL_ESTATE_AUTO_CONFIG in changes || STORAGE_KEYS.REAL_ESTATE_AUTO_STATUS in changes) render();
  });
  // "3.2h ago" and the like age with the clock.
  setInterval(render, 60_000);
}
