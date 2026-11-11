import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { STORAGE_KEYS } from '@/shared/constants';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationId, type NotificationPreferences } from '@/shared/notifications';
import { DEFAULT_PAGE_FEATURE_PREFERENCES, type PageFeatureId, type PageFeaturePreferences } from '@/shared/pageFeatures';
import { SETTING_ENTRIES, SETTING_TABS, groupEntries, matchesSearch, type SettingEntry, type SettingTabId } from '@/shared/settingsCatalog';
import { storage } from '@/shared/storage';
import type { AutomationQueueConfig } from '@/shared/types';
import { ExportDataButton } from './ExportDataButton';
import { PageSettingsReloadBanner } from './GameTabs';
import { ResetDataButton } from './ResetDataButton';

/**
 * The Dashboard's Settings page: every setting, sorted into tabs by part of the
 * game, with a search across all of them. Where each one goes is
 * `shared/settingsCatalog.ts`. Everything reads and writes the same stored
 * preferences as other surfaces (the Arena section, the "Up next" chip) and
 * follows changes made there.
 */

const TAB_KEY = 'ff_settings_tab';
/** About one line of description at this page's width. */
const LONG_DESCRIPTION = 85;

function savedTab(): SettingTabId {
  const saved = localStorage.getItem(TAB_KEY);
  return SETTING_TABS.some((t) => t.id === saved) ? (saved as SettingTabId) : SETTING_TABS[0].id;
}

function SettingRow({
  entry,
  checked,
  onToggle,
  tabLabel,
}: {
  entry: SettingEntry;
  checked: boolean;
  onToggle: () => void;
  tabLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const isLong = entry.description.length > LONG_DESCRIPTION;
  return (
    <label class="ff-toggle-row db-setting">
      <div class="ff-toggle-row__text">
        <div class="ff-toggle-row__title">
          {entry.label}
          {entry.kind === 'notification' && <span class="db-setting__kind">Notification</span>}
          {tabLabel && <span class="db-setting__where">{tabLabel} · {entry.group}</span>}
        </div>
        <div class={`db-setting__line${open ? ' db-setting__line--open' : ''}`}>
          <div class={`ff-toggle-row__status db-setting__desc${isLong && !open ? ' db-setting__desc--clamped' : ''}`}>{entry.description}</div>
          {isLong && (
            <button
              type="button"
              class="db-setting__more"
              aria-expanded={open}
              // Inside the row's <label>: without this, the tap also flips the switch.
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setOpen(!open);
              }}
            >
              {open ? 'Less' : 'More'}
            </button>
          )}
        </div>
      </div>
      <input type="checkbox" class="ff-toggle" checked={checked} onChange={onToggle} />
    </label>
  );
}

export function Settings() {
  const [pagePrefs, setPagePrefs] = useState<PageFeaturePreferences | null>(null);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences | null>(null);
  const [queue, setQueue] = useState<AutomationQueueConfig | null>(null);
  const [tab, setTab] = useState<SettingTabId>(savedTab);
  const [query, setQuery] = useState('');
  // Set by a page-feature change; cleared once a game tab reloads.
  const [pageChanged, setPageChanged] = useState(false);
  const clearPageChanged = useCallback(() => setPageChanged(false), []);
  const tabRefs = useRef<Partial<Record<SettingTabId, HTMLButtonElement | null>>>({});

  useEffect(() => {
    storage.getPageFeaturePreferences().then(setPagePrefs);
    storage.getNotificationPreferences().then(setNotificationPrefs);
    storage.getAutomationQueueConfig().then(setQueue);

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (STORAGE_KEYS.PAGE_FEATURE_PREFERENCES in changes) {
        setPagePrefs({ ...DEFAULT_PAGE_FEATURE_PREFERENCES, ...changes[STORAGE_KEYS.PAGE_FEATURE_PREFERENCES].newValue });
      }
      if (STORAGE_KEYS.NOTIFICATION_PREFERENCES in changes) {
        setNotificationPrefs({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...changes[STORAGE_KEYS.NOTIFICATION_PREFERENCES].newValue });
      }
      if (STORAGE_KEYS.AUTOMATION_QUEUE_CONFIG in changes) {
        storage.getAutomationQueueConfig().then(setQueue);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  if (!pagePrefs || !notificationPrefs || !queue) return null;

  function chooseTab(next: SettingTabId, focus = false) {
    setTab(next);
    localStorage.setItem(TAB_KEY, next);
    if (focus) tabRefs.current[next]?.focus();
  }

  function onTabKey(event: KeyboardEvent, index: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    chooseTab(SETTING_TABS[(index + step + SETTING_TABS.length) % SETTING_TABS.length].id, true);
  }

  function renderEntry(entry: SettingEntry, tabLabel?: string) {
    if (entry.kind === 'export' || entry.kind === 'reset') {
      return (
        <div class="db-setting-action" key={entry.id}>
          {tabLabel && <div class="db-setting__where db-setting__where--alone">{tabLabel} · {entry.group}</div>}
          {entry.kind === 'export' ? <ExportDataButton /> : <ResetDataButton />}
        </div>
      );
    }
    if (entry.kind === 'page') {
      const id = entry.id as PageFeatureId;
      return (
        <SettingRow
          key={id}
          entry={entry}
          tabLabel={tabLabel}
          checked={pagePrefs![id]}
          onToggle={() => {
            const next = { ...pagePrefs!, [id]: !pagePrefs![id] };
            setPagePrefs(next);
            setPageChanged(true);
            void storage.setPageFeaturePreferences(next);
          }}
        />
      );
    }
    if (entry.kind === 'notification') {
      const id = entry.id as NotificationId;
      return (
        <SettingRow
          key={id}
          entry={entry}
          tabLabel={tabLabel}
          checked={notificationPrefs![id]}
          onToggle={() => {
            const next = { ...notificationPrefs!, [id]: !notificationPrefs![id] };
            setNotificationPrefs(next);
            void storage.setNotificationPreferences(next);
          }}
        />
      );
    }
    return (
      <SettingRow
        key={entry.id}
        entry={entry}
        tabLabel={tabLabel}
        checked={queue!.enabled}
        onToggle={() => {
          const enabled = !queue!.enabled;
          setQueue({ ...queue!, enabled });
          // Only this field: quiet hours are set on the Dashboard.
          void storage.updateAutomationQueueConfig({ enabled });
        }}
      />
    );
  }

  const searching = query.trim() !== '';
  const results = searching ? SETTING_ENTRIES.filter((entry) => matchesSearch(entry, query)) : [];
  const tabEntries = SETTING_ENTRIES.filter((entry) => entry.tab === tab);

  return (
    <div class="db-settings">
      <div class="db-settings__search">
        <input
          type="search"
          class="db-settings__search-input"
          placeholder="Search all settings"
          aria-label="Search all settings"
          value={query}
          onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setQuery('');
          }}
        />
      </div>

      {pageChanged && <PageSettingsReloadBanner onDone={clearPageChanged} />}

      {searching ? (
        <>
          <div class="db-settings__count" role="status">
            {results.length === 0 ? `Nothing matches “${query.trim()}”` : `${results.length} ${results.length === 1 ? 'setting' : 'settings'} found`}
          </div>
          {results.map((entry) => renderEntry(entry, SETTING_TABS.find((t) => t.id === entry.tab)?.label))}
        </>
      ) : (
        <>
          <div class="db-settings__tabs" role="tablist" aria-label="Settings">
            {SETTING_TABS.map((t, index) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`db-settings-tab-${t.id}`}
                aria-selected={t.id === tab}
                aria-controls="db-settings-panel"
                tabIndex={t.id === tab ? 0 : -1}
                class={`db-settings__tab${t.id === tab ? ' db-settings__tab--active' : ''}`}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                onClick={() => chooseTab(t.id)}
                onKeyDown={(event) => onTabKey(event, index)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div id="db-settings-panel" role="tabpanel" aria-labelledby={`db-settings-tab-${tab}`}>
            {tabEntries.some((entry) => entry.kind === 'page') && (
              <div class="db-settings__note">Changes to in-game page features apply after you reload the game page.</div>
            )}
            {groupEntries(tabEntries).map(({ group, entries }) => (
              <section key={group}>
                <div class="ff-section-label">{group}</div>
                {entries.map((entry) => renderEntry(entry))}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
