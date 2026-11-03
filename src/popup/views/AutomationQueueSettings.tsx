import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { STORAGE_KEYS } from '@/shared/constants';
import type { AutomationQueueConfig } from '@/shared/types';

/** The automation queue's on/off switch (background/automationQueue.ts). Takes
 *  effect on the next automation check, no reload. Also listens for changes
 *  made elsewhere (the chip and dashboard will carry the same switch). */
export function AutomationQueueSettings() {
  const [config, setConfig] = useState<AutomationQueueConfig | null>(null);

  useEffect(() => {
    storage.getAutomationQueueConfig().then(setConfig);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !(STORAGE_KEYS.AUTOMATION_QUEUE_CONFIG in changes)) return;
      setConfig({ enabled: false, ...(changes[STORAGE_KEYS.AUTOMATION_QUEUE_CONFIG].newValue as Partial<AutomationQueueConfig> | undefined) });
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  if (!config) return null;

  return (
    <>
      <div class="ff-section-label">Background Automations</div>
      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Automation Queue</div>
          <div class="ff-toggle-row__status">
            Automations take turns: one at a time, with a 3–8 s gap between them, like a player switching pages. Off: they run exactly as
            before. Takes effect on the next check.
          </div>
        </div>
        <input
          type="checkbox"
          class="ff-toggle"
          checked={config.enabled}
          onChange={() => {
            const next = { ...config, enabled: !config.enabled };
            setConfig(next);
            void storage.setAutomationQueueConfig(next);
          }}
        />
      </label>
    </>
  );
}
