import type { CapturedRequest } from '@/shared/messaging';
import { STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { InventoryPriceResult, QuickSellPriceBook } from '@/shared/types';
import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { isQuickSellable, activeInventoryBatch, beginInventoryBatch, endInventoryBatch } from './shared';

/**
 * Inventory quick-sell total: what every item currently on screen would
 * quick-sell for, following whatever tab, filter chip, rarity and search the
 * player has picked, plus a price tag on each card.
 *
 * The inventory page carries no prices at all. A card's $ button opens the
 * Item Market's sell sheet (`IMV2.sellSheet`, since 2026-10-11), which reads
 * `GET /actions/item_market_v2.php?view=sell&inv_id=N` (shop price in
 * `item.base`) and then quotes it (`POST /actions/shops_v2.php
 * action=dispose_quote`), one item per tap. Prices come from (see
 * `QuickSellPriceBook`):
 *
 * - **Estimate, 20% of shop price.** Checked against every captured quote
 *   (2026-08-11 → 2026-09-28): 42 of the 44 quotes for non-Crime-Req items
 *   were exactly 20% of that item's shop price, upgrade level (+1…+5)
 *   making no difference; 6 of 7 on 2026-10-11 against the new sheet's
 *   `base` too. The exceptions (Enforcer's Chain Belt at 15%, Broker's
 *   Gloves at 8.4%, Bandolier at 2%) fit nothing found so far; shop prices
 *   also drift over time, so an estimate is shown with "≈".
 * - **Real quotes.** Every `dispose_quote` the game sends is kept and wins
 *   over the estimate, for that item and for every other copy of it (same
 *   name; upgrade level doesn't change the price).
 * - **Fetch prices.** A button on the bar that taps $ for the player on
 *   every item still without an exact quote: one copy per name, best rarity
 *   first, in runs of 10 at about one item a second with a few seconds'
 *   break between runs, so it reads like someone clicking through their
 *   inventory by hand. Manual start only, stoppable, and it picks up where
 *   it left off (anything already quoted is skipped).
 *
 * Crime Req items (`data-crime="1"`) get their quote cut when they're tied
 * to a crime the player needs (`capstone_warning` in the quote): 2% of shop
 * price for Brass Knuckles and Gold Rope Chain, 10% for The Iron Curtain.
 * No rule for which applies was found, so they're totalled on their own
 * line as a 2–10% range.
 *
 * Only equipment is counted (`isQuickSellable`): locked cards have no $
 * button, and consumables, which have one since the 2026-10-11 rebuild, are
 * left out on purpose. Equipped gear isn't an `.inv-card` at all.
 */

const SEARCH_INPUT_ID = 'invSearch';
// Every card, not just `[data-inv]` ones: consumable cards carried no id
// before 2026-10-11, but still count as "shown" for the bar's empty-state
// wording.
const CARD_SELECTOR = '.inv-card';
const BAR_ID = 'ff-qs-bar';
const TAG_CLASS = 'ff-qs-tag';
const STYLE_ID = 'ff-qs-style';

const QUICKSELL_SHARE = 0.2;
const CRIME_SHARE_LOW = 0.02;
const CRIME_SHARE_HIGH = 0.1;
// Keeps the stored book from growing forever as items are sold off; far above
// this account's ~460 inventory items.
const MAX_ENTRIES_PER_MAP = 4000;

let book: QuickSellPriceBook = { shopByInv: {}, shopByName: {}, quotes: {}, quotesByName: {} };

// One read-modify-write at a time, so a shop price and a quote
// landing together can't overwrite each other's entries.
let writeChain: Promise<void> = Promise.resolve();

function prune<T extends { at: number }>(map: Record<string, T>): Record<string, T> {
  const keys = Object.keys(map);
  if (keys.length <= MAX_ENTRIES_PER_MAP) return map;
  keys.sort((a, b) => map[b].at - map[a].at);
  return Object.fromEntries(keys.slice(0, MAX_ENTRIES_PER_MAP).map((k) => [k, map[k]]));
}

function updateBook(mutate: (b: QuickSellPriceBook) => boolean): void {
  writeChain = writeChain
    .then(async () => {
      const current = await storage.getQuickSellPriceBook();
      if (!mutate(current)) return;
      book = {
        shopByInv: prune(current.shopByInv),
        shopByName: prune(current.shopByName),
        quotes: prune(current.quotes),
        quotesByName: prune(current.quotesByName),
      };
      await storage.setQuickSellPriceBook(book);
    })
    .catch((err) => console.error(LOG_PREFIX, 'quick-sell price book write failed', err));
}

/** Keeps the shop price and real payout from every sell sheet the game
 *  itself opens when the player taps a $ button. */
export function handleCapturedRequest(req: CapturedRequest): void {
  if (req.method === 'GET' && req.url.includes('/actions/item_market_v2.php')) {
    handleSellSheet(req);
    return;
  }
  if (req.method !== 'POST' || !req.url.includes('/actions/shops_v2.php')) return;
  const params = new URLSearchParams(req.requestBody ?? '');
  if (params.get('action') !== 'dispose_quote') return;
  const invId = params.get('inv_id');
  if (!invId) return;

  let data: any;
  try {
    data = JSON.parse(req.responseText);
  } catch {
    return;
  }
  if (data?.ok !== true || typeof data.cash !== 'number') return;

  recordQuote(invId, typeof data.name === 'string' ? data.name : '', data.cash);
}

/** Stores one real `dispose_quote` payout in the price book. Also called by
 *  the Auto-Sell panel for quotes background sends on its behalf, which
 *  never pass through the page's own network hook. */
export function recordQuote(invId: string, itemName: string, cash: number): void {
  const name = itemName.toLowerCase();
  updateBook((b) => {
    const now = Date.now();
    let changed = false;
    if (b.quotes[invId]?.cash !== cash) {
      b.quotes[invId] = { cash, at: now };
      changed = true;
    }
    if (name && b.quotesByName[name]?.cash !== cash) {
      b.quotesByName[name] = { cash, at: now };
      changed = true;
    }
    return changed;
  });
}

function handleSellSheet(req: CapturedRequest): void {
  let url: URL;
  try {
    url = new URL(req.url, window.location.origin);
  } catch {
    return;
  }
  if (url.searchParams.get('view') !== 'sell') return;
  let data: any;
  try {
    data = JSON.parse(req.responseText);
  } catch {
    return;
  }
  if (data?.ok !== true || typeof data.item?.base !== 'number' || typeof data.item?.name !== 'string' || data.stack?.inv_id == null) return;
  recordShopPrice(String(data.stack.inv_id), data.item.name, data.item.base);
}

/** Stores one shop price (the sell sheet's `item.base`). */
export function recordShopPrice(invId: string, itemName: string, price: number): void {
  if (!(price > 0)) return;
  const name = itemName.toLowerCase();
  updateBook((b) => {
    const now = Date.now();
    let changed = false;
    if (b.shopByInv[invId]?.price !== price) {
      b.shopByInv[invId] = { price, at: now };
      changed = true;
    }
    if (name && b.shopByName[name]?.price !== price) {
      b.shopByName[name] = { price, at: now };
      changed = true;
    }
    return changed;
  });
}

export type CardPrice =
  | { kind: 'quote'; cash: number }
  | { kind: 'shared-quote'; cash: number }
  | { kind: 'estimate'; cash: number }
  | { kind: 'crime-range'; low: number; high: number }
  | { kind: 'unknown' };

/** What `card` should quick-sell for, from `b` (this module's own copy of
 *  the price book unless another feature passes its own). */
export function priceFor(card: Element, b: QuickSellPriceBook = book): CardPrice {
  const inv = card.getAttribute('data-inv') ?? '';
  const quote = b.quotes[inv];
  if (quote) return { kind: 'quote', cash: quote.cash };
  const name = card.getAttribute('data-name') ?? '';
  const sharedQuote = b.quotesByName[name];
  if (sharedQuote) return { kind: 'shared-quote', cash: sharedQuote.cash };

  const shop = b.shopByInv[inv] ?? b.shopByName[name];
  if (!shop) return { kind: 'unknown' };
  if (card.getAttribute('data-crime') === '1') {
    return { kind: 'crime-range', low: Math.round(shop.price * CRIME_SHARE_LOW), high: Math.round(shop.price * CRIME_SHARE_HIGH) };
  }
  return { kind: 'estimate', cash: Math.round(shop.price * QUICKSELL_SHARE) };
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function compactMoney(n: number): string {
  // Only zeros after a decimal point are trimmed: "990" (from 990K) must
  // stay "990", not lose its last digit and read as 99K.
  const trim = (v: number) => {
    const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
    return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  };
  if (n >= 1e9) return `$${trim(n / 1e9)}B`;
  if (n >= 1e6) return `$${trim(n / 1e6)}M`;
  if (n >= 1e3) return `$${trim(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

function tagFor(price: CardPrice): { text: string; title: string; kind: string } {
  switch (price.kind) {
    case 'quote':
      return { text: `Quick sell ${compactMoney(price.cash)}`, title: `${money(price.cash)}, the game's own quote for this item.`, kind: 'exact' };
    case 'shared-quote':
      return {
        text: `Quick sell ${compactMoney(price.cash)}`,
        title: `${money(price.cash)}, the game's own quote for another copy of this item (every copy sells for the same).`,
        kind: 'exact',
      };
    case 'estimate':
      return { text: `Quick sell ≈ ${compactMoney(price.cash)}`, title: `About ${money(price.cash)}: 20% of this item's shop price. Tap $ for the exact amount.`, kind: 'estimate' };
    case 'crime-range':
      return {
        text: `Quick sell ≈ ${compactMoney(price.low)}–${compactMoney(price.high)}`,
        title: 'Crime Req item: the game cuts its quick-sell price to 2–10% of shop price. Tap $ for the exact amount.',
        kind: 'crime',
      };
    case 'unknown':
      return { text: 'Quick sell: no price yet', title: 'Tap $ on it once, or use Fetch prices above, to fill in this price.', kind: 'unknown' };
  }
}

function isShown(el: Element): boolean {
  return el.getClientRects().length > 0;
}

function paintTag(card: Element, price: CardPrice): void {
  const { text, title, kind } = tagFor(price);
  let tag = card.querySelector<HTMLElement>(`.${TAG_CLASS}`);
  if (!tag) {
    tag = document.createElement('div');
    tag.className = TAG_CLASS;
    (card.querySelector('.inv-info') ?? card).appendChild(tag);
  }
  if (tag.textContent !== text) tag.textContent = text;
  if (tag.title !== title) tag.title = title;
  if (tag.dataset.kind !== kind) tag.dataset.kind = kind;
}

interface Totals {
  count: number;
  total: number;
  exactCount: number;
  unknownCount: number;
  crimeCount: number;
  crimeLow: number;
  crimeHigh: number;
  crimeUnknown: number;
  lockedCount: number;
  shownCount: number;
}

function recompute(): void {
  const input = document.getElementById(SEARCH_INPUT_ID);
  const bar = document.getElementById(BAR_ID);
  const root = input?.parentElement;
  if (!root || !bar) return;

  const t: Totals = { count: 0, total: 0, exactCount: 0, unknownCount: 0, crimeCount: 0, crimeLow: 0, crimeHigh: 0, crimeUnknown: 0, lockedCount: 0, shownCount: 0 };

  for (const card of root.querySelectorAll(CARD_SELECTOR)) {
    const sellable = isQuickSellable(card);
    const price = sellable ? priceFor(card) : null;
    // Tagged whether or not it's showing right now, so a filter change
    // doesn't reveal untagged cards for a frame.
    if (price) paintTag(card, price);
    if (!isShown(card)) continue;

    t.shownCount++;
    if (!price) {
      if (card.getAttribute('data-locked') === '1') t.lockedCount++;
      continue;
    }
    if (card.getAttribute('data-crime') === '1') {
      t.crimeCount++;
      if (price.kind === 'quote' || price.kind === 'shared-quote') {
        t.crimeLow += price.cash;
        t.crimeHigh += price.cash;
      } else if (price.kind === 'crime-range') {
        t.crimeLow += price.low;
        t.crimeHigh += price.high;
      } else {
        t.crimeUnknown++;
      }
      continue;
    }
    t.count++;
    if (price.kind === 'quote' || price.kind === 'shared-quote' || price.kind === 'estimate') t.total += price.cash;
    if (price.kind === 'quote' || price.kind === 'shared-quote') t.exactCount++;
    if (price.kind === 'unknown') t.unknownCount++;
  }

  const html = renderBar(t) + renderFetch(fetchTargets(root).length);
  if (renderedHtml.get(bar) !== html) {
    renderedHtml.set(bar, html);
    bar.innerHTML = html;
  }
}

// What each bar last rendered, so an unchanged recompute doesn't touch the
// DOM (which would re-fire the grid observer).
const renderedHtml = new WeakMap<Element, string>();

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function renderBar(t: Totals): string {
  const lines: string[] = [];

  if (t.count === 0 && t.crimeCount === 0) {
    lines.push(`<div class="ff-qs-empty">${t.shownCount === 0 ? 'No items shown.' : 'Nothing shown here can be quick sold.'}</div>`);
  } else {
    if (t.count > 0) {
      const approx = t.exactCount === t.count ? '' : '≈ ';
      lines.push(
        `<div class="ff-qs-main"><span class="ff-qs-count">${plural(t.count, 'item')}</span> quick sell for <span class="ff-qs-total" title="${money(t.total)}">${approx}${money(t.total)}</span></div>`,
      );
      const priced = t.count - t.unknownCount;
      if (priced > 0 && t.exactCount < priced) {
        lines.push(
          `<div class="ff-qs-note">${t.exactCount > 0 ? `${t.exactCount} exact from the game's own quote, the rest` : 'Estimated'} at 20% of shop price.</div>`,
        );
      }
    }
    if (t.unknownCount > 0 || t.crimeUnknown > 0) {
      const n = t.unknownCount + t.crimeUnknown;
      lines.push(`<div class="ff-qs-warn">${plural(n, 'item')} with no price yet, not in the total. Use Fetch prices below, or tap $ on ${n === 1 ? 'it' : 'them'}.</div>`);
    }
    if (t.crimeCount > 0) {
      const range = t.crimeLow === t.crimeHigh ? money(t.crimeLow) : `${money(t.crimeLow)}–${money(t.crimeHigh)}`;
      lines.push(
        `<div class="ff-qs-crime">Crime Req: ${plural(t.crimeCount, 'item')} ≈ ${range}, not in the total. The game pays 2–10% of shop price for these, and your crimes may need them.</div>`,
      );
    }
  }
  if (t.lockedCount > 0) lines.push(`<div class="ff-qs-note">${plural(t.lockedCount, 'locked item')} not counted (locked items can't be quick sold).</div>`);

  return `${brandBadgeHtml('Quick Sell')}${lines.join('')}`;
}

// ---------------------------------------------------------------- fetch prices

/** Best first, so the items worth the most get their exact price soonest.
 *  Same values as the game's own rarity dropdown (2026-10-03). */
const RARITY_ORDER = ['fifth_family_mythic', 'red', 'crowned_legendary', 'gold', 'underworld_epic', 'purple', 'infamous_rare', 'blue', 'green', 'grey'];
/** Items per run before a break; a new rarity also starts a new run. */
const FETCH_RUN_SIZE = 10;
/** Gap between two items in a run, on top of the two round trips (~0.35s).
 *  The player clicking through $ by hand (28 taps, 2026-10-11 17:02–17:05
 *  UTC) went 1.4–4.7s from one sheet to the next, median 1.9s; this lands
 *  at roughly 0.85–2.6s, median about 1.7s. */
const BETWEEN_ITEMS_MS: [number, number] = [500, 2200];
const BETWEEN_RUNS_MS: [number, number] = [3_000, 8_000];

interface FetchTarget {
  invId: number;
  name: string;
  quality: string;
}

interface FetchState {
  running: boolean;
  stopRequested: boolean;
  done: number;
  total: number;
  /** What's happening right now, while running. */
  status: string;
  /** How the last run ended, until the next one starts. */
  result: string | null;
}

let fetchState: FetchState = { running: false, stopRequested: false, done: 0, total: 0, status: '', result: null };

function rarityRank(quality: string): number {
  const i = RARITY_ORDER.indexOf(quality);
  return i === -1 ? RARITY_ORDER.length : i;
}

/** One copy per item name (a quote prices every copy), only items with a $
 *  button and no exact quote yet, best rarity first. Filters and search
 *  don't matter: the hidden cards are still in the page. */
function fetchTargets(root: Element): FetchTarget[] {
  const seen = new Set<string>();
  const out: FetchTarget[] = [];
  for (const card of root.querySelectorAll('.inv-card[data-inv]')) {
    if (card.getAttribute('data-locked') === '1' || !isQuickSellable(card)) continue;
    const name = card.getAttribute('data-name') ?? '';
    if (!name || seen.has(name)) continue;
    const kind = priceFor(card).kind;
    if (kind === 'quote' || kind === 'shared-quote') continue;
    seen.add(name);
    out.push({ invId: Number(card.getAttribute('data-inv')), name, quality: card.getAttribute('data-quality') ?? '' });
  }
  return out.sort((a, b) => rarityRank(a.quality) - rarityRank(b.quality));
}

function between([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

/** Sleeps in short steps so Stop takes effect during a break, not after it. */
async function pause(ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until && !fetchState.stopRequested) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, until - Date.now())));
  }
}

function titleCase(lowerName: string): string {
  return lowerName.replace(/(^|\s)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function estimateMinutes(count: number): number {
  const runs = Math.ceil(count / FETCH_RUN_SIZE);
  const seconds = count * ((BETWEEN_ITEMS_MS[0] + BETWEEN_ITEMS_MS[1]) / 2000 + 0.5) + Math.max(0, runs - 1) * ((BETWEEN_RUNS_MS[0] + BETWEEN_RUNS_MS[1]) / 2000);
  return Math.max(1, Math.round(seconds / 60));
}

async function runFetch(): Promise<void> {
  if (fetchState.running) return;
  const root = document.getElementById(SEARCH_INPUT_ID)?.parentElement;
  if (!root) return;
  if (!beginInventoryBatch('price')) {
    fetchState = { ...fetchState, result: 'Auto-Sell is running a batch. Let it finish, then try again.' };
    scheduleRecompute();
    return;
  }

  const targets = fetchTargets(root);
  fetchState = { running: true, stopRequested: false, done: 0, total: targets.length, status: '', result: null };
  scheduleRecompute();

  let priced = 0;
  let stopped: string | null = null;
  let inRun = 0;
  let prevQuality: string | null = null;
  try {
    for (const target of targets) {
      if (fetchState.stopRequested) break;
      if (prevQuality !== null) {
        if (inRun >= FETCH_RUN_SIZE || target.quality !== prevQuality) {
          const ms = between(BETWEEN_RUNS_MS);
          fetchState.status = `Short break, next run in about ${Math.round(ms / 1000)}s.`;
          scheduleRecompute();
          await pause(ms);
          inRun = 0;
        } else {
          await pause(between(BETWEEN_ITEMS_MS));
        }
        if (fetchState.stopRequested) break;
      }
      prevQuality = target.quality;

      const liveRoot = document.getElementById(SEARCH_INPUT_ID)?.parentElement;
      if (!liveRoot) {
        stopped = 'you left the inventory page. Press Fetch prices again to carry on.';
        break;
      }
      const card = liveRoot.querySelector(`.inv-card[data-inv="${target.invId}"]`);
      const kind = card ? priceFor(card).kind : null;
      // Gone, locked or quoted (by the player's own tap) since the list was made.
      if (!card || card.getAttribute('data-locked') === '1' || kind === 'quote' || kind === 'shared-quote') {
        fetchState.done++;
        continue;
      }

      fetchState.status = `Checking ${titleCase(target.name)}`;
      scheduleRecompute();
      const result = (await chrome.runtime.sendMessage({
        type: 'inventory-price-item-requested',
        invId: target.invId,
        expectedName: target.name,
      })) as InventoryPriceResult;
      if (result.status === 'stopped') {
        stopped = `${titleCase(target.name)}: ${result.error}`;
        break;
      }
      recordShopPrice(String(target.invId), result.name, result.shopPrice);
      recordQuote(String(target.invId), result.name, result.cash);
      priced++;
      inRun++;
      fetchState.done++;
    }
  } catch (err) {
    stopped = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, 'quick-sell price fetch failed', err);
  } finally {
    chrome.runtime.sendMessage({ type: 'inventory-batch-finished' }).catch(() => {});
    endInventoryBatch();
    const got = `Fetched ${plural(priced, 'price')}.`;
    fetchState = {
      running: false,
      stopRequested: false,
      done: fetchState.done,
      total: fetchState.total,
      status: '',
      result: stopped ? `${got} Stopped: ${stopped}` : fetchState.stopRequested ? `${got} Stopped by you.` : got,
    };
    scheduleRecompute();
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function renderFetch(pending: number): string {
  if (fetchState.running) {
    return `<div class="ff-qs-fetch"><div class="ff-qs-fetch-status">Fetching prices: ${fetchState.done} of ${fetchState.total}${
      fetchState.status ? ` · ${escapeHtml(fetchState.status)}` : ''
    }</div><button type="button" class="ff-qs-btn" data-qs-action="stop" ${fetchState.stopRequested ? 'disabled' : ''}>${
      fetchState.stopRequested ? 'Stopping…' : 'Stop'
    }</button></div>`;
  }
  const result = fetchState.result ? `<div class="ff-qs-note">${escapeHtml(fetchState.result)}</div>` : '';
  if (pending === 0) return result;
  const otherBatch = activeInventoryBatch() !== null;
  return `${result}<div class="ff-qs-fetch"><button type="button" class="ff-qs-btn" data-qs-action="fetch" ${otherBatch ? 'disabled' : ''}>Fetch prices (${plural(
    pending,
    'item',
  )})</button><span class="ff-qs-note">Taps $ on each one for you, best rarity first, ${FETCH_RUN_SIZE} at a time with breaks. About ${estimateMinutes(pending)} min; stay on this page.</span></div>`;
}

function onBarClick(event: Event): void {
  const target = (event.target as Element).closest<HTMLElement>('[data-qs-action]');
  if (!target || !document.getElementById(BAR_ID)?.contains(target)) return;
  event.preventDefault();
  event.stopPropagation();
  if (target.dataset.qsAction === 'fetch') runFetch();
  if (target.dataset.qsAction === 'stop' && fetchState.running) {
    fetchState.stopRequested = true;
    scheduleRecompute();
  }
}

let scheduled = false;
function scheduleRecompute(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    recompute();
  });
}

// The inventory's own filters hide cards with inline `display` changes rather
// than reloading the panel, so the grid is watched for attribute changes too,
// not just added/removed cards.
let rootObserver: MutationObserver | null = null;
let observedRoot: Element | null = null;

function ensureBar(): void {
  const input = document.getElementById(SEARCH_INPUT_ID);
  const root = input?.parentElement;
  if (!input || !root) return;

  let changed = false;
  if (input.nextElementSibling?.id !== BAR_ID) {
    document.getElementById(BAR_ID)?.remove();
    const bar = document.createElement('div');
    bar.id = BAR_ID;
    input.insertAdjacentElement('afterend', bar);
    changed = true;
  }

  if (observedRoot !== root) {
    rootObserver?.disconnect();
    observedRoot = root;
    rootObserver = new MutationObserver(scheduleRecompute);
    rootObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    changed = true;
  }
  if (changed) scheduleRecompute();
}

const STYLE = `
#${BAR_ID} {
  margin: 0 0 10px; padding: 10px 12px;
  background: rgba(74,222,128,0.05); border: 1px solid rgba(74,222,128,0.22); border-radius: 10px;
  font-family: 'Inter', system-ui, sans-serif; display: flex; flex-direction: column; gap: 5px;
}
.ff-qs-main { font-size: 0.8rem; color: #d1d5db; margin-top: 3px; }
.ff-qs-count { font-weight: 800; color: #f3f4f6; }
.ff-qs-total { font-family: 'SF Mono', 'Roboto Mono', ui-monospace, Menlo, monospace; font-weight: 800; color: #4ade80; }
.ff-qs-note, .ff-qs-empty { font-size: 0.65rem; color: #9ca3af; line-height: 1.5; }
.ff-qs-warn { font-size: 0.65rem; color: #fbbf24; line-height: 1.5; }
.ff-qs-crime { font-size: 0.65rem; color: #f59e0b; line-height: 1.5; }
.ff-qs-fetch { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 3px; }
.ff-qs-fetch-status { font-size: 0.7rem; color: #d1d5db; }
.ff-qs-btn {
  padding: 5px 12px; background: rgba(74,222,128,0.12); border: 1px solid rgba(74,222,128,0.4);
  border-radius: 7px; color: #86efac; font-size: 0.65rem; font-weight: 800; letter-spacing: 0.03em;
  text-transform: uppercase; cursor: pointer;
}
.ff-qs-btn:disabled { opacity: 0.5; cursor: default; }
.${TAG_CLASS} { font-size: 0.55rem; font-weight: 800; margin-top: 3px; letter-spacing: 0.02em; color: #4ade80; }
.${TAG_CLASS}[data-kind="estimate"] { color: #86efac; }
.${TAG_CLASS}[data-kind="crime"] { color: #f59e0b; }
.${TAG_CLASS}[data-kind="unknown"] { color: #6b7280; }
`;

export function initInventoryQuickSell(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + STYLE);

  storage.getQuickSellPriceBook().then((b) => {
    book = b;
    scheduleRecompute();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEYS.QUICK_SELL_PRICE_BOOK]) return;
    const next = changes[STORAGE_KEYS.QUICK_SELL_PRICE_BOOK].newValue as QuickSellPriceBook | undefined;
    if (next) book = next;
    scheduleRecompute();
  });

  document.addEventListener('click', onBarClick, true);

  const observer = new MutationObserver(() => {
    if (document.getElementById(SEARCH_INPUT_ID)) ensureBar();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
