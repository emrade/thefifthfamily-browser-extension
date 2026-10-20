import { useEffect, useState } from 'preact/hooks';
import { GAME_ORIGIN, STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import type { ExtensionMessage } from '@/shared/messaging';
import { storage } from '@/shared/storage';
import type { StaleGameTabs } from '@/shared/types';
import { ReloadIcon } from './icons';

/** Game tabs open now, and which of them are still on the previous version
 *  after an update. Re-read when the stale list changes or tabs open, close
 *  or reload while the popup is up. */
function useGameTabs(): { open: number; stale: StaleGameTabs | null; staleOpen: number } {
  const [open, setOpen] = useState(0);
  const [stale, setStale] = useState<StaleGameTabs | null>(null);
  const [staleOpen, setStaleOpen] = useState(0);

  useEffect(() => {
    const load = async () => {
      const [tabs, s] = await Promise.all([chrome.tabs.query({ url: `${GAME_ORIGIN}/*` }), storage.getStaleGameTabs()]);
      const ids = new Set(tabs.map((t) => t.id));
      setOpen(ids.size);
      setStale(s);
      setStaleOpen(s ? s.tabIds.filter((id) => ids.has(id)).length : 0);
    };
    const reload = () => void load().catch((err) => console.error(LOG_PREFIX, 'failed to read game tabs', err));
    reload();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && STORAGE_KEYS.STALE_GAME_TABS in changes) reload();
    };
    const onUpdated = (_id: number, info: { status?: string }) => {
      if (info.status) reload();
    };
    chrome.storage.onChanged.addListener(onChanged);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(reload);
    chrome.tabs.onCreated.addListener(reload);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(reload);
      chrome.tabs.onCreated.removeListener(reload);
    };
  }, []);

  return { open, stale, staleOpen };
}

function send(scope: 'stale' | 'all'): void {
  const msg: ExtensionMessage = { type: 'reload-game-tabs', scope };
  chrome.runtime.sendMessage(msg).catch((err) => console.error(LOG_PREFIX, 'reload-game-tabs failed', err));
}

const tabsText = (n: number) => `${n} game tab${n === 1 ? '' : 's'}`;

/** Shown after an update while game tabs opened before it haven't been
 *  reloaded. */
export function UpdateBanner() {
  const { stale, staleOpen } = useGameTabs();
  if (!stale || staleOpen === 0) return null;
  return (
    <div class="ff-update-banner" role="status">
      <div class="ff-update-banner__text">
        <span class="ff-update-banner__title">Updated to v{stale.version}</span>
        <span class="ff-update-banner__meta">
          {tabsText(staleOpen)} still on {stale.previousVersion ? `v${stale.previousVersion}` : 'the old version'}
        </span>
      </div>
      <button type="button" class="ff-update-banner__btn" disabled={stale.reloading} onClick={() => send('stale')}>
        {stale.reloading ? 'Reloading…' : 'Reload them'}
      </button>
      <button
        type="button"
        class="ff-update-banner__dismiss"
        title="Dismiss"
        aria-label="Dismiss"
        onClick={() => void storage.clearStaleGameTabs()}
      >
        ✕
      </button>
    </div>
  );
}

/** Always there: reloads every open game tab, one at a time. */
export function ReloadGameTabsRow() {
  const { open } = useGameTabs();
  const [sent, setSent] = useState(false);
  const status = open === 0 ? 'No game tabs open' : sent ? `Reloading ${tabsText(open)}…` : `${tabsText(open)} open`;
  return (
    <button
      class="ff-nav-row"
      disabled={open === 0 || sent}
      onClick={() => {
        setSent(true);
        send('all');
        // Reloads are half a second apart; free the button once they're done.
        setTimeout(() => setSent(false), open * 500 + 1000);
      }}
    >
      <div class="ff-nav-row__icon"><ReloadIcon /></div>
      <div class="ff-nav-row__text">
        <div class="ff-nav-row__title">Reload game tabs</div>
        <div class="ff-nav-row__status">{status}</div>
      </div>
    </button>
  );
}
