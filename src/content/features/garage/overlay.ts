import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { GarageCar, GarageCatalog, GarageDealerListing, GaragePartsInventory, GarageSlotKey } from '@/shared/types';

/**
 * A floating panel on the live Garage & Dealership page (`type=chop_shop`)
 * with four manual, tap-triggered batch tools the native panel doesn't
 * offer: buying several of the same dealer model in one go, stripping parts
 * from several owned vehicles in one go, selling several already-stripped
 * bodies in one go, and auto-fitting spare parts into one or many vehicles
 * in one go. Same "badge + expand" shape as streetRacing/overlay.ts, and the
 * same "one real action per background message, loop lives here" split —
 * see that file's own doc for why.
 *
 * Everything here defers to protections the game (or the player) already
 * set: the equipped vehicle is never selectable for Strip/Delete (the
 * native panel disables its own Strip/Sell buttons for it too — confirmed
 * real reading its `renderVehicle`), and a vehicle the player has marked Do
 * Not Touch (a purely local flag, persisted via `storage.getGarageDoNotTouch`
 * — not a game concept) is equally unselectable there until they unmark it.
 * Fit Parts is deliberately exempt from both — fitting only ever adds a
 * part to an empty slot, never removes or sells anything, so there's
 * nothing for either protection to guard against. Every batch action goes
 * through an inline confirm step before anything is sent.
 *
 * Every batch (all four tools) shows a spinner plus a determinate progress
 * bar the whole time it's running — added after Bulk Buy/Strip/Delete first
 * shipped with progress as plain re-rendered text only, which read as inert
 * during a single slow call rather than "actively working." See
 * `renderRunningBatch`/`renderIndeterminateBatch`.
 *
 * Bulk Buy is scoped to cash-priced dealer models only (`priceCash > 0`) —
 * the archive's dealer captures always showed `price_platinum: 0` for every
 * entry, so there's no confirmed real example of a platinum purchase to
 * build against. Bulk Delete is scoped to vehicles already fully stripped
 * (`partsFitted === 0`) — see `background/features/garage`'s own doc on
 * `sellBody` for why selling a body that still has parts fitted is left
 * alone entirely rather than guessed at.
 *
 * Fit Parts plans before it asks for confirmation: it fetches the player's
 * real loose-parts inventory, then — for every slot every selected vehicle
 * is missing — randomly picks one compatible spare part from what's left in
 * a local copy of that pool and removes it from that copy, so the same
 * physical part is never planned into two different vehicles in one run.
 * The confirm step shows the *exact* resulting cost and part list, not an
 * estimate, since the random choice already happened during planning, not
 * at execution time.
 */

const CONTAINER_ID = 'ff-garage-panel';
const STYLE_ID = 'ff-garage-panel-style';
const PAGE_MARKER = '.xp-wrap';

type Tab = 'buy' | 'strip' | 'delete' | 'fit';

interface BuyCashCheck {
  total: number;
  cashOnHand: number;
  sufficient: boolean;
}

interface BuySummary {
  bought: number;
  spent: number;
  errors: string[];
  stopped: boolean;
  vehicleName: string;
}

interface StripSummary {
  stripped: number;
  partsRemoved: number;
  affected: number;
  errors: string[];
  stopped: boolean;
}

interface DeleteSummary {
  sold: number;
  payout: number;
  errors: string[];
  stopped: boolean;
}

/** One planned (vehicle, slot, part) assignment — see the module doc's
 *  "Fit Parts plans before it asks for confirmation" paragraph. */
interface FitPlanStep {
  carId: number;
  carName: string;
  slot: GarageSlotKey;
  partId: number;
  partName: string;
  installFee: number;
}

interface FitPlan {
  steps: FitPlanStep[];
  /** Vehicles found to be `migrated: false` — handled with one free
   *  `migrate` call each instead of per-slot `install` steps. */
  migrateCarIds: { id: number; name: string }[];
  totalCost: number;
  /** Human-readable "no spare X for Y" notes for a slot that couldn't be
   *  planned because the loose-parts pool for it was already empty by the
   *  time this plan reached it (a real possibility across a multi-vehicle
   *  bulk plan, not just an edge case). */
  shortfalls: string[];
}

interface FitSummary {
  fitted: number;
  migrated: number;
  spent: number;
  errors: string[];
  stopped: boolean;
}

let panelEl: HTMLDivElement | null = null;
let expanded = false;
let activeTab: Tab = 'buy';

let catalog: GarageCatalog | null = null;
let loadError: string | null = null;
let doNotTouch = new Set<number>();

// --- Bulk Buy state ----------------------------------------------------
let buySelectedModelId: number | null = null;
let buyQuantity = 1;
let buyCashCheck: BuyCashCheck | null = null;
let buyBatchState: 'idle' | 'confirming' | 'running' = 'idle';
let buyCancelRequested = false;
let buyProgressText = '';
// 0/0 means "indeterminate" (no per-item count yet, e.g. the pre-batch cash
// re-check) — see `renderBuyBatchControls`.
let buyProgressDone = 0;
let buyProgressTotal = 0;
let buySummary: BuySummary | null = null;

// --- Strip Parts state ---------------------------------------------------
const stripSelected = new Set<number>();
let stripBatchState: 'idle' | 'confirming' | 'running' = 'idle';
let stripCancelRequested = false;
let stripProgressText = '';
let stripProgressDone = 0;
let stripProgressTotal = 0;
let stripSummary: StripSummary | null = null;

// --- Delete Bodies state --------------------------------------------------
const deleteSelected = new Set<number>();
// carId -> quicksell value, or null while the get_state lookup is in flight.
const deleteQuotes = new Map<number, number | null>();
let deleteBatchState: 'idle' | 'confirming' | 'running' = 'idle';
let deleteCancelRequested = false;
let deleteProgressText = '';
let deleteProgressDone = 0;
let deleteProgressTotal = 0;
let deleteSummary: DeleteSummary | null = null;

// --- Fit Parts state -------------------------------------------------------
// Two independent selections rather than a mode toggle — a single-vehicle
// pick and a bulk checkbox list are different enough targets (any
// incomplete vehicle vs. specifically empty ones) that showing both at once
// avoids an extra click to switch between them, and nothing about planning
// or executing needs them to be mutually exclusive.
let fitSingleCarId: number | null = null;
const fitBulkSelected = new Set<number>();
let fitBatchState: 'idle' | 'planning' | 'confirming' | 'running' = 'idle';
let fitCancelRequested = false;
let fitProgressText = '';
let fitProgressDone = 0;
let fitProgressTotal = 0;
let fitPlan: FitPlan | null = null;
let fitSummary: FitSummary | null = null;

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/** Same "account-wide block, not a per-item miss" heuristic as
 *  streetRacing/overlay.ts's own `looksSystemic` — duplicated rather than
 *  imported since that one is a private module-level function there, not a
 *  shared export. */
function looksSystemic(message: string): boolean {
  return /jail|hospitali[sz]ed|travel|csrf|token|session|unauthori[sz]ed|forbidden/i.test(message);
}

/** Unconfirmed wording — no real "insufficient cash" rejection from
 *  `chop_shop_v2.php`'s `buy` action has been captured yet, unlike the
 *  jailed/hospitalized phrasings `looksSystemic` matches. Still worth
 *  checking for: running out of cash mid-batch means every remaining
 *  purchase would fail identically, so this stops the batch outright rather
 *  than burning through the rest of the queue one rejection at a time. */
function looksLikeInsufficientFunds(message: string): boolean {
  return /not enough (cash|money|funds)|insufficient (cash|money|funds)|can'?t afford/i.test(message);
}

/** A spinner plus a real determinate progress bar for a batch mid-run — see
 *  the module doc's "physical loading" paragraph for why plain re-rendered
 *  text alone wasn't enough. Shared by all four tools' 'running' state. */
function renderRunningBatch(text: string, done: number, total: number, cancelRequested: boolean, stopLabel: string): string {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return `
    <div class="ff-gp-batch">
      <div class="ff-gp-batch-text"><span class="ff-gp-spinner" aria-hidden="true"></span>${text}</div>
      <div class="ff-gp-progress-track"><div class="ff-gp-progress-fill" style="width:${pct}%"></div></div>
      <div class="ff-gp-progress-label">${done} of ${total}</div>
      <div class="ff-gp-batch-actions">
        <button class="ff-gp-batch-stop" type="button" ${cancelRequested ? 'disabled' : ''}>${cancelRequested ? 'Stopping…' : stopLabel}</button>
      </div>
    </div>
  `;
}

/** Same spinner, no progress bar — for a phase with no per-item count yet
 *  (a single live check, or Fit Parts building its plan) where a 0-of-0 bar
 *  would read as broken rather than simply not applicable. */
function renderIndeterminateBatch(text: string): string {
  return `<div class="ff-gp-batch"><div class="ff-gp-batch-text"><span class="ff-gp-spinner" aria-hidden="true"></span>${text}</div></div>`;
}

function isProtected(car: GarageCar): boolean {
  return car.isEquipped || doNotTouch.has(car.id);
}

function eligibleForStrip(car: GarageCar): boolean {
  return !isProtected(car) && car.modifiable && car.partsFitted > 0;
}

function eligibleForDelete(car: GarageCar): boolean {
  return !isProtected(car) && car.modifiable && car.partsFitted === 0;
}

// Fit Parts deliberately ignores `isProtected` — see the module doc for why
// (fitting only ever fills an empty slot, nothing to protect against).
function eligibleForFitSingle(car: GarageCar): boolean {
  return car.modifiable && car.partsFitted < 5;
}

function eligibleForFitBulk(car: GarageCar): boolean {
  return car.modifiable && car.partsFitted === 0;
}

const SLOT_LABELS: Record<GarageSlotKey, string> = {
  engine: 'Engine',
  transmission: 'Transmission',
  tires: 'Tires',
  suspension: 'Suspension',
  aerodynamics: 'Clutch',
};
const SLOT_KEYS: GarageSlotKey[] = ['engine', 'transmission', 'tires', 'suspension', 'aerodynamics'];

async function toggleDoNotTouch(carId: number): Promise<void> {
  if (doNotTouch.has(carId)) doNotTouch.delete(carId);
  else doNotTouch.add(carId);
  stripSelected.delete(carId);
  deleteSelected.delete(carId);
  await storage.setGarageDoNotTouch(Array.from(doNotTouch));
  renderAll();
}

function protectionTag(car: GarageCar): string {
  if (car.isEquipped) return '<span class="ff-gp-tag ff-gp-tag-active">Active</span>';
  if (doNotTouch.has(car.id)) return '<span class="ff-gp-tag ff-gp-tag-dnt">Do Not Touch</span>';
  return '';
}

function dntButtonHtml(car: GarageCar): string {
  if (car.isEquipped) return '';
  const marked = doNotTouch.has(car.id);
  return `<button class="ff-gp-dnt-btn${marked ? ' ff-gp-dnt-on' : ''}" type="button" data-dnt-id="${car.id}" title="${marked ? 'Allow this vehicle to be stripped/deleted again' : 'Protect this vehicle from Strip/Delete'}">${marked ? '🔒 Protected' : '🔓 Protect'}</button>`;
}

// =========================================================================
// Bulk Buy
// =========================================================================

function buyableDealer(): GarageDealerListing[] {
  if (!catalog) return [];
  return catalog.dealer.filter((d) => d.buyable && d.priceCash > 0);
}

function renderBuyBatchControls(): string {
  const listing = buyableDealer().find((d) => d.id === buySelectedModelId);
  if (!listing) return '';

  if (buyBatchState === 'running') {
    return buyProgressTotal > 0
      ? renderRunningBatch(buyProgressText, buyProgressDone, buyProgressTotal, buyCancelRequested, 'Stop after this purchase')
      : renderIndeterminateBatch(buyProgressText);
  }

  if (buyBatchState === 'confirming') {
    const total = listing.priceCash * buyQuantity;
    return `
      <div class="ff-gp-batch">
        <div class="ff-gp-batch-text">Buy ${buyQuantity} × ${listing.name} for ${money(total)} total? This cannot be undone.</div>
        <div class="ff-gp-batch-actions">
          <button class="ff-gp-batch-confirm" type="button">Confirm</button>
          <button class="ff-gp-batch-cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
  }

  return '';
}

function renderBuyTab(): string {
  if (!catalog) return '<div class="ff-gp-empty">Loading dealer stock…</div>';
  const listings = buyableDealer();
  if (!listings.length) return '<div class="ff-gp-empty">No cash-priced vehicles currently for sale.</div>';

  const options = listings
    .map((d) => `<option value="${d.id}" ${d.id === buySelectedModelId ? 'selected' : ''}>${d.name} — ${money(d.priceCash)}</option>`)
    .join('');
  const listing = listings.find((d) => d.id === buySelectedModelId) ?? null;
  const total = listing ? listing.priceCash * buyQuantity : 0;

  let cashCheckHtml = '';
  if (buyCashCheck) {
    cashCheckHtml = buyCashCheck.sufficient
      ? `<div class="ff-gp-cash-ok">You have ${money(buyCashCheck.cashOnHand)} on hand — enough for this purchase.</div>`
      : `<div class="ff-gp-cash-short">You have ${money(buyCashCheck.cashOnHand)} on hand — short by ${money(buyCashCheck.total - buyCashCheck.cashOnHand)}. Withdraw at least that much, then check again.</div>`;
  }

  const canBuy = !!listing && !!buyCashCheck?.sufficient && buyBatchState === 'idle';
  const batchHtml = renderBuyBatchControls();
  const summaryHtml = buySummary
    ? `<div class="ff-gp-batch-summary"><button class="ff-gp-batch-summary-close" type="button" title="Dismiss">✕</button>${buySummary.vehicleName} — ${buySummary.stopped ? 'stopped' : 'finished'}: ${buySummary.bought} bought, ${money(buySummary.spent)} spent.${buySummary.errors.length ? `<br>${buySummary.errors.join('<br>')}` : ''}</div>`
    : '';

  return `
    <div class="ff-gp-buy-form">
      <label class="ff-gp-label">Vehicle</label>
      <select class="ff-gp-select" id="ffGpModel">${options}</select>
      <label class="ff-gp-label">Quantity</label>
      <input class="ff-gp-qty" id="ffGpQty" type="number" min="1" max="999" value="${buyQuantity}" ${buyBatchState !== 'idle' ? 'disabled' : ''}>
      <div class="ff-gp-total">Total: <strong>${money(total)}</strong> (${listing ? money(listing.priceCash) : '$0'} each)</div>
      ${cashCheckHtml}
      <div class="ff-gp-buy-actions">
        <button class="ff-gp-check-cash" type="button" ${buyBatchState !== 'idle' ? 'disabled' : ''}>Check Cash</button>
        <button class="ff-gp-buy-go" type="button" ${canBuy ? '' : 'disabled'}>Buy ${buyQuantity} × Vehicle</button>
      </div>
    </div>
    ${batchHtml}
    ${summaryHtml}
  `;
}

async function runBuyBatch(): Promise<void> {
  const listing = buyableDealer().find((d) => d.id === buySelectedModelId);
  if (!listing) return;

  buyBatchState = 'running';
  buyCancelRequested = false;
  buySummary = null;
  const vehicleName = listing.name;
  const modelId = listing.id;
  const totalQty = buyQuantity;

  // Re-checked live right before spending — time (or other spending) may
  // have passed since the player last hit "Check Cash". Indeterminate
  // (buyProgressTotal stays 0): this is one call, not a per-item count.
  buyProgressText = 'Confirming cash on hand…';
  buyProgressDone = 0;
  buyProgressTotal = 0;
  renderAll();
  const cashOnHand = (await chrome.runtime.sendMessage({ type: 'garage-cash-requested' })) as number;
  const total = listing.priceCash * totalQty;
  if (cashOnHand < total) {
    buyBatchState = 'idle';
    buySummary = { bought: 0, spent: 0, errors: [`Only ${money(cashOnHand)} on hand now — needed ${money(total)}. Nothing was bought.`], stopped: true, vehicleName };
    renderAll();
    return;
  }

  const tally: BuySummary = { bought: 0, spent: 0, errors: [], stopped: false, vehicleName };
  buyProgressTotal = totalQty;

  for (let i = 0; i < totalQty; i++) {
    if (buyCancelRequested) {
      tally.stopped = true;
      break;
    }
    buyProgressText = `Buying ${vehicleName} — ${i + 1} of ${totalQty}…`;
    buyProgressDone = i;
    renderAll();
    try {
      await chrome.runtime.sendMessage({ type: 'garage-buy-requested', modelId });
      tally.bought++;
      tally.spent += listing.priceCash;
      buyProgressDone = i + 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      tally.errors.push(message);
      if (looksSystemic(message) || looksLikeInsufficientFunds(message)) {
        tally.stopped = true;
        break;
      }
    }
  }

  buyBatchState = 'idle';
  buyCashCheck = null;
  buySummary = tally;
  renderAll();
  await refresh();
}

/** Patches just the total/cash-check/button text in place, without touching
 *  the quantity `<input>` node itself — a full `renderBody()` on every
 *  keystroke (the natural choice, since every other piece of state here
 *  re-renders that way) replaces that input's DOM node wholesale, which
 *  steals focus mid-type: type "12" and the "1" keystroke's re-render would
 *  swap in a fresh, unfocused input before "2" ever reaches it. */
function updateBuyTotals(): void {
  const body = panelEl?.querySelector('.ff-gp-body');
  if (!body) return;
  const listing = buyableDealer().find((d) => d.id === buySelectedModelId);
  const total = listing ? listing.priceCash * buyQuantity : 0;

  const totalEl = body.querySelector('.ff-gp-total');
  if (totalEl) totalEl.innerHTML = `Total: <strong>${money(total)}</strong> (${listing ? money(listing.priceCash) : '$0'} each)`;

  // buyCashCheck was already cleared by the caller (the total it was
  // computed against is now stale) — drop whatever it last rendered.
  body.querySelector('.ff-gp-cash-ok')?.remove();
  body.querySelector('.ff-gp-cash-short')?.remove();

  const buyBtn = body.querySelector<HTMLButtonElement>('.ff-gp-buy-go');
  if (buyBtn) {
    buyBtn.textContent = `Buy ${buyQuantity} × Vehicle`;
    buyBtn.disabled = true; // no fresh cash check yet for this total
  }
}

function wireBuyTab(): void {
  const body = panelEl?.querySelector('.ff-gp-body');
  if (!body) return;

  body.querySelector('#ffGpModel')?.addEventListener('change', (e) => {
    buySelectedModelId = Number((e.target as HTMLSelectElement).value);
    buyCashCheck = null;
    renderAll();
  });
  body.querySelector('#ffGpQty')?.addEventListener('input', (e) => {
    const v = Math.max(1, Math.min(999, Number((e.target as HTMLInputElement).value) || 1));
    buyQuantity = v;
    buyCashCheck = null;
    updateBuyTotals();
  });
  body.querySelector('.ff-gp-check-cash')?.addEventListener('click', () => void checkBuyCash());
  body.querySelector('.ff-gp-buy-go')?.addEventListener('click', () => {
    buyBatchState = 'confirming';
    renderAll();
  });
  body.querySelector('.ff-gp-batch-confirm')?.addEventListener('click', () => void runBuyBatch());
  body.querySelector('.ff-gp-batch-cancel')?.addEventListener('click', () => {
    buyBatchState = 'idle';
    renderAll();
  });
  body.querySelector('.ff-gp-batch-stop')?.addEventListener('click', () => {
    buyCancelRequested = true;
    renderAll();
  });
  body.querySelector('.ff-gp-batch-summary-close')?.addEventListener('click', () => {
    buySummary = null;
    renderAll();
  });
}

async function checkBuyCash(): Promise<void> {
  const listing = buyableDealer().find((d) => d.id === buySelectedModelId);
  if (!listing) return;
  const total = listing.priceCash * buyQuantity;
  const cashOnHand = (await chrome.runtime.sendMessage({ type: 'garage-cash-requested' })) as number;
  buyCashCheck = { total, cashOnHand, sufficient: cashOnHand >= total };
  renderAll();
}

// =========================================================================
// Strip Parts
// =========================================================================

function renderStripRow(car: GarageCar): string {
  const eligible = eligibleForStrip(car);
  const protectedRow = isProtected(car);
  const checked = stripSelected.has(car.id);
  const disabled = !eligible || stripBatchState !== 'idle';
  return `
    <div class="ff-gp-row${protectedRow ? ' ff-gp-row-protected' : ''}" data-car-id="${car.id}">
      <input type="checkbox" class="ff-gp-row-check" data-strip-id="${car.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <div class="ff-gp-row-body">
        <div class="ff-gp-row-name">${car.name} ${protectionTag(car)}</div>
        <div class="ff-gp-row-meta">${car.category} · ${car.partsFitted}/5 parts · chop value ${money(car.chopValue)}</div>
      </div>
      ${dntButtonHtml(car)}
    </div>
  `;
}

function renderStripBatchControls(): string {
  if (stripBatchState === 'running') {
    return renderRunningBatch(stripProgressText, stripProgressDone, stripProgressTotal, stripCancelRequested, 'Stop after this vehicle');
  }
  if (stripBatchState === 'confirming') {
    return `
      <div class="ff-gp-batch">
        <div class="ff-gp-batch-text">Strip ${stripSelected.size} selected vehicle${stripSelected.size === 1 ? '' : 's'} for parts? Every component native to them returns to your chop inventory, including any now fitted to your other vehicles — those cars will be unequipped until refilled. The bodies are kept.</div>
        <div class="ff-gp-batch-actions">
          <button class="ff-gp-batch-confirm" type="button">Confirm</button>
          <button class="ff-gp-batch-cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
  }
  return '';
}

function renderStripTab(): string {
  if (!catalog) return '<div class="ff-gp-empty">Loading garage…</div>';
  if (!catalog.cars.length) return '<div class="ff-gp-empty">No vehicles in your garage.</div>';

  const rows = catalog.cars.map(renderStripRow).join('');
  const eligibleCount = catalog.cars.filter(eligibleForStrip).length;
  const selectAllBtn = eligibleCount
    ? `<button class="ff-gp-select-all" type="button" ${stripBatchState !== 'idle' ? 'disabled' : ''}>Select All Strippable (${eligibleCount})</button>`
    : '';
  const stripBtn = stripSelected.size
    ? `<button class="ff-gp-batch-start" type="button" ${stripBatchState !== 'idle' ? 'disabled' : ''}>Strip ${stripSelected.size} Selected</button>`
    : '';
  const summaryHtml = stripSummary
    ? `<div class="ff-gp-batch-summary"><button class="ff-gp-batch-summary-close" type="button" title="Dismiss">✕</button>Strip batch ${stripSummary.stopped ? 'stopped' : 'finished'}: ${stripSummary.stripped} stripped, ${stripSummary.partsRemoved} parts removed${stripSummary.affected ? `, ${stripSummary.affected} other vehicle(s) unequipped` : ''}.${stripSummary.errors.length ? `<br>${stripSummary.errors.join('<br>')}` : ''}</div>`
    : '';

  return `
    <div class="ff-gp-toolbar">${selectAllBtn}${stripBtn}</div>
    ${renderStripBatchControls()}
    ${summaryHtml}
    <div class="ff-gp-list">${rows}</div>
  `;
}

async function runStripBatch(): Promise<void> {
  stripBatchState = 'running';
  stripCancelRequested = false;
  stripSummary = null;
  const ids = Array.from(stripSelected);
  const tally: StripSummary = { stripped: 0, partsRemoved: 0, affected: 0, errors: [], stopped: false };
  stripProgressTotal = ids.length;

  for (let i = 0; i < ids.length; i++) {
    if (stripCancelRequested) {
      tally.stopped = true;
      break;
    }
    const car = catalog?.cars.find((c) => c.id === ids[i]);
    stripProgressText = `Stripping ${car?.name ?? `vehicle ${ids[i]}`} — ${i + 1} of ${ids.length}…`;
    stripProgressDone = i;
    renderAll();
    try {
      const result = (await chrome.runtime.sendMessage({ type: 'garage-strip-requested', carId: ids[i] })) as {
        payout: number;
        partsRemoved: number;
        affected: number;
      };
      tally.stripped++;
      tally.partsRemoved += result.partsRemoved;
      tally.affected += result.affected;
      stripProgressDone = i + 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      tally.errors.push(`${car?.name ?? ids[i]}: ${message}`);
      if (looksSystemic(message)) {
        tally.stopped = true;
        break;
      }
    }
  }

  stripSelected.clear();
  stripBatchState = 'idle';
  stripSummary = tally;
  renderAll();
  await refresh();
}

function wireStripTab(): void {
  const body = panelEl?.querySelector('.ff-gp-body');
  if (!body) return;

  body.querySelectorAll<HTMLInputElement>('[data-strip-id]').forEach((el) => {
    el.addEventListener('change', () => {
      const id = Number(el.dataset.stripId);
      if (el.checked) stripSelected.add(id);
      else stripSelected.delete(id);
      renderAll();
    });
  });
  body.querySelectorAll<HTMLButtonElement>('[data-dnt-id]').forEach((el) => {
    el.addEventListener('click', () => void toggleDoNotTouch(Number(el.dataset.dntId)));
  });
  body.querySelector('.ff-gp-select-all')?.addEventListener('click', () => {
    catalog?.cars.filter(eligibleForStrip).forEach((c) => stripSelected.add(c.id));
    renderAll();
  });
  body.querySelector('.ff-gp-batch-start')?.addEventListener('click', () => {
    stripBatchState = 'confirming';
    renderAll();
  });
  body.querySelector('.ff-gp-batch-confirm')?.addEventListener('click', () => void runStripBatch());
  body.querySelector('.ff-gp-batch-cancel')?.addEventListener('click', () => {
    stripBatchState = 'idle';
    renderAll();
  });
  body.querySelector('.ff-gp-batch-stop')?.addEventListener('click', () => {
    stripCancelRequested = true;
    renderAll();
  });
  body.querySelector('.ff-gp-batch-summary-close')?.addEventListener('click', () => {
    stripSummary = null;
    renderAll();
  });
}

// =========================================================================
// Delete Bodies
// =========================================================================

function requestDeleteQuote(carId: number): void {
  if (deleteQuotes.has(carId)) return;
  deleteQuotes.set(carId, null);
  chrome.runtime
    .sendMessage({ type: 'garage-car-state-requested', carId })
    .then((state: unknown) => {
      const s = state as { bodyQuicksell: number };
      deleteQuotes.set(carId, s.bodyQuicksell);
      renderAll();
    })
    .catch((err) => {
      console.error(LOG_PREFIX, 'garage delete quote failed', err);
      deleteQuotes.delete(carId);
      renderAll();
    });
}

function renderDeleteRow(car: GarageCar): string {
  const eligible = eligibleForDelete(car);
  const protectedRow = isProtected(car);
  const checked = deleteSelected.has(car.id);
  const disabled = !eligible || deleteBatchState !== 'idle';
  const needsStrip = !isProtected(car) && car.modifiable && car.partsFitted > 0;
  const quote = deleteQuotes.get(car.id);
  const quoteHtml = checked ? (quote == null ? ' · loading value…' : ` · sells for ${money(quote)}`) : '';
  const stripTag = needsStrip ? '<span class="ff-gp-tag ff-gp-tag-strip-first">Strip first</span>' : '';
  // Reflects this row's real parts_fitted count — a protected (Do Not
  // Touch/Active) vehicle can easily still be 5/5, and previously this line
  // said "fully stripped" unconditionally for every row regardless of that,
  // which read as flatly wrong next to the Strip Parts tab showing the same
  // vehicle at 5/5.
  const partsLabel = car.partsFitted === 0 ? 'fully stripped' : `${car.partsFitted}/5 parts fitted`;

  return `
    <div class="ff-gp-row${protectedRow ? ' ff-gp-row-protected' : ''}" data-car-id="${car.id}">
      <input type="checkbox" class="ff-gp-row-check" data-delete-id="${car.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <div class="ff-gp-row-body">
        <div class="ff-gp-row-name">${car.name} ${protectionTag(car)} ${stripTag}</div>
        <div class="ff-gp-row-meta">${car.category} · ${partsLabel}${quoteHtml}</div>
      </div>
      ${dntButtonHtml(car)}
    </div>
  `;
}

function renderDeleteBatchControls(): string {
  if (deleteBatchState === 'running') {
    return renderRunningBatch(deleteProgressText, deleteProgressDone, deleteProgressTotal, deleteCancelRequested, 'Stop after this vehicle');
  }
  if (deleteBatchState === 'confirming') {
    const total = Array.from(deleteSelected).reduce((sum, id) => sum + (deleteQuotes.get(id) ?? 0), 0);
    return `
      <div class="ff-gp-batch">
        <div class="ff-gp-batch-text">Sell ${deleteSelected.size} vehicle body/bodies for a total of ${money(total)}? This is permanent — the vehicles are gone for good.</div>
        <div class="ff-gp-batch-actions">
          <button class="ff-gp-batch-confirm" type="button">Confirm</button>
          <button class="ff-gp-batch-cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
  }
  return '';
}

function renderDeleteTab(): string {
  if (!catalog) return '<div class="ff-gp-empty">Loading garage…</div>';
  const strippedCars = catalog.cars.filter((c) => c.modifiable);
  if (!strippedCars.length) return '<div class="ff-gp-empty">No modifiable vehicles in your garage.</div>';

  const rows = strippedCars.map(renderDeleteRow).join('');
  const eligibleCount = catalog.cars.filter(eligibleForDelete).length;
  const selectAllBtn = eligibleCount
    ? `<button class="ff-gp-select-all" type="button" ${deleteBatchState !== 'idle' ? 'disabled' : ''}>Select All Stripped (${eligibleCount})</button>`
    : '';
  const pendingQuotes = Array.from(deleteSelected).some((id) => deleteQuotes.get(id) == null);
  const deleteBtn = deleteSelected.size
    ? `<button class="ff-gp-batch-start" type="button" ${deleteBatchState !== 'idle' || pendingQuotes ? 'disabled' : ''}>Delete ${deleteSelected.size} Selected</button>`
    : '';
  const summaryHtml = deleteSummary
    ? `<div class="ff-gp-batch-summary"><button class="ff-gp-batch-summary-close" type="button" title="Dismiss">✕</button>Delete batch ${deleteSummary.stopped ? 'stopped' : 'finished'}: ${deleteSummary.sold} sold, ${money(deleteSummary.payout)} earned.${deleteSummary.errors.length ? `<br>${deleteSummary.errors.join('<br>')}` : ''}</div>`
    : '';

  return `
    <div class="ff-gp-note">Only fully-stripped vehicles (0 parts fitted) can be sold here — strip a vehicle on the Strip Parts tab first.</div>
    <div class="ff-gp-toolbar">${selectAllBtn}${deleteBtn}</div>
    ${renderDeleteBatchControls()}
    ${summaryHtml}
    <div class="ff-gp-list">${rows}</div>
  `;
}

async function runDeleteBatch(): Promise<void> {
  deleteBatchState = 'running';
  deleteCancelRequested = false;
  deleteSummary = null;
  const ids = Array.from(deleteSelected);
  const tally: DeleteSummary = { sold: 0, payout: 0, errors: [], stopped: false };
  deleteProgressTotal = ids.length;

  for (let i = 0; i < ids.length; i++) {
    if (deleteCancelRequested) {
      tally.stopped = true;
      break;
    }
    const car = catalog?.cars.find((c) => c.id === ids[i]);
    deleteProgressText = `Selling ${car?.name ?? `vehicle ${ids[i]}`} — ${i + 1} of ${ids.length}…`;
    deleteProgressDone = i;
    renderAll();
    try {
      const result = (await chrome.runtime.sendMessage({ type: 'garage-sell-body-requested', carId: ids[i] })) as { payout: number };
      tally.sold++;
      tally.payout += result.payout;
      deleteProgressDone = i + 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      tally.errors.push(`${car?.name ?? ids[i]}: ${message}`);
      if (looksSystemic(message)) {
        tally.stopped = true;
        break;
      }
    }
  }

  deleteSelected.clear();
  deleteQuotes.clear();
  deleteBatchState = 'idle';
  deleteSummary = tally;
  renderAll();
  await refresh();
}

function wireDeleteTab(): void {
  const body = panelEl?.querySelector('.ff-gp-body');
  if (!body) return;

  body.querySelectorAll<HTMLInputElement>('[data-delete-id]').forEach((el) => {
    el.addEventListener('change', () => {
      const id = Number(el.dataset.deleteId);
      if (el.checked) {
        deleteSelected.add(id);
        requestDeleteQuote(id);
      } else {
        deleteSelected.delete(id);
      }
      renderAll();
    });
  });
  body.querySelectorAll<HTMLButtonElement>('[data-dnt-id]').forEach((el) => {
    el.addEventListener('click', () => void toggleDoNotTouch(Number(el.dataset.dntId)));
  });
  body.querySelector('.ff-gp-select-all')?.addEventListener('click', () => {
    catalog?.cars.filter(eligibleForDelete).forEach((c) => {
      deleteSelected.add(c.id);
      requestDeleteQuote(c.id);
    });
    renderAll();
  });
  body.querySelector('.ff-gp-batch-start')?.addEventListener('click', () => {
    deleteBatchState = 'confirming';
    renderAll();
  });
  body.querySelector('.ff-gp-batch-confirm')?.addEventListener('click', () => void runDeleteBatch());
  body.querySelector('.ff-gp-batch-cancel')?.addEventListener('click', () => {
    deleteBatchState = 'idle';
    renderAll();
  });
  body.querySelector('.ff-gp-batch-stop')?.addEventListener('click', () => {
    deleteCancelRequested = true;
    renderAll();
  });
  body.querySelector('.ff-gp-batch-summary-close')?.addEventListener('click', () => {
    deleteSummary = null;
    renderAll();
  });
}

// =========================================================================
// Fit Parts
// =========================================================================

/** Builds the exact plan a confirmed Fit Parts run will execute — fetches a
 *  fresh loose-parts inventory, then for every vehicle: reads its real
 *  `missing` slot list (a `partsFitted` count alone can't say *which* slots
 *  are empty), and either queues a free `migrate` (a chassis that predates
 *  the component system) or, for each missing slot, removes one random
 *  non-locked candidate from a local copy of that slot's pool and queues an
 *  `install` for it. The local pool copy is what stops the same physical
 *  part from being planned into two different vehicles in a multi-vehicle
 *  run — nothing here talks to the server beyond the read calls; the plan
 *  itself is pure client-side bookkeeping until the player confirms it. */
async function buildFitPlan(carIds: number[]): Promise<FitPlan> {
  const inventory = (await chrome.runtime.sendMessage({ type: 'garage-inventory-requested' })) as GaragePartsInventory;
  const pool: Record<GarageSlotKey, { userPartId: number; name: string; installFee: number }[]> = {
    engine: [],
    transmission: [],
    tires: [],
    suspension: [],
    aerodynamics: [],
  };
  for (const slot of SLOT_KEYS) {
    pool[slot] = inventory[slot].filter((p) => !p.locked).map((p) => ({ userPartId: p.userPartId, name: p.name, installFee: p.installFee }));
  }

  const steps: FitPlanStep[] = [];
  const migrateCarIds: { id: number; name: string }[] = [];
  const shortfalls: string[] = [];
  let totalCost = 0;

  for (const carId of carIds) {
    const carName = catalog?.cars.find((c) => c.id === carId)?.name ?? `vehicle ${carId}`;
    let state: { migrated: boolean; missing: GarageSlotKey[] };
    try {
      state = (await chrome.runtime.sendMessage({ type: 'garage-car-state-requested', carId })) as { migrated: boolean; missing: GarageSlotKey[] };
    } catch (err) {
      shortfalls.push(`${carName}: could not read its current state (${err instanceof Error ? err.message : String(err)}).`);
      continue;
    }

    if (!state.migrated) {
      migrateCarIds.push({ id: carId, name: carName });
      continue;
    }

    for (const slot of state.missing) {
      const candidates = pool[slot];
      if (!candidates.length) {
        shortfalls.push(`No spare ${SLOT_LABELS[slot]} for ${carName}.`);
        continue;
      }
      const idx = Math.floor(Math.random() * candidates.length);
      const part = candidates.splice(idx, 1)[0];
      steps.push({ carId, carName, slot, partId: part.userPartId, partName: part.name, installFee: part.installFee });
      totalCost += part.installFee;
    }
  }

  return { steps, migrateCarIds, totalCost, shortfalls };
}

async function startFitPlanning(carIds: number[]): Promise<void> {
  if (!carIds.length) return;
  fitBatchState = 'planning';
  fitPlan = null;
  fitSummary = null;
  fitProgressText = 'Checking spare parts and vehicle state…';
  renderAll();
  try {
    fitPlan = await buildFitPlan(carIds);
    fitBatchState = 'confirming';
  } catch (err) {
    fitBatchState = 'idle';
    fitSummary = { fitted: 0, migrated: 0, spent: 0, errors: [err instanceof Error ? err.message : String(err)], stopped: true };
  }
  renderAll();
}

type FitAction = { kind: 'migrate'; carId: number; carName: string } | (FitPlanStep & { kind: 'install' });

async function runFitBatch(): Promise<void> {
  if (!fitPlan) return;
  const plan = fitPlan;

  fitBatchState = 'running';
  fitCancelRequested = false;
  fitSummary = null;
  fitProgressText = 'Confirming cash on hand…';
  fitProgressDone = 0;
  fitProgressTotal = 0;
  renderAll();

  if (plan.totalCost > 0) {
    const cashOnHand = (await chrome.runtime.sendMessage({ type: 'garage-cash-requested' })) as number;
    if (cashOnHand < plan.totalCost) {
      fitBatchState = 'idle';
      fitPlan = null;
      fitSummary = {
        fitted: 0,
        migrated: 0,
        spent: 0,
        errors: [`Only ${money(cashOnHand)} on hand now — needed ${money(plan.totalCost)}. Nothing was fitted.`],
        stopped: true,
      };
      renderAll();
      return;
    }
  }

  const actions: FitAction[] = [
    ...plan.migrateCarIds.map((m) => ({ kind: 'migrate' as const, carId: m.id, carName: m.name })),
    ...plan.steps.map((s) => ({ ...s, kind: 'install' as const })),
  ];
  const tally: FitSummary = { fitted: 0, migrated: 0, spent: 0, errors: [], stopped: false };
  fitProgressTotal = actions.length;

  for (let i = 0; i < actions.length; i++) {
    if (fitCancelRequested) {
      tally.stopped = true;
      break;
    }
    const action = actions[i];
    fitProgressText =
      action.kind === 'migrate'
        ? `Installing native parts on ${action.carName} (free) — ${i + 1} of ${actions.length}…`
        : `Fitting ${action.partName} into ${action.carName}'s ${SLOT_LABELS[action.slot]} — ${i + 1} of ${actions.length}…`;
    fitProgressDone = i;
    renderAll();
    try {
      if (action.kind === 'migrate') {
        await chrome.runtime.sendMessage({ type: 'garage-migrate-requested', carId: action.carId });
        tally.migrated++;
      } else {
        await chrome.runtime.sendMessage({ type: 'garage-install-requested', carId: action.carId, partId: action.partId });
        tally.fitted++;
        tally.spent += action.installFee;
      }
      fitProgressDone = i + 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const label = action.kind === 'migrate' ? action.carName : `${action.carName} (${SLOT_LABELS[action.slot]})`;
      tally.errors.push(`${label}: ${message}`);
      if (looksSystemic(message) || looksLikeInsufficientFunds(message)) {
        tally.stopped = true;
        break;
      }
    }
  }

  fitBulkSelected.clear();
  fitPlan = null;
  fitBatchState = 'idle';
  fitSummary = tally;
  renderAll();
  await refresh();
}

function renderFitPlanControls(): string {
  if (fitBatchState === 'planning') {
    return renderIndeterminateBatch(fitProgressText);
  }

  if (fitBatchState === 'confirming' && fitPlan) {
    const plan = fitPlan;
    const shortfallHtml = plan.shortfalls.length ? `<div class="ff-gp-shortfalls">${plan.shortfalls.join('<br>')}</div>` : '';
    const nothingToDo = !plan.steps.length && !plan.migrateCarIds.length;

    if (nothingToDo) {
      return `
        <div class="ff-gp-batch">
          <div class="ff-gp-batch-text">Nothing to fit — no compatible spare parts are available for the selected vehicle(s) right now.</div>
          ${shortfallHtml}
          <div class="ff-gp-batch-actions"><button class="ff-gp-batch-cancel" type="button" id="ffGpFitCancel">Close</button></div>
        </div>
      `;
    }

    const parts: string[] = [];
    if (plan.steps.length) parts.push(`${plan.steps.length} part${plan.steps.length === 1 ? '' : 's'} for ${money(plan.totalCost)}`);
    if (plan.migrateCarIds.length) parts.push(`${plan.migrateCarIds.length} vehicle${plan.migrateCarIds.length === 1 ? '' : 's'} getting free native parts installed`);

    return `
      <div class="ff-gp-batch">
        <div class="ff-gp-batch-text">Fit ${parts.join(' and ')}? This cannot be undone.</div>
        ${shortfallHtml}
        <div class="ff-gp-batch-actions">
          <button class="ff-gp-batch-confirm" type="button" id="ffGpFitConfirm">Confirm</button>
          <button class="ff-gp-batch-cancel" type="button" id="ffGpFitCancel">Cancel</button>
        </div>
      </div>
    `;
  }

  if (fitBatchState === 'running') {
    return renderRunningBatch(fitProgressText, fitProgressDone, fitProgressTotal, fitCancelRequested, 'Stop after this part');
  }

  return '';
}

function renderFitSummary(): string {
  if (!fitSummary) return '';
  const parts = [`${fitSummary.fitted} part(s) fitted`, `${money(fitSummary.spent)} spent`];
  if (fitSummary.migrated) parts.push(`${fitSummary.migrated} vehicle(s) given free native parts`);
  return `<div class="ff-gp-batch-summary"><button class="ff-gp-batch-summary-close" type="button" id="ffGpFitSummaryClose" title="Dismiss">✕</button>Fit batch ${fitSummary.stopped ? 'stopped' : 'finished'}: ${parts.join(', ')}.${fitSummary.errors.length ? `<br>${fitSummary.errors.join('<br>')}` : ''}</div>`;
}

function renderFitSingleSection(): string {
  const candidates = (catalog?.cars ?? []).filter(eligibleForFitSingle);
  const disabled = fitBatchState !== 'idle';
  if (!candidates.length) {
    return '<div class="ff-gp-subsection"><div class="ff-gp-subhead">Auto-Fit a Vehicle</div><div class="ff-gp-empty">No vehicles with empty slots.</div></div>';
  }

  const options = candidates
    .map((c) => `<option value="${c.id}" ${c.id === fitSingleCarId ? 'selected' : ''}>${c.name} — ${c.partsFitted}/5 parts</option>`)
    .join('');

  return `
    <div class="ff-gp-subsection">
      <div class="ff-gp-subhead">Auto-Fit a Vehicle</div>
      <select class="ff-gp-select" id="ffGpFitSingle" ${disabled ? 'disabled' : ''}>${options}</select>
      <button class="ff-gp-batch-start" type="button" id="ffGpFitSingleGo" style="margin-top:8px;width:100%;" ${disabled ? 'disabled' : ''}>Auto-Fit This Vehicle</button>
    </div>
  `;
}

function renderFitBulkSection(): string {
  const candidates = (catalog?.cars ?? []).filter(eligibleForFitBulk);
  const disabled = fitBatchState !== 'idle';
  const rows = candidates
    .map(
      (c) => `
      <div class="ff-gp-row" data-car-id="${c.id}">
        <input type="checkbox" class="ff-gp-row-check" data-fit-bulk-id="${c.id}" ${fitBulkSelected.has(c.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <div class="ff-gp-row-body">
          <div class="ff-gp-row-name">${c.name}</div>
          <div class="ff-gp-row-meta">${c.category} · 0/5 parts</div>
        </div>
      </div>
    `,
    )
    .join('');
  const selectAllBtn = candidates.length
    ? `<button class="ff-gp-select-all" type="button" id="ffGpFitSelectAll" ${disabled ? 'disabled' : ''}>Select All Empty (${candidates.length})</button>`
    : '';
  const goBtn = fitBulkSelected.size
    ? `<button class="ff-gp-batch-start" type="button" id="ffGpFitBulkGo" ${disabled ? 'disabled' : ''}>Auto-Fit ${fitBulkSelected.size} Selected</button>`
    : '';

  return `
    <div class="ff-gp-subsection">
      <div class="ff-gp-subhead">Auto-Fit Multiple Empty Vehicles</div>
      ${candidates.length ? '' : '<div class="ff-gp-empty">No vehicles with 0 parts fitted.</div>'}
      <div class="ff-gp-toolbar">${selectAllBtn}${goBtn}</div>
      <div class="ff-gp-list">${rows}</div>
    </div>
  `;
}

function renderFitTab(): string {
  if (!catalog) return '<div class="ff-gp-empty">Loading garage…</div>';
  return `
    ${renderFitPlanControls()}
    ${renderFitSummary()}
    ${renderFitSingleSection()}
    ${renderFitBulkSection()}
  `;
}

function wireFitTab(): void {
  const body = panelEl?.querySelector('.ff-gp-body');
  if (!body) return;

  body.querySelector('#ffGpFitSingle')?.addEventListener('change', (e) => {
    fitSingleCarId = Number((e.target as HTMLSelectElement).value);
  });
  body.querySelector('#ffGpFitSingleGo')?.addEventListener('click', () => {
    if (fitSingleCarId != null) void startFitPlanning([fitSingleCarId]);
  });

  body.querySelectorAll<HTMLInputElement>('[data-fit-bulk-id]').forEach((el) => {
    el.addEventListener('change', () => {
      const id = Number(el.dataset.fitBulkId);
      if (el.checked) fitBulkSelected.add(id);
      else fitBulkSelected.delete(id);
      renderAll();
    });
  });
  body.querySelector('#ffGpFitSelectAll')?.addEventListener('click', () => {
    catalog?.cars.filter(eligibleForFitBulk).forEach((c) => fitBulkSelected.add(c.id));
    renderAll();
  });
  body.querySelector('#ffGpFitBulkGo')?.addEventListener('click', () => {
    void startFitPlanning(Array.from(fitBulkSelected));
  });

  body.querySelector('#ffGpFitConfirm')?.addEventListener('click', () => void runFitBatch());
  body.querySelector('#ffGpFitCancel')?.addEventListener('click', () => {
    fitBatchState = 'idle';
    fitPlan = null;
    renderAll();
  });
  body.querySelector('.ff-gp-batch-stop')?.addEventListener('click', () => {
    fitCancelRequested = true;
    renderAll();
  });
  body.querySelector('#ffGpFitSummaryClose')?.addEventListener('click', () => {
    fitSummary = null;
    renderAll();
  });
}

// =========================================================================
// Shell (tabs, badge, panel)
// =========================================================================

function renderHeaderLine(): string {
  if (!catalog) return '';
  return `<div class="ff-gp-cash-line">Cash on hand: <strong>${money(catalog.cash)}</strong></div>`;
}

function renderBody(): void {
  if (!panelEl) return;
  const bodyEl = panelEl.querySelector('.ff-gp-body');
  if (!bodyEl) return;

  if (loadError) {
    bodyEl.innerHTML = `<div class="ff-gp-error">${loadError}</div>`;
    return;
  }

  const tabContent =
    activeTab === 'buy' ? renderBuyTab() : activeTab === 'strip' ? renderStripTab() : activeTab === 'delete' ? renderDeleteTab() : renderFitTab();
  bodyEl.innerHTML = renderHeaderLine() + tabContent;

  if (activeTab === 'buy') wireBuyTab();
  else if (activeTab === 'strip') wireStripTab();
  else if (activeTab === 'delete') wireDeleteTab();
  else wireFitTab();
}

function renderTabs(): void {
  if (!panelEl) return;
  panelEl.querySelectorAll<HTMLButtonElement>('.ff-gp-tab').forEach((btn) => {
    btn.classList.toggle('ff-gp-tab-on', btn.dataset.tab === activeTab);
  });
}

function renderAll(): void {
  renderTabs();
  renderBody();
}

async function refresh(): Promise<void> {
  try {
    catalog = (await chrome.runtime.sendMessage({ type: 'garage-catalog-requested' })) as GarageCatalog;
    loadError = null;
    // Defaults the Bulk Buy dropdown to its first real option as soon as
    // there's a catalog to pick from — without this, `buySelectedModelId`
    // stays `null` (nothing has fired the <select>'s own 'change' event
    // yet) while the freshly-rendered <select> already visually shows its
    // first option selected, so "Check Cash"/"Buy" would silently no-op
    // against a listing lookup that finds nothing until the player happens
    // to touch the dropdown themselves.
    if (buySelectedModelId == null || !buyableDealer().some((d) => d.id === buySelectedModelId)) {
      buySelectedModelId = buyableDealer()[0]?.id ?? null;
    }
    // Same reasoning as the Bulk Buy default above, for the Fit Parts
    // single-vehicle dropdown.
    if (fitSingleCarId == null || !catalog.cars.some((c) => c.id === fitSingleCarId && eligibleForFitSingle(c))) {
      fitSingleCarId = catalog.cars.find(eligibleForFitSingle)?.id ?? null;
    }
  } catch (err) {
    loadError = 'Could not load the garage — open the panel in-game once, then try again.';
    console.error(LOG_PREFIX, 'garage catalog refresh failed', err);
  }
  renderAll();
}

function setExpanded(next: boolean): void {
  expanded = next;
  panelEl?.classList.toggle('ff-gp-expanded', expanded);
  if (expanded) void refresh();
}

function setTab(tab: Tab): void {
  activeTab = tab;
  renderAll();
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.innerHTML = `
    <button class="ff-gp-badge" type="button">
      ${brandBadgeHtml('Garage & Dealership')}
      <span class="ff-gp-badge-label">Garage Tools</span>
    </button>
    <div class="ff-gp-panel">
      <div class="ff-gp-head">
        ${brandBadgeHtml('Garage & Dealership')}
        <button class="ff-gp-close" type="button" title="Collapse">✕</button>
      </div>
      <div class="ff-gp-tabs">
        <button class="ff-gp-tab" type="button" data-tab="buy">Bulk Buy</button>
        <button class="ff-gp-tab" type="button" data-tab="strip">Strip Parts</button>
        <button class="ff-gp-tab" type="button" data-tab="delete">Delete Bodies</button>
        <button class="ff-gp-tab" type="button" data-tab="fit">Fit Parts</button>
      </div>
      <div class="ff-gp-body"><div class="ff-gp-empty">Loading garage…</div></div>
    </div>
  `;

  el.querySelector('.ff-gp-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-gp-close')?.addEventListener('click', () => setExpanded(false));
  el.querySelectorAll<HTMLButtonElement>('.ff-gp-tab').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab as Tab));
  });

  return el;
}

function updateVisibility(): void {
  if (!panelEl) return;
  const visible = document.querySelector(PAGE_MARKER) != null;
  panelEl.classList.toggle('ff-gp-visible', visible);
  if (!visible && expanded) setExpanded(false);
}

const PANEL_CSS = `
#${CONTAINER_ID} {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif;
  display: none;
}
#${CONTAINER_ID}.ff-gp-visible { display: block; }

.ff-gp-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: linear-gradient(180deg, rgba(20,20,28,0.96), rgba(10,10,15,0.96));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 999px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.ff-gp-badge:hover { border-color: rgba(201,168,76,0.8); transform: translateY(-1px); }
.ff-gp-badge-label { font-size: 10.5px; color: #d9c48a; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }

.ff-gp-panel {
  display: none;
  width: 400px;
  /* Anchored only from the bottom (the container's own bottom: 20px),
     growing upward with content — a flat 78vh cap still let the top edge
     land flush against the viewport's top on a shorter window or a tab
     with enough content (four tabs plus a batch summary routinely exceeds
     78% of a ~700px-tall window), with none of the 20px breathing room the
     container already keeps on every other side. Capping at
     100vh - 40px guarantees that same 20px gap at the top too, whichever
     of the two limits ends up smaller. */
  max-height: min(78vh, calc(100vh - 40px));
  overflow-y: auto;
  padding: 16px;
  background: linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 14px;
  box-shadow: 0 10px 34px rgba(0,0,0,0.6);
  color: #ccc;
}
#${CONTAINER_ID}.ff-gp-expanded .ff-gp-panel { display: block; }
#${CONTAINER_ID}.ff-gp-expanded .ff-gp-badge { display: none; }

.ff-gp-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
.ff-gp-close { background: none; border: none; color: #8b8f9e; font-size: 16px; line-height: 1; cursor: pointer; padding: 2px 6px; }
.ff-gp-close:hover { color: #fff; }

.ff-gp-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
.ff-gp-tab {
  flex: 1; padding: 7px 4px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px; color: #9ca3af; font-size: 9px; font-weight: 800; letter-spacing: 0.01em; cursor: pointer;
}
.ff-gp-tab:hover { color: #ccc; }
.ff-gp-tab-on { background: rgba(212,175,55,0.18); border-color: rgba(212,175,55,0.5); color: #fbbf24; }

.ff-gp-empty { font-size: 10.5px; color: #6b6455; padding: 4px 0; }
.ff-gp-error {
  padding: 8px 10px; margin-bottom: 10px; font-size: 10px; line-height: 1.5;
  background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.3);
  border-radius: 7px; color: #fca5a5;
}
.ff-gp-note { font-size: 9.5px; color: #8b8578; line-height: 1.5; margin-bottom: 10px; }
.ff-gp-cash-line { font-size: 10px; color: #9ca3af; margin-bottom: 10px; }
.ff-gp-cash-line strong { color: #d9c48a; }

.ff-gp-label { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #7d7466; margin: 8px 0 4px; }
.ff-gp-select, .ff-gp-qty {
  width: 100%; padding: 7px 9px; border-radius: 7px; background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.14); color: #eee; font-size: 11px;
}
.ff-gp-total { margin-top: 10px; font-size: 11px; color: #ccc; }
.ff-gp-total strong { color: #fbbf24; }
.ff-gp-cash-ok { margin-top: 8px; font-size: 10px; color: #4ade80; line-height: 1.5; }
.ff-gp-cash-short { margin-top: 8px; font-size: 10px; color: #f87171; line-height: 1.5; }
.ff-gp-buy-actions { display: flex; gap: 8px; margin-top: 12px; }
.ff-gp-buy-actions button {
  flex: 1; padding: 8px 10px; border-radius: 8px; font-size: 10px; font-weight: 800;
  letter-spacing: 0.02em; cursor: pointer; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.16); color: #ccc;
}
.ff-gp-buy-go { background: rgba(212,175,55,0.28) !important; border-color: rgba(212,175,55,0.55) !important; color: #fbbf24 !important; }
.ff-gp-buy-actions button:disabled { opacity: 0.4; cursor: default; }

.ff-gp-toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.ff-gp-select-all, .ff-gp-batch-start {
  padding: 7px 12px; border-radius: 8px; font-size: 10px; font-weight: 800; letter-spacing: 0.02em; cursor: pointer;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.16); color: #ccc;
}
.ff-gp-batch-start { background: rgba(212,175,55,0.28); border-color: rgba(212,175,55,0.55); color: #fbbf24; }
.ff-gp-select-all:disabled, .ff-gp-batch-start:disabled { opacity: 0.4; cursor: default; }

.ff-gp-batch {
  padding: 9px 10px; margin-bottom: 12px;
  background: rgba(212,175,55,0.06); border: 1px solid rgba(212,175,55,0.28);
  border-radius: 9px;
}
.ff-gp-batch-text { font-size: 10px; color: #d9c48a; line-height: 1.5; }
.ff-gp-batch-actions { display: flex; gap: 8px; margin-top: 8px; }
.ff-gp-batch-actions button {
  flex: 1; padding: 6px 10px; border-radius: 7px; font-size: 10px; font-weight: 800;
  letter-spacing: 0.03em; cursor: pointer;
}
.ff-gp-batch-confirm { background: rgba(212,175,55,0.32); border: 1px solid rgba(212,175,55,0.6); color: #fbbf24; }
.ff-gp-batch-cancel, .ff-gp-batch-stop {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.14); color: #ccc;
}
.ff-gp-batch-summary {
  padding: 8px 10px; margin-bottom: 12px; font-size: 10px; line-height: 1.5;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 7px; color: #ccc;
}
.ff-gp-batch-summary-close { float: right; background: none; border: none; color: #6b6455; cursor: pointer; font-size: 12px; }

.ff-gp-list { display: flex; flex-direction: column; gap: 6px; }
.ff-gp-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 9px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
}
.ff-gp-row-protected { opacity: 0.55; }
.ff-gp-row-check { flex-shrink: 0; }
.ff-gp-row-body { flex: 1; min-width: 0; }
.ff-gp-row-name { font-size: 10.5px; font-weight: 700; color: #f1ede2; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ff-gp-row-meta { font-size: 9px; color: #8b8578; margin-top: 2px; }

.ff-gp-tag {
  font-size: 8px; font-weight: 800; letter-spacing: 0.03em; padding: 1px 6px; border-radius: 999px; text-transform: uppercase;
}
.ff-gp-tag-active { background: rgba(96,165,250,0.18); border: 1px solid rgba(96,165,250,0.4); color: #93c5fd; }
.ff-gp-tag-dnt { background: rgba(239,68,68,0.16); border: 1px solid rgba(239,68,68,0.35); color: #fca5a5; }
.ff-gp-tag-strip-first { background: rgba(251,191,36,0.14); border: 1px solid rgba(251,191,36,0.35); color: #fbbf24; }

.ff-gp-dnt-btn {
  flex-shrink: 0; padding: 5px 9px; border-radius: 7px; font-size: 9px; font-weight: 700;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.14); color: #9ca3af; cursor: pointer;
  white-space: nowrap;
}
.ff-gp-dnt-btn:hover { border-color: rgba(255,255,255,0.3); color: #ccc; }
.ff-gp-dnt-on { background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.4); color: #fca5a5; }

/* Spinner + determinate progress bar shown for the whole duration of every
   running batch (all four tools) — see the module doc's "physical loading"
   paragraph. */
.ff-gp-batch-text { display: flex; align-items: center; gap: 8px; }
.ff-gp-spinner {
  flex-shrink: 0; width: 11px; height: 11px; border-radius: 50%;
  border: 2px solid rgba(212,175,55,0.25); border-top-color: #fbbf24;
  animation: ff-gp-spin 0.7s linear infinite;
}
@keyframes ff-gp-spin { to { transform: rotate(360deg); } }
.ff-gp-progress-track { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.08); margin-top: 8px; overflow: hidden; }
.ff-gp-progress-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, rgba(212,175,55,0.5), rgba(251,191,36,0.95)); transition: width 0.2s ease; }
.ff-gp-progress-label { font-size: 9px; color: #8b8578; margin-top: 4px; }

.ff-gp-subsection { margin-top: 4px; margin-bottom: 16px; }
.ff-gp-subsection:last-child { margin-bottom: 0; }
.ff-gp-subhead { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #d9c48a; margin-bottom: 8px; }
.ff-gp-shortfalls { margin-top: 8px; font-size: 9.5px; color: #f0b23a; line-height: 1.6; }
`;

export function initGarageOverlay(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + PANEL_CSS);

  storage.getGarageDoNotTouch().then((ids) => {
    doNotTouch = new Set(ids);
    if (expanded) renderAll();
  });

  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);
  updateVisibility();

  // Same "page swaps panel content via innerHTML, no navigation" reasoning
  // as streetRacing/overlay.ts's own visibility watch.
  const observer = new MutationObserver(() => updateVisibility());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}
