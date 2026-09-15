import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { storage } from '@/shared/storage';

/**
 * A live-DOM assistant for the Item Market's "List an Item for Sale" form —
 * no network capture, no adapter, purely reading what the page has already
 * rendered. Confirmed real (2026-09-15 archive): `panel.php?type=item_market`
 * embeds `data-shop-price`, `data-max-price`, `data-avg-7d` and `data-vol-7d`
 * directly on every one of the player's own `.sell-item` cards in `#sellGrid`
 * — the exact "Shop value / Market avg (7d) / N sold" numbers the game's own
 * client JS renders into `#sellPreview` when a card is clicked, just also
 * sitting there as plain attributes for every item at once, not only the one
 * currently selected. The live "Buy Orders" feed (`.im-card`, elsewhere in
 * the same page) carries the same per-unit price/name for every active
 * listing, letting a cheapest-current-ask lookup run entirely client-side too.
 *
 * Two things this adds, neither of which the game surfaces on its own:
 *
 * 1. **A liquidity badge on every sell-grid card** — `data-vol-7d` (units of
 *    that item sold market-wide in the last 7 days), shown at a glance across
 *    the whole grid so "which of my items would actually sell" doesn't need
 *    clicking through one at a time.
 * 2. **A suggested price + "Use This" button** once a card is clicked — see
 *    `suggestPrice()`'s own doc for the reasoning. Never invents a number
 *    with no signal behind it: an item with neither active listings nor
 *    recent sales gets an explicit "not enough data" note instead of a guess.
 *
 * Deliberately does *not* try to reproduce the quicksell payout (confirmed
 * real: quicksell ≈ shop-price ÷ 5, halved again for capstone-linked items
 * like The Iron Curtain) — that would be a guess dressed up as a number, and
 * the existing Quick Sell button already shows the real one on demand.
 *
 * A third piece: a small toolbar above the grid with two toggles.
 * "Sort: Best Sellers/wk" reorders `.sell-item` cards by `data-vol-7d`
 * descending — same non-destructive "move the real nodes, don't clone them"
 * approach as Fight Club's toolbar sort (targetControls.ts), so every card's
 * own click handler (and this feature's delegated listener) stays live
 * through a re-sort. Turning it back off stops applying new sorts rather
 * than restoring original page order, since the game re-sends fresh
 * (unsorted) cards on every filter or search change anyway. "Hide
 * Consumables" just toggles `display` on `data-type="consumable"` cards —
 * player-requested, since consumables trade in the thousands/week and
 * otherwise bury every piece of gear at the top of the sort. Both persisted
 * together in one `ItemMarketSortPrefs` record.
 */

const GRID_SELECTOR = '#sellGrid';
const CARD_SELECTOR = '.sell-item';
const PREVIEW_SELECTOR = '#sellPreview';
const PRICE_INPUT_SELECTOR = '#sellPrice';
const BUY_CARD_SELECTOR = '.im-card';
const VOL_BADGE_CLASS = 'ff-im-vol-badge';
const ADVISOR_ID = 'ff-im-advisor';
const TOOLBAR_ID = 'ff-im-toolbar';
const STYLE_ID = 'ff-im-style';

// Single module-level flags rather than per-grid state — only one sell grid
// is ever on screen at a time, and a freshly-loaded grid (after a filter or
// search change swaps the whole `#sellGrid` node) should pick up whatever
// these were last set to, not reset to off.
let sortByVolume = false;
let hideConsumables = false;

function persistPrefs(): void {
  storage.setItemMarketSortPrefs({ sortByVolume, hideConsumables });
}

interface SellItem {
  name: string;
  displayName: string;
  shopPrice: number;
  maxPrice: number;
  avg7d: number;
  vol7d: number;
}

// Grids already wired for the delegated click listener — keyed by the live
// DOM node so a fresh grid after `Game.loadPanel('item_market', ...)` swaps
// the whole panel in (confirmed real: every filter chip does this, not just
// pagination) gets re-wired automatically instead of silently going stale.
const wiredGrids = new WeakSet<Element>();

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function titleCase(lowerName: string): string {
  return lowerName.replace(/(^|\s)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function readSellItem(card: Element): SellItem {
  const name = card.getAttribute('data-name') ?? '';
  return {
    name,
    displayName: titleCase(name),
    shopPrice: Number(card.getAttribute('data-shop-price')) || 0,
    maxPrice: Number(card.getAttribute('data-max-price')) || 0,
    avg7d: Number(card.getAttribute('data-avg-7d')) || 0,
    vol7d: Number(card.getAttribute('data-vol-7d')) || 0,
  };
}

/** Scans the live "Buy Orders" feed for the cheapest currently-active ask on
 *  this item name — the per-unit price is read from the card's own rendered
 *  "$X/ea" text rather than its `data-price` (confirmed real: `data-price` is
 *  the listing's *total* — a 204-unit Nerve Tonic listing carried
 *  `data-price="1326000000"`, exactly 204 × the $6,500,000/ea it actually
 *  displayed — so dividing would mean also trusting a quantity read off a
 *  second, unrelated attribute for no reason when the per-unit figure is
 *  already rendered in plain text right there). */
function cheapestActiveListing(name: string): number | null {
  let min: number | null = null;
  for (const card of document.querySelectorAll(BUY_CARD_SELECTOR)) {
    if (card.getAttribute('data-name') !== name) continue;
    for (const el of card.querySelectorAll('div,span')) {
      const m = /^\$([\d,]+)\/ea$/.exec(el.textContent?.trim() ?? '');
      if (!m) continue;
      const perUnit = Number(m[1].replace(/,/g, ''));
      if (min == null || perUnit < min) min = perUnit;
      break;
    }
  }
  return min;
}

interface Suggestion {
  price: number | null;
  reason: string;
  cheapestActive: number | null;
}

/**
 * Never a black box: `reason` always says which signal actually drove the
 * number, since this is a suggestion for real in-game cash and a player
 * should be able to tell at a glance whether it's "undercut the competition"
 * or "there is no competition, this is just last week's average."
 *
 * - An active listing exists: price slightly undercuts it (3%, enough to be
 *   the visibly cheapest without leaving obvious money on the table), capped
 *   at a touch over the 7-day average so a stale/inflated lone listing can't
 *   drag the suggestion up with it.
 * - No active listing but real sales history: match the 7-day average — the
 *   only real price signal available.
 * - Neither: no suggestion. `vol7d`/`cheapestActive` being both empty means
 *   there is no evidence a price at any level would actually sell.
 *
 * Always clamped to the item's own `maxPrice` (confirmed real: the server
 * enforces this — Iron Curtain's `data-max-price` is exactly 2× its
 * `data-shop-price`, and the sell form's own cap warning matches it), and
 * rounded to the nearest $1,000 for a listing price that doesn't look like
 * the output of a formula.
 */
function suggestPrice(item: SellItem): Suggestion {
  const cheapestActive = cheapestActiveListing(item.name);
  let raw: number | null = null;
  let reason = '';

  if (cheapestActive != null) {
    const undercut = cheapestActive * 0.97;
    const cap = item.avg7d > 0 ? item.avg7d * 1.05 : undercut;
    raw = Math.min(undercut, cap);
    reason =
      raw >= undercut - 1
        ? `undercuts the cheapest current listing (${money(cheapestActive)}/ea)`
        : `capped near the 7-day average (${money(item.avg7d)}/ea) rather than following that listing down`;
  } else if (item.avg7d > 0) {
    raw = item.avg7d;
    reason = `matches the 7-day average — nothing else is currently listed`;
  }

  const price = raw == null ? null : Math.min(item.maxPrice || raw, Math.max(1000, Math.round(raw / 1000) * 1000));
  return { price, reason, cheapestActive };
}

function liquidityBadge(vol7d: number): { label: string; color: string } {
  if (vol7d <= 0) return { label: 'No sales this week', color: '#6b7280' };
  if (vol7d < 5) return { label: `${vol7d} sold/wk`, color: '#fbbf24' };
  return { label: `${vol7d} sold/wk`, color: '#4ade80' };
}

function paintVolumeBadges(grid: Element): void {
  for (const card of grid.querySelectorAll(CARD_SELECTOR)) {
    if (card.querySelector(`.${VOL_BADGE_CLASS}`)) continue;
    const vol7d = Number(card.getAttribute('data-vol-7d')) || 0;
    const { label, color } = liquidityBadge(vol7d);
    const badge = document.createElement('div');
    badge.className = VOL_BADGE_CLASS;
    badge.style.color = color;
    badge.textContent = label;
    card.appendChild(badge);
  }
}

function renderAdvisor(item: SellItem, suggestion: Suggestion): HTMLElement {
  const el = document.createElement('div');
  el.id = ADVISOR_ID;

  if (suggestion.price == null) {
    el.innerHTML = `${brandBadgeHtml('Price Advisor')}<div class="ff-im-advisor-empty">No active listings or recent sales for ${item.displayName} — not enough market data for a suggested price.</div>`;
    return el;
  }

  el.innerHTML = `
    ${brandBadgeHtml('Price Advisor')}
    <div class="ff-im-advisor-row">
      <span class="ff-im-advisor-label">Suggested</span>
      <span class="ff-im-advisor-price">${money(suggestion.price)}/ea</span>
      <button type="button" class="ff-im-advisor-use">Use This</button>
    </div>
    <div class="ff-im-advisor-reason">${suggestion.reason}</div>
  `;
  el.querySelector('.ff-im-advisor-use')?.addEventListener('click', () => {
    const input = document.querySelector<HTMLInputElement>(PRICE_INPUT_SELECTOR);
    if (!input) return;
    input.value = String(suggestion.price);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return el;
}

function handleCardSelected(card: Element): void {
  const item = readSellItem(card);
  const suggestion = suggestPrice(item);

  document.getElementById(ADVISOR_ID)?.remove();
  const preview = document.querySelector(PREVIEW_SELECTOR);
  preview?.insertAdjacentElement('afterend', renderAdvisor(item, suggestion));
}

/** Moves the real `.sell-item` nodes (never clones — same reasoning as
 *  Fight Club's `applySort`) into `data-vol-7d`-descending order. A no-op
 *  when the toggle is off, so this is safe to call unconditionally on every
 *  grid without needing its own "did this already run" guard. */
function applySort(grid: Element): void {
  if (!sortByVolume) return;
  const cards = Array.from(grid.querySelectorAll(CARD_SELECTOR));
  cards.sort((a, b) => (Number(b.getAttribute('data-vol-7d')) || 0) - (Number(a.getAttribute('data-vol-7d')) || 0));
  for (const card of cards) grid.appendChild(card);
}

/** Toggles visibility on every consumable card — `display: none`, not
 *  removal, so nothing here disturbs `applySort`'s node order or this
 *  feature's own delegated click listener (a hidden card is still clickable
 *  by whatever re-shows it, but that's moot since it's simply skipped by the
 *  player, not disabled). Independent of the native All/Weapons/Armour/…
 *  filter chips entirely — those trigger a full `Game.loadPanel` reload with
 *  a `market_filter` query param; this just hides cards already in the DOM,
 *  so it works from "All" (where the player actually wants to stay) without
 *  fighting the game's own tab state. */
function applyConsumableFilter(grid: Element): void {
  for (const card of grid.querySelectorAll<HTMLElement>(CARD_SELECTOR)) {
    if (card.getAttribute('data-type') === 'consumable') {
      card.style.display = hideConsumables ? 'none' : '';
    }
  }
}

function sortToggleLabel(): string {
  return sortByVolume ? '✓ Sorted: Best Sellers/wk' : 'Sort: Best Sellers/wk';
}

function consumableToggleLabel(): string {
  return hideConsumables ? '✓ Consumables Hidden' : 'Hide Consumables';
}

function ensureToolbar(grid: Element): void {
  document.getElementById(TOOLBAR_ID)?.remove();

  const bar = document.createElement('div');
  bar.id = TOOLBAR_ID;

  const sortBtn = document.createElement('button');
  sortBtn.type = 'button';
  sortBtn.className = 'ff-im-toggle-btn';
  sortBtn.classList.toggle('active', sortByVolume);
  sortBtn.textContent = sortToggleLabel();
  sortBtn.addEventListener('click', () => {
    sortByVolume = !sortByVolume;
    persistPrefs();
    sortBtn.classList.toggle('active', sortByVolume);
    sortBtn.textContent = sortToggleLabel();
    applySort(grid);
  });

  const consumableBtn = document.createElement('button');
  consumableBtn.type = 'button';
  consumableBtn.className = 'ff-im-toggle-btn';
  consumableBtn.classList.toggle('active', hideConsumables);
  consumableBtn.textContent = consumableToggleLabel();
  consumableBtn.addEventListener('click', () => {
    hideConsumables = !hideConsumables;
    persistPrefs();
    consumableBtn.classList.toggle('active', hideConsumables);
    consumableBtn.textContent = consumableToggleLabel();
    applyConsumableFilter(grid);
  });

  bar.appendChild(sortBtn);
  bar.appendChild(consumableBtn);
  grid.parentElement?.insertBefore(bar, grid);
}

function ensureWired(grid: Element): void {
  if (wiredGrids.has(grid)) return;
  wiredGrids.add(grid);

  // Everything below runs exactly once per grid instance, not on every
  // MutationObserver tick — `applySort`'s `appendChild` calls are themselves
  // DOM mutations, so re-running this on every observer callback would mean
  // re-sorting (already-sorted cards) on every tick, which is itself a
  // mutation, which re-fires the observer: a self-sustaining loop. The
  // `wiredGrids` guard is what breaks that, same as Fight Club toolbar's own
  // `previousElementSibling?.id === TOOLBAR_ID` guard serves.
  paintVolumeBadges(grid);
  ensureToolbar(grid);
  applySort(grid);
  applyConsumableFilter(grid);

  // Delegated, not per-card — the game replaces this grid's whole innerHTML
  // on every filter/search change (same `Game.loadPanel` reload as the rest
  // of this panel), so a listener bound to the grid container itself is what
  // survives that instead of needing to be reattached per card.
  grid.addEventListener('click', (e) => {
    const card = (e.target as Element).closest(CARD_SELECTOR);
    if (card) handleCardSelected(card);
  });
}

const STYLE = `
.${VOL_BADGE_CLASS} { font-size: 0.5rem; font-weight: 800; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.02em; }

#${TOOLBAR_ID} { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.ff-im-toggle-btn {
  padding: 7px 14px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 20px; color: #9ca3af; font-size: 0.7rem; font-weight: 700;
  cursor: pointer; transition: all 0.15s;
}
.ff-im-toggle-btn:hover { border-color: rgba(96,165,250,0.4); color: #cbd5e1; }
.ff-im-toggle-btn.active { background: rgba(96,165,250,0.15); border-color: rgba(96,165,250,0.4); color: #60a5fa; }

#${ADVISOR_ID} {
  margin: 10px 0 14px;
  padding: 10px 12px;
  background: rgba(96,165,250,0.06);
  border: 1px solid rgba(96,165,250,0.25);
  border-radius: 10px;
  font-family: 'Inter', system-ui, sans-serif;
}
.ff-im-advisor-empty { font-size: 0.7rem; color: #9ca3af; margin-top: 6px; line-height: 1.5; }
.ff-im-advisor-row { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.ff-im-advisor-label { font-size: 0.6rem; color: #888; text-transform: uppercase; letter-spacing: 1px; font-weight: 800; }
.ff-im-advisor-price { font-family: 'SF Mono', 'Roboto Mono', ui-monospace, Menlo, monospace; font-size: 0.95rem; font-weight: 800; color: #60a5fa; }
.ff-im-advisor-use {
  padding: 5px 12px; background: rgba(96,165,250,0.18); border: 1px solid rgba(96,165,250,0.45);
  border-radius: 7px; color: #93c5fd; font-size: 0.65rem; font-weight: 800; letter-spacing: 0.03em;
  text-transform: uppercase; cursor: pointer;
}
.ff-im-advisor-use:hover { border-color: rgba(96,165,250,0.8); }
.ff-im-advisor-reason { font-size: 0.65rem; color: #9ca3af; margin-top: 6px; line-height: 1.5; }
`;

export function initItemMarketPriceAdvisor(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + STYLE);

  // Best-effort seed from storage — a grid rendered before this resolves
  // just uses the `false` default, same tolerance for the read/render race
  // every other storage-backed content-script preference in this codebase
  // already accepts (e.g. content/index.ts's own `requestLogEnabled`).
  storage.getItemMarketSortPrefs().then((prefs) => {
    sortByVolume = prefs.sortByVolume;
    hideConsumables = prefs.hideConsumables;
  });

  const observer = new MutationObserver(() => {
    const grid = document.querySelector(GRID_SELECTOR);
    if (grid) ensureWired(grid);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
