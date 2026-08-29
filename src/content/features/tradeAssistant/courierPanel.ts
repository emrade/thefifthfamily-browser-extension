import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { STOP_REASON_LABEL, describeItems, describeProgressEvent, describeRoster, formatCourierMoney, formatRelativeTime } from '@/shared/courierDisplay';
import { storage } from '@/shared/storage';
import type { ExtensionMessage } from '@/shared/messaging';
import type { CourierRunSummary, CourierStatus, CourierWatchSummary } from '@/shared/types';

/**
 * A floating panel on the live Smuggling page — collapsed to a small badge by
 * default, expanding on click into a Run button + last-run summary. This is the
 * only surface for triggering a courier run (a popup Couriers tab existed
 * briefly but was removed: a popup is a poor fit for a feature you want to
 * trigger repeatedly while looking at the game, since it's a separate surface
 * that closes the moment it loses focus).
 *
 * Runs entirely over `chrome.runtime.sendMessage`'s 'courier-run-requested'/
 * 'courier-offload-requested'/'courier-status-requested' messages, answered by
 * the background service worker in petCourier.ts.
 *
 * The panel's own visibility (not just its expand/collapse state) tracks whether
 * Smuggling is actually the panel currently on screen — the game is a single-page
 * app that swaps panel content in place via innerHTML, so `.sv2-monitor-board`
 * (present in every state the sv2 dashboard renders — idle, drafting, in transit;
 * see smugglingV2PanelAdapter.ts) is watched via MutationObserver as the signal
 * for "is this the page a courier panel makes sense on right now."
 */

const CONTAINER_ID = 'ff-courier-panel';
const STYLE_ID = 'ff-courier-panel-style';
const SMUGGLING_MARKER = '.sv2-monitor-board';

const PANEL_CSS = `
#${CONTAINER_ID} {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif;
  display: none;
}
#${CONTAINER_ID}.ff-cp-visible { display: block; }

.ff-cp-badge {
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
.ff-cp-badge:hover { border-color: rgba(201,168,76,0.8); transform: translateY(-1px); }
.ff-cp-badge-label { font-size: 10.5px; color: #d9c48a; font-weight: 700; letter-spacing: 0.04em; }

.ff-cp-panel {
  display: none;
  width: 300px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 16px;
  background: linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 14px;
  box-shadow: 0 10px 34px rgba(0,0,0,0.6);
  color: #ccc;
}
#${CONTAINER_ID}.ff-cp-expanded .ff-cp-panel { display: block; }
#${CONTAINER_ID}.ff-cp-expanded .ff-cp-badge { display: none; }

.ff-cp-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.ff-cp-close {
  background: none; border: none; color: #8b8f9e; font-size: 16px; line-height: 1;
  cursor: pointer; padding: 2px 6px;
}
.ff-cp-close:hover { color: #fff; }

.ff-cp-roster { font-size: 10px; color: #8b8f9e; margin-bottom: 12px; line-height: 1.5; }

/* Ported from the popup's own .ff-toggle-row/.ff-toggle (src/design/tokens.css
 * + src/popup/app.css) with its CSS custom properties resolved to literal
 * values — a content script runs on the game's own page, outside the
 * popup's :root token scope, so the vars themselves aren't reachable here. */
.ff-cp-toggle-row {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 11px 12px; margin-bottom: 8px;
  background: #17130e; border: 1px solid rgba(201,168,76,0.16);
  border-radius: 10px; cursor: pointer;
}
.ff-cp-toggle-row__text { flex: 1; min-width: 0; }
.ff-cp-toggle-row__title { font-family: 'Inter', system-ui, sans-serif; font-weight: 700; font-size: 12.5px; color: #f1ede2; }
.ff-cp-toggle-row__status { font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 9.5px; color: #6b6455; margin-top: 1px; line-height: 1.4; }

.ff-cp-toggle {
  flex-shrink: 0; appearance: none; -webkit-appearance: none;
  width: 34px; height: 20px; border-radius: 10px;
  background: rgba(0,0,0,0.5); border: 1px solid rgba(201,168,76,0.34);
  position: relative; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.ff-cp-toggle::before {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #6b6455;
  transition: transform 0.15s cubic-bezier(.22,1,.36,1), background 0.15s;
}
.ff-cp-toggle:checked { background: rgba(251,191,36,0.18); border-color: #fbbf24; }
.ff-cp-toggle:checked::before { transform: translateX(14px); background: #fbbf24; box-shadow: 0 0 6px rgba(251,191,36,0.5); }

.ff-cp-watch {
  padding: 8px 10px; margin-bottom: 12px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
}
.ff-cp-watch-row { font-size: 9.5px; color: #ccc; padding: 1px 0; line-height: 1.5; }
.ff-cp-watch-row-head {
  font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em;
  color: #6b6455; margin: 6px 0 2px;
}

.ff-cp-actions { display: flex; gap: 8px; margin-bottom: 12px; }

.ff-cp-run, .ff-cp-offload {
  display: block; flex: 1; padding: 10px;
  border-radius: 8px;
  font-weight: 800;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
}
.ff-cp-run {
  background: linear-gradient(135deg, rgba(201,168,76,0.30), rgba(201,168,76,0.12));
  border: 1px solid rgba(201,168,76,0.5);
  color: #f4d160;
}
.ff-cp-run:hover { background: linear-gradient(135deg, rgba(201,168,76,0.42), rgba(201,168,76,0.18)); }
.ff-cp-offload {
  background: linear-gradient(135deg, rgba(96,165,250,0.22), rgba(96,165,250,0.08));
  border: 1px solid rgba(96,165,250,0.4);
  color: #9fc4fa;
}
.ff-cp-offload:hover { background: linear-gradient(135deg, rgba(96,165,250,0.32), rgba(96,165,250,0.14)); }
.ff-cp-run:disabled, .ff-cp-offload:disabled { opacity: 0.5; cursor: default; }

.ff-cp-summary-time { font-size: 9px; color: #6b6455; margin-bottom: 8px; }
.ff-cp-alert {
  padding: 8px 10px; margin-bottom: 8px; font-size: 10px; line-height: 1.5;
  background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.3);
  border-radius: 7px; color: #ccc;
}
.ff-cp-row-head {
  font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em;
  color: #6b6455; margin: 8px 0 3px;
}
.ff-cp-row { font-size: 10.5px; color: #ccc; padding: 2px 0; line-height: 1.4; }
.ff-cp-row--error { color: #ef7a7a; }
`;

let panelEl: HTMLDivElement | null = null;
let expanded = false;
// Which action (if any) is currently in flight — the offload-only path shares
// the same live-progress/summary rendering as a full run (identical
// `CourierRunSummary` shape, same broadcast), so one flag distinguishes them
// rather than two independent booleans.
let activeAction: 'run' | 'offload' | null = null;
// Cleared at the start of each run, appended to live as `courier-run-progress`
// messages arrive — see petCourier.ts's `emitProgress`. Replaced wholesale by
// the final summary once the run's response resolves.
let liveLines: string[] = [];

function renderSummary(run: CourierRunSummary | null): string {
  if (!run) return '<div class="ff-cp-row">No runs yet.</div>';

  const parts: string[] = [`<div class="ff-cp-summary-time">${new Date(run.timestamp).toLocaleString()}</div>`];

  if (run.stoppedReason) {
    parts.push(`<div class="ff-cp-alert">${STOP_REASON_LABEL[run.stoppedReason]}</div>`);
  }
  if (run.offloaded.length > 0) {
    parts.push('<div class="ff-cp-row-head">Offloaded</div>');
    parts.push(...run.offloaded.map((o) => `<div class="ff-cp-row">${o.petName} — ${formatCourierMoney(o.profit)}</div>`));
  }
  if (run.sent.length > 0) {
    parts.push('<div class="ff-cp-row-head">Sent</div>');
    parts.push(...run.sent.map((s) => `<div class="ff-cp-row">${s.petName} — ${describeItems(s.items)} → ${s.destination}</div>`));
  }
  if (run.cashWithdrawn > 0) {
    parts.push(`<div class="ff-cp-row">Withdrew ${formatCourierMoney(run.cashWithdrawn)}.</div>`);
  }
  if (run.cashDeposited > 0) {
    parts.push(`<div class="ff-cp-row">Deposited ${formatCourierMoney(run.cashDeposited)}.</div>`);
  }
  if (run.skipped.length > 0) {
    parts.push('<div class="ff-cp-row-head">Skipped</div>');
    parts.push(...run.skipped.map((s) => `<div class="ff-cp-row">${s.petName} — ${s.reason}</div>`));
  }
  if (run.errors.length > 0) {
    parts.push('<div class="ff-cp-row-head">Errors</div>');
    parts.push(...run.errors.map((e) => `<div class="ff-cp-row ff-cp-row--error">${e}</div>`));
  }
  if (run.offloaded.length === 0 && run.sent.length === 0 && run.cashDeposited === 0 && !run.stoppedReason && run.errors.length === 0) {
    parts.push('<div class="ff-cp-row">Nothing to do.</div>');
  }

  return parts.join('');
}

/** Answers "even when it is active i have no idea what it is doing" — a plain
 *  status readout of what the background courier-watch is currently tracking:
 *  whether the destination is open, when it'll next check, and when each
 *  in-flight pet is due back. Purely descriptive; never triggers anything. */
function renderWatchStatus(watch: CourierWatchSummary): string {
  const now = Date.now();
  const parts: string[] = [
    `<div class="ff-cp-watch-row">Auto-dispatch: ${watch.autoDispatchEnabled ? 'ON' : 'OFF'} · Auto-offload: ${watch.autoOffloadEnabled ? 'ON' : 'OFF'}</div>`,
  ];

  const destOpen = watch.destinationOpenUntil !== null && watch.destinationOpenUntil > now;
  if (watch.lastCheckedAt === 0) {
    parts.push('<div class="ff-cp-watch-row">Destination: not checked yet.</div>');
  } else if (watch.lastProbeResult === 'skipped-no-idle-pets') {
    // Honest about *why* there's nothing fresher: the alarm ran at
    // `lastCheckedAt` but every pet was out, so it had nothing to draft with
    // and couldn't actually learn the destination's state — very different
    // from having checked and found it locked.
    parts.push(`<div class="ff-cp-watch-row">Destination: no idle pets to check with (last tried ${new Date(watch.lastCheckedAt).toLocaleTimeString()}).</div>`);
  } else if (destOpen) {
    parts.push(
      `<div class="ff-cp-watch-row">Destination: open, closes in ${formatRelativeTime(watch.destinationOpenUntil!, now)} (${new Date(watch.destinationOpenUntil!).toLocaleTimeString()}).</div>`,
    );
  } else {
    parts.push(`<div class="ff-cp-watch-row">Destination: locked (checked ${new Date(watch.lastCheckedAt).toLocaleTimeString()}).</div>`);
  }

  if (watch.nextDestCheckAt !== null) {
    parts.push(
      `<div class="ff-cp-watch-row">Next check: in ${formatRelativeTime(watch.nextDestCheckAt, now)} (${new Date(watch.nextDestCheckAt).toLocaleTimeString()}).</div>`,
    );
  }

  if (watch.pendingReturns.length === 0) {
    parts.push('<div class="ff-cp-watch-row">No pets currently en route.</div>');
  } else {
    parts.push('<div class="ff-cp-watch-row-head">En route</div>');
    parts.push(
      ...watch.pendingReturns.map((p) => {
        // A pet only leaves this list once the return alarm actually offloads
        // it (see `recordFleetReturns`) — so still appearing here past its own
        // ETA means offload genuinely hasn't happened yet, not just "the
        // countdown hit zero a moment ago." Said plainly instead of repeating
        // the same vague "any moment" a stuck pet and a freshly-landed one
        // would otherwise share.
        const label = p.arrivesAt <= now ? 'landed, offload pending' : `back in ${formatRelativeTime(p.arrivesAt, now)}`;
        return `<div class="ff-cp-watch-row">${p.petName} — ${label}</div>`;
      }),
    );
  }

  return parts.join('');
}

function renderLive(): string {
  if (liveLines.length === 0) return '<div class="ff-cp-row">Starting…</div>';
  return liveLines.map((line) => `<div class="ff-cp-row">${line}</div>`).join('');
}

async function refresh() {
  if (!panelEl) return;
  const rosterEl = panelEl.querySelector('.ff-cp-roster');
  const summaryEl = panelEl.querySelector('.ff-cp-summary');
  const watchEl = panelEl.querySelector('.ff-cp-watch');
  try {
    const status = (await chrome.runtime.sendMessage({ type: 'courier-status-requested' })) as CourierStatus;
    if (rosterEl) rosterEl.textContent = describeRoster(status.roster);
    if (summaryEl) summaryEl.innerHTML = renderSummary(status.lastRun);
    if (watchEl) watchEl.innerHTML = renderWatchStatus(status.watch);
  } catch (err) {
    console.error(LOG_PREFIX, 'courier panel status refresh failed', err);
  }
}

async function handleAction(kind: 'run' | 'offload') {
  if (!panelEl || activeAction) return;
  activeAction = kind;
  liveLines = [];
  const runBtn = panelEl.querySelector<HTMLButtonElement>('.ff-cp-run');
  const offloadBtn = panelEl.querySelector<HTMLButtonElement>('.ff-cp-offload');
  const summaryEl = panelEl.querySelector('.ff-cp-summary');
  if (runBtn) {
    runBtn.disabled = true;
    runBtn.textContent = kind === 'run' ? 'Running…' : 'Run';
  }
  if (offloadBtn) {
    offloadBtn.disabled = true;
    offloadBtn.textContent = kind === 'offload' ? 'Offloading…' : 'Offload All';
  }
  if (summaryEl) summaryEl.innerHTML = renderLive();
  try {
    const messageType = kind === 'run' ? 'courier-run-requested' : 'courier-offload-requested';
    const summary = (await chrome.runtime.sendMessage({ type: messageType })) as CourierRunSummary;
    if (summaryEl) summaryEl.innerHTML = renderSummary(summary);
    await refresh(); // either action can learn new pets too
  } catch (err) {
    console.error(LOG_PREFIX, `courier panel ${kind} failed`, err);
  } finally {
    activeAction = null;
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = 'Run';
    }
    if (offloadBtn) {
      offloadBtn.disabled = false;
      offloadBtn.textContent = 'Offload All';
    }
  }
}

chrome.runtime.onMessage.addListener((msg: ExtensionMessage) => {
  if (msg.type !== 'courier-run-progress' || !activeAction || !panelEl) return;
  const line = describeProgressEvent(msg.event);
  if (!line) return;
  liveLines.push(line);
  const summaryEl = panelEl.querySelector('.ff-cp-summary');
  if (summaryEl) summaryEl.innerHTML = renderLive();
});

// Only runs while the panel is open — the watch summary's relative times
// ("back in 12m") would otherwise go stale for as long as the panel sits
// expanded, since nothing else re-triggers `refresh()` on its own. A plain
// status read (no game API call), so a 30s cadence costs nothing.
let watchRefreshTimer: ReturnType<typeof setInterval> | null = null;

function setExpanded(next: boolean) {
  expanded = next;
  panelEl?.classList.toggle('ff-cp-expanded', expanded);
  if (expanded) {
    refresh();
    if (watchRefreshTimer === null) watchRefreshTimer = setInterval(() => void refresh(), 30_000);
  } else if (watchRefreshTimer !== null) {
    clearInterval(watchRefreshTimer);
    watchRefreshTimer = null;
  }
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.innerHTML = `
    <button class="ff-cp-badge" type="button">
      ${brandBadgeHtml('Couriers')}
      <span class="ff-cp-badge-label">▲</span>
    </button>
    <div class="ff-cp-panel">
      <div class="ff-cp-head">
        ${brandBadgeHtml('Pet Couriers')}
        <button class="ff-cp-close" type="button" title="Collapse">✕</button>
      </div>
      <div class="ff-cp-roster">Loading…</div>
      <label class="ff-cp-toggle-row">
        <div class="ff-cp-toggle-row__text">
          <div class="ff-cp-toggle-row__title">Auto-dispatch</div>
          <div class="ff-cp-toggle-row__status">Send idle pets automatically when a destination opens</div>
        </div>
        <input class="ff-cp-autodispatch-toggle ff-cp-toggle" type="checkbox">
      </label>
      <label class="ff-cp-toggle-row">
        <div class="ff-cp-toggle-row__text">
          <div class="ff-cp-toggle-row__title">Auto-offload</div>
          <div class="ff-cp-toggle-row__status">Collect a landed pet's cargo automatically</div>
        </div>
        <input class="ff-cp-autooffload-toggle ff-cp-toggle" type="checkbox">
      </label>
      <div class="ff-cp-watch"><div class="ff-cp-watch-row">Loading…</div></div>
      <div class="ff-cp-actions">
        <button class="ff-cp-run" type="button">Run</button>
        <button class="ff-cp-offload" type="button">Offload All</button>
      </div>
      <div class="ff-cp-summary"><div class="ff-cp-row">No runs yet.</div></div>
    </div>
  `;

  el.querySelector('.ff-cp-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-cp-close')?.addEventListener('click', () => setExpanded(false));
  el.querySelector('.ff-cp-run')?.addEventListener('click', () => void handleAction('run'));
  el.querySelector('.ff-cp-offload')?.addEventListener('click', () => void handleAction('offload'));

  // Read/written straight through storage.ts rather than a message round-trip —
  // it's a plain config flag with no live network call behind it, same direct
  // pattern the popup uses for e.g. Career Auto's config. Detection/notification
  // from the background courier-watch alarm run regardless of either flag; they
  // only gate whether a landed pet gets auto-offloaded and an open destination
  // gets pets auto-dispatched. Two independent toggles, not one — this system's
  // own convention (every auto feature) is that anything automated can be
  // turned off on its own, and offload/dispatch are genuinely different
  // actions with different risk profiles.
  const offloadToggle = el.querySelector<HTMLInputElement>('.ff-cp-autooffload-toggle');
  const dispatchToggle = el.querySelector<HTMLInputElement>('.ff-cp-autodispatch-toggle');
  if (offloadToggle && dispatchToggle) {
    storage
      .getCourierAutoConfig()
      .then((config) => {
        offloadToggle.checked = config.autoOffloadEnabled;
        dispatchToggle.checked = config.autoDispatchEnabled;
      })
      .catch((err) => console.error(LOG_PREFIX, 'courier panel auto config read failed', err));

    offloadToggle.addEventListener('change', () => {
      storage
        .getCourierAutoConfig()
        .then((config) => storage.setCourierAutoConfig({ ...config, autoOffloadEnabled: offloadToggle.checked }))
        .catch((err) => console.error(LOG_PREFIX, 'courier panel auto-offload config write failed', err));
    });

    dispatchToggle.addEventListener('change', () => {
      storage
        .getCourierAutoConfig()
        .then((config) => storage.setCourierAutoConfig({ ...config, autoDispatchEnabled: dispatchToggle.checked }))
        .catch((err) => console.error(LOG_PREFIX, 'courier panel auto-dispatch config write failed', err));
    });
  }

  return el;
}

function updateVisibility() {
  if (!panelEl) return;
  const visible = document.querySelector(SMUGGLING_MARKER) != null;
  panelEl.classList.toggle('ff-cp-visible', visible);
  if (!visible && expanded) setExpanded(false); // don't leave it expanded, hidden, for the next page it reappears on
}

export function initCourierPanel(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + PANEL_CSS);

  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);
  updateVisibility();

  // The game swaps panel content via innerHTML on the same page — no navigation,
  // so this is the only way to know when Smuggling comes on/off screen. Same
  // "watch the live DOM, react to what's actually there" approach as Fight Club's
  // toolbar and Street Intel's highlights.
  const observer = new MutationObserver(() => updateVisibility());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}
