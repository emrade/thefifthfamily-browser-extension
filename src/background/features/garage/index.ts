import type {
  GarageBuyResult,
  GarageCar,
  GarageCarState,
  GarageCatalog,
  GarageDealerListing,
  GarageInstallResult,
  GarageMigrateResult,
  GaragePartEntry,
  GaragePartsInventory,
  GarageSellBodyResult,
  GarageSlotKey,
  GarageStripResult,
} from '@/shared/types';
import { fetchLiveStatus, postAction } from '../../gameAction';

const SLOT_KEYS: GarageSlotKey[] = ['engine', 'transmission', 'tires', 'suspension', 'aerodynamics'];

/**
 * Backs the Garage & Dealership overlay's three manual, tap-triggered batch
 * tools — Bulk Buy, Strip Parts, Delete Bodies. Same shape as
 * `background/features/streetRacing`: no config, no auto-runner, just one
 * real game action per exported function, each called once per item by the
 * overlay's own batch loop (see `content/features/garage/overlay.ts`) so
 * `postAction`'s pacing/rate-limit handling applies to every call the same
 * way a manual player's clicks would.
 *
 * Confirmed real against the live `/api/chop_shop_proto.php` (read) and
 * `/actions/chop_shop_v2.php` (write) endpoints via a 2026-09-17 request
 * archive — see the doc comments on the `Garage*` types in shared/types.ts
 * for the specific captures each field came from.
 */

function mapCar(raw: any): GarageCar {
  return {
    id: raw.id,
    carModelId: raw.car_model_id,
    isEquipped: !!raw.is_equipped,
    durability: raw.durability,
    name: raw.name,
    category: raw.category,
    vehicleClass: raw.vehicle_class,
    image: raw.image,
    chopValue: raw.chop_value,
    baseSpeed: raw.base_speed,
    baseHandling: raw.base_handling,
    baseAccel: raw.base_accel,
    bonusStr: raw.bonus_str,
    bonusDef: raw.bonus_def,
    bonusAgl: raw.bonus_agl,
    bonusDex: raw.bonus_dex,
    partsFitted: raw.parts_fitted,
    modifiable: !!raw.modifiable,
    complete: !!raw.complete,
  };
}

function mapDealerListing(raw: any): GarageDealerListing {
  return {
    id: raw.id,
    name: raw.name,
    category: raw.category,
    vehicleClass: raw.vehicle_class,
    image: raw.image,
    baseSpeed: raw.base_speed,
    baseHandling: raw.base_handling,
    baseAccel: raw.base_accel,
    bonusStr: raw.bonus_str,
    bonusDef: raw.bonus_def,
    bonusAgl: raw.bonus_agl,
    bonusDex: raw.bonus_dex,
    priceCash: raw.price_cash,
    pricePlatinum: raw.price_platinum,
    modifiable: !!raw.modifiable,
    buyable: !!raw.buyable,
    owned: !!raw.owned,
  };
}

/** Sent by the overlay on mount/refresh — a live, uncached read, same
 *  reasoning as `streetRacing.fetchCatalog`: the whole point is the
 *  player's real current garage/dealer/cash state before anything is
 *  selected, let alone confirmed. */
export async function fetchCatalog(): Promise<GarageCatalog> {
  const resp = await postAction('/api/chop_shop_proto.php', { action: 'catalog' });
  if (resp.ok === false) throw new Error(resp.error || 'chop_shop_proto.php catalog did not return ok:true');

  return {
    cars: ((resp.cars ?? []) as any[]).map(mapCar),
    dealer: ((resp.dealer ?? []) as any[]).map(mapDealerListing),
    cash: Number(resp.cash) || 0,
    platinum: Number(resp.platinum) || 0,
  };
}

/** Fetched on demand, one call per vehicle — see `GarageCarState`'s own doc
 *  for why `bodyQuicksell` can't be derived from anything already on the
 *  catalog's car list, and for `migrated`/`missing`'s role in Fit Parts
 *  planning. */
export async function fetchCarState(carId: number): Promise<GarageCarState> {
  const resp = await postAction('/api/chop_shop_proto.php', { action: 'get_state', car_id: carId });
  if (resp.ok === false) throw new Error(resp.error || `chop_shop_proto.php get_state did not return ok:true for car ${carId}`);

  const missing = (resp.missing ?? []) as GarageSlotKey[];
  return {
    carId,
    equipped: !!resp.equipped,
    complete: !!resp.complete,
    partsFitted: 5 - missing.length,
    bodyQuicksell: Number(resp.body_quicksell) || 0,
    migrated: !!resp.migrated,
    missing,
  };
}

function mapPartEntry(raw: any): GaragePartEntry {
  return {
    userPartId: raw.user_part_id,
    name: raw.name,
    topSpeed: raw.top_speed,
    accel: raw.accel,
    handling: raw.handling,
    installFee: raw.install_fee,
    fullPrice: raw.full_price,
    quicksell: raw.quicksell,
    originModel: raw.origin_model ?? null,
    locked: !!raw.locked,
  };
}

/** The player's whole loose-parts bin, grouped by slot — exactly the pool
 *  the native "Spare X Components" drawer picks from (confirmed real: the
 *  live panel's own `renderSlot`/drawer code reads `state.inv.parts[key]`
 *  directly, no further filtering beyond what's already in this response).
 *  Fit Parts planning fetches this fresh immediately before building a plan
 *  rather than caching it, since a part consumed by one step in a
 *  multi-vehicle plan must not be offered again to the next. */
export async function fetchInventory(): Promise<GaragePartsInventory> {
  const resp = await postAction('/api/chop_shop_proto.php', { action: 'inventory' });
  if (resp.ok === false) throw new Error(resp.error || 'chop_shop_proto.php inventory did not return ok:true');

  const parts = resp.parts ?? {};
  const result = {} as GaragePartsInventory;
  for (const slot of SLOT_KEYS) {
    result[slot] = ((parts[slot] ?? []) as any[]).map(mapPartEntry);
  }
  return result;
}

/** Live cash on hand — what the Bulk Buy tab checks its computed total
 *  against, both right after the player says they've withdrawn and again
 *  immediately before the batch actually starts spending (time, or other
 *  spending, may have passed between the two). Reuses `fetchLiveStatus`
 *  rather than trusting the catalog's own `cash` field, which goes stale
 *  the moment the player leaves the Bank page open in another tab. */
export async function fetchCashOnHand(): Promise<number> {
  const status = await fetchLiveStatus();
  return status?.cash ?? 0;
}

/** One dealer purchase — arrives with all five native parts fitted at $0,
 *  per the live panel's own "Vehicles arrive complete" copy, not a bare
 *  chassis. `currency` is hardcoded to `cash`: the overlay's Bulk Buy tab
 *  only ever offers cash-priced models (see `overlay.ts`'s own doc for why
 *  platinum purchases are out of scope). */
export async function buyVehicle(modelId: number): Promise<GarageBuyResult> {
  const resp = await postAction('/actions/chop_shop_v2.php', { action: 'buy', model_id: modelId, currency: 'cash' });
  if (resp.ok === false) throw new Error(resp.error || `Buying model ${modelId} was rejected.`);
  return { message: resp.message ?? '', userCarId: Number(resp.user_car_id) };
}

/** Strips every part fitted to `carId` back to the chop inventory —
 *  including, per the live panel's own confirm copy, any part native to
 *  this vehicle that's since been fitted to a *different* one (that other
 *  vehicle comes back unequipped; `affected` counts how many). The body
 *  itself is kept, not destroyed. */
export async function stripVehicle(carId: number): Promise<GarageStripResult> {
  const resp = await postAction('/actions/chop_shop_v2.php', { action: 'chop', user_car_id: carId, confirm: 1 });
  if (resp.ok === false) throw new Error(resp.error || `Stripping vehicle ${carId} was rejected.`);
  return {
    message: resp.message ?? '',
    payout: Number(resp.payout) || 0,
    partsRemoved: Number(resp.parts_removed) || 0,
    affected: Number(resp.affected) || 0,
  };
}

/** Sells the body itself for good. Every real capture of this action in the
 *  archive was on an already-stripped vehicle (`partsFitted === 0`) — what
 *  happens to parts still fitted at call time has never actually been
 *  observed, so it isn't guessed at here. The overlay's Delete Bodies tab
 *  only offers already-stripped vehicles for exactly this reason, matching
 *  how the player described the flow ("delete multiple vehicles I have
 *  stripped"), not because the server is known to reject the other case. */
export async function sellBody(carId: number): Promise<GarageSellBodyResult> {
  const resp = await postAction('/actions/chop_shop_v2.php', { action: 'sell_body', user_car_id: carId, confirm: 1 });
  if (resp.ok === false) throw new Error(resp.error || `Selling the body for vehicle ${carId} was rejected.`);
  return { message: resp.message ?? '', payout: Number(resp.payout) || 0 };
}

/** Fits one specific loose part into `carId`'s matching slot — confirmed
 *  real (2026-09-17 archive): five consecutive real `install` calls fitting
 *  a freshly-bought vehicle, each returning a fee-bearing confirmation
 *  message ("Fitted Karnov Uno Engine for $1,000.") and the vehicle's fresh
 *  `stats`/`complete`. The server infers the slot from `part_id` itself —
 *  there's no separate slot parameter — which is exactly why Fit Parts
 *  planning only ever offers a part from that slot's own inventory bucket
 *  in the first place; nothing here re-validates compatibility beyond what
 *  the plan already guaranteed by construction. */
export async function installPart(carId: number, partId: number): Promise<GarageInstallResult> {
  const resp = await postAction('/actions/chop_shop_v2.php', { action: 'install', user_car_id: carId, part_id: partId });
  if (resp.ok === false) throw new Error(resp.error || `Fitting part ${partId} to vehicle ${carId} was rejected.`);
  return { message: resp.message ?? '', complete: !!resp.complete };
}

/** Installs the free native part set on a chassis that predates the
 *  component system (`GarageCarState.migrated === false`) — see
 *  `GarageMigrateResult`'s own doc for why this one is unconfirmed beyond
 *  its basic `{ok:true,message}` shape. Fit Parts calls this instead of
 *  `installPart` for such a vehicle, once, rather than trying to fill its
 *  five slots individually. */
export async function migrateVehicle(carId: number): Promise<GarageMigrateResult> {
  const resp = await postAction('/actions/chop_shop_v2.php', { action: 'migrate', user_car_id: carId });
  if (resp.ok === false) throw new Error(resp.error || `Installing native parts on vehicle ${carId} was rejected.`);
  return { message: resp.message ?? '' };
}
