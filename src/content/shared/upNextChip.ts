import { injectStyleOnce } from './injectStyle';
import { STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { AUTOMATION_FEATURE_LABELS } from '@/shared/automationLabels';
import type { ExtensionMessage } from '@/shared/messaging';
import type { AutomationScheduleItem, AutomationScheduleSnapshot } from '@/shared/types';

/**
 * "Up next" chip: a small floating button on every game page, collapsed by
 * default, showing when the next background automation check is due (gold
 * while one is running). Tap it to expand: each automation in time order,
 * the Automation Queue's on/off switch, and a link to the dashboard.
 *
 * It exists so the player can plan their own clicks around the automations
 * (the player chose this over automations holding off while they click), see
 * docs/proposals/automation-clash-queue.md. Read-only apart from the queue
 * switch: it sends nothing to the game.
 *
 * Placed top-right, under the achievement chip's spot, so it stays clear of
 * the bottom-right panels (Garage, Racing, …).
 */

const CONTAINER_ID = 'ff-upnext';
const STYLE_ID = 'ff-upnext-style';
const REFRESH_OPEN_MS = 4_000;
const REFRESH_CLOSED_MS = 15_000;

let root: HTMLDivElement | null = null;
let expanded = false;
let snap: AutomationScheduleSnapshot | null = null;
let lastFetch = 0;
let timer: number | undefined;

function short(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function stateText(item: AutomationScheduleItem, now: number): string {
  if (item.state === 'running') return 'running now';
  if (item.state === 'waiting') return 'waiting its turn';
  if (item.state === 'off') return 'off';
  if (item.nextAt === null) return 'on';
  return item.nextAt <= now ? 'due now' : `in ${short(item.nextAt - now)}`;
}

function render(): void {
  if (!root || !snap) return;
  const now = Date.now();
  const items = snap.items;
  const running = items.some((i) => i.state === 'running');
  const next = items.filter((i) => i.state === 'scheduled' && i.nextAt !== null).map((i) => i.nextAt as number);
  const soonest = next.length ? Math.min(...next) : null;
  const label = running ? 'running' : soonest === null ? '–' : soonest <= now ? 'now' : short(soonest - now);

  const pill = root.querySelector<HTMLButtonElement>('.ff-un-pill')!;
  pill.classList.toggle('ff-un-busy', running);
  pill.querySelector('.ff-un-time')!.textContent = label;
  pill.setAttribute('aria-expanded', String(expanded));
  pill.title = running ? 'An automation is running now' : 'Next automation check';

  const panel = root.querySelector<HTMLDivElement>('.ff-un-panel')!;
  panel.hidden = !expanded;
  if (!expanded) return;

  const list = panel.querySelector<HTMLUListElement>('.ff-un-list')!;
  list.innerHTML = items
    .map(
      (i) =>
        `<li class="ff-un-row ff-un-${i.state}"><span class="ff-un-dot"></span><span class="ff-un-name">${AUTOMATION_FEATURE_LABELS[i.feature]}</span><span class="ff-un-state">${stateText(i, now)}</span></li>`,
    )
    .join('');
  const toggle = panel.querySelector<HTMLInputElement>('.ff-un-queue input')!;
  toggle.checked = snap.queueEnabled;
}

async function refresh(): Promise<void> {
  lastFetch = Date.now();
  try {
    const msg: ExtensionMessage = { type: 'automation-schedule-requested' };
    snap = (await chrome.runtime.sendMessage(msg)) as AutomationScheduleSnapshot;
    render();
  } catch (err) {
    // The extension was reloaded or updated under this page: stop polling
    // (the page reload that picks up the new version brings it back).
    if (String(err).includes('context invalidated')) {
      clearInterval(timer);
      return;
    }
    console.error(LOG_PREFIX, 'up-next chip refresh failed', err);
  }
}

function tick(): void {
  if (document.hidden) return;
  const due = expanded ? REFRESH_OPEN_MS : REFRESH_CLOSED_MS;
  if (Date.now() - lastFetch >= due) void refresh();
  else render();
}

function build(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.innerHTML = `
    <button type="button" class="ff-un-pill" aria-expanded="false" aria-controls="ff-un-panel">
      <span class="ff-un-icon" aria-hidden="true">⏱</span><span class="ff-un-time">…</span>
    </button>
    <div class="ff-un-panel" id="ff-un-panel" hidden>
      <div class="ff-un-head">Up next</div>
      <ul class="ff-un-list"></ul>
      <label class="ff-un-queue"><input type="checkbox"> Automation Queue</label>
      <button type="button" class="ff-un-open">Open dashboard</button>
      <div class="ff-un-hint">Times are each automation's next check; a check can find nothing to do.</div>
    </div>
  `;
  el.querySelector('.ff-un-pill')!.addEventListener('click', () => {
    expanded = !expanded;
    render();
    if (expanded) void refresh();
  });
  el.querySelector<HTMLInputElement>('.ff-un-queue input')!.addEventListener('change', (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    void chrome.storage.local.set({ [STORAGE_KEYS.AUTOMATION_QUEUE_CONFIG]: { enabled } }).then(() => refresh());
  });
  el.querySelector('.ff-un-open')!.addEventListener('click', () => {
    const msg: ExtensionMessage = { type: 'automation-dashboard-open-requested' };
    chrome.runtime.sendMessage(msg).catch((err) => console.error(LOG_PREFIX, 'open dashboard failed', err));
  });
  return el;
}

const STYLE = `
#${CONTAINER_ID} {
  position: fixed;
  top: calc(62px + 5vh);
  right: 14px;
  z-index: 999997;
  font-family: Inter, system-ui, sans-serif;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
#${CONTAINER_ID} .ff-un-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px;
  font: 600 12px/1 Inter, system-ui, sans-serif;
  color: #f1ede2;
  background: rgba(13, 11, 8, .82);
  border: 1px solid rgba(201, 168, 76, .34);
  border-radius: 999px;
  cursor: pointer;
  opacity: .6;
  transition: opacity .18s ease, border-color .18s ease;
}
#${CONTAINER_ID} .ff-un-pill:hover, #${CONTAINER_ID} .ff-un-pill[aria-expanded="true"] { opacity: 1; }
#${CONTAINER_ID} .ff-un-pill:focus-visible { outline: 2px solid #fbbf24; outline-offset: 2px; opacity: 1; }
#${CONTAINER_ID} .ff-un-pill.ff-un-busy { opacity: 1; color: #fbbf24; border-color: #fbbf24; }
#${CONTAINER_ID} .ff-un-time { font-variant-numeric: tabular-nums; }
#${CONTAINER_ID} .ff-un-panel {
  width: 280px;
  padding: 12px;
  background: #17130e;
  border: 1px solid rgba(201, 168, 76, .34);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, .55);
  color: #f1ede2;
  font-size: 12.5px;
}
#${CONTAINER_ID} .ff-un-panel[hidden] { display: none; }
#${CONTAINER_ID} .ff-un-head {
  font: 700 10px/1 'Courier New', monospace; letter-spacing: .16em; text-transform: uppercase;
  color: #6b6455; margin-bottom: 8px;
}
#${CONTAINER_ID} .ff-un-list { list-style: none; margin: 0; padding: 0; }
#${CONTAINER_ID} .ff-un-row {
  display: grid; grid-template-columns: 8px 1fr auto; align-items: center; gap: 8px;
  padding: 6px 0; border-bottom: 1px solid rgba(201, 168, 76, .16);
}
#${CONTAINER_ID} .ff-un-row:last-child { border-bottom: none; }
#${CONTAINER_ID} .ff-un-dot { width: 7px; height: 7px; border-radius: 50%; background: #6b6455; }
#${CONTAINER_ID} .ff-un-name { font-weight: 600; }
#${CONTAINER_ID} .ff-un-state { color: #a89e8c; font-variant-numeric: tabular-nums; }
#${CONTAINER_ID} .ff-un-running .ff-un-dot { background: #fbbf24; }
#${CONTAINER_ID} .ff-un-running .ff-un-state { color: #fbbf24; }
#${CONTAINER_ID} .ff-un-waiting .ff-un-dot { background: #60a5fa; }
#${CONTAINER_ID} .ff-un-waiting .ff-un-state { color: #60a5fa; }
#${CONTAINER_ID} .ff-un-scheduled .ff-un-dot { background: #34d399; }
#${CONTAINER_ID} .ff-un-off { opacity: .5; }
#${CONTAINER_ID} .ff-un-queue {
  display: flex; align-items: center; gap: 8px; margin-top: 10px; cursor: pointer; font-weight: 600;
}
#${CONTAINER_ID} .ff-un-queue input { accent-color: #fbbf24; width: 15px; height: 15px; }
#${CONTAINER_ID} .ff-un-open {
  width: 100%; margin-top: 10px; padding: 7px 10px;
  font: 700 12px/1 Inter, system-ui, sans-serif; color: #0d0b08;
  background: #c9a84c; border: none; border-radius: 6px; cursor: pointer;
}
#${CONTAINER_ID} .ff-un-open:hover { background: #fbbf24; }
#${CONTAINER_ID} .ff-un-hint { margin-top: 8px; font-size: 11px; color: #6b6455; line-height: 1.4; }
@media (prefers-reduced-motion: reduce) { #${CONTAINER_ID} * { transition: none !important; } }
`;

export function initUpNextChip(): void {
  if (document.getElementById(CONTAINER_ID)) return;
  injectStyleOnce(STYLE_ID, STYLE);
  root = build();
  (document.body ?? document.documentElement).appendChild(root);
  void refresh();
  timer = window.setInterval(tick, 1_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
}
