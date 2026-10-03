import type { CapturedRequest } from '@/shared/messaging';
import { STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { QuickSellPriceBook } from '@/shared/types';
import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';

/**
 * Inventory quick-sell total: what every item currently on screen would
 * quick-sell for, following whatever tab, filter chip, rarity and search the
 * player has picked, plus a price tag on each card.
 *
 * The inventory page carries no prices at all. A card's $ button calls
 * `Game.disposeItemV2(id,'quicksell',name)`, and the game only then asks
 * the server (`POST /actions/shops_v2.php action=dispose_quote`, one item
 * per call). Sending that for every card would be hundreds of requests no
 * real client ever makes, so prices come from two passive sources instead
 * (see `QuickSellPriceBook`):
 *
 * - **Estimate, 20% of shop price.** Checked against every captured quote
 *   (2026-08-11 → 2026-09-28): 42 of the 44 quotes for non-Crime-Req items
 *   were exactly 20% of that item's `data-shop-price` on the Item Market
 *   sell grid, upgrade level (+1…+5) making no difference. The two
 *   exceptions (Enforcer's Chain Belt at 15%, Broker's Gloves at 8.4%) fit
 *   nothing found so far; shop prices also drift over time (Enforcer's
 *   Chain Belt went 800k → 950k), so an estimate is shown with "≈".
 * - **Real quotes.** Every `dispose_quote` the game sends is kept and wins
 *   over the estimate, for that item and for every other copy of it (same
 *   name; upgrade level doesn't change the price).
 *
 * Crime Req items (`data-crime="1"`) get their quote cut when they're tied
 * to a crime the player needs (`capstone_warning` in the quote): 2% of shop
 * price for Brass Knuckles and Gold Rope Chain, 10% for The Iron Curtain.
 * No rule for which applies was found, so they're totalled on their own
 * line as a 2–10% range.
 *
 * Locked cards have no $ button, and consumables never do; neither is
 * counted. Equipped gear isn't an `.inv-card` at all.
 */

const SEARCH_INPUT_ID = 'invSearch';
// Every card, not just `[data-inv]` ones: consumable cards carry no id, but
// still count as "shown" for the bar's empty-state wording.
const CARD_SELECTOR = '.inv-card';
const QUICKSELL_BUTTON_SELECTOR = `[onclick*="'quicksell'"]`;
const SELL_GRID_CARD_SELECTOR = '#sellGrid .sell-item[data-inv]';
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

// One read-modify-write at a time, so an Item Market harvest and a quote
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

/** Keeps the real payout from every quote the game itself asks for when the
 *  player taps a $ button. */
export function handleCapturedRequest(req: CapturedRequest): void {
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

// Item Market sell-grid cards already recorded, so the observer doesn't
// rewrite storage on every unrelated mutation while that page is open.
const harvestedCards = new WeakSet<Element>();

function harvestShopPrices(): void {
  const fresh: { inv: string; name: string; price: number }[] = [];
  for (const card of document.querySelectorAll(SELL_GRID_CARD_SELECTOR)) {
    if (harvestedCards.has(card)) continue;
    harvestedCards.add(card);
    const price = Number(card.getAttribute('data-shop-price'));
    const inv = card.getAttribute('data-inv');
    if (!inv || !(price > 0)) continue;
    fresh.push({ inv, name: card.getAttribute('data-name') ?? '', price });
  }
  if (fresh.length === 0) return;

  updateBook((b) => {
    const now = Date.now();
    let changed = false;
    for (const { inv, name, price } of fresh) {
      if (b.shopByInv[inv]?.price !== price) changed = true;
      b.shopByInv[inv] = { price, at: now };
      if (name) {
        if (b.shopByName[name]?.price !== price) changed = true;
        b.shopByName[name] = { price, at: now };
      }
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
      return { text: 'Quick sell: no price yet', title: 'Open the Item Market once to fill in this price.', kind: 'unknown' };
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
    const sellable = card.querySelector(QUICKSELL_BUTTON_SELECTOR) !== null;
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

  const html = renderBar(t);
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
      lines.push(`<div class="ff-qs-warn">${plural(n, 'item')} with no price yet, not in the total. Open the Item Market once to fill ${n === 1 ? 'it' : 'them'} in.</div>`);
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

  const observer = new MutationObserver(() => {
    harvestShopPrices();
    if (document.getElementById(SEARCH_INPUT_ID)) ensureBar();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
