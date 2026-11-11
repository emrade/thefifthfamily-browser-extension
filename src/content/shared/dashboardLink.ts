import { LOG_PREFIX } from '@/shared/log';
import type { DashboardSection } from '@/shared/dashboardSections';
import type { ExtensionMessage } from '@/shared/messaging';
import { injectStyleOnce } from './injectStyle';

/**
 * "Dashboard ↗" in an in-page panel's header: opens that feature's Dashboard
 * page, switching to a Dashboard tab that's already open instead of adding
 * another (the background's `openDashboard`). Only panels with a page of
 * their own carry one (the player's call, 2026-11-11).
 *
 * One delegated listener for every panel, so a panel that rebuilds its
 * markup keeps working without re-binding.
 */

const STYLE_ID = 'ff-dashboard-link-style';

const CSS = `
.ff-dash-link {
  margin-left: auto; margin-right: 8px; padding: 3px 8px;
  font: 600 11px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: .02em;
  color: #e8c766; background: transparent;
  border: 1px solid rgba(201,168,76,.35); border-radius: 6px;
  cursor: pointer; white-space: nowrap;
}
.ff-dash-link:hover { color: #fbbf24; border-color: rgba(251,191,36,.6); background: rgba(201,168,76,.08); }
.ff-dash-link:focus-visible { outline: 2px solid #fbbf24; outline-offset: 1px; }
`;

let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  injectStyleOnce(STYLE_ID, CSS);
  document.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-ff-dash]');
    if (!link) return;
    e.preventDefault();
    const msg: ExtensionMessage = { type: 'dashboard-open-requested', section: link.dataset.ffDash as DashboardSection };
    chrome.runtime.sendMessage(msg).catch((err) => console.error(LOG_PREFIX, 'could not open the Dashboard', err));
  });
}

/** The link's markup, for a panel's header. */
export function dashboardLinkHtml(section: DashboardSection): string {
  install();
  return `<button type="button" class="ff-dash-link" data-ff-dash="${section}" title="Open this on the Dashboard">Dashboard ↗</button>`;
}
