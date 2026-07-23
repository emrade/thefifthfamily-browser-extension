import { ExportDataButton } from './ExportDataButton';
import { ResetDataButton } from './ResetDataButton';

export function Settings() {
  return (
    <>
      <div class="ff-section-label">Data</div>
      <ExportDataButton />
      <ResetDataButton />
    </>
  );
}
