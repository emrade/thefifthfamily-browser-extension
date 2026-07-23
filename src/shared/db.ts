import Dexie, { type EntityTable } from 'dexie';
import type { CustomsEvent, District, DistrictVisit, PriceSnapshot, RiskObservation, Trade, TravelLeg } from './types';

const db = new Dexie('FifthFamilyTradeAssistant') as Dexie & {
  trades: EntityTable<Trade, 'id'>;
  priceSnapshots: EntityTable<PriceSnapshot, 'id'>;
  customsEvents: EntityTable<CustomsEvent, 'id'>;
  districts: EntityTable<District, 'id'>;
  districtVisits: EntityTable<DistrictVisit, 'id'>;
  travelLegs: EntityTable<TravelLeg, 'id'>;
  riskObservations: EntityTable<RiskObservation, 'id'>;
};

db.version(1).stores({
  trades: '++id, item, status, buyTime, sellTime',
  priceSnapshots: '++id, district, item, timestamp, type',
  customsEvents: '++id, timestamp, district, resolution',
  districts: 'id, name',
  districtVisits: '++id, cityId, timestamp',
  travelLegs: '++id, timestamp',
});

// Dexie versioning only needs the delta — tables from version 1 carry forward
// unchanged. A real version bump (not editing version(1) in place) is required so
// installs that already have a v1 database on disk actually get the new store.
db.version(2).stores({
  riskObservations: '++id, timestamp',
});

/** Wipes every Dexie table. `districts` is included — `ensureSeedData()` re-seeds it
 * automatically the next time the background worker wakes, since it just checks
 * `count() === 0`. */
export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.trades, db.priceSnapshots, db.customsEvents, db.districts, db.districtVisits, db.travelLegs, db.riskObservations],
    async () => {
      await Promise.all([
        db.trades.clear(),
        db.priceSnapshots.clear(),
        db.customsEvents.clear(),
        db.districts.clear(),
        db.districtVisits.clear(),
        db.travelLegs.clear(),
        db.riskObservations.clear(),
      ]);
    },
  );
}

export { db };
