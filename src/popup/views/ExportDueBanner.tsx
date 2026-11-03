import { useEffect, useState } from 'preact/hooks';
import { LOG_PREFIX } from '@/shared/log';
import { exportMessage, readExportPressure, type ExportPressure } from '@/shared/requestLog/exportReminder';

/** Shown while the HTTP Archive export is due (shared/requestLog/
 *  exportReminder.ts): on the popup, the Dashboard's Overview and its HTTP
 *  Archive section. Re-read every minute while open. */
export function ExportDueBanner({ onOpen }: { onOpen?: () => void }) {
  const [p, setP] = useState<ExportPressure | null>(null);
  useEffect(() => {
    const load = () => void readExportPressure().then(setP).catch((err) => console.error(LOG_PREFIX, 'export reminder read failed', err));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!p || p.inactive || p.level === 'ok') return null;
  const title = p.level === 'lost' ? 'Archive rows were lost' : p.level === 'now' ? 'Export the HTTP Archive now' : 'Export the HTTP Archive soon';
  return (
    <div class={`ff-update-banner${p.level === 'soon' ? '' : ' ff-update-banner--urgent'}`} role="status">
      <div class="ff-update-banner__text">
        <span class="ff-update-banner__title">{title}</span>
        <span class="ff-update-banner__meta">{exportMessage(p)}</span>
      </div>
      {onOpen && (
        <button type="button" class="ff-update-banner__btn" onClick={onOpen}>
          Export
        </button>
      )}
    </div>
  );
}
