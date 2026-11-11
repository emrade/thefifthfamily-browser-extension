import { dashboardLinkHtml } from '@/content/shared/dashboardLink';
import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { STORAGE_KEYS, STREET_INTEL_AUTO_MIN_CARD_STAMINA_RELEASE } from '@/shared/constants';
import { storage } from '@/shared/storage';
import { SCOUT_MODE_OPTIONS, formatFloor, streetIntelWaitingText } from '@/shared/streetIntelAutoDisplay';
import { formatDollars, parseDollars, reformatDollarInput } from '@/shared/moneyInput';
import type { StreetIntelAnalytics } from '@/shared/streetIntelAnalytics';
import { ANALYTICS_CSS, renderStreetIntelAnalytics, requestStreetIntelAnalytics } from '@/shared/streetIntelAnalyticsView';
import type { StreetIntelAutoConfig, StreetIntelAutoStatus } from '@/shared/types';

/**
 * A floating panel on the live Street Intel page — collapsed to a small badge
 * showing today's earnings at a glance, expanding on click into three tabs:
 *
 * - **Overview** — what's happening: the Auto-Attempt switch and its live
 *   state (running / waiting / stopped), today's attempts and earnings, the
 *   last attempt, Run Now.
 * - **Settings** — how it decides, every setting with what it does in plain
 *   words: scouting method, minimum success %, card minimums, complications,
 *   odds source. The player plays from this page and rarely opens the popup
 *   (which closes easily), so the panel carries the full set.
 * - **Analytics** — the same view as the popup's (see
 *   `@/shared/streetIntelAnalyticsView`), asked of background since its
 *   records live in IndexedDB.
 *
 * `StreetIntelAutoConfig`/`StreetIntelAutoStatus` live in `chrome.storage.local`,
 * which (unlike Dexie's `db`) a content script can read/write directly — no
 * message round trip needed, same as courierPanel.ts's own config reads.
 * `chrome.alarms`, unlike `chrome.storage`, isn't reachable from a content
 * script at all, so this asks background for the poll alarm's own
 * `scheduledTime` — see the 'street-intel-next-check-requested' message's
 * own doc in messaging.ts — and for Run Now.
 */

const CONTAINER_ID = 'ff-si-status-panel';
const STYLE_ID = 'ff-si-status-panel-style';
const STREET_INTEL_MARKER = '.si-cards';

type Tab = 'overview' | 'settings' | 'analytics';

// Literal values, not the popup's :root tokens — a content script runs outside
// their scope. Everything the game's own stylesheet also styles (inputs,
// selects, buttons) is ID-scoped and !important, or the game's full-width,
// big-padding defaults win.
const C = {
  gold: '#c9a84c',
  goldSoft: '#d9c48a',
  ink: '#f1ede2',
  text: '#cfc8b6',
  muted: '#9a917c',
  faint: '#6b6455',
  line: 'rgba(201,168,76,0.14)',
  field: 'rgba(0,0,0,0.42)',
  green: '#4ade80',
  amber: '#fbbf24',
  red: '#f87171',
};

const PANEL_CSS = `
#${CONTAINER_ID} {
  position: fixed; bottom: 20px; right: 20px; z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif; display: none;
  -webkit-font-smoothing: antialiased;
}
#${CONTAINER_ID}.ff-sip-visible { display: block; }
#${CONTAINER_ID} *, #${CONTAINER_ID} *::before { box-sizing: border-box; }

/* Collapsed badge */
#${CONTAINER_ID} .ff-sip-badge {
  display: flex !important; align-items: center; gap: 10px; margin: 0 !important;
  padding: 9px 16px 9px 12px !important; width: auto !important;
  background: linear-gradient(180deg, rgba(20,20,28,0.97), rgba(10,10,15,0.97)) !important;
  border: 1px solid rgba(201,168,76,0.45) !important; border-radius: 999px !important;
  box-shadow: 0 8px 22px rgba(0,0,0,0.5); cursor: pointer;
  transition: border-color 0.18s ease-out, transform 0.18s ease-out;
}
#${CONTAINER_ID} .ff-sip-badge:hover { border-color: rgba(201,168,76,0.85) !important; transform: translateY(-1px); }
.ff-sip-badge-label { font-size: 11px; color: ${C.goldSoft}; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ff-sip-badge-dot { width: 7px; height: 7px; border-radius: 50%; background: ${C.faint}; flex-shrink: 0; }
.ff-sip-badge-dot.ff-on { background: ${C.green}; box-shadow: 0 0 0 3px rgba(74,222,128,0.16); }
.ff-sip-badge-dot.ff-warn { background: ${C.amber}; box-shadow: 0 0 0 3px rgba(251,191,36,0.16); }

/* Expanded panel */
.ff-sip-panel {
  display: none; width: 340px; max-height: min(78vh, 720px); overflow: hidden;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(17,16,21,0.985), rgba(9,9,12,0.985));
  border: 1px solid rgba(201,168,76,0.4); border-radius: 16px;
  box-shadow: 0 18px 44px rgba(0,0,0,0.62), 0 2px 6px rgba(0,0,0,0.4);
  color: ${C.text};
}
#${CONTAINER_ID}.ff-sip-expanded .ff-sip-panel { display: flex; }
#${CONTAINER_ID}.ff-sip-expanded .ff-sip-badge { display: none !important; }
#${CONTAINER_ID}.ff-sip-on-analytics .ff-sip-panel { width: 380px; }

.ff-sip-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 14px 0 16px; }
#${CONTAINER_ID} .ff-sip-close {
  display: grid !important; place-items: center; width: 28px !important; height: 28px !important;
  margin: 0 !important; padding: 0 !important; border-radius: 8px !important;
  background: transparent !important; border: 1px solid transparent !important; color: ${C.muted} !important; cursor: pointer;
}
#${CONTAINER_ID} .ff-sip-close:hover { color: ${C.ink} !important; border-color: ${C.line} !important; }
.ff-sip-close svg { width: 14px; height: 14px; }

/* Tabs: an underline row, not a row of boxes */
.ff-sip-tabs { display: flex; gap: 2px; padding: 0 16px; margin-top: 12px; border-bottom: 1px solid ${C.line}; }
#${CONTAINER_ID} .ff-sip-tab {
  flex: 0 0 auto !important; width: auto !important; margin: 0 0 -1px !important; padding: 8px 10px 9px !important;
  background: transparent !important; border: 0 !important; border-bottom: 2px solid transparent !important; border-radius: 0 !important;
  font: 600 12px/1 'Inter', system-ui, sans-serif !important; color: ${C.muted} !important; cursor: pointer;
  transition: color 0.15s ease-out, border-color 0.15s ease-out;
}
#${CONTAINER_ID} .ff-sip-tab:hover { color: ${C.text} !important; }
#${CONTAINER_ID} .ff-sip-tab.ff-sip-tab-active { color: ${C.ink} !important; border-bottom-color: ${C.gold} !important; }

.ff-sip-body { overflow-y: auto; padding: 16px; }
.ff-sip-pane { display: none; }
#${CONTAINER_ID}.ff-sip-on-overview .ff-sip-pane-overview,
#${CONTAINER_ID}.ff-sip-on-settings .ff-sip-pane-settings,
#${CONTAINER_ID}.ff-sip-on-analytics .ff-sip-pane-analytics { display: block; }

/* Switch */
#${CONTAINER_ID} input.ff-sip-switch {
  flex-shrink: 0; appearance: none !important; -webkit-appearance: none !important;
  width: 38px !important; height: 22px !important; margin: 0 !important; padding: 0 !important;
  border-radius: 11px !important; background: rgba(0,0,0,0.5) !important; border: 1px solid rgba(201,168,76,0.34) !important;
  position: relative; cursor: pointer; transition: background 0.18s ease-out, border-color 0.18s ease-out;
}
#${CONTAINER_ID} input.ff-sip-switch::before {
  content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
  background: ${C.faint}; transition: transform 0.2s cubic-bezier(.22,1,.36,1), background 0.18s ease-out;
}
#${CONTAINER_ID} input.ff-sip-switch:checked { background: rgba(251,191,36,0.18) !important; border-color: ${C.amber} !important; }
#${CONTAINER_ID} input.ff-sip-switch:checked::before { transform: translateX(16px); background: ${C.amber}; }
#${CONTAINER_ID} input.ff-sip-switch:focus-visible { outline: 2px solid ${C.gold} !important; outline-offset: 2px; }

/* Overview */
.ff-sip-master { display: flex; align-items: center; gap: 12px; cursor: pointer; }
.ff-sip-master-text { flex: 1; min-width: 0; }
.ff-sip-master-title { font-size: 15px; font-weight: 700; color: ${C.ink}; letter-spacing: -0.01em; }
.ff-sip-state { display: flex; align-items: center; gap: 7px; margin-top: 4px; font-size: 12px; line-height: 1.4; color: ${C.muted}; }
.ff-sip-state .ff-sip-badge-dot { margin-top: 1px; }
.ff-sip-state.ff-on { color: ${C.text}; }
.ff-sip-state.ff-warn { color: ${C.amber}; }

.ff-sip-alert {
  margin-top: 14px; padding: 10px 12px; font-size: 12px; line-height: 1.5;
  background: rgba(248,113,113,0.07); border: 1px solid rgba(248,113,113,0.32); border-radius: 10px; color: ${C.text};
}
.ff-sip-alert strong { color: ${C.red}; display: block; margin-bottom: 2px; }

.ff-sip-today { display: flex; margin-top: 18px; padding: 14px 0; border-top: 1px solid ${C.line}; border-bottom: 1px solid ${C.line}; }
.ff-sip-figure { flex: 1; min-width: 0; }
.ff-sip-figure + .ff-sip-figure { padding-left: 16px; border-left: 1px solid ${C.line}; }
.ff-sip-figure-value { font-size: 20px; font-weight: 700; color: ${C.ink}; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; line-height: 1.1; }
.ff-sip-figure-value.ff-money { color: ${C.green}; }
.ff-sip-figure-label { margin-top: 4px; font-size: 11px; color: ${C.muted}; }

.ff-sip-section-title { margin: 18px 0 8px; font-size: 12px; font-weight: 700; color: ${C.goldSoft}; }
.ff-sip-last { display: grid; gap: 3px; font-size: 12px; line-height: 1.45; }
.ff-sip-last-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.ff-sip-outcome { font-weight: 700; text-transform: capitalize; }
.ff-sip-outcome.ff-good { color: ${C.green}; }
.ff-sip-outcome.ff-mid { color: ${C.amber}; }
.ff-sip-outcome.ff-bad { color: ${C.red}; }
.ff-sip-reward { font-weight: 700; color: ${C.ink}; font-variant-numeric: tabular-nums; }
.ff-sip-meta { color: ${C.muted}; }
.ff-sip-empty { font-size: 12px; color: ${C.muted}; line-height: 1.5; }


#${CONTAINER_ID} .ff-sip-run {
  display: block !important; width: 100% !important; margin: 18px 0 0 !important; padding: 9px 12px !important;
  border-radius: 9px !important; font: 600 12px/1.2 'Inter', system-ui, sans-serif !important; cursor: pointer;
  background: transparent !important; border: 1px solid rgba(201,168,76,0.45) !important; color: ${C.goldSoft} !important;
  transition: background 0.15s ease-out, border-color 0.15s ease-out;
}
#${CONTAINER_ID} .ff-sip-run:hover:not(:disabled) { background: rgba(201,168,76,0.1) !important; border-color: ${C.gold} !important; }
#${CONTAINER_ID} .ff-sip-run:disabled { opacity: 0.5; cursor: default; }
.ff-sip-run-hint { margin-top: 6px; font-size: 11px; line-height: 1.45; color: ${C.muted}; text-align: center; }

/* Settings */
.ff-sip-group + .ff-sip-group { margin-top: 22px; }
.ff-sip-group-title { font-size: 12px; font-weight: 700; color: ${C.goldSoft}; padding-bottom: 6px; border-bottom: 1px solid ${C.line}; }
.ff-sip-setting { padding: 12px 0; }
.ff-sip-setting + .ff-sip-setting { border-top: 1px solid rgba(255,255,255,0.045); }
.ff-sip-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ff-sip-setting-label { font-size: 13px; font-weight: 600; color: ${C.ink}; }
.ff-sip-setting-help { margin-top: 6px; font-size: 11.5px; line-height: 1.5; color: ${C.muted}; }
.ff-sip-setting-help b { color: ${C.text}; font-weight: 600; }
.ff-sip-setting-sub { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; padding-left: 12px; }
.ff-sip-setting-sub .ff-sip-setting-label { font-size: 12px; font-weight: 500; color: ${C.text}; }
.ff-sip-setting-sub.ff-off { opacity: 0.45; }

.ff-sip-control { position: relative; flex: 0 0 158px; }
/* A control whose options don't fit 158px (Odds source) takes its own line. */
.ff-sip-setting-row.ff-sip-stack { flex-direction: column; align-items: stretch; gap: 8px; }
.ff-sip-setting-row.ff-sip-stack .ff-sip-control { flex: 1 1 auto; }
#${CONTAINER_ID} .ff-sip-control select,
#${CONTAINER_ID} .ff-sip-control input {
  display: block !important; width: 100% !important; height: 30px !important; margin: 0 !important;
  padding: 0 10px !important; border-radius: 8px !important; box-shadow: none !important; outline: none !important;
  background: ${C.field} !important; border: 1px solid rgba(201,168,76,0.3) !important; color: ${C.ink} !important;
  font: 500 12px/30px 'Inter', system-ui, sans-serif !important; font-variant-numeric: tabular-nums !important;
  transition: border-color 0.15s ease-out;
}
#${CONTAINER_ID} .ff-sip-control select {
  appearance: none !important; -webkit-appearance: none !important; padding-right: 28px !important; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23c9a84c' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") !important;
  background-repeat: no-repeat !important; background-position: right 10px center !important;
}
#${CONTAINER_ID} .ff-sip-control select option { background: #15141a; color: ${C.ink}; }
#${CONTAINER_ID} .ff-sip-control input { text-align: right !important; }
#${CONTAINER_ID} .ff-sip-control.ff-prefix input { padding-left: 22px !important; }
#${CONTAINER_ID} .ff-sip-control.ff-suffix input { padding-right: 24px !important; }
.ff-sip-control .ff-sip-affix { position: absolute; top: 50%; transform: translateY(-50%); font-size: 12px; color: ${C.faint}; pointer-events: none; }
.ff-sip-control.ff-prefix .ff-sip-affix { left: 10px; }
.ff-sip-control.ff-suffix .ff-sip-affix { right: 10px; }
#${CONTAINER_ID} .ff-sip-control select:hover, #${CONTAINER_ID} .ff-sip-control input:hover { border-color: rgba(201,168,76,0.55) !important; }
#${CONTAINER_ID} .ff-sip-control select:focus-visible, #${CONTAINER_ID} .ff-sip-control input:focus { border-color: ${C.gold} !important; }
#${CONTAINER_ID} .ff-sip-control input:disabled { cursor: not-allowed; }
.ff-sip-saved { font-size: 11px; color: ${C.green}; opacity: 0; transition: opacity 0.2s ease-out; }
.ff-sip-saved.ff-show { opacity: 1; }

@media (prefers-reduced-motion: reduce) {
  #${CONTAINER_ID} * { transition: none !important; }
}
`;

const CLOSE_ICON = `<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

let panelEl: HTMLDivElement | null = null;
let expanded = false;
let config: StreetIntelAutoConfig | null = null;
let status: StreetIntelAutoStatus | null = null;
// Cached from background on refresh and every few ticks — see the module
// doc's note on why this can't be read straight from chrome.alarms here.
// Preferred over `status.nextEligibleAt`, same as the popup: that one is a
// past time ("due now") for as long as jail, hospital or an empty board
// keeps the runner from attempting.
let cachedNextAlarmAt: number | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let ticks = 0;
let running = false;
let runError: string | null = null;
let activeTab: Tab = 'overview';
let analytics: StreetIntelAnalytics | null = null;
let analyticsError = false;

function localDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** "4:15 PM · in 3:42" — same ticking format as the popup's own
 *  `formatNextRun`, so the two surfaces read consistently. */
function formatNextRun(nextRunAt: number, now: number): string {
  const clock = new Date(nextRunAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const remainingSeconds = Math.max(0, Math.round((nextRunAt - now) / 1000));
  if (remainingSeconds === 0) return `${clock} · due now`;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${clock} · in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function today(): { attempts: number; cash: number } {
  const current = status?.attemptsTodayDate === localDateKey();
  return { attempts: current ? status!.attemptsToday : 0, cash: current ? (status!.cashToday ?? 0) : 0 };
}

function badgeLabel(): string {
  if (!config?.enabled) return 'Off';
  return `$${today().cash.toLocaleString()} today`;
}

/** One line under the switch: what the runner is doing right now. */
function stateLine(): { text: string; tone: '' | 'ff-on' | 'ff-warn' } {
  if (!config) return { text: 'Loading…', tone: '' };
  if (status?.pausedReason) return { text: 'Stopped — see below', tone: 'ff-warn' };
  if (!config.enabled) return { text: 'Off — nothing will run', tone: '' };
  const waiting = streetIntelWaitingText(status?.waiting, config.minSuccessPct, Date.now());
  if (waiting) return { text: waiting, tone: 'ff-warn' };
  const nextRunAt = cachedNextAlarmAt ?? status?.nextEligibleAt ?? null;
  return { text: nextRunAt ? `Running · next check ${formatNextRun(nextRunAt, Date.now())}` : 'Running', tone: 'ff-on' };
}

/** "steel_yourself" -> "Steel yourself". */
function approachLabel(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function outcomeTone(band: string): string {
  if (band === 'success' || band === 'critical_success') return 'ff-good';
  if (band === 'partial_success') return 'ff-mid';
  return 'ff-bad';
}

/** Everything on Overview that changes: re-rendered on every tick. The
 *  switch and the Run button are built once (`buildPanel`) and only updated,
 *  so neither loses focus or a click mid-tick. */
function renderOverview(): string {
  if (!config) return '<div class="ff-sip-empty">Loading…</div>';
  const parts: string[] = [];

  if (status?.pausedReason) {
    parts.push(
      `<div class="ff-sip-alert"><strong>Auto-Attempt stopped</strong>It got a response from the game it didn't recognise${
        status.pausedMessage ? `: “${escapeHtml(status.pausedMessage)}”` : '.'
      } Check Street Intel in-game, then switch Auto-Attempt back on.</div>`,
    );
  }

  const t = today();
  parts.push(`
    <div class="ff-sip-today">
      <div class="ff-sip-figure"><div class="ff-sip-figure-value">${t.attempts}</div><div class="ff-sip-figure-label">Attempts today</div></div>
      <div class="ff-sip-figure"><div class="ff-sip-figure-value ff-money">$${t.cash.toLocaleString()}</div><div class="ff-sip-figure-label">Earned today</div></div>
    </div>`);

  parts.push('<div class="ff-sip-section-title">Last attempt</div>');
  const last = status?.lastAttempt;
  if (last) {
    const odds =
      last.pctSource === 'predicted' ? `${last.scoutedPct}% worked out, blind` : last.pctSource === 'computed' ? `${last.scoutedPct}% computed` : `${last.scoutedPct}% scouted`;
    const risk = `${last.riskTier.charAt(0).toUpperCase()}${last.riskTier.slice(1)}${last.legendary ? ', Legendary' : ''}`;
    parts.push(`
      <div class="ff-sip-last">
        <div class="ff-sip-last-head">
          <span class="ff-sip-outcome ${outcomeTone(last.outcomeBand)}">${escapeHtml((last.outcomeBand || '—').replace(/_/g, ' '))}</span>
          <span class="ff-sip-reward">$${last.reward.toLocaleString()}</span>
        </div>
        <div>${escapeHtml(last.opportunityTitle)} <span class="ff-sip-meta">· ${risk}</span></div>
        <div class="ff-sip-meta">${escapeHtml(approachLabel(last.approach))} at ${odds} · ${new Date(last.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
        ${last.hadComplication ? `<div class="ff-sip-meta">Complication: ${escapeHtml(approachLabel(last.complicationChoice ?? '—'))}${last.complicationSuccess === null ? '' : last.complicationSuccess ? ', won' : ', lost'}</div>` : ''}
      </div>`);
  } else {
    parts.push('<div class="ff-sip-empty">No attempts yet.</div>');
  }

  return parts.join('');
}

function syncOverviewControls(): void {
  if (!panelEl || !config) return;
  const state = stateLine();
  const stateEl = panelEl.querySelector('.ff-sip-state');
  if (stateEl) {
    stateEl.className = `ff-sip-state ${state.tone}`;
    stateEl.innerHTML = `<span class="ff-sip-badge-dot ${state.tone}"></span><span>${escapeHtml(state.text)}</span>`;
  }
  const toggle = panelEl.querySelector<HTMLInputElement>('.ff-sip-auto-toggle');
  if (toggle) toggle.checked = config.enabled;
  const run = panelEl.querySelector<HTMLButtonElement>('.ff-sip-run');
  if (run) {
    run.disabled = running;
    run.textContent = running ? 'Running…' : 'Run Now';
  }
  const hint = panelEl.querySelector('.ff-sip-run-hint');
  if (hint) hint.textContent = runError ?? 'Runs one check right now, even with Auto-Attempt off. Handy after bailing out early or refilling Stamina.';
}

function scoutingHelp(): string {
  return escapeHtml(SCOUT_MODE_OPTIONS.find((o) => o.value === config?.scoutMode)?.detail ?? '');
}

function minCardHelp(): string {
  if (!config) return '';
  const release = Math.round(STREET_INTEL_AUTO_MIN_CARD_STAMINA_RELEASE * 100);
  return config.minCardValue > 0
    ? `Cards worth under <b>${formatFloor(config.minCardValue)}</b> (the middle of their pay range) are skipped and never scouted, saving Stamina for bigger ones — they pay far more per Stamina. Lifted once Stamina is ${release}% full, so regen isn't wasted. 0 means no minimum.`
    : 'No minimum — any card can be taken if it clears the minimum success %. Set an amount to skip small cards and save Stamina for bigger ones.';
}

function extremeHelp(): string {
  if (!config) return '';
  return `Extreme cards fail about 40% of the time at every size, and under $1M they paid no more per Stamina than high-risk cards that fail half as often (Aug 10 – Oct 30, 142 attempts). ${
    config.extremeMinEnabled
      ? `On: extreme cards need <b>${formatFloor(Math.max(config.minCardValue, config.extremeMinValue))}</b> or more.`
      : 'Off: extreme cards use the same minimum as the rest.'
  }`;
}

function settingsMarkup(): string {
  const options = SCOUT_MODE_OPTIONS.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('');
  return `
    <div class="ff-sip-group">
      <div class="ff-sip-group-title">Scouting</div>
      <div class="ff-sip-setting">
        <div class="ff-sip-setting-row">
          <span class="ff-sip-setting-label">Method</span>
          <div class="ff-sip-control"><select class="ff-sip-scout-select" aria-label="Scouting method">${options}</select></div>
        </div>
        <div class="ff-sip-setting-help ff-sip-scout-help"></div>
      </div>
      <div class="ff-sip-setting">
        <div class="ff-sip-setting-row">
          <span class="ff-sip-setting-label">Minimum scouted success %</span>
          <div class="ff-sip-control ff-suffix"><input class="ff-sip-pct-input" type="text" inputmode="numeric" aria-label="Minimum success percent"><span class="ff-sip-affix">%</span></div>
        </div>
        <div class="ff-sip-setting-help">A card is only attempted if its best approach's odds are at least this — otherwise it's skipped and no attempt is spent, whatever its risk tier.</div>
      </div>
    </div>

    <div class="ff-sip-group">
      <div class="ff-sip-group-title">Which cards</div>
      <div class="ff-sip-setting">
        <div class="ff-sip-setting-row">
          <span class="ff-sip-setting-label">Minimum card value ($)</span>
          <div class="ff-sip-control ff-prefix"><span class="ff-sip-affix">$</span><input class="ff-sip-min-input" type="text" inputmode="numeric" aria-label="Minimum card value"></div>
        </div>
        <div class="ff-sip-setting-help ff-sip-min-help"></div>
      </div>
      <div class="ff-sip-setting">
        <label class="ff-sip-setting-row" style="cursor:pointer">
          <span class="ff-sip-setting-label">Extreme cards need more</span>
          <input class="ff-sip-switch ff-sip-extreme-toggle" type="checkbox">
        </label>
        <div class="ff-sip-setting-sub ff-sip-extreme-sub">
          <span class="ff-sip-setting-label">Extreme minimum ($)</span>
          <div class="ff-sip-control ff-prefix"><span class="ff-sip-affix">$</span><input class="ff-sip-extreme-input" type="text" inputmode="numeric" aria-label="Extreme card minimum"></div>
        </div>
        <div class="ff-sip-setting-help ff-sip-extreme-help"></div>
      </div>
    </div>

    <div class="ff-sip-group">
      <div class="ff-sip-group-title">Complications</div>
      <div class="ff-sip-setting">
        <label class="ff-sip-setting-row" style="cursor:pointer">
          <span class="ff-sip-setting-label">Smart complication choices</span>
          <input class="ff-sip-switch ff-sip-cplx-toggle" type="checkbox">
        </label>
        <div class="ff-sip-setting-help">When a complication comes up, the attempt's own approach is reused (Steel Yourself, which has no complication match, falls back to the best win rate). <b>On:</b> unless that choice has never won in this exact scenario — then the best remaining choice for it is used instead. Choices that never won lost every time (0 of 91) and cost 86% of all complication losses.</div>
      </div>
    </div>

    <div class="ff-sip-group">
      <div class="ff-sip-group-title">Odds</div>
      <div class="ff-sip-setting">
        <div class="ff-sip-setting-row ff-sip-stack">
          <span class="ff-sip-setting-label">Odds source</span>
          <div class="ff-sip-control">
            <select class="ff-sip-odds-select" aria-label="Odds source">
              <option value="revealed">Revealed only (safe, default)</option>
              <option value="computed">Computed (includes hidden approaches)</option>
            </select>
          </div>
        </div>
        <div class="ff-sip-setting-help">"Revealed only" ranks and attempts strictly the approach(es) the scout gave real numbers for — a card whose only revealed approach misses the floor above just gets skipped, even if a hidden approach might have been great. "Computed" also scores every other (hidden) approach on the same card using the exact formula from that same scout's real base odds — worst case ~3 points off, and it can win the ranking and get attempted directly.</div>
      </div>
    </div>

    <div class="ff-sip-saved" aria-live="polite">Saved</div>`;
}

/** Brings the Settings controls in line with `config`, leaving a field alone
 *  while it's being typed in. */
function syncSettings(): void {
  if (!panelEl || !config) return;
  const q = <T extends Element>(sel: string) => panelEl!.querySelector<T>(sel);
  const setSelect = (sel: string, value: string) => {
    const el = q<HTMLSelectElement>(sel);
    if (el && document.activeElement !== el) el.value = value;
  };
  const setInput = (sel: string, value: string) => {
    const el = q<HTMLInputElement>(sel);
    if (el && document.activeElement !== el) el.value = value;
  };
  setSelect('.ff-sip-scout-select', config.scoutMode);
  setSelect('.ff-sip-odds-select', config.oddsMode);
  setInput('.ff-sip-pct-input', String(config.minSuccessPct));
  setInput('.ff-sip-min-input', formatDollars(String(config.minCardValue)));
  setInput('.ff-sip-extreme-input', formatDollars(String(config.extremeMinValue)));
  const extremeToggle = q<HTMLInputElement>('.ff-sip-extreme-toggle');
  if (extremeToggle) extremeToggle.checked = config.extremeMinEnabled;
  q('.ff-sip-extreme-sub')?.classList.toggle('ff-off', !config.extremeMinEnabled);
  const extremeInput = q<HTMLInputElement>('.ff-sip-extreme-input');
  if (extremeInput) extremeInput.disabled = !config.extremeMinEnabled;
  const cplx = q<HTMLInputElement>('.ff-sip-cplx-toggle');
  if (cplx) cplx.checked = config.complicationMode === 'avoidBlocked';
  const scoutHelp = q('.ff-sip-scout-help');
  if (scoutHelp) scoutHelp.innerHTML = scoutingHelp();
  const minHelp = q('.ff-sip-min-help');
  if (minHelp) minHelp.innerHTML = minCardHelp();
  const extremeHelpEl = q('.ff-sip-extreme-help');
  if (extremeHelpEl) extremeHelpEl.innerHTML = extremeHelp();
}

function renderAnalytics(): void {
  const pane = panelEl?.querySelector('.ff-sip-pane-analytics');
  if (!pane || !config) return;
  if (analytics) pane.innerHTML = renderStreetIntelAnalytics(analytics, config);
  else pane.innerHTML = `<div class="ff-sip-empty">${analyticsError ? "Analytics didn't load — trying again shortly." : 'Loading analytics…'}</div>`;
}

async function refreshAnalytics(): Promise<void> {
  if (!expanded || activeTab !== 'analytics') return;
  try {
    analytics = await requestStreetIntelAnalytics();
    analyticsError = false;
  } catch (err) {
    console.error(LOG_PREFIX, 'street intel status panel analytics read failed', err);
    analyticsError = true;
  }
  renderAnalytics();
}

function setTab(tab: Tab): void {
  activeTab = tab;
  if (!panelEl) return;
  panelEl.classList.remove('ff-sip-on-overview', 'ff-sip-on-settings', 'ff-sip-on-analytics');
  panelEl.classList.add(`ff-sip-on-${tab}`);
  panelEl.querySelectorAll<HTMLButtonElement>('.ff-sip-tab').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('ff-sip-tab-active', active);
    b.setAttribute('aria-selected', String(active));
  });
  if (tab === 'analytics') {
    renderAnalytics();
    void refreshAnalytics();
  }
  if (tab === 'settings') syncSettings();
}

function renderAll(): void {
  if (!panelEl) return;
  const live = panelEl.querySelector('.ff-sip-overview-live');
  if (live) live.innerHTML = renderOverview();
  syncOverviewControls();
  syncSettings();
  const label = panelEl.querySelector('.ff-sip-badge-label');
  if (label) label.textContent = badgeLabel();
  const dot = panelEl.querySelector('.ff-sip-badge .ff-sip-badge-dot');
  if (dot) dot.className = `ff-sip-badge-dot ${status?.pausedReason ? 'ff-warn' : config?.enabled ? 'ff-on' : ''}`;
}

async function refresh(): Promise<void> {
  try {
    const [nextConfig, nextStatus] = await Promise.all([storage.getStreetIntelAutoConfig(), storage.getStreetIntelAutoStatus()]);
    config = nextConfig;
    status = nextStatus;
    await refreshNextAlarm();
    renderAll();
  } catch (err) {
    console.error(LOG_PREFIX, 'street intel status panel refresh failed', err);
  }
}

async function refreshNextAlarm(): Promise<void> {
  if (!config?.enabled) {
    cachedNextAlarmAt = null;
    return;
  }
  try {
    cachedNextAlarmAt = (await chrome.runtime.sendMessage({ type: 'street-intel-next-check-requested' })) as number | null;
  } catch (err) {
    console.error(LOG_PREFIX, 'street intel status panel next-check read failed', err);
  }
}

/** Run Now: one check right now, even with Auto-Attempt off — for a wait the
 *  runner can't see end early (bailing out, a discharge, a Stamina refill). */
async function runNow(): Promise<void> {
  running = true;
  runError = null;
  renderAll();
  try {
    status = (await chrome.runtime.sendMessage({ type: 'street-intel-auto-run-requested' })) as StreetIntelAutoStatus | null;
  } catch (err) {
    console.error(LOG_PREFIX, 'street intel status panel run-now failed', err);
    runError = 'Could not reach the extension in the background. Try again in a moment.';
  } finally {
    running = false;
    await refreshNextAlarm();
    renderAll();
  }
}

function setExpanded(next: boolean): void {
  expanded = next;
  panelEl?.classList.toggle('ff-sip-expanded', expanded);
  if (expanded) {
    refresh();
    void refreshAnalytics();
    // Ticks the "next check" countdown live while the panel is open — a
    // plain re-render off already-fetched state, no network/game call, so a
    // 1s cadence costs nothing. Matches the popup's own countdown cadence.
    // The alarm itself is re-read every 5s, since some checks reschedule
    // without writing status — same cadence as the Careers panel.
    if (tickTimer === null) {
      // Analytics every 30s while its tab is open: manual attempts on this
      // page don't touch the auto status, so they'd otherwise go unseen.
      tickTimer = setInterval(() => {
        if (++ticks % 30 === 0) void refreshAnalytics();
        if (ticks % 5 === 0) void refreshNextAlarm().then(renderAll);
        else renderAll();
      }, 1_000);
    }
  } else if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

let savedTimer: ReturnType<typeof setTimeout> | null = null;

function flashSaved(): void {
  const el = panelEl?.querySelector('.ff-sip-saved');
  if (!el) return;
  el.classList.add('ff-show');
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('ff-show'), 1400);
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.className = `ff-sip-on-${activeTab}`;
  el.innerHTML = `
    <button class="ff-sip-badge" type="button" aria-label="Open Street Intel panel">
      ${brandBadgeHtml('Street Intel')}
      <span class="ff-sip-badge-dot"></span>
      <span class="ff-sip-badge-label">Loading…</span>
    </button>
    <div class="ff-sip-panel" role="dialog" aria-label="Street Intel">
      <div class="ff-sip-head">
        ${brandBadgeHtml('Street Intel')}
        ${dashboardLinkHtml('automations/street-intel')}
        <button class="ff-sip-close" type="button" title="Collapse" aria-label="Collapse">${CLOSE_ICON}</button>
      </div>
      <div class="ff-sip-tabs" role="tablist">
        <button class="ff-sip-tab ff-sip-tab-active" type="button" role="tab" data-tab="overview">Overview</button>
        <button class="ff-sip-tab" type="button" role="tab" data-tab="settings">Settings</button>
        <button class="ff-sip-tab" type="button" role="tab" data-tab="analytics">Analytics</button>
      </div>
      <div class="ff-sip-body">
        <div class="ff-sip-pane ff-sip-pane-overview">
          <label class="ff-sip-master">
            <div class="ff-sip-master-text">
              <div class="ff-sip-master-title">Auto-Attempt</div>
              <div class="ff-sip-state"><span class="ff-sip-badge-dot"></span><span>Loading…</span></div>
            </div>
            <input class="ff-sip-switch ff-sip-auto-toggle" type="checkbox" aria-label="Auto-Attempt">
          </label>
          <div class="ff-sip-overview-live"></div>
          <button class="ff-sip-run" type="button">Run Now</button>
          <div class="ff-sip-run-hint"></div>
        </div>
        <div class="ff-sip-pane ff-sip-pane-settings">${settingsMarkup()}</div>
        <div class="ff-sip-pane ff-sip-pane-analytics"></div>
      </div>
    </div>
  `;

  el.querySelector('.ff-sip-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-sip-close')?.addEventListener('click', () => setExpanded(false));

  const writeConfig = (patch: Partial<StreetIntelAutoConfig>) => {
    if (!config) return;
    const next = { ...config, ...patch };
    config = next;
    renderAll();
    storage
      .setStreetIntelAutoConfig(next)
      .then(() => {
        flashSaved();
        return refresh();
      })
      .catch((err) => console.error(LOG_PREFIX, 'street intel status panel config write failed', err));
  };

  const toggle = el.querySelector<HTMLInputElement>('.ff-sip-auto-toggle');
  toggle?.addEventListener('change', () => writeConfig({ enabled: toggle.checked }));
  el.querySelector('.ff-sip-run')?.addEventListener('click', () => void runNow());

  const settings = el.querySelector('.ff-sip-pane-settings')!;
  const scoutSelect = settings.querySelector<HTMLSelectElement>('.ff-sip-scout-select');
  scoutSelect?.addEventListener('change', () => writeConfig({ scoutMode: scoutSelect.value as StreetIntelAutoConfig['scoutMode'] }));
  const oddsSelect = settings.querySelector<HTMLSelectElement>('.ff-sip-odds-select');
  oddsSelect?.addEventListener('change', () => writeConfig({ oddsMode: oddsSelect.value as StreetIntelAutoConfig['oddsMode'] }));

  const pctInput = settings.querySelector<HTMLInputElement>('.ff-sip-pct-input');
  pctInput?.addEventListener('input', () => {
    pctInput.value = pctInput.value.replace(/\D/g, '').slice(0, 3);
  });
  pctInput?.addEventListener('change', () => {
    const value = Number(pctInput.value);
    if (pctInput.value !== '' && Number.isFinite(value)) writeConfig({ minSuccessPct: Math.min(100, Math.max(0, Math.round(value))) });
  });

  // Dollar fields: commas added as you type, committed on change (Enter or
  // leaving the field).
  const minInput = settings.querySelector<HTMLInputElement>('.ff-sip-min-input');
  minInput?.addEventListener('input', () => reformatDollarInput(minInput));
  minInput?.addEventListener('change', () => {
    const value = parseDollars(minInput.value);
    if (value !== null) writeConfig({ minCardValue: value });
  });
  const extremeToggle = settings.querySelector<HTMLInputElement>('.ff-sip-extreme-toggle');
  extremeToggle?.addEventListener('change', () => writeConfig({ extremeMinEnabled: extremeToggle.checked }));
  const extremeInput = settings.querySelector<HTMLInputElement>('.ff-sip-extreme-input');
  extremeInput?.addEventListener('input', () => reformatDollarInput(extremeInput));
  extremeInput?.addEventListener('change', () => {
    const value = parseDollars(extremeInput.value);
    if (value !== null) writeConfig({ extremeMinValue: value });
  });
  const cplxToggle = settings.querySelector<HTMLInputElement>('.ff-sip-cplx-toggle');
  cplxToggle?.addEventListener('change', () => writeConfig({ complicationMode: cplxToggle.checked ? 'avoidBlocked' : 'reuse' }));

  el.querySelectorAll<HTMLButtonElement>('.ff-sip-tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab as Tab)));
  el.querySelector('.ff-sip-pane-analytics')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const minimum = target.closest<HTMLButtonElement>('.ff-sia-apply');
    if (minimum?.dataset.value) writeConfig({ minCardValue: Number(minimum.dataset.value) });
    // 0 switches the extreme rule off.
    const extreme = target.closest<HTMLButtonElement>('.ff-sia-apply-extreme');
    if (extreme?.dataset.value) {
      const value = Number(extreme.dataset.value);
      writeConfig(value > 0 ? { extremeMinEnabled: true, extremeMinValue: value } : { extremeMinEnabled: false });
    }
  });

  return el;
}

function updateVisibility(): void {
  if (!panelEl) return;
  const visible = document.querySelector(STREET_INTEL_MARKER) != null;
  panelEl.classList.toggle('ff-sip-visible', visible);
  if (!visible && expanded) setExpanded(false); // don't leave it expanded, hidden, for the next page it reappears on
}

export function initStreetIntelStatusPanel(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + PANEL_CSS + ANALYTICS_CSS);

  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);
  updateVisibility();
  refresh();

  // Keeps the collapsed badge's "$X today" label current even while the
  // panel is collapsed, and picks up a run that happened while this page
  // wasn't even open yet (e.g. the background auto-runner firing between
  // visits) — same live-sync approach as the popup's own StreetIntelAutoHome.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (STORAGE_KEYS.STREET_INTEL_AUTO_STATUS in changes) {
      const previousAttemptAt = status?.lastAttempt?.timestamp;
      status = changes[STORAGE_KEYS.STREET_INTEL_AUTO_STATUS].newValue ?? null;
      renderAll();
      if (status?.lastAttempt?.timestamp !== previousAttemptAt) void refreshAnalytics();
    }
    if (STORAGE_KEYS.STREET_INTEL_AUTO_CONFIG in changes) {
      // Re-read rather than taking `newValue`: the getter migrates a config
      // saved before the minimum card value existed.
      void storage.getStreetIntelAutoConfig().then((next) => {
        config = next;
        renderAll();
        void refreshAnalytics();
      });
    }
  });

  // The game swaps panel content via innerHTML on the same page — no
  // navigation, so this is the only way to know when Street Intel comes
  // on/off screen. Same approach as courierPanel.ts's own visibility watch.
  const observer = new MutationObserver(() => updateVisibility());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}
