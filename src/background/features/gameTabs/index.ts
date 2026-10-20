import { GAME_ORIGIN } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';

/**
 * Reloads the game's tabs from the popup, one at a time.
 *
 * Two uses: the popup's "Reload game tabs" row reloads every open game tab,
 * and after an update the popup's banner reloads just the tabs opened before
 * it. Those keep the previous version's content scripts until they're
 * reloaded; they're tracked here (`StaleGameTabs`) rather than reloaded
 * automatically, so an update never cuts off something the player is in the
 * middle of, like an inventory sell batch. Ported from the SimpleMMO
 * extension's staleTabs feature.
 */

const GAME_TABS_PATTERN = `${GAME_ORIGIN}/*`;
/** Spread reloads so the game doesn't get every page load at once. */
const RELOAD_GAP_MS = 500;

/** Serializes read-modify-write of the stored stale list across the listeners below. */
let queue: Promise<void> = Promise.resolve();
function withState(fn: () => Promise<void>): Promise<void> {
  queue = queue.then(fn, fn).catch((err) => console.error(LOG_PREFIX, 'stale game tabs update failed', err));
  return queue;
}

function dropTab(tabId: number): void {
  void withState(async () => {
    const state = await storage.getStaleGameTabs();
    if (!state?.tabIds.includes(tabId)) return;
    const tabIds = state.tabIds.filter((id) => id !== tabId);
    if (tabIds.length === 0) await storage.clearStaleGameTabs();
    else await storage.setStaleGameTabs({ ...state, tabIds });
  });
}

export async function openGameTabIds(): Promise<number[]> {
  const tabs = await chrome.tabs.query({ url: GAME_TABS_PATTERN });
  return tabs.map((t) => t.id).filter((id): id is number => id != null);
}

let reloadInFlight = false;

/** `stale`: only the tabs still on the previous version; `all`: every open
 *  game tab. One reload at a time, whichever button started it. */
export async function reloadGameTabs(scope: 'stale' | 'all'): Promise<void> {
  if (reloadInFlight) return;
  reloadInFlight = true;
  try {
    const stale = await storage.getStaleGameTabs();
    const tabIds = scope === 'all' ? await openGameTabIds() : (stale?.tabIds ?? []);
    if (stale) await storage.setStaleGameTabs({ ...stale, reloading: true });
    for (const [i, tabId] of tabIds.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, RELOAD_GAP_MS));
      // Each reload drops the tab from the stale list via onUpdated; a tab
      // closed meanwhile just fails.
      await chrome.tabs.reload(tabId).catch(() => dropTab(tabId));
    }
  } finally {
    reloadInFlight = false;
    // Any tab still listed didn't reload (e.g. discarded); let the button be used again.
    void withState(async () => {
      const state = await storage.getStaleGameTabs();
      if (state?.reloading) await storage.setStaleGameTabs({ ...state, reloading: false });
    });
  }
}

export function init(): void {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'update') return;
    void withState(async () => {
      const tabIds = await openGameTabIds();
      if (tabIds.length === 0) return storage.clearStaleGameTabs();
      await storage.setStaleGameTabs({
        version: chrome.runtime.getManifest().version,
        previousVersion: details.previousVersion ?? null,
        tabIds,
        reloading: false,
      });
    });
  });

  // A browser restart reloads every tab anyway.
  chrome.runtime.onStartup.addListener(() => void withState(() => storage.clearStaleGameTabs()));

  // Reloaded or navigated → running the new code; closed → gone.
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading') dropTab(tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => dropTab(tabId));
}
