import { NotificationSettings } from './NotificationSettings';
import { PageFeatureSettings } from './PageFeatureSettings';
import { ExportDataButton } from './ExportDataButton';
import { RequestLogSettings } from './RequestLogSettings';
import { ResetDataButton } from './ResetDataButton';

export function Settings() {
  return (
    <>
      <NotificationSettings />
      <PageFeatureSettings />
      <RequestLogSettings />

      <div class="ff-section-label">Data</div>
      <ExportDataButton />
      <ResetDataButton />
    </>
  );
}
