import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { STOCK_MARKET_POLL_INTERVAL_MS } from '@/shared/constants';

/**
 * A floating status readout on the live Stock Market page — same collapsed-
 * badge-that-expands shape as the Pet Courier panel, but read-only: there's
 * nothing to trigger here, only a way to actually see that
 * background/features/stockMarket/poller.ts is doing what it says (see
 * docs/stock-market-tracker-plan.md). Before this, the only way to check was
 * digging through the service worker's own console — the tracker runs
 * entirely in the background with no other UI at all, so "is this thing
 * actually collecting data" had no answer in the product itself.
 *
 * The status itself lives in the extension's own IndexedDB/chrome.storage,
 * which this overlay — running on the game's origin, not the extension's —
 * can only reach via a message round-trip to background/index.ts, same as
 * the courier panel's own status refresh.
 */

const CONTAINER_ID = 'ff-stock-status';
const STYLE_ID = 'ff-stock-status-style';
// The panel's own hidden data blob — unique to this page, present the moment
// the panel renders regardless of which stock (if any) is selected.
const MARKER_SELECTOR = '#lsv2-data';

// Past this, a poll that's still "succeeding" on schedule would have run
// again already — twice the interval gives a missed-alarm or two some slack
// before this reads as stale rather than just unlucky timing.
const STALE_AFTER_MS = STOCK_MARKET_POLL_INTERVAL_MS * 2;

const STYLE = `
#${CONTAINER_ID} {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif;
  display: none;
}
#${CONTAINER_ID}.ff-ss-visible { display: block; }

.ff-ss-badge {
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
.ff-ss-badge:hover { border-color: rgba(201,168,76,0.8); transform: translateY(-1px); }
.ff-ss-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ff-ss-dot[data-ff-health="ok"] { background: #34d399; box-shadow: 0 0 6px rgba(52,211,153,0.7); }
.ff-ss-dot[data-ff-health="stale"], .ff-ss-dot[data-ff-health="waiting"] { background: #fbbf24; box-shadow: 0 0 6px rgba(251,191,36,0.6); }
.ff-ss-dot[data-ff-health="error"] { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.6); }
.ff-ss-dot[data-ff-health="paused"] {
  background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.6);
  animation: ffSsPulse 1.6s ease-in-out infinite;
}
@keyframes ffSsPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) {
  .ff-ss-dot[data-ff-health="paused"] { animation: none; }
}
.ff-ss-badge-arrow { font-size: 10.5px; color: #d9c48a; font-weight: 700; }

.ff-ss-panel {
  display: none;
  width: 290px;
  padding: 16px;
  background: linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 14px;
  box-shadow: 0 10px 34px rgba(0,0,0,0.6);
  color: #ccc;
}
#${CONTAINER_ID}.ff-ss-expanded .ff-ss-panel { display: block; }
#${CONTAINER_ID}.ff-ss-expanded .ff-ss-badge { display: none; }

.ff-ss-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.ff-ss-close {
  background: none; border: none; color: #8b8f9e; font-size: 16px; line-height: 1;
  cursor: pointer; padding: 2px 6px;
}
.ff-ss-close:hover { color: #fff; }

.ff-ss-status { display: flex; align-items: flex-start; gap: 8px; font-size: 11px; line-height: 1.5; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.ff-ss-status .ff-ss-dot { margin-top: 4px; }
.ff-ss-status-title { font-weight: 800; color: #e4e4e7; }
.ff-ss-status[data-ff-health="ok"] .ff-ss-status-title { color: #6ee7b7; }
.ff-ss-status[data-ff-health="stale"] .ff-ss-status-title, .ff-ss-status[data-ff-health="waiting"] .ff-ss-status-title { color: #fbbf24; }
.ff-ss-status[data-ff-health="error"] .ff-ss-status-title, .ff-ss-status[data-ff-health="paused"] .ff-ss-status-title { color: #f87171; }
.ff-ss-status-sub { color: #8b8f9e; font-size: 10px; margin-top: 2px; }

.ff-ss-rows { font-size: 10.5px; color: #ccc; margin-bottom: 12px; }
.ff-ss-row { display: flex; justify-content: space-between; padding: 4px 0; }
.ff-ss-row-label { color: #8b8f9e; }
.ff-ss-row-val { font-family: 'Courier New', ui-monospace, monospace; font-weight: 700; color: #fff; }

.ff-ss-sync {
  width: 100%; padding: 8px;
  background: rgba(201,168,76,0.1); border: 1px solid rgba(201,168,76,0.3);
  border-radius: 7px; color: #d9c48a;
  font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em;
  cursor: pointer;
}
.ff-ss-sync:hover:not(:disabled) { background: rgba(201,168,76,0.18); }
.ff-ss-sync:disabled { opacity: 0.6; cursor: default; }
.ff-ss-sync[data-ff-mode="resume"] {
  background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.4); color: #f87171;
}
.ff-ss-sync[data-ff-mode="resume"]:hover:not(:disabled) { background: rgba(239,68,68,0.2); }
`;

function formatRelative(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

interface StockTrackerStatus {
  lastPollAt: number | null;
  lastError: string | null;
  paused: boolean;
  backfillDone: boolean;
  totalPricePoints: number;
  stocksTracked: number;
  totalRumors: number;
  resolvedRumors: number;
  trueCount: number;
  falseCount: number;
}

let panelEl: HTMLDivElement | null = null;

function healthOf(status: StockTrackerStatus): 'ok' | 'stale' | 'waiting' | 'error' | 'paused' {
  // A genuine hard stop (see poller.ts's `pause`) always wins, regardless of
  // what lastError happens to say — this is the one state that needs a
  // human to actually notice and act, unlike every other tier here.
  if (status.paused) return 'paused';
  // A "Skipped — " message is the poller declining to run for a normal,
  // temporary reason (hospitalized/jailed — see poller.ts's
  // blockedByPlayerState) — not a malfunction, so it gets its own calmer
  // tier rather than reading as broken the way a real error does.
  if (status.lastError?.startsWith('Skipped — ')) return 'waiting';
  if (status.lastError) return 'error';
  if (!status.lastPollAt || Date.now() - status.lastPollAt > STALE_AFTER_MS) return 'stale';
  return 'ok';
}

function renderStatus(status: StockTrackerStatus) {
  if (!panelEl) return;
  const health = healthOf(status);

  const dot = panelEl.querySelector('.ff-ss-dot[data-ff-badge]');
  if (dot) dot.setAttribute('data-ff-health', health);

  const statusEl = panelEl.querySelector('.ff-ss-status');
  if (statusEl) {
    statusEl.setAttribute('data-ff-health', health);
    let title: string;
    let sub: string;
    if (health === 'paused') {
      title = 'Paused — needs your attention';
      sub = `${status.lastError ?? 'An unrecognized response stopped data collection.'} Won't retry until you resume it below.`;
    } else if (health === 'waiting') {
      title = status.lastError as string; // "Skipped — hospitalized"/"Skipped — jailed"
      sub = 'Normal — polling resumes automatically once that clears, no action needed.';
    } else if (health === 'error') {
      title = 'Last attempt failed';
      sub = status.lastError ?? 'unknown error';
    } else if (!status.lastPollAt) {
      title = 'Not synced yet';
      sub = 'Waiting on the first successful poll — open any other game panel once so a session token gets captured.';
    } else if (health === 'stale') {
      title = `Stale — last synced ${formatRelative(status.lastPollAt)}`;
      sub = 'Expected roughly every 30 minutes. The extension may need the game tab reloaded.';
    } else {
      title = `Synced ${formatRelative(status.lastPollAt)}`;
      sub = status.backfillDone ? '30-day history backfilled' : 'Backfill pending';
    }
    statusEl.innerHTML = `<span class="ff-ss-dot" data-ff-health="${health}"></span><span><span class="ff-ss-status-title">${title}</span><br><span class="ff-ss-status-sub">${sub}</span></span>`;
  }

  const rowsEl = panelEl.querySelector('.ff-ss-rows');
  if (rowsEl) {
    rowsEl.innerHTML = `
      <div class="ff-ss-row"><span class="ff-ss-row-label">Price points</span><span class="ff-ss-row-val">${status.totalPricePoints.toLocaleString()}</span></div>
      <div class="ff-ss-row"><span class="ff-ss-row-label">Stocks tracked</span><span class="ff-ss-row-val">${status.stocksTracked}</span></div>
      <div class="ff-ss-row"><span class="ff-ss-row-label">Rumors resolved</span><span class="ff-ss-row-val">${status.resolvedRumors} / ${status.totalRumors}</span></div>
      <div class="ff-ss-row"><span class="ff-ss-row-label">True / False</span><span class="ff-ss-row-val">${status.trueCount} / ${status.falseCount}</span></div>
    `;
  }

  // Swaps the single action button between "Sync Now" and "Resume Tracking"
  // rather than having two separate buttons — only one action ever makes
  // sense at a time, and the click handler (see buildPanel) reads this same
  // data attribute to decide which one to run.
  const btn = panelEl.querySelector<HTMLButtonElement>('.ff-ss-sync');
  if (btn && !btn.disabled) {
    if (status.paused) {
      btn.dataset.ffMode = 'resume';
      btn.textContent = 'Resume Tracking';
    } else {
      btn.dataset.ffMode = 'sync';
      btn.textContent = 'Sync Now';
    }
  }
}

async function refresh() {
  try {
    const status = (await chrome.runtime.sendMessage({ type: 'stock-tracker-status-requested' })) as StockTrackerStatus;
    renderStatus(status);
  } catch (err) {
    console.error(LOG_PREFIX, 'stock tracker status refresh failed', err);
  }
}

// Shared by both buttons this single element can become (see renderStatus's
// mode-swap) — runs `messageType`, shows `busyLabel` while it's in flight,
// then hands the fresh status to renderStatus, which sets the button back to
// whichever mode/label actually matches the *new* state (re-enabling it
// first, since renderStatus only touches an enabled button — this is what a
// resume that comes back still `paused` for some reason relies on to keep
// reading as "Resume Tracking" rather than snapping back to "Sync Now").
async function runButtonAction(messageType: 'stock-tracker-poll-requested' | 'stock-tracker-resume-requested', busyLabel: string) {
  if (!panelEl) return;
  const btn = panelEl.querySelector<HTMLButtonElement>('.ff-ss-sync');
  if (btn) {
    btn.disabled = true;
    btn.textContent = busyLabel;
  }
  try {
    const status = (await chrome.runtime.sendMessage({ type: messageType })) as StockTrackerStatus;
    if (btn) btn.disabled = false;
    renderStatus(status);
  } catch (err) {
    console.error(LOG_PREFIX, `stock tracker ${messageType} failed`, err);
    if (btn) btn.disabled = false;
  }
}

// Runs a real poll immediately rather than waiting out whatever's left of the
// 30-minute schedule — the status shown otherwise only ever reflects the
// *last scheduled* attempt, which can be stale by up to that whole interval
// (e.g. right after fixing a CSRF issue, there's no other way to confirm it
// without waiting).
function syncNow() {
  return runButtonAction('stock-tracker-poll-requested', 'Syncing…');
}

// Clears a pause set by poller.ts's `pause` — see its own comment for why a
// pause exists at all for a feature that spends nothing.
function resumeTracking() {
  return runButtonAction('stock-tracker-resume-requested', 'Resuming…');
}

function setExpanded(next: boolean) {
  panelEl?.classList.toggle('ff-ss-expanded', next);
  if (next) void refresh();
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.innerHTML = `
    <button class="ff-ss-badge" type="button">
      ${brandBadgeHtml('Stock Intel')}
      <span class="ff-ss-dot" data-ff-badge data-ff-health="stale"></span>
      <span class="ff-ss-badge-arrow">▲</span>
    </button>
    <div class="ff-ss-panel">
      <div class="ff-ss-head">
        ${brandBadgeHtml('Stock Market Tracker')}
        <button class="ff-ss-close" type="button" title="Collapse">✕</button>
      </div>
      <div class="ff-ss-status" data-ff-health="stale">Loading…</div>
      <div class="ff-ss-rows"></div>
      <button class="ff-ss-sync" type="button" data-ff-mode="sync">Sync Now</button>
    </div>
  `;

  el.querySelector('.ff-ss-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-ss-close')?.addEventListener('click', () => setExpanded(false));
  el.querySelector<HTMLButtonElement>('.ff-ss-sync')?.addEventListener('click', (e) => {
    const mode = (e.currentTarget as HTMLButtonElement).dataset.ffMode;
    void (mode === 'resume' ? resumeTracking() : syncNow());
  });

  return el;
}

function updateVisibility() {
  if (!panelEl) return;
  const visible = document.querySelector(MARKER_SELECTOR) != null;
  panelEl.classList.toggle('ff-ss-visible', visible);
}

export function initStockMarketStatus(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + STYLE);

  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);
  updateVisibility();
  void refresh();

  // Same "watch the live DOM, react to what's actually there" approach as the
  // Real Estate Advisor and Pet Courier panel — the game swaps panel content
  // via innerHTML in place, so there's no navigation event to hook instead.
  // Tracks presence only, same as the courier panel's own observer — this
  // status comes entirely from a message round-trip to the background, not
  // from anything on the page, so there's no reason to refresh on every page
  // mutation (and doing so was a real bug: the stock page mutates constantly
  // on its own — countdowns, chart redraws, price ticks — which was
  // rewriting the status text via innerHTML on every one of them, several
  // times a second, breaking text selection anytime the player tried to
  // copy from it. Refreshing happens on init, the 60s interval below, expand,
  // and "Sync Now" — never off an unrelated page mutation.
  const observer = new MutationObserver(() => updateVisibility());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });

  // The badge/panel is meant to answer "is this working right now", not just
  // "was it working when the page loaded" — a light poll while the page is
  // open keeps the dot honest without needing the player to collapse/reopen
  // the panel to force a refresh.
  setInterval(() => {
    if (document.querySelector(MARKER_SELECTOR)) void refresh();
  }, 60_000);
}
