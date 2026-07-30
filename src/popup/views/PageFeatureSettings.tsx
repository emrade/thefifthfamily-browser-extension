import { useEffect, useState } from 'preact/hooks';
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

  async function toggle(id: keyof PageFeaturePreferences) {
    const next = { ...prefs, [id]: !prefs[id] };
    setPrefs(next);
    await storage.setPageFeaturePreferences(next);
  }

  if (!loaded) return null;

  return (
    <>
      <div class="ff-section-label">In-Game Page Features</div>
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
