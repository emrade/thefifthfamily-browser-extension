import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { sendMessage } from '@/shared/messaging';
import { STORAGE_KEYS } from '@/shared/constants';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '@/shared/notifications';
import type { ArenaAutoConfig, ArenaAutoStatus, ArenaStatusResponse } from '@/shared/types';

/**
 * A floating panel on the live Arena page — collapsed badge by default,
 * expanding into the Auto-Attack toggle, the boss win% threshold, and the
 * last page it ran. Same badge/expand shape as `courierPanel.ts`; unlike
 * that one, the toggle here writes straight through `storage.ts` (a plain
 * config flag, no network call behind the write itself — same shortcut
 * courierPanel.ts's own three toggles already take) rather than a message
 * round-trip, while status itself still has to be message-based, since this
 * runs on the game's own origin and can't read `chrome.alarms` directly.
 *
 * Also carries the `arenaPageUnlocked` notification toggle — player's own
 * ask: Settings toggles it too, but this panel is what they're already
 * looking at, so duplicating the one that matters here beats making them
 * tab away. Reads/writes the exact same `NotificationPreferences` storage key
 * Settings does (`storage.ts`'s `getNotificationPreferences`/
 * `setNotificationPreferences`), and a `chrome.storage.onChanged` listener
 * keeps this panel's checkboxes live if the value changes from Settings
 * while this panel happens to be open — same pattern
 * `PetCouriersHome.tsx` uses to reflect a courier toggle changed from its
 * own in-page panel, just in the other direction.
 */

const CONTAINER_ID = 'ff-arena-panel';
const STYLE_ID = 'ff-arena-panel-style';
const ARENA_MARKER = '.ar-page';

const PANEL_CSS = `
#${CONTAINER_ID} {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif;
  display: none;
}
#${CONTAINER_ID}.ff-arp-visible { display: block; }

.ff-arp-badge {
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
.ff-arp-badge:hover { border-color: rgba(201,168,76,0.8); transform: translateY(-1px); }
.ff-arp-badge-label { font-size: 10.5px; color: #d9c48a; font-weight: 700; letter-spacing: 0.04em; }

.ff-arp-panel {
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
#${CONTAINER_ID}.ff-arp-expanded .ff-arp-panel { display: block; }
#${CONTAINER_ID}.ff-arp-expanded .ff-arp-badge { display: none; }

.ff-arp-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.ff-arp-close {
  background: none; border: none; color: #8b8f9e; font-size: 16px; line-height: 1;
  cursor: pointer; padding: 2px 6px;
}
.ff-arp-close:hover { color: #fff; }

/* Ported from the popup's own .ff-toggle-row/.ff-toggle, same as
 * courierPanel.ts's own copy — a content script can't reach the popup's
 * :root CSS-variable scope. */
.ff-arp-toggle-row {
  display: flex; align-items: center; gap: 12px; width: 100%;
  padding: 11px 12px; margin-bottom: 10px;
  background: #17130e; border: 1px solid rgba(201,168,76,0.16);
  border-radius: 10px; cursor: pointer;
}
.ff-arp-toggle-row__text { flex: 1; min-width: 0; }
.ff-arp-toggle-row__title { font-family: 'Inter', system-ui, sans-serif; font-weight: 700; font-size: 12.5px; color: #f1ede2; }
.ff-arp-toggle-row__status { font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 9.5px; color: #6b6455; margin-top: 1px; line-height: 1.4; }

.ff-arp-toggle {
  flex-shrink: 0; appearance: none; -webkit-appearance: none;
  width: 34px; height: 20px; border-radius: 10px;
  background: rgba(0,0,0,0.5); border: 1px solid rgba(201,168,76,0.34);
  position: relative; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.ff-arp-toggle::before {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #6b6455;
  transition: transform 0.15s cubic-bezier(.22,1,.36,1), background 0.15s;
}
.ff-arp-toggle:checked { background: rgba(251,191,36,0.18); border-color: #fbbf24; }
.ff-arp-toggle:checked::before { transform: translateX(14px); background: #fbbf24; box-shadow: 0 0 6px rgba(251,191,36,0.5); }

.ff-arp-field { margin-bottom: 12px; }
.ff-arp-field-label { font-size: 9.5px; color: #6b6455; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px; }
.ff-arp-field-input {
  width: 70px; padding: 6px 8px; font-size: 12px; font-family: 'Courier New', monospace;
  background: rgba(0,0,0,0.4); border: 1px solid rgba(201,168,76,0.3); border-radius: 6px; color: #f1ede2;
}

.ff-arp-check {
  display: block; width: 100%; padding: 10px; margin-bottom: 12px;
  border-radius: 8px; font-weight: 800; font-size: 10.5px;
  text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer;
  background: linear-gradient(135deg, rgba(201,168,76,0.30), rgba(201,168,76,0.12));
  border: 1px solid rgba(201,168,76,0.5);
  color: #f4d160;
}
.ff-arp-check:hover { background: linear-gradient(135deg, rgba(201,168,76,0.42), rgba(201,168,76,0.18)); }
.ff-arp-check:disabled { opacity: 0.5; cursor: default; }

.ff-arp-row-head {
  font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em;
  color: #6b6455; margin: 8px 0 3px;
}
.ff-arp-row { font-size: 10.5px; color: #ccc; padding: 2px 0; line-height: 1.4; }
.ff-arp-row--win { color: #7fd88f; }
.ff-arp-row--error { color: #f27f7f; }
.ff-arp-summary-time { font-size: 9px; color: #6b6455; margin-top: 8px; }
`;

let panelEl: HTMLDivElement | null = null;
let expanded = false;
let checking = false;

function formatCountdown(nextAt: number, now: number): string {
  const s = Math.max(0, Math.round((nextAt - now) / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

function renderStatus(config: ArenaAutoConfig, status: ArenaAutoStatus | null): string {
  const parts: string[] = [];

  if (status?.dayComplete) {
    parts.push('<div class="ff-arp-row">Today’s 6 Arena pages are done — resets with the game’s own daily reset.</div>');
  }

  const nextAt = status?.nextUnlockAt ?? null;
  if (nextAt !== null) {
    const label = config.enabled ? 'Next page' : 'Next reminder check';
    parts.push(`<div class="ff-arp-row">${label}: ${formatCountdown(nextAt, Date.now())}</div>`);
  }

  if (status?.pausedReason) {
    parts.push(`<div class="ff-arp-row ff-arp-row--error">Stopped: ${status.pausedMessage ?? 'unexpected response'}</div>`);
  }

  if (!status?.lastPage) {
    parts.push('<div class="ff-arp-row">No pages run yet.</div>');
    return parts.join('');
  }

  const page = status.lastPage;
  parts.push(`<div class="ff-arp-row-head">${page.complete ? 'Last Page' : 'Current Page — in progress'}</div>`);
  if (page.complete) {
    parts.push(`<div class="ff-arp-row">Page ${page.pageNumber} · banked +${page.banked} · score ${page.seasonScore}</div>`);
  } else {
    parts.push(`<div class="ff-arp-row">Page ${page.pageNumber} · fights below happened for real, not banked yet</div>`);
  }
  for (const o of page.opponents) {
    parts.push(`<div class="ff-arp-row${o.won ? ' ff-arp-row--win' : ''}">${o.won ? '✓' : '✗'} ${o.name} (${o.winPctAtAttack}%)</div>`);
  }
  if (page.boss) {
    parts.push(
      page.boss.attacked
        ? `<div class="ff-arp-row${page.boss.won ? ' ff-arp-row--win' : ''}">${page.boss.won ? '✓' : '✗'} ${page.boss.name} (boss, ${page.boss.winPct}%)</div>`
        : `<div class="ff-arp-row">Boss skipped — ${page.boss.skippedReason}</div>`,
    );
  }
  parts.push(`<div class="ff-arp-summary-time">${new Date(page.timestamp).toLocaleString()}</div>`);
  return parts.join('');
}

async function refresh() {
  if (!panelEl) return;
  const toggle = panelEl.querySelector<HTMLInputElement>('.ff-arp-toggle');
  const thresholdInput = panelEl.querySelector<HTMLInputElement>('.ff-arp-threshold-input');
  const statusEl = panelEl.querySelector('.ff-arp-status');
  try {
    const { config, status } = (await chrome.runtime.sendMessage({ type: 'arena-status-requested' })) as ArenaStatusResponse;
    if (toggle) toggle.checked = config.enabled;
    if (thresholdInput && document.activeElement !== thresholdInput) thresholdInput.value = String(config.bossWinPctThreshold);
    if (statusEl) statusEl.innerHTML = renderStatus(config, status);
  } catch (err) {
    console.error(LOG_PREFIX, 'arena panel status refresh failed', err);
  }
  await refreshNotifToggles();
}

async function handleCheckNow() {
  if (!panelEl || checking) return;
  checking = true;
  const btn = panelEl.querySelector<HTMLButtonElement>('.ff-arp-check');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Checking…';
  }
  try {
    await chrome.runtime.sendMessage({ type: 'arena-check-requested' });
    await refresh();
  } catch (err) {
    console.error(LOG_PREFIX, 'arena panel check-now failed', err);
  } finally {
    checking = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Check Now';
    }
  }
}

function setExpanded(next: boolean) {
  expanded = next;
  panelEl?.classList.toggle('ff-arp-expanded', expanded);
  if (expanded) refresh();
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.innerHTML = `
    <button class="ff-arp-badge" type="button">
      ${brandBadgeHtml('Arena')}
      <span class="ff-arp-badge-label">▲</span>
    </button>
    <div class="ff-arp-panel">
      <div class="ff-arp-head">
        ${brandBadgeHtml('Arena Auto-Attack')}
        <button class="ff-arp-close" type="button" title="Collapse">✕</button>
      </div>
      <label class="ff-arp-toggle-row">
        <div class="ff-arp-toggle-row__text">
          <div class="ff-arp-toggle-row__title">Auto-Attack</div>
          <div class="ff-arp-toggle-row__status">Fight every opponent, then the boss if it clears the threshold, then bank</div>
        </div>
        <input class="ff-arp-toggle" type="checkbox">
      </label>
      <div class="ff-arp-field">
        <div class="ff-arp-field-label">Boss win% threshold</div>
        <input class="ff-arp-field-input ff-arp-threshold-input" type="number" min="0" max="100">
      </div>
      <label class="ff-arp-toggle-row">
        <div class="ff-arp-toggle-row__text">
          <div class="ff-arp-toggle-row__title">Notify: page ready</div>
          <div class="ff-arp-toggle-row__status">A new Arena page is ready to open — repeats until you open it</div>
        </div>
        <input class="ff-arp-toggle ff-arp-notif-toggle" type="checkbox" data-notif-id="arenaPageUnlocked">
      </label>
      <button class="ff-arp-check" type="button">Check Now</button>
      <div class="ff-arp-status"><div class="ff-arp-row">Loading…</div></div>
    </div>
  `;

  el.querySelector('.ff-arp-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-arp-close')?.addEventListener('click', () => setExpanded(false));
  el.querySelector('.ff-arp-check')?.addEventListener('click', () => void handleCheckNow());

  const toggle = el.querySelector<HTMLInputElement>('.ff-arp-toggle');
  toggle?.addEventListener('change', () => {
    storage
      .getArenaAutoConfig()
      .then((config) => storage.setArenaAutoConfig({ ...config, enabled: toggle.checked }))
      .then(() => setTimeout(() => void refresh(), 4_000)) // background's own immediate-check delay
      .catch((err) => console.error(LOG_PREFIX, 'arena panel toggle write failed', err));
  });

  const thresholdInput = el.querySelector<HTMLInputElement>('.ff-arp-threshold-input');
  thresholdInput?.addEventListener('change', () => {
    const value = Math.min(100, Math.max(0, Math.round(Number(thresholdInput.value))));
    if (!Number.isFinite(value)) return;
    storage
      .getArenaAutoConfig()
      .then((config) => storage.setArenaAutoConfig({ ...config, bossWinPctThreshold: value }))
      .catch((err) => console.error(LOG_PREFIX, 'arena panel threshold write failed', err));
  });

  el.querySelectorAll<HTMLInputElement>('.ff-arp-notif-toggle').forEach((notifToggle) => {
    const id = notifToggle.dataset.notifId as keyof NotificationPreferences;
    notifToggle.addEventListener('change', () => {
      storage
        .getNotificationPreferences()
        .then((prefs) => storage.setNotificationPreferences({ ...prefs, [id]: notifToggle.checked }))
        .catch((err) => console.error(LOG_PREFIX, 'arena panel notification toggle write failed', err));
    });
  });

  return el;
}

/** Syncs the two notification checkboxes straight from storage — split out
 *  from `refresh()` (which round-trips to the background for the rest of
 *  the panel) since this half only ever needs a local read, and the
 *  `chrome.storage.onChanged` listener below reuses it to reflect a change
 *  made from Settings without waiting on the slower path. */
async function refreshNotifToggles() {
  if (!panelEl) return;
  const prefs = await storage.getNotificationPreferences();
  panelEl.querySelectorAll<HTMLInputElement>('.ff-arp-notif-toggle').forEach((notifToggle) => {
    const id = notifToggle.dataset.notifId as keyof NotificationPreferences;
    notifToggle.checked = prefs[id] ?? DEFAULT_NOTIFICATION_PREFERENCES[id];
  });
}

function updateVisibility() {
  if (!panelEl) return;
  const visible = document.querySelector(ARENA_MARKER) != null;
  panelEl.classList.toggle('ff-arp-visible', visible);
  if (!visible && expanded) setExpanded(false);
  if (visible) sendMessage({ type: 'arena-viewed', timestamp: Date.now() });
}

// Only runs while the panel is open, same reasoning as courierPanel.ts's own
// watchRefreshTimer — the countdown text would otherwise go stale for as
// long as the panel sits expanded.
let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function initArenaOverlay(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + PANEL_CSS);

  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);
  updateVisibility();

  const observer = new MutationObserver(() => updateVisibility());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });

  refreshTimer = setInterval(() => {
    if (expanded) void refresh();
  }, 15_000);

  // Live-reflects a notification toggle changed from Settings instead —
  // both surfaces read the same storage key, same `chrome.storage.onChanged`
  // pattern `PetCouriersHome.tsx` uses for its own courier toggle, just
  // watching the other direction (Settings → this panel rather than
  // in-page panel → popup).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEYS.NOTIFICATION_PREFERENCES in changes)) return;
    void refreshNotifToggles();
  });
}
