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
.ff-ss-dot[data-ff-health="stale"] { background: #fbbf24; box-shadow: 0 0 6px rgba(251,191,36,0.6); }
.ff-ss-dot[data-ff-health="error"] { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.6); }
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
.ff-ss-status[data-ff-health="stale"] .ff-ss-status-title { color: #fbbf24; }
.ff-ss-status[data-ff-health="error"] .ff-ss-status-title { color: #f87171; }
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
  backfillDone: boolean;
  totalPricePoints: number;
  stocksTracked: number;
  totalRumors: number;
  resolvedRumors: number;
  trueCount: number;
  falseCount: number;
}

let panelEl: HTMLDivElement | null = null;

function healthOf(status: StockTrackerStatus): 'ok' | 'stale' | 'error' {
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
    if (health === 'error') {
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
}

async function refresh() {
  try {
    const status = (await chrome.runtime.sendMessage({ type: 'stock-tracker-status-requested' })) as StockTrackerStatus;
    renderStatus(status);
  } catch (err) {
    console.error(LOG_PREFIX, 'stock tracker status refresh failed', err);
  }
}

// Runs a real poll immediately rather than waiting out whatever's left of the
// 30-minute schedule — the status shown otherwise only ever reflects the
// *last scheduled* attempt, which can be stale by up to that whole interval
// (e.g. right after fixing a CSRF issue, there's no other way to confirm it
// without waiting).
async function syncNow() {
  if (!panelEl) return;
  const btn = panelEl.querySelector<HTMLButtonElement>('.ff-ss-sync');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Syncing…';
  }
  try {
    const status = (await chrome.runtime.sendMessage({ type: 'stock-tracker-poll-requested' })) as StockTrackerStatus;
    renderStatus(status);
  } catch (err) {
    console.error(LOG_PREFIX, 'stock tracker manual sync failed', err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Sync Now';
    }
  }
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
      <button class="ff-ss-sync" type="button">Sync Now</button>
    </div>
  `;

  el.querySelector('.ff-ss-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-ss-close')?.addEventListener('click', () => setExpanded(false));
  el.querySelector('.ff-ss-sync')?.addEventListener('click', () => void syncNow());

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
