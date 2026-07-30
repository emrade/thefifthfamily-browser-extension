import { NotificationSettings } from './NotificationSettings';
import { PageFeatureSettings } from './PageFeatureSettings';
import { ExportDataButton } from './ExportDataButton';
import { ResetDataButton } from './ResetDataButton';

export function Settings() {
  return (
    <>
      <NotificationSettings />
      <PageFeatureSettings />

      <div class="ff-section-label">Data</div>
      <ExportDataButton />
      <ResetDataButton />
    </>
  );
}
