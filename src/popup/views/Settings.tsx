import { NotificationSettings } from './NotificationSettings';
import { PageFeatureSettings } from './PageFeatureSettings';
import { AutomationQueueSettings } from './AutomationQueueSettings';
import { ExportDataButton } from './ExportDataButton';
import { ResetDataButton } from './ResetDataButton';

export function Settings() {
  return (
    <>
      <NotificationSettings />
      <AutomationQueueSettings />
      <PageFeatureSettings />

      <div class="ff-section-label">Data</div>
      <ExportDataButton />
      <ResetDataButton />
    </>
  );
}
