import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { STORAGE_KEYS, STREET_INTEL_AUTO_BIG_CARD_STAMINA_RELEASE, STREET_INTEL_AUTO_DEFAULT_BIG_CARD_FLOOR } from '@/shared/constants';
import { storage } from '@/shared/storage';
import { formatFloor, streetIntelWaitingText } from '@/shared/streetIntelAutoDisplay';
import type { StreetIntelAutoConfig, StreetIntelAutoStatus } from '@/shared/types';

/**
 * A floating panel on the live Street Intel page — collapsed to a small badge
 * showing today's earnings at a glance, expanding on click into the
 * Auto-Attempt toggle + a snapshot of today's stats and the last result. Same
 * shape as the Pet Courier panel (courierPanel.ts): a passive read/toggle
 * surface for a feature that already runs entirely in the background, so the
 * player doesn't have to open the popup just to check "how much did I make
 * today" while looking at this page.
 *
 * Deliberately lighter than the popup's own StreetIntelAutoHome — no minimum
 * success %, odds mode, last-cycle-scouted breakdown, or complication history
 * here; that's config/analysis, not the daily-glance snapshot this exists
 * for. Adjust those in the popup. The two strategy switches (smart scouting,
 * smart complication choices) are the exception: they're on/off toggles the
 * player wants to flip back quickly from the page if a new mode misbehaves.
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

const PANEL_CSS = `
#${CONTAINER_ID} {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif;
  display: none;
}
#${CONTAINER_ID}.ff-sip-visible { display: block; }

.ff-sip-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: linear-gradient(180deg, rgba(20,20,28,0.96), rgba(10,10,15,0.96));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 999px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.ff-sip-badge:hover { border-color: rgba(201,168,76,0.8); transform: translateY(-1px); }
.ff-sip-badge-label { font-size: 10.5px; color: #d9c48a; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }

.ff-sip-panel {
  display: none;
  width: 280px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 16px;
  background: linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 14px;
  box-shadow: 0 10px 34px rgba(0,0,0,0.6);
  color: #ccc;
}
#${CONTAINER_ID}.ff-sip-expanded .ff-sip-panel { display: block; }
#${CONTAINER_ID}.ff-sip-expanded .ff-sip-badge { display: none; }

.ff-sip-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.ff-sip-close {
  background: none; border: none; color: #8b8f9e; font-size: 16px; line-height: 1;
  cursor: pointer; padding: 2px 6px;
}
.ff-sip-close:hover { color: #fff; }

/* Ported from the popup's own .ff-toggle-row/.ff-toggle with its CSS custom
 * properties resolved to literal values — same reasoning as courierPanel.ts's
 * own copy (a content script runs outside the popup's :root token scope). */
.ff-sip-toggle-row {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 11px 12px; margin-bottom: 12px;
  background: #17130e; border: 1px solid rgba(201,168,76,0.16);
  border-radius: 10px; cursor: pointer;
}
.ff-sip-toggle-row__text { flex: 1; min-width: 0; }
.ff-sip-toggle-row__title { font-family: 'Inter', system-ui, sans-serif; font-weight: 700; font-size: 12.5px; color: #f1ede2; }
.ff-sip-toggle-row__status { font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 9.5px; color: #6b6455; margin-top: 1px; line-height: 1.4; }

.ff-sip-toggle {
  flex-shrink: 0; appearance: none; -webkit-appearance: none;
  width: 34px; height: 20px; border-radius: 10px;
  background: rgba(0,0,0,0.5); border: 1px solid rgba(201,168,76,0.34);
  position: relative; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.ff-sip-toggle::before {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #6b6455;
  transition: transform 0.15s cubic-bezier(.22,1,.36,1), background 0.15s;
}
.ff-sip-toggle:checked { background: rgba(251,191,36,0.18); border-color: #fbbf24; }
.ff-sip-toggle:checked::before { transform: translateX(14px); background: #fbbf24; box-shadow: 0 0 6px rgba(251,191,36,0.5); }

.ff-sip-alert {
  padding: 8px 10px; margin-bottom: 12px; font-size: 10px; line-height: 1.5;
  background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.3);
  border-radius: 7px; color: #ccc;
}

/* Ported from the popup's own .ff-stat-grid/.ff-stat-tile, same "resolve the
 * :root tokens to literal values" reasoning as the toggle row above. */
.ff-sip-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.ff-sip-stat-tile {
  padding: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px; text-align: center;
}
.ff-sip-stat-tile__value { font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 14px; font-weight: 700; color: #f1ede2; }
.ff-sip-stat-tile__label { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b6455; margin-top: 3px; }

.ff-sip-row-head {
  font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em;
  color: #6b6455; margin: 8px 0 3px;
}
.ff-sip-row { font-size: 10.5px; color: #ccc; padding: 2px 0; line-height: 1.4; }
.ff-sip-empty { font-size: 10.5px; color: #6b6455; padding: 4px 0; }
.ff-sip-waiting { font-size: 10.5px; color: #fbbf24; padding: 2px 0 6px; line-height: 1.4; }
.ff-sip-hint { font-size: 9.5px; color: #8b8578; line-height: 1.45; margin: 5px 0 12px; }
.ff-sip-run {
  box-sizing: border-box; display: block; width: 100%; padding: 7px 10px; border-radius: 8px;
  font-family: 'Inter', system-ui, sans-serif; font-size: 11px; font-weight: 700; line-height: 1.2; cursor: pointer;
  background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.5); color: #d9c48a;
}
.ff-sip-run:hover:not(:disabled) { border-color: #c9a84c; }
.ff-sip-run:disabled { opacity: 0.45; cursor: default; }
`;

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

function localDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
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

function badgeLabel(): string {
  if (!config?.enabled) return 'Off';
  const cashToday = status?.attemptsTodayDate === localDateKey() ? (status.cashToday ?? 0) : 0;
  return `$${cashToday.toLocaleString()} today`;
}

function renderStatus(): string {
  if (!config) return '<div class="ff-sip-empty">Loading…</div>';

  const parts: string[] = [];

  if (status?.pausedReason) {
    parts.push(
      `<div class="ff-sip-alert"><strong>Auto-Attempt stopped</strong><br>Stopped after an unexpected response from the game.${
        status.pausedMessage ? `<br>"${status.pausedMessage}"` : ''
      }<br>Check Street Intel in-game, then flip Auto-Attempt back on above.</div>`,
    );
  }

  const attemptsToday = status?.attemptsTodayDate === localDateKey() ? status.attemptsToday : 0;
  const cashToday = status?.attemptsTodayDate === localDateKey() ? (status.cashToday ?? 0) : 0;
  const nextRunAt = config.enabled ? (cachedNextAlarmAt ?? status?.nextEligibleAt ?? null) : null;
  const waiting = config.enabled ? streetIntelWaitingText(status?.waiting, config.minSuccessPct, Date.now()) : null;

  parts.push('<div class="ff-sip-stat-grid">');
  parts.push(`<div class="ff-sip-stat-tile"><div class="ff-sip-stat-tile__value">${attemptsToday}</div><div class="ff-sip-stat-tile__label">Attempts Today</div></div>`);
  parts.push(
    `<div class="ff-sip-stat-tile"><div class="ff-sip-stat-tile__value" style="color:#4ade80">$${cashToday.toLocaleString()}</div><div class="ff-sip-stat-tile__label">Earned Today</div></div>`,
  );
  parts.push('</div>');

  if (!config.enabled) {
    parts.push('<div class="ff-sip-empty">Auto-Attempt is off — nothing will run.</div>');
  } else if (status?.lastAttempt) {
    parts.push('<div class="ff-sip-row-head">Last Result</div>');
    parts.push(
      `<div class="ff-sip-row">${status.lastAttempt.outcomeBand || '—'} — $${status.lastAttempt.reward.toLocaleString()}</div>`,
    );
    parts.push(
      `<div class="ff-sip-row">${status.lastAttempt.opportunityTitle} · ${new Date(status.lastAttempt.timestamp).toLocaleTimeString()}</div>`,
    );
  } else {
    parts.push('<div class="ff-sip-empty">No attempts run yet.</div>');
  }

  if (nextRunAt) {
    parts.push(`<div class="ff-sip-row-head">Next Check</div>`);
    parts.push(`<div class="ff-sip-row">${formatNextRun(nextRunAt, Date.now())}</div>`);
  }
  if (waiting) parts.push(`<div class="ff-sip-waiting">${waiting}</div>`);

  return parts.join('');
}

function renderToggle(): void {
  if (!panelEl || !config) return;
  const toggle = panelEl.querySelector<HTMLInputElement>('.ff-sip-auto-toggle');
  const statusText = panelEl.querySelector('.ff-sip-auto-status');
  if (toggle) toggle.checked = config.enabled;
  if (statusText) {
    statusText.textContent = config.enabled
      ? `Running whenever the best scouted approach clears ${config.minSuccessPct}%.`
      : 'Off — nothing will run.';
  }

  // `=== 'smart'`/`=== 'avoidBlocked'` rather than trusting the field to
  // exist: a config pushed through `chrome.storage.onChanged` is the raw
  // stored object, which an older build may have written without these.
  const smartScouting = config.scoutMode === 'smart';
  const scoutToggle = panelEl.querySelector<HTMLInputElement>('.ff-sip-scout-toggle');
  const scoutStatus = panelEl.querySelector('.ff-sip-scout-status');
  if (scoutToggle) scoutToggle.checked = smartScouting;
  if (scoutStatus) {
    scoutStatus.textContent = smartScouting ? 'Only scouts cards that could beat the best found.' : 'Off — scouts the 2 highest-paying cards.';
  }

  const runBtn = panelEl.querySelector<HTMLButtonElement>('.ff-sip-run');
  if (runBtn) {
    runBtn.disabled = running;
    runBtn.textContent = running ? 'Running…' : 'Run Now';
  }
  const runHint = panelEl.querySelector('.ff-sip-run-hint');
  if (runHint) {
    runHint.textContent = runError ?? 'Runs one check right now, even with Auto-Attempt off. Handy after bailing out early or refilling Stamina.';
  }

  const smartComplications = config.complicationMode === 'avoidBlocked';
  const cplxToggle = panelEl.querySelector<HTMLInputElement>('.ff-sip-cplx-toggle');
  const cplxStatus = panelEl.querySelector('.ff-sip-cplx-status');
  if (cplxToggle) cplxToggle.checked = smartComplications;
  if (cplxStatus) {
    cplxStatus.textContent = smartComplications ? 'Avoids choices that never win in that scenario.' : 'Off — reuses the attempt approach.';
  }

  // `=== true` and a fallback floor for the same raw-stored-config reason as above.
  const bigOnly = config.bigCardsOnly === true;
  const bigToggle = panelEl.querySelector<HTMLInputElement>('.ff-sip-big-toggle');
  const bigStatus = panelEl.querySelector('.ff-sip-big-status');
  if (bigToggle) bigToggle.checked = bigOnly;
  if (bigStatus) {
    bigStatus.textContent = bigOnly
      ? `Only cards paying ${formatFloor(config.bigCardFloor ?? STREET_INTEL_AUTO_DEFAULT_BIG_CARD_FLOOR)}+ until Stamina is ${Math.round(STREET_INTEL_AUTO_BIG_CARD_STAMINA_RELEASE * 100)}% full. Set the amount in the popup.`
      : 'Off — takes any card that clears the success floor.';
  }
}

function renderAll(): void {
  if (!panelEl) return;
  renderToggle();
  const statusEl = panelEl.querySelector('.ff-sip-status');
  if (statusEl) statusEl.innerHTML = renderStatus();
  const badgeLabelEl = panelEl.querySelector('.ff-sip-badge-label');
  if (badgeLabelEl) badgeLabelEl.textContent = badgeLabel();
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
    runError = 'Could not reach the background service. Try again in a moment.';
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
    // Ticks the "Next Check" countdown live while the panel is open — a
    // plain re-render off already-fetched state, no network/game call, so a
    // 1s cadence costs nothing. Matches the popup's own countdown cadence.
    // The alarm itself is re-read every 5s, since some checks reschedule
    // without writing status — same cadence as the Careers panel.
    if (tickTimer === null) {
      tickTimer = setInterval(() => {
        if (++ticks % 5 === 0) void refreshNextAlarm().then(renderAll);
        else renderAll();
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
    <button class="ff-sip-badge" type="button">
      ${brandBadgeHtml('Street Intel')}
      <span class="ff-sip-badge-label">Loading…</span>
    </button>
    <div class="ff-sip-panel">
      <div class="ff-sip-head">
        ${brandBadgeHtml('Street Intel')}
        <button class="ff-sip-close" type="button" title="Collapse">✕</button>
      </div>
      <label class="ff-sip-toggle-row">
        <div class="ff-sip-toggle-row__text">
          <div class="ff-sip-toggle-row__title">Auto-Attempt</div>
          <div class="ff-sip-toggle-row__status ff-sip-auto-status">Loading…</div>
        </div>
        <input class="ff-sip-auto-toggle ff-sip-toggle" type="checkbox">
      </label>
      <button class="ff-sip-run" type="button">Run Now</button>
      <div class="ff-sip-hint ff-sip-run-hint"></div>
      <label class="ff-sip-toggle-row">
        <div class="ff-sip-toggle-row__text">
          <div class="ff-sip-toggle-row__title">Smart scouting</div>
          <div class="ff-sip-toggle-row__status ff-sip-scout-status">Loading…</div>
        </div>
        <input class="ff-sip-scout-toggle ff-sip-toggle" type="checkbox">
      </label>
      <label class="ff-sip-toggle-row">
        <div class="ff-sip-toggle-row__text">
          <div class="ff-sip-toggle-row__title">Smart complication choices</div>
          <div class="ff-sip-toggle-row__status ff-sip-cplx-status">Loading…</div>
        </div>
        <input class="ff-sip-cplx-toggle ff-sip-toggle" type="checkbox">
      </label>
      <label class="ff-sip-toggle-row">
        <div class="ff-sip-toggle-row__text">
          <div class="ff-sip-toggle-row__title">Big cards only</div>
          <div class="ff-sip-toggle-row__status ff-sip-big-status">Loading…</div>
        </div>
        <input class="ff-sip-big-toggle ff-sip-toggle" type="checkbox">
      </label>
      <div class="ff-sip-status"><div class="ff-sip-empty">Loading…</div></div>
    </div>
  `;

  el.querySelector('.ff-sip-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-sip-close')?.addEventListener('click', () => setExpanded(false));
  el.querySelector('.ff-sip-run')?.addEventListener('click', () => void runNow());

  const writeConfig = (patch: Partial<StreetIntelAutoConfig>) => {
    if (!config) return;
    const next = { ...config, ...patch };
    config = next;
    storage
      .setStreetIntelAutoConfig(next)
      .then(() => refresh())
      .catch((err) => console.error(LOG_PREFIX, 'street intel status panel toggle write failed', err));
  };

  const toggle = el.querySelector<HTMLInputElement>('.ff-sip-auto-toggle');
  toggle?.addEventListener('change', () => writeConfig({ enabled: toggle.checked }));

  const scoutToggle = el.querySelector<HTMLInputElement>('.ff-sip-scout-toggle');
  scoutToggle?.addEventListener('change', () => writeConfig({ scoutMode: scoutToggle.checked ? 'smart' : 'topPayout' }));

  const cplxToggle = el.querySelector<HTMLInputElement>('.ff-sip-cplx-toggle');
  cplxToggle?.addEventListener('change', () => writeConfig({ complicationMode: cplxToggle.checked ? 'avoidBlocked' : 'reuse' }));

  const bigToggle = el.querySelector<HTMLInputElement>('.ff-sip-big-toggle');
  bigToggle?.addEventListener('change', () => writeConfig({ bigCardsOnly: bigToggle.checked }));

  return el;
}

function updateVisibility(): void {
  if (!panelEl) return;
  const visible = document.querySelector(STREET_INTEL_MARKER) != null;
  panelEl.classList.toggle('ff-sip-visible', visible);
  if (!visible && expanded) setExpanded(false); // don't leave it expanded, hidden, for the next page it reappears on
}

export function initStreetIntelStatusPanel(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + PANEL_CSS);

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
      status = changes[STORAGE_KEYS.STREET_INTEL_AUTO_STATUS].newValue ?? null;
      renderAll();
    }
    if (STORAGE_KEYS.STREET_INTEL_AUTO_CONFIG in changes) {
      config = changes[STORAGE_KEYS.STREET_INTEL_AUTO_CONFIG].newValue ?? null;
      renderAll();
    }
  });

  // The game swaps panel content via innerHTML on the same page — no
  // navigation, so this is the only way to know when Street Intel comes
  // on/off screen. Same approach as courierPanel.ts's own visibility watch.
  const observer = new MutationObserver(() => updateVisibility());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}
