import { exportAllData } from '@/shared/exportAllData';

export function ExportDataButton() {
  async function handleExport() {
    const json = await exportAllData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `fifth-family-data-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  return (
    <button class="ff-export-trigger" onClick={handleExport}>
      Download All Data
    </button>
  );
}
