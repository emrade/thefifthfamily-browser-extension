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

export { db };
