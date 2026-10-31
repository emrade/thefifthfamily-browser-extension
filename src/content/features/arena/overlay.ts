import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { sendMessage } from '@/shared/messaging';
import { STORAGE_KEYS } from '@/shared/constants';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '@/shared/notifications';
import { bossStrengthBreakEven, regularStrengthLimit } from '@/shared/arenaCombat';
import type { ArenaMyProfile, ArenaWatchStatus } from '@/shared/types';
import { MASTERY_TIER_LABEL, ROSTER_BOSSES, familyMastery, type ArenaMasteryState } from '@/shared/arenaMastery';

/**
 * A floating panel on the live Arena page: collapsed badge by default,
 * expanding into two tabs. **Advisor**: the page reminder's toggle and
 * last-seen state, and the season numbers the fight advisor (fightAdvisor.ts)
 * is working from, with the STR limits they give. **Mastery**: Arena Mastery
 * progress per family from the Ticket Exchange's own record (see
 * `@/shared/arenaMastery`) — what's earned, each tier's count, and the bosses
 * still needed for the next bonus. Same badge/expand shape as `courierPanel.ts`.
 *
 * The reminder toggle reads/writes the same `NotificationPreferences` key as
 * Settings, and a `chrome.storage.onChanged` listener keeps it live if
 * Settings changes it while this panel is open. The reminder's state comes
 * from the background by message, since this runs on the game's origin.
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

.ff-arp-row-head {
  font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em;
  color: #6b6455; margin: 8px 0 3px;
}
.ff-arp-row { font-size: 10.5px; color: #ccc; padding: 2px 0; line-height: 1.4; }
.ff-arp-muted { color: #8b8f9e; }
.ff-arp-summary-time { font-size: 9px; color: #6b6455; margin-top: 8px; }

/* Tabs: an underline row, same as the Street Intel panel's. */
#${CONTAINER_ID}.ff-arp-on-mastery .ff-arp-panel { width: 340px; }
.ff-arp-tabs { display: flex; gap: 2px; margin: -2px 0 14px; border-bottom: 1px solid rgba(201,168,76,0.14); }
#${CONTAINER_ID} .ff-arp-tab {
  flex: 0 0 auto !important; width: auto !important; margin: 0 0 -1px !important; padding: 7px 10px 8px !important;
  background: transparent !important; border: 0 !important; border-bottom: 2px solid transparent !important; border-radius: 0 !important;
  font: 600 12px/1 'Inter', system-ui, sans-serif !important; color: #9a917c !important; cursor: pointer;
}
#${CONTAINER_ID} .ff-arp-tab:hover { color: #cfc8b6 !important; }
#${CONTAINER_ID} .ff-arp-tab.ff-on { color: #f1ede2 !important; border-bottom-color: #c9a84c !important; }
.ff-arp-pane { display: none; }
#${CONTAINER_ID}.ff-arp-on-advisor .ff-arp-pane-advisor,
#${CONTAINER_ID}.ff-arp-on-mastery .ff-arp-pane-mastery { display: block; }

/* Mastery */
.ff-arm-summary { font-size: 12px; color: #cfc8b6; line-height: 1.5; }
.ff-arm-summary b { color: #f1ede2; font-variant-numeric: tabular-nums; }
.ff-arm-sub { font-size: 11px; color: #9a917c; margin-top: 2px; }
.ff-arm-h { margin: 16px 0 8px; font-size: 12px; font-weight: 700; color: #d9c48a; }
.ff-arm-next { display: grid; gap: 6px; }
.ff-arm-step { font-size: 12px; line-height: 1.45; color: #cfc8b6; }
.ff-arm-step b { color: #e8c766; }
.ff-arm-fam { padding: 12px 0; border-top: 1px solid rgba(201,168,76,0.12); }
.ff-arm-fam-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.ff-arm-fam-name { font-size: 13px; font-weight: 700; color: #f1ede2; }
.ff-arm-earned { font-size: 12px; font-weight: 700; color: #9a917c; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ff-arm-earned.ff-has { color: #4ade80; }
.ff-arm-tiers { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 8px; }
.ff-arm-tier { padding: 6px 6px 5px; border-radius: 7px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
.ff-arm-tier-name { font-size: 10px; color: #9a917c; }
.ff-arm-tier-count { margin-top: 2px; font-size: 12px; font-weight: 700; color: #f1ede2; font-variant-numeric: tabular-nums; }
.ff-arm-tier-bar { height: 3px; margin-top: 5px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden; }
.ff-arm-tier-bar i { display: block; height: 100%; background: #c9a84c; }
.ff-arm-tier.ff-done { border-color: rgba(74,222,128,0.35); }
.ff-arm-tier.ff-done .ff-arm-tier-bar i { background: #4ade80; }
.ff-arm-tier.ff-locked { opacity: 0.4; }
.ff-arm-need { margin-top: 8px; font-size: 11.5px; line-height: 1.5; color: #9a917c; }
.ff-arm-need-row { display: flex; justify-content: space-between; gap: 10px; color: #cfc8b6; }
.ff-arm-need-row span:last-child { color: #9a917c; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ff-arm-empty { font-size: 12px; line-height: 1.55; color: #cfc8b6; }
.ff-arm-foot { margin-top: 12px; font-size: 10.5px; line-height: 1.5; color: #6b6455; }
`;

let panelEl: HTMLDivElement | null = null;
let expanded = false;
let activeTab: 'advisor' | 'mastery' = 'advisor';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function shortFamily(name: string): string {
  return name === 'Society for Balance & Prosperity' ? 'SBP' : name.replace(/ (Syndicate|Family|Bratva)$/, '');
}

function renderMastery(state: ArenaMasteryState): string {
  if (!state.syncedAt) {
    return `<div class="ff-arm-empty">Open the <b>Ticket Exchange</b> in the Arena once — this reads your progress from it (the game marks every boss you've beaten there), then keeps up with each boss you beat.</div>`;
  }
  const families = familyMastery(state);
  const synced = new Date(state.syncedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const parts: string[] = [
    `<div class="ff-arm-summary"><b>${state.beaten.length}</b> of ${ROSTER_BOSSES.length} bosses beaten${state.ticketsHeld !== null ? ` · <b>${state.ticketsHeld}</b> tickets` : ''}</div>`,
    `<div class="ff-arm-sub">From the Ticket Exchange, ${synced}${state.winsSinceSync ? `, plus ${state.winsSinceSync} boss win${state.winsSinceSync === 1 ? '' : 's'} since` : ''}.</div>`,
  ];

  // Closest bonuses first: fewest bosses left in the current tier.
  const next = families.filter((f) => f.current).sort((a, b) => a.needed.length - b.needed.length);
  if (next.length) {
    parts.push('<div class="ff-arm-h">Next bonuses</div><div class="ff-arm-next">');
    for (const f of next.slice(0, 3)) {
      const tier = f.current!;
      const bonus = `+${f.family.tierBonus[tier]}% ${escapeHtml(f.family.stat)}`;
      const who =
        f.needed.length === 1
          ? `${escapeHtml(f.needed[0].name)} (${f.needed[0].draw}% draw)`
          : `${f.needed.length} ${MASTERY_TIER_LABEL[tier]} left`;
      parts.push(`<div class="ff-arm-step"><b>${bonus}</b> · ${escapeHtml(shortFamily(f.family.name))} ${MASTERY_TIER_LABEL[tier]}: ${who}</div>`);
    }
    parts.push('</div>');
  }

  parts.push('<div class="ff-arm-h">Families</div>');
  for (const f of families) {
    const tiers = f.tiers
      .map((t) => {
        const cls = t.complete ? 'ff-done' : t.unlocked ? '' : 'ff-locked';
        const width = t.total ? Math.round((t.done / t.total) * 100) : 0;
        return `<div class="ff-arm-tier ${cls}" title="${MASTERY_TIER_LABEL[t.tier]}: +${t.bonus}% ${escapeHtml(f.family.stat)}${t.unlocked ? '' : ' — unlocks when the tier before is cleared'}"><div class="ff-arm-tier-name">${MASTERY_TIER_LABEL[t.tier]}</div><div class="ff-arm-tier-count">${t.unlocked ? `${t.done}/${t.total}` : 'Locked'}</div><div class="ff-arm-tier-bar"><i style="width:${width}%"></i></div></div>`;
      })
      .join('');
    const need = f.current
      ? `<div class="ff-arm-need">Still needed for ${MASTERY_TIER_LABEL[f.current]} (+${f.family.tierBonus[f.current]}%):${f.needed
          .map((b) => `<div class="ff-arm-need-row"><span>${escapeHtml(b.name)}</span><span>${b.draw}% draw · ${b.tickets} tickets</span></div>`)
          .join('')}</div>`
      : '<div class="ff-arm-need">Every tier cleared.</div>';
    parts.push(`
      <div class="ff-arm-fam">
        <div class="ff-arm-fam-head">
          <span class="ff-arm-fam-name">${escapeHtml(f.family.name)}</span>
          <span class="ff-arm-earned ${f.earned > 0 ? 'ff-has' : ''}">+${f.earned}% of +${f.family.max}% ${escapeHtml(f.family.stat)}</span>
        </div>
        <div class="ff-arm-tiers">${tiers}</div>
        ${need}
      </div>`);
  }
  parts.push(
    '<div class="ff-arm-foot">A tier’s bonus is permanent once every boss in it is beaten; partial tiers pay nothing. Clearing a tier adds the next one to the boss pool. Draw % is how often a boss is a page’s boss — the best exclusives are rarest. Each boss appears at most once a day.</div>',
  );
  return parts.join('');
}

async function refreshMastery(): Promise<void> {
  const pane = panelEl?.querySelector('.ff-arp-pane-mastery');
  if (!pane) return;
  try {
    pane.innerHTML = renderMastery(await storage.getArenaMastery());
  } catch (err) {
    console.error(LOG_PREFIX, 'arena panel mastery read failed', err);
  }
}

function setTab(tab: 'advisor' | 'mastery'): void {
  activeTab = tab;
  if (!panelEl) return;
  panelEl.classList.toggle('ff-arp-on-advisor', tab === 'advisor');
  panelEl.classList.toggle('ff-arp-on-mastery', tab === 'mastery');
  panelEl.querySelectorAll<HTMLButtonElement>('.ff-arp-tab').forEach((b) => {
    b.classList.toggle('ff-on', b.dataset.tab === tab);
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  });
  if (tab === 'mastery') void refreshMastery();
}

function formatCountdown(nextAt: number, now: number): string {
  const s = Math.max(0, Math.round((nextAt - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(rem).padStart(2, '0')}`;
}

const STATE_TEXT: Record<NonNullable<ArenaWatchStatus['state']>, string> = {
  ready: 'A page is ready to open. Reminding every 15 minutes.',
  'in-progress': 'Your open page isn’t finished (fights, boss or pot left). Reminding every 15 minutes until it’s banked.',
  waiting: 'Waiting for the next page.',
  'day-complete': 'Today’s 6 pages are done.',
};

function renderReminder(status: ArenaWatchStatus | null): string {
  if (!status?.state) return '<div class="ff-arp-row">Not checked yet.</div>';
  const parts = [`<div class="ff-arp-row">${STATE_TEXT[status.state]}</div>`];
  const now = Date.now();
  if (status.state === 'waiting' && status.nextUnlockAt !== null) {
    parts.push(`<div class="ff-arp-row">Next page in ${formatCountdown(status.nextUnlockAt, now)}</div>`);
  }
  if (status.nextCheckAt !== null && status.nextCheckAt > now) {
    parts.push(`<div class="ff-arp-summary-time">Next check in ${formatCountdown(status.nextCheckAt, now)}</div>`);
  }
  return parts.join('');
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function renderProfile(p: ArenaMyProfile | null): string {
  if (!p) {
    return '<div class="ff-arp-row">Not seen yet. Read from the season lock-in screen, or from your first fight.</div>';
  }
  const source = p.source === 'fights' ? `from ${p.fightCount} fight${p.fightCount === 1 ? '' : 's'}` : 'estimated from lock-in';
  const limits = [90, 100, 110, 120].map((lvl) => `Lv ${lvl}: ~${fmt(regularStrengthLimit(lvl, p))}`).join(' · ');
  return [
    `<div class="ff-arp-row">${fmt(p.maxHp)} HP · ~${fmt(p.baseDamage)} damage · ~${fmt(p.reduction)} armour <span class="ff-arp-muted">(${source})</span></div>`,
    p.lockedStats
      ? `<div class="ff-arp-row ff-arp-muted">Locked STR ${fmt(p.lockedStats.strength)} · DEF ${fmt(p.lockedStats.defence)} · AGI ${fmt(p.lockedStats.agility)} · DEX ${fmt(p.lockedStats.dexterity)}</div>`
      : '',
    '<div class="ff-arp-row-head">Max opponent STR you beat (score 1.0)</div>',
    `<div class="ff-arp-row">${limits}</div>`,
    `<div class="ff-arp-row">Boss (level 106) break-even: ~${fmt(bossStrengthBreakEven(p))} STR</div>`,
  ].join('');
}

async function refresh() {
  if (!panelEl) return;
  const reminderEl = panelEl.querySelector('.ff-arp-status');
  const profileEl = panelEl.querySelector('.ff-arp-profile');
  try {
    const [status, profile] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'arena-status-requested' }) as Promise<ArenaWatchStatus | null>,
      storage.getArenaMyProfile(),
    ]);
    if (reminderEl) reminderEl.innerHTML = renderReminder(status);
    if (profileEl) profileEl.innerHTML = renderProfile(profile);
  } catch (err) {
    console.error(LOG_PREFIX, 'arena panel refresh failed', err);
  }
  await refreshNotifToggles();
}

function setExpanded(next: boolean) {
  expanded = next;
  panelEl?.classList.toggle('ff-arp-expanded', expanded);
  if (expanded) {
    refresh();
    if (activeTab === 'mastery') void refreshMastery();
  }
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.className = `ff-arp-on-${activeTab}`;
  el.innerHTML = `
    <button class="ff-arp-badge" type="button">
      ${brandBadgeHtml('Arena')}
      <span class="ff-arp-badge-label">▲</span>
    </button>
    <div class="ff-arp-panel">
      <div class="ff-arp-head">
        ${brandBadgeHtml('Arena')}
        <button class="ff-arp-close" type="button" title="Collapse">✕</button>
      </div>
      <div class="ff-arp-tabs" role="tablist">
        <button class="ff-arp-tab ff-on" type="button" role="tab" data-tab="advisor">Advisor</button>
        <button class="ff-arp-tab" type="button" role="tab" data-tab="mastery">Mastery</button>
      </div>
      <div class="ff-arp-pane ff-arp-pane-mastery"></div>
      <div class="ff-arp-pane ff-arp-pane-advisor">
      <label class="ff-arp-toggle-row">
        <div class="ff-arp-toggle-row__text">
          <div class="ff-arp-toggle-row__title">Page reminder</div>
          <div class="ff-arp-toggle-row__status">When a page is ready, or an opened page isn’t banked yet. Repeats every 15 minutes.</div>
        </div>
        <input class="ff-arp-toggle ff-arp-notif-toggle" type="checkbox" data-notif-id="arenaPageUnlocked">
      </label>
      <div class="ff-arp-status"><div class="ff-arp-row">Loading…</div></div>
      <div class="ff-arp-row-head">Your season numbers</div>
      <div class="ff-arp-profile"><div class="ff-arp-row">Loading…</div></div>
      </div>
    </div>
  `;

  el.querySelector('.ff-arp-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-arp-close')?.addEventListener('click', () => setExpanded(false));
  el.querySelectorAll<HTMLButtonElement>('.ff-arp-tab').forEach((b) =>
    b.addEventListener('click', () => setTab(b.dataset.tab === 'mastery' ? 'mastery' : 'advisor')),
  );

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

/** Syncs the reminder checkbox straight from storage — split out from
 *  `refresh()` (which round-trips to the background for the rest of the
 *  panel) so the `chrome.storage.onChanged` listener below can reflect a
 *  change made from Settings without waiting on the slower path. */
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

  // Live-reflects the reminder toggle changed from Settings, and the
  // reminder state or season numbers changing while the panel is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (STORAGE_KEYS.NOTIFICATION_PREFERENCES in changes) void refreshNotifToggles();
    if (expanded && (STORAGE_KEYS.ARENA_WATCH_STATUS in changes || STORAGE_KEYS.ARENA_MY_PROFILE in changes)) void refresh();
    if (expanded && activeTab === 'mastery' && STORAGE_KEYS.ARENA_MASTERY in changes) void refreshMastery();
  });
}
