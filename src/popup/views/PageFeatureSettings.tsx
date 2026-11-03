import { useCallback, useEffect, useState } from 'preact/hooks';
import { PageSettingsReloadBanner } from './GameTabs';
import { storage } from '@/shared/storage';
import { STORAGE_KEYS } from '@/shared/constants';
import { PAGE_FEATURE_DEFINITIONS, DEFAULT_PAGE_FEATURE_PREFERENCES, type PageFeaturePreferences } from '@/shared/pageFeatures';

/**
 * The In-Game Page Features toggles. `only` narrows it to some of them (the
 * Arena section shows just the Arena ones); every surface reads and writes
 * the same stored preferences.
 */
export function PageFeatureSettings({ title = 'In-Game Page Features', only }: { title?: string; only?: (id: keyof PageFeaturePreferences) => boolean } = {}) {
  const [prefs, setPrefs] = useState<PageFeaturePreferences>(DEFAULT_PAGE_FEATURE_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    storage.getPageFeaturePreferences().then((v) => {
      setPrefs(v);
      setLoaded(true);
    });
    // Shown in more than one place (Settings, Dashboard → Arena): keep each
    // in step with a change made in another.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !(STORAGE_KEYS.PAGE_FEATURE_PREFERENCES in changes)) return;
      setPrefs({ ...DEFAULT_PAGE_FEATURE_PREFERENCES, ...changes[STORAGE_KEYS.PAGE_FEATURE_PREFERENCES].newValue });
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // Set on any change here; cleared once a game tab reloads. Not saved, so it
  // starts clear each time the popup opens.
  const [changed, setChanged] = useState(false);
  const clearChanged = useCallback(() => setChanged(false), []);

  async function toggle(id: keyof PageFeaturePreferences) {
    const next = { ...prefs, [id]: !prefs[id] };
    setPrefs(next);
    setChanged(true);
    await storage.setPageFeaturePreferences(next);
  }

  if (!loaded) return null;

  return (
    <>
      <div class="ff-section-label">{title}</div>
      {changed && <PageSettingsReloadBanner onDone={clearChanged} />}
      {PAGE_FEATURE_DEFINITIONS.filter((def) => !only || only(def.id)).map((def) => (
        <label class="ff-toggle-row" key={def.id}>
          <div class="ff-toggle-row__text">
            <div class="ff-toggle-row__title">{def.label}</div>
            <div class="ff-toggle-row__status">{def.description} Reload the page to apply.</div>
          </div>
          <input
            type="checkbox"
            class="ff-toggle"
            checked={prefs[def.id]}
            onChange={() => toggle(def.id)}
          />
        </label>
      ))}
    </>
  );
}
