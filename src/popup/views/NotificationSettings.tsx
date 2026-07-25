import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { NOTIFICATION_DEFINITIONS, DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from '@/shared/notifications';

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    storage.getNotificationPreferences().then((v) => {
      setPrefs(v);
      setLoaded(true);
    });
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
