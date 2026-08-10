import Dexie, { type EntityTable } from 'dexie';
import type { CustomsEvent, District, DistrictVisit, PriceSnapshot, RiskObservation, Trade, TravelLeg } from './types';
import type { EndpointProfile, RequestLogEntry } from './requestLog/types';

const db = new Dexie('FifthFamilyTradeAssistant') as Dexie & {
  trades: EntityTable<Trade, 'id'>;
  priceSnapshots: EntityTable<PriceSnapshot, 'id'>;
  customsEvents: EntityTable<CustomsEvent, 'id'>;
  districts: EntityTable<District, 'id'>;
  districtVisits: EntityTable<DistrictVisit, 'id'>;
  travelLegs: EntityTable<TravelLeg, 'id'>;
  riskObservations: EntityTable<RiskObservation, 'id'>;
  requestLog: EntityTable<RequestLogEntry, 'id'>;
  endpointProfiles: EntityTable<EndpointProfile, 'id'>;
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

// `requestLog.timestamp` is indexed because it carries the whole retention sweep —
// trimming is a `below(cutoff)` range delete, which has to stay cheap on a table
// that reaches six figures of rows. `[endpoint+timestamp]` serves the export's
// "this endpoint, this window" reads without falling back to a full scan.
//
// `endpointShapes` is indexed on `[endpoint+shapeHash]` because the write path
// looks up exactly that pair on every single logged response, to decide between
// bumping an existing shape and recording a new one.
db.version(3).stores({
  requestLog: '++id, timestamp, endpoint, [endpoint+timestamp]',
  endpointShapes: '++id, endpoint, lastSeen, [endpoint+shapeHash]',
});

// `endpointShapes` stored one row per distinct token *set* and treated a count
// above one as evidence the game had changed. Against real traffic that fired on
// every endpoint within an hour of first use: one endpoint legitimately returns
// several structures (listing vs raid screen, city list vs travel confirmation vs
// error), and optional elements forked the set every time they toggled. Setting
// the store to null drops it outright rather than migrating — the rows were
// counting the wrong thing, so none of their content is worth carrying over, and
// `endpointProfiles` rebuilds from live traffic within a session.
db.version(4).stores({
  endpointShapes: null,
  endpointProfiles: '++id, endpoint, lastSeen',
});

/** Wipes the derived, player-facing tables — everything behind the numbers shown in
 * the popup. `districts` is included; `ensureSeedData()` re-seeds it automatically
 * the next time the background worker wakes, since it just checks `count() === 0`.
 *
 * The HTTP archive is deliberately **not** touched. These are two different kinds
 * of data with two different lifecycles: the tables here are the player's game
 * history, while `requestLog`/`endpointShapes` are a developer-facing recording of
 * raw traffic with its own retention policy, its own exports, and its own clear
 * control in the archive's section of Settings. Clearing "the numbers I see" should
 * not silently destroy months of capture that exists to diagnose the game — so
 * `clearRequestLog()` is the only thing that empties it. */
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

/** Clears the HTTP archive and its shape index, and nothing else. The archive's
 *  own reset — trades, prices, and every other derived table are left intact. */
export async function clearRequestLog(): Promise<void> {
  await db.transaction('rw', [db.requestLog, db.endpointProfiles], async () => {
    await Promise.all([db.requestLog.clear(), db.endpointProfiles.clear()]);
  });
}

export { db };
