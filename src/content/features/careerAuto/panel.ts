import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { STORAGE_KEYS } from '@/shared/constants';
import { storage } from '@/shared/storage';
import { CAREER_SHIFT_MODE_HINT, CAREER_SHIFT_MODE_OPTIONS, careerWaitingText } from '@/shared/careerAutoDisplay';
import type { CareerAutoConfig, CareerAutoStatus, CareerCatalogEntry } from '@/shared/types';

/**
 * Career Auto on the Careers page itself, for a player who'd rather not work
 * from the popup (it closes on any click outside it). Two parts:
 *
 * - A floating panel, same badge-that-expands shape as the Street Intel
 *   panel, with everything the popup's Career Auto tab has: the Auto-Run
 *   switch, job dropdown, shift mode, next shift and today's numbers.
 * - An "Auto-run this job" button on every job card, so a job can be picked
 *   right where its perks and progress are. It only asks first; nothing
 *   changes until Confirm, so a stray tap can't switch the running job.
 *
 * Both read and write the same `chrome.storage` config and status as the
 * popup and the background runner, and follow each other's changes live.
 * The scheduled alarm (for Next Shift) is the one thing a content script
 * can't read, so that's asked of the background.
 */

const CONTAINER_ID = 'ff-career-auto-panel';
const STYLE_ID = 'ff-career-auto-panel-style';
const CARD_SELECTOR = '.cv2-card[id^="career-card-"]';

const PANEL_CSS = `
#${CONTAINER_ID} {
  position: fixed; bottom: 20px; right: 20px; z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif; display: none;
}
#${CONTAINER_ID}.ff-cap-visible { display: block; }

#${CONTAINER_ID} .ff-cap-badge {
  display: flex; align-items: center; gap: 10px; width: auto; margin: 0; padding: 10px 16px;
  background: linear-gradient(180deg, rgba(20,20,28,0.96), rgba(10,10,15,0.96));
  border: 1px solid rgba(201,168,76,0.45); border-radius: 999px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5); cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
#${CONTAINER_ID} .ff-cap-badge:hover { border-color: rgba(201,168,76,0.8); transform: translateY(-1px); }
.ff-cap-badge-label { font-size: 10.5px; color: #d9c48a; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }

.ff-cap-panel {
  display: none; width: 300px; max-height: 75vh; overflow-y: auto; padding: 16px;
  background: linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98));
  border: 1px solid rgba(201,168,76,0.45); border-radius: 14px;
  box-shadow: 0 10px 34px rgba(0,0,0,0.6); color: #ccc;
}
#${CONTAINER_ID}.ff-cap-expanded .ff-cap-panel { display: block; }
#${CONTAINER_ID}.ff-cap-expanded .ff-cap-badge { display: none; }

.ff-cap-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
#${CONTAINER_ID} .ff-cap-close {
  width: auto; margin: 0; background: none; border: none; color: #8b8f9e;
  font-size: 16px; line-height: 1; cursor: pointer; padding: 2px 6px;
}
#${CONTAINER_ID} .ff-cap-close:hover { color: #fff; }

.ff-cap-toggle-row {
  display: flex; align-items: center; gap: 12px; padding: 11px 12px; margin-bottom: 12px;
  background: #17130e; border: 1px solid rgba(201,168,76,0.16); border-radius: 10px; cursor: pointer;
}
.ff-cap-toggle-row__text { flex: 1; min-width: 0; }
.ff-cap-toggle-row__title { font-weight: 700; font-size: 12.5px; color: #f1ede2; }
.ff-cap-toggle-row__status { font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 9.5px; color: #6b6455; margin-top: 1px; line-height: 1.4; }
#${CONTAINER_ID} .ff-cap-toggle {
  flex-shrink: 0; appearance: none; -webkit-appearance: none; display: block; box-sizing: border-box;
  width: 34px; height: 20px; min-width: 0; margin: 0; padding: 0; border-radius: 10px;
  background: rgba(0,0,0,0.5); border: 1px solid rgba(201,168,76,0.34);
  position: relative; cursor: pointer; transition: background 0.15s, border-color 0.15s;
}
#${CONTAINER_ID} .ff-cap-toggle::before {
  content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: #6b6455; transition: transform 0.15s cubic-bezier(.22,1,.36,1), background 0.15s;
}
#${CONTAINER_ID} .ff-cap-toggle:checked { background: rgba(251,191,36,0.18); border-color: #fbbf24; }
#${CONTAINER_ID} .ff-cap-toggle:checked::before { transform: translateX(14px); background: #fbbf24; box-shadow: 0 0 6px rgba(251,191,36,0.5); }
#${CONTAINER_ID} .ff-cap-toggle:disabled { opacity: 0.4; cursor: default; }

.ff-cap-alert {
  padding: 8px 10px; margin-bottom: 12px; font-size: 10px; line-height: 1.5;
  background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.35); border-radius: 7px; color: #fca5a5;
}
.ff-cap-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b6455; margin: 12px 0 5px; }
.ff-cap-hint { font-size: 9.5px; color: #8b8578; line-height: 1.45; margin-top: 5px; }
#${CONTAINER_ID} .ff-cap-select {
  box-sizing: border-box; display: block; width: 100%; height: auto; margin: 0; padding: 6px 8px;
  border-radius: 7px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.18);
  color: #f1ede2; font-size: 11px; line-height: 1.3;
}
#${CONTAINER_ID} .ff-cap-select:focus { outline: none; border-color: rgba(201,168,76,0.6); }
#${CONTAINER_ID} .ff-cap-search {
  box-sizing: border-box; display: block; width: 100%; height: auto; margin: 0 0 6px; padding: 6px 8px;
  border-radius: 7px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.18);
  color: #f1ede2; font-size: 11px; line-height: 1.3;
}
#${CONTAINER_ID} .ff-cap-search:focus { outline: none; border-color: rgba(201,168,76,0.6); }
#${CONTAINER_ID} .ff-cap-select:disabled { opacity: 0.5; }
#${CONTAINER_ID} .ff-cap-link {
  width: auto; height: auto; margin: 6px 0 0; padding: 0; background: none; border: none;
  color: #d9c48a; font-size: 9.5px; font-weight: 700; cursor: pointer;
}
#${CONTAINER_ID} .ff-cap-link:disabled { opacity: 0.45; cursor: default; }
#${CONTAINER_ID} .ff-cap-run {
  box-sizing: border-box; display: block; width: 100%; height: auto; margin: 0; padding: 7px 10px; border-radius: 8px;
  font-size: 11px; font-weight: 700; line-height: 1.2; cursor: pointer;
  background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.5); color: #d9c48a;
}
#${CONTAINER_ID} .ff-cap-run:hover:not(:disabled) { border-color: #c9a84c; }
#${CONTAINER_ID} .ff-cap-run:disabled { opacity: 0.45; cursor: default; }

.ff-cap-waiting { font-size: 10.5px; color: #fbbf24; padding: 2px 0 8px; line-height: 1.4; }
.ff-cap-stat-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.ff-cap-stat-tile { padding: 8px 4px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; text-align: center; min-width: 0; }
.ff-cap-stat-tile__value { font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 11.5px; font-weight: 700; color: #f1ede2; overflow-wrap: anywhere; }
.ff-cap-stat-tile__label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b6455; margin-top: 3px; }
.ff-cap-row { font-size: 10px; color: #a1a1aa; padding: 8px 0 0; line-height: 1.4; }
.ff-cap-empty { font-size: 10.5px; color: #6b6455; padding: 4px 0; }

.ff-ca-pick { margin-top: 8px; font-family: 'Inter', system-ui, sans-serif; }
.cv2-card .ff-ca-pick button {
  box-sizing: border-box; width: 100%; height: auto; margin: 0; padding: 7px 10px; border-radius: 8px;
  font-size: 11px; font-weight: 700; line-height: 1.2; cursor: pointer;
  background: rgba(201,168,76,0.08); border: 1px dashed rgba(201,168,76,0.45); color: #d9c48a;
}
.cv2-card .ff-ca-pick button:hover { border-style: solid; }
.ff-ca-pick-confirm { padding: 8px 10px; border-radius: 8px; background: rgba(201,168,76,0.1); border: 1px solid rgba(201,168,76,0.5); }
.ff-ca-pick-q { font-size: 11px; color: #f1ede2; line-height: 1.4; margin-bottom: 7px; }
.ff-ca-pick-actions { display: flex; gap: 6px; }
.cv2-card .ff-ca-pick .ff-ca-pick-actions button { flex: 1; border-style: solid; }
.cv2-card .ff-ca-pick .ff-ca-pick-actions button[data-ff-act="confirm"] { background: #c9a84c; border-color: #c9a84c; color: #17130e; }
.ff-ca-pick-chip {
  padding: 7px 10px; border-radius: 8px; font-size: 11px; font-weight: 700; text-align: center;
  background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.45); color: #6ee7b7;
}
.ff-ca-pick-chip[data-ff-state="off"] { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.15); color: #a1a1aa; }
`;

let panelEl: HTMLDivElement | null = null;
let expanded = false;
let config: CareerAutoConfig | null = null;
let status: CareerAutoStatus | null = null;
let catalog: CareerCatalogEntry[] | null = null;
let catalogLoading = false;
let catalogError: string | null = null;
let nextAlarmAt: number | null = null;
/** From the last stats the game tab fetched; null until read. */
let playerLevel: number | null = null;
let running = false;
let runError: string | null = null;
/** The job search box's text; filters the dropdown by name, like the popup's. */
let jobQuery = '';
/** The card whose "Auto-run this job" was tapped and is waiting on Confirm. */
let pendingPickId: number | null = null;
let lastBodyHtml = '';
let tickTimer: ReturnType<typeof setInterval> | null = null;
let ticks = 0;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Same local calendar-day key as `runner.ts` and the popup. */
function localDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "4:15 PM · in 3:42", same as the popup's Next Shift tile. */
function formatNextRun(nextRunAt: number, now: number): string {
  const clock = new Date(nextRunAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const remainingSeconds = Math.max(0, Math.round((nextRunAt - now) / 1000));
  if (remainingSeconds === 0) return `${clock} · due now`;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${clock} · in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function today(): { shifts: number; cash: number } {
  if (status?.shiftsTodayDate !== localDateKey()) return { shifts: 0, cash: 0 };
  return { shifts: status.shiftsToday, cash: status.cashToday ?? 0 };
}

async function writeConfig(patch: Partial<CareerAutoConfig>): Promise<void> {
  if (!config) return;
  const next = { ...config, ...patch };
  config = next;
  renderAll();
  try {
    await storage.setCareerAutoConfig(next);
  } catch (err) {
    console.error(LOG_PREFIX, 'career auto panel config write failed', err);
  }
}

async function writeStatus(patch: Partial<CareerAutoStatus>): Promise<void> {
  if (!status) return;
  status = { ...status, ...patch };
  try {
    await storage.setCareerAutoStatus(status);
  } catch (err) {
    console.error(LOG_PREFIX, 'career auto panel status write failed', err);
  }
}

async function setEnabled(enabling: boolean): Promise<void> {
  await writeConfig({ enabled: enabling });
  // Same as the popup: switching back on clears the old "stopped" banner.
  if (enabling && status?.pausedReason) await writeStatus({ pausedReason: null, pausedMessage: null, pausedAt: null });
}

/** Same as the popup's `selectJob`. The tracked cooldown and waiting reason
 *  belonged to the previous job, so they're cleared rather than shown as if
 *  they applied to the new one. Doesn't touch the Auto-Run switch. */
async function selectJob(entry: Pick<CareerCatalogEntry, 'careerId' | 'name' | 'energyCost' | 'otEnergyCost'>): Promise<void> {
  await writeConfig({ careerId: entry.careerId, careerName: entry.name, energyCost: entry.energyCost, otEnergyCost: entry.otEnergyCost });
  if (status?.nextEligibleAt || status?.waiting) await writeStatus({ nextEligibleAt: null, waiting: null });
}

async function loadCatalog(): Promise<void> {
  catalogLoading = true;
  catalogError = null;
  renderAll();
  try {
    catalog = (await chrome.runtime.sendMessage({ type: 'career-catalog-requested' })) as CareerCatalogEntry[];
  } catch (err) {
    console.error(LOG_PREFIX, 'career auto panel catalog fetch failed', err);
    catalogError = 'Could not read the job list. Try again in a moment.';
  } finally {
    catalogLoading = false;
    renderAll();
  }
}

/** Run Now: one check right now, even with Auto-Run off — for a wait the
 *  runner can't see end early (bailing out, a discharge, an energy refill). */
async function runNow(): Promise<void> {
  running = true;
  runError = null;
  renderAll();
  try {
    status = (await chrome.runtime.sendMessage({ type: 'career-auto-run-requested' })) as CareerAutoStatus | null;
  } catch (err) {
    console.error(LOG_PREFIX, 'career auto panel run-now failed', err);
    runError = 'Could not reach the background service. Try again in a moment.';
  } finally {
    running = false;
    await refreshNextAlarm();
    renderAll();
  }
}

async function refreshNextAlarm(): Promise<void> {
  if (!config?.enabled) {
    nextAlarmAt = null;
    return;
  }
  try {
    nextAlarmAt = (await chrome.runtime.sendMessage({ type: 'career-auto-next-check-requested' })) as number | null;
  } catch (err) {
    console.error(LOG_PREFIX, 'career auto panel next-check read failed', err);
  }
  renderAll();
}

// ── Floating panel ──────────────────────────────────────────────────────────

function badgeLabel(): string {
  if (status?.pausedReason) return 'Stopped';
  if (!config?.enabled) return 'Off';
  const t = today();
  return `${t.shifts} shift${t.shifts === 1 ? '' : 's'} · $${t.cash.toLocaleString()} today`;
}

function jobSelectHtml(): string {
  if (!config) return '';
  const current = config.careerId;
  const options: string[] = [];
  if (!catalog) {
    options.push(
      current != null
        ? `<option value="${current}" selected>${escapeHtml(config.careerName)}</option>`
        : `<option value="" selected disabled>${catalogLoading ? 'Loading jobs…' : 'Select a job'}</option>`,
    );
  } else {
    const query = jobQuery.trim().toLowerCase();
    const shown = query ? catalog.filter((c) => c.name.toLowerCase().includes(query)) : catalog;
    if (current == null) options.push('<option value="" selected disabled>Select a job</option>');
    // Kept as an option when the search hides it, so the dropdown doesn't
    // look like a different job is selected.
    if (current != null && !shown.some((c) => c.careerId === current)) {
      options.push(`<option value="${current}" selected>${escapeHtml(config.careerName)} — currently selected</option>`);
    }
    const families = new Map<string, CareerCatalogEntry[]>();
    for (const c of shown) {
      const group = families.get(c.family);
      if (group) group.push(c);
      else families.set(c.family, [c]);
    }
    for (const family of [...families.keys()].sort()) {
      options.push(`<optgroup label="${escapeHtml(family)}">`);
      for (const c of families.get(family)!) {
        const ot = c.otAvailable ? ` / OT ${c.otEnergyCost}E` : '';
        options.push(`<option value="${c.careerId}" ${c.careerId === current ? 'selected' : ''}>${escapeHtml(c.name)} (${c.energyCost}E${ot})</option>`);
      }
      options.push('</optgroup>');
    }
  }
  return `<select class="ff-cap-select" data-ff-field="job" ${catalogLoading ? 'disabled' : ''}>${options.join('')}</select>`;
}

function noMatchHtml(): string {
  const query = jobQuery.trim().toLowerCase();
  if (!query || !catalog || catalog.some((c) => c.name.toLowerCase().includes(query))) return '';
  return `<div class="ff-cap-hint">No jobs match "${escapeHtml(jobQuery.trim())}".</div>`;
}

function bodyHtml(now: number): string {
  if (!config) return '<div class="ff-cap-empty">Loading…</div>';
  const parts: string[] = [];

  const toggleStatus =
    config.careerId == null ? 'Pick a job below to enable.' : config.enabled ? `Running ${escapeHtml(config.careerName)} whenever it's available.` : 'Off — nothing will run.';
  parts.push(`
    <label class="ff-cap-toggle-row">
      <div class="ff-cap-toggle-row__text">
        <div class="ff-cap-toggle-row__title">Auto-Run</div>
        <div class="ff-cap-toggle-row__status">${toggleStatus}</div>
      </div>
      <input class="ff-cap-toggle" type="checkbox" data-ff-field="enabled" ${config.enabled ? 'checked' : ''} ${config.careerId == null ? 'disabled' : ''}>
    </label>`);

  if (status?.pausedReason) {
    const why = status.pausedReason === 'fired' ? 'Stopped after getting fired from a fumbled shift.' : 'Stopped after an unexpected response from the game.';
    parts.push(
      `<div class="ff-cap-alert"><strong>Career auto-runner stopped</strong><br>${why}${
        status.pausedMessage ? `<br>"${escapeHtml(status.pausedMessage)}"` : ''
      }<br>Check the job in-game, then switch Auto-Run back on above.</div>`,
    );
  }

  parts.push(
    `<button class="ff-cap-run" type="button" data-ff-act="run" ${running || config.careerId == null ? 'disabled' : ''}>${running ? 'Running…' : 'Run Now'}</button>`,
  );
  parts.push('<div class="ff-cap-hint">Runs one check right now, even with Auto-Run off. Handy after bailing out early or refilling energy.</div>');
  if (runError) parts.push(`<div class="ff-cap-hint">${escapeHtml(runError)}</div>`);

  parts.push('<div class="ff-cap-label">Job</div>');
  parts.push(`<input class="ff-cap-search" type="text" placeholder="Search jobs…" data-ff-field="search" value="${escapeHtml(jobQuery)}">`);
  parts.push(`<div class="ff-cap-job">${jobSelectHtml()}${noMatchHtml()}</div>`);
  parts.push(
    `<button class="ff-cap-link" type="button" data-ff-act="refresh" ${catalogLoading ? 'disabled' : ''}>${catalogLoading ? 'Refreshing…' : 'Refresh job list'}</button>`,
  );
  if (catalogError) parts.push(`<div class="ff-cap-hint">${escapeHtml(catalogError)}</div>`);
  parts.push('<div class="ff-cap-hint">Or tap “Auto-run this job” on any job card.</div>');

  const mode = config.shiftMode;
  parts.push('<div class="ff-cap-label">Shift mode</div>');
  parts.push(
    `<select class="ff-cap-select" data-ff-field="mode">${CAREER_SHIFT_MODE_OPTIONS.map(
      (o) => `<option value="${o.value}" ${o.value === mode ? 'selected' : ''}>${escapeHtml(o.label)}</option>`,
    ).join('')}</select>`,
  );
  parts.push(`<div class="ff-cap-hint">${escapeHtml(CAREER_SHIFT_MODE_HINT[mode])}</div>`);

  parts.push('<div class="ff-cap-label">Status</div>');
  const waiting = config.enabled ? careerWaitingText(status?.waiting, now) : null;
  if (waiting) parts.push(`<div class="ff-cap-waiting">${escapeHtml(waiting)}</div>`);

  // Same source order as the popup: the scheduled check, falling back to the
  // tracked cooldown only until the alarm has been read.
  const nextRunAt = config.enabled ? (nextAlarmAt ?? status?.nextEligibleAt ?? null) : null;
  const t = today();
  const last = status?.lastShift ?? null;
  const tile = (value: string, label: string, color = '#f1ede2') =>
    `<div class="ff-cap-stat-tile"><div class="ff-cap-stat-tile__value" style="color:${color}">${value}</div><div class="ff-cap-stat-tile__label">${label}</div></div>`;
  parts.push(`<div class="ff-cap-stat-grid">
    ${tile(last ? escapeHtml(last.tierLabel || last.tier || '—') : '—', 'Last result')}
    ${tile(last ? `$${last.cash.toLocaleString()}` : '—', 'Cash', '#4ade80')}
    ${tile(last ? last.xp.toLocaleString() : '—', 'XP', '#a78bfa')}
    ${tile(String(t.shifts), 'Shifts today')}
    ${tile(`$${t.cash.toLocaleString()}`, 'Earned today', '#4ade80')}
    ${tile(nextRunAt ? formatNextRun(nextRunAt, now) : '—', 'Next shift')}
  </div>`);
  if (last) {
    parts.push(
      `<div class="ff-cap-row">${last.overtime ? 'Overtime' : 'Normal shift'} at ${last.accuracy}% accuracy · ${escapeHtml(last.careerName)} · ${new Date(
        last.timestamp,
      ).toLocaleString()}</div>`,
    );
  } else if (!config.enabled) {
    parts.push('<div class="ff-cap-empty">No shifts run yet.</div>');
  }

  return parts.join('');
}

function renderPanel(): void {
  if (!panelEl) return;
  const label = panelEl.querySelector('.ff-cap-badge-label');
  if (label) label.textContent = badgeLabel();
  if (!expanded) return;
  const body = panelEl.querySelector('.ff-cap-body');
  if (!body) return;
  // Don't rebuild a dropdown out from under the player while it's open, or
  // the search box while they're typing (the dropdown under it is updated on
  // its own as they type).
  const active = document.activeElement;
  if (body.contains(active) && (active instanceof HTMLSelectElement || (active instanceof HTMLInputElement && active.type === 'text'))) return;
  const html = bodyHtml(Date.now());
  if (html === lastBodyHtml) return;
  lastBodyHtml = html;
  body.innerHTML = html;
}

function setExpanded(next: boolean): void {
  expanded = next;
  panelEl?.classList.toggle('ff-cap-expanded', expanded);
  if (expanded) {
    lastBodyHtml = '';
    if (!catalog && !catalogLoading) void loadCatalog();
    void refreshNextAlarm();
    renderPanel();
    // The countdown ticks every second off stored state; the alarm itself is
    // re-read every 5s, since some checks reschedule without writing status.
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
    <button class="ff-cap-badge" type="button">
      ${brandBadgeHtml('Career Auto')}
      <span class="ff-cap-badge-label">Loading…</span>
    </button>
    <div class="ff-cap-panel">
      <div class="ff-cap-head">
        ${brandBadgeHtml('Career Auto')}
        <button class="ff-cap-close" type="button" title="Collapse">✕</button>
      </div>
      <div class="ff-cap-body"><div class="ff-cap-empty">Loading…</div></div>
    </div>
  `;

  el.querySelector('.ff-cap-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-cap-close')?.addEventListener('click', () => setExpanded(false));

  // Delegated: the body is rebuilt on every change.
  el.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    const field = target.getAttribute('data-ff-field');
    if (field === 'enabled') {
      void setEnabled((target as HTMLInputElement).checked);
    } else if (field === 'mode') {
      void writeConfig({ shiftMode: (target as HTMLSelectElement).value as CareerAutoConfig['shiftMode'] });
      target.blur();
    } else if (field === 'job') {
      const entry = catalog?.find((c) => c.careerId === Number((target as HTMLSelectElement).value));
      if (entry) void selectJob(entry);
      target.blur();
    }
  });
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-ff-act="refresh"]')) void loadCatalog();
    if ((e.target as HTMLElement).closest('[data-ff-act="run"]')) void runNow();
  });
  el.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.getAttribute('data-ff-field') !== 'search') return;
    jobQuery = target.value;
    const job = el.querySelector('.ff-cap-job');
    if (job) job.innerHTML = jobSelectHtml() + noMatchHtml();
  });

  return el;
}

// ── Job card buttons ────────────────────────────────────────────────────────

/** What selecting a job needs, read off the card the player is looking at, so
 *  a pick from the page doesn't wait on a fresh job-list fetch. Same fields
 *  `parseCareersCatalog` reads from the same markup. `null` for a card that
 *  can't be picked (level-locked) or doesn't read cleanly. */
function readCard(card: Element): Pick<CareerCatalogEntry, 'careerId' | 'name' | 'energyCost' | 'otEnergyCost'> | null {
  const careerId = Number(card.id.replace('career-card-', ''));
  if (!careerId) return null;
  // Read off the whole card, not `.cv2-btn-row`: the locked button sits
  // straight on the card with no row around it, so looking only inside the
  // row put the pick button on locked jobs (2026-10-26: job 22, "Lv 140
  // Required" at level 129, picked and rejected with "Level too low.").
  if (/Lv \d+ Required/.test(card.textContent ?? '')) return null;
  // That lock is gone during the after-shift break (every card shows the
  // same countdown instead), so a card above the player's level is locked
  // too. 2026-10-28: a level-190 job was picked at level 130 during a break.
  // Same rule as the background's `cardRequiredLevel`.
  const cardLevel = Number(card.querySelector('.cv2-card-lv')?.textContent?.match(/Level\s+(\d+)/)?.[1]);
  if (playerLevel && cardLevel > playerLevel) return null;
  const name = card.querySelector('.cv2-card-name')?.textContent?.trim();
  if (!name) return null;
  let energyCost: number | null = null;
  for (const stat of card.querySelectorAll('.cv2-stat')) {
    if (stat.querySelector('.cv2-stat-lbl')?.textContent?.trim() === 'Energy') {
      energyCost = Number(stat.querySelector('.cv2-stat-val')?.textContent?.replace(/[^\d]/g, '')) || null;
    }
  }
  if (energyCost == null) return null;
  const ot = card.querySelector('.cv2-ot-row')?.textContent?.match(/OT:\s*(\d+)E/);
  return { careerId, name, energyCost, otEnergyCost: ot ? Number(ot[1]) : null };
}

function pickHtml(entry: { careerId: number; name: string }): string {
  if (!config) return '';
  if (config.careerId === entry.careerId) {
    const on = config.enabled;
    return `<div class="ff-ca-pick-chip" data-ff-state="${on ? 'on' : 'off'}">${on ? '✓ Career Auto is running this job' : '✓ Career Auto job (Auto-Run is off)'}</div>`;
  }
  if (pendingPickId === entry.careerId) {
    const q =
      config.enabled && config.careerId != null
        ? `Switch Career Auto from ${escapeHtml(config.careerName)} to ${escapeHtml(entry.name)}? It starts on the next shift.`
        : `Make ${escapeHtml(entry.name)} the Career Auto job? Auto-Run stays ${config.enabled ? 'on' : 'off'}.`;
    return `<div class="ff-ca-pick-confirm"><div class="ff-ca-pick-q">${q}</div><div class="ff-ca-pick-actions">
      <button type="button" data-ff-act="confirm" data-ff-id="${entry.careerId}">Confirm</button>
      <button type="button" data-ff-act="cancel">Cancel</button>
    </div></div>`;
  }
  return `<button type="button" data-ff-act="pick" data-ff-id="${entry.careerId}">Auto-run this job</button>`;
}

function decorateCards(): void {
  for (const card of document.querySelectorAll(CARD_SELECTOR)) {
    const entry = readCard(card);
    let slot = card.querySelector<HTMLElement>(':scope > .ff-ca-pick');
    if (!entry) {
      slot?.remove();
      continue;
    }
    const html = pickHtml(entry);
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'ff-ca-pick';
      card.appendChild(slot);
    }
    if (slot.getAttribute('data-ff-html') === html) continue;
    slot.setAttribute('data-ff-html', html);
    slot.innerHTML = html;
  }
}

function onCardClick(e: MouseEvent): void {
  const button = (e.target as HTMLElement).closest<HTMLElement>('.ff-ca-pick [data-ff-act]');
  if (!button) return;
  e.preventDefault();
  e.stopPropagation();
  const act = button.getAttribute('data-ff-act');
  if (act === 'pick') {
    pendingPickId = Number(button.getAttribute('data-ff-id'));
  } else if (act === 'cancel') {
    pendingPickId = null;
  } else if (act === 'confirm') {
    const card = button.closest(CARD_SELECTOR);
    const entry = card ? readCard(card) : null;
    pendingPickId = null;
    if (entry) void selectJob(entry);
  }
  renderAll();
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function renderAll(): void {
  renderPanel();
  decorateCards();
}

function updateVisibility(): void {
  if (!panelEl) return;
  const visible = document.querySelector(CARD_SELECTOR) != null;
  panelEl.classList.toggle('ff-cap-visible', visible);
  if (!visible) {
    pendingPickId = null;
    if (expanded) setExpanded(false);
  }
}

export function initCareerAutoPanel(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + PANEL_CSS);

  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);
  // Capture phase, so a tap on the card's own button never reaches the
  // game's handlers on the card around it.
  document.addEventListener('click', onCardClick, true);

  Promise.all([storage.getCareerAutoConfig(), storage.getCareerAutoStatus(), storage.getLatestStats()])
    .then(([c, s, stats]) => {
      config = c;
      status = s;
      playerLevel = stats?.level || null;
      updateVisibility();
      renderAll();
    })
    .catch((err) => console.error(LOG_PREFIX, 'career auto panel load failed', err));

  // The background writes status after every check and turns the switch off
  // when it stops; the popup can change both too.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const configChanged = STORAGE_KEYS.CAREER_AUTO_CONFIG in changes;
    const statusChanged = STORAGE_KEYS.CAREER_AUTO_STATUS in changes;
    if (configChanged) config = changes[STORAGE_KEYS.CAREER_AUTO_CONFIG].newValue ?? config;
    if (statusChanged) status = changes[STORAGE_KEYS.CAREER_AUTO_STATUS].newValue ?? null;
    // A level-up unlocks jobs; the card buttons follow it.
    const nextLevel = STORAGE_KEYS.LATEST_STATS in changes ? changes[STORAGE_KEYS.LATEST_STATS].newValue?.level || null : playerLevel;
    const levelChanged = nextLevel !== playerLevel;
    playerLevel = nextLevel;
    if (!configChanged && !statusChanged && !levelChanged) return;
    renderAll();
    if (expanded) void refreshNextAlarm();
  });

  // The game swaps page content in place, so a mutation is the only sign the
  // Careers page (or a re-rendered card) has appeared. Batched to one pass per
  // frame; the pass itself is a no-op when nothing needs changing, so its own
  // edits don't loop.
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      updateVisibility();
      decorateCards();
    });
  });
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}
