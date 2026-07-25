import { NotificationSettings } from './NotificationSettings';
import { ExportDataButton } from './ExportDataButton';
import { ResetDataButton } from './ResetDataButton';

export function Settings() {
  return (
    <>
      <NotificationSettings />

      <div class="ff-section-label">Data</div>
      <ExportDataButton />
      <ResetDataButton />
    </>
  );
}
