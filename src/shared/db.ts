import Dexie, { type EntityTable } from 'dexie';
import type { CustomsEvent, District, DistrictVisit, PriceSnapshot, Trade, TravelLeg } from './types';

const db = new Dexie('FifthFamilyTradeAssistant') as Dexie & {
  trades: EntityTable<Trade, 'id'>;
  priceSnapshots: EntityTable<PriceSnapshot, 'id'>;
  customsEvents: EntityTable<CustomsEvent, 'id'>;
  districts: EntityTable<District, 'id'>;
  districtVisits: EntityTable<DistrictVisit, 'id'>;
  travelLegs: EntityTable<TravelLeg, 'id'>;
};

db.version(1).stores({
  trades: '++id, item, status, buyTime, sellTime',
  priceSnapshots: '++id, district, item, timestamp, type',
  customsEvents: '++id, timestamp, district, resolution',
  districts: 'id, name',
  districtVisits: '++id, cityId, timestamp',
  travelLegs: '++id, timestamp',
});

export { db };
