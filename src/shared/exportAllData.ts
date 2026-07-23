import { db } from './db';

/**
 * Dumps every Dexie table and the whole chrome.storage.local namespace as one JSON
 * blob — a raw data export for manual inspection (e.g. spotting duplicate rows from
 * a stacked network-hook bug), not a re-importable backup format.
 */
export async function exportAllData(): Promise<string> {
  const [trades, priceSnapshots, customsEvents, districts, districtVisits, travelLegs, riskObservations, storageSnapshot] =
    await Promise.all([
      db.trades.toArray(),
      db.priceSnapshots.toArray(),
      db.customsEvents.toArray(),
      db.districts.toArray(),
      db.districtVisits.toArray(),
      db.travelLegs.toArray(),
      db.riskObservations.toArray(),
      chrome.storage.local.get(null),
    ]);

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      tables: { trades, priceSnapshots, customsEvents, districts, districtVisits, travelLegs, riskObservations },
      storage: storageSnapshot,
    },
    null,
    2,
  );
}
