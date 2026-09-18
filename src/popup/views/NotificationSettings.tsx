import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { STORAGE_KEYS } from '@/shared/constants';
import { NOTIFICATION_DEFINITIONS, DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '@/shared/notifications';

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    storage.getNotificationPreferences().then((v) => {
      setPrefs(v);
      setLoaded(true);
    });

    // Live-reflects a toggle changed from the Arena in-page panel instead —
    // both surfaces read the same storage key, same `chrome.storage.onChanged`
    // pattern `PetCouriersHome.tsx` uses for its own courier toggle.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !(STORAGE_KEYS.NOTIFICATION_PREFERENCES in changes)) return;
      setPrefs({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...changes[STORAGE_KEYS.NOTIFICATION_PREFERENCES].newValue });
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  async function toggle(id: keyof NotificationPreferences) {
    const next = { ...prefs, [id]: !prefs[id] };
    setPrefs(next);
    await storage.setNotificationPreferences(next);
  }

  if (!loaded) return null;

  return (
    <>
      <div class="ff-section-label">Notifications</div>
      {NOTIFICATION_DEFINITIONS.map((def) => (
        <label class="ff-toggle-row" key={def.id}>
          <div class="ff-toggle-row__text">
            <div class="ff-toggle-row__title">{def.label}</div>
            <div class="ff-toggle-row__status">{def.description}</div>
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
