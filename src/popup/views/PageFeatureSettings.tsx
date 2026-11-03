import { useCallback, useEffect, useState } from 'preact/hooks';
import { PageSettingsReloadBanner } from './GameTabs';
import { storage } from '@/shared/storage';
import { PAGE_FEATURE_DEFINITIONS, DEFAULT_PAGE_FEATURE_PREFERENCES, type PageFeaturePreferences } from '@/shared/pageFeatures';

export function PageFeatureSettings() {
  const [prefs, setPrefs] = useState<PageFeaturePreferences>(DEFAULT_PAGE_FEATURE_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    storage.getPageFeaturePreferences().then((v) => {
      setPrefs(v);
      setLoaded(true);
    });
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
      <div class="ff-section-label">In-Game Page Features</div>
      {changed && <PageSettingsReloadBanner onDone={clearChanged} />}
      {PAGE_FEATURE_DEFINITIONS.map((def) => (
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
