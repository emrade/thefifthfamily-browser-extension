import { db } from './db';

/**
 * Dumps every Dexie table and the whole chrome.storage.local namespace as one JSON
 * blob — a raw data export for manual inspection (e.g. spotting duplicate rows from
 * a stacked network-hook bug), not a re-importable backup format.
 */
export async function exportAllData(): Promise<string> {
  const [districts, districtVisits, stockPrices, stockRumors, storageSnapshot] = await Promise.all([
    db.districts.toArray(),
    db.districtVisits.toArray(),
    db.stockPrices.toArray(),
    db.stockRumors.toArray(),
    chrome.storage.local.get(null),
  ]);

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      tables: { districts, districtVisits, stockPrices, stockRumors },
      storage: storageSnapshot,
    },
    null,
    2,
  );
}
