import { STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { InventoryAutoSellCriteria, InventoryLockResult, InventorySellResult, QuickSellPriceBook } from '@/shared/types';
import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { priceFor, recordQuote, type CardPrice } from './quickSellTotal';

/**
 * Inventory Auto-Sell & Crime Locks: a panel under the inventory search box
 * that does two manual, confirm-first batches.
 *
 * **Crime locks.** Crime Req cards (`data-crime="1"`) are items a crime needs
 * you to own; the crimes panel marks one as covered as soon as you own a
 * single copy (`data-req` `o:true`). Locking is the only thing stopping that
 * copy from being sold, so every crime item with no locked copy is flagged on
 * its cards and listed here, with a button that locks one copy of each (the
 * highest upgrade level).
 *
 * **Auto-sell.** The player picks rarities (required), and optionally slots,
 * a highest upgrade level, a price cap and never-sell names; a live preview
 * lists exactly what would go. On Confirm, each item is quoted and sold in
 * turn by background (`features/inventory`), with human-like gaps measured
 * from the player's own manual sales. Crime Req items keep one copy: a
 * locked copy if there is one, otherwise the best unlocked copy is held
 * back and only the rest are sold.
 *
 * Any rejection or unrecognized response ends the batch on the spot rather
 * than moving on to the next item; so does leaving the inventory page.
 * Nothing here runs in the background: no alarm, no trigger other than the
 * two Confirm buttons, and only one batch at a time (`batchInFlight`, plus
 * a per-tab lease in background against two game tabs).
 */

const SEARCH_INPUT_ID = 'invSearch';
const RARITY_SELECT_ID = 'invRaritySelect';
const QS_BAR_ID = 'ff-qs-bar';
const PANEL_ID = 'ff-as-panel';
const STYLE_ID = 'ff-as-style';
const CRIME_TAG_CLASS = 'ff-as-crime-tag';
const QUICKSELL_BUTTON_SELECTOR = `[onclick*="'quicksell'"]`;

/** Sale → next quote gap, total including background's own pacing. The
 *  player's own back-to-back sales ran 0.8–8s apart, most of them 1–3.5s. */
const BETWEEN_SALES_MS: [number, number] = [1100, 3600];
/** Same for locks: the player's own lock runs went 1–3s per item. */
const BETWEEN_LOCKS_MS: [number, number] = [1000, 2500];
/** `postAction`'s fixed pause before every call, already part of each gap. */
const ACTION_PACING_MS = 600;

/** The game's own rarity dropdown is read when it's on the page; this is the
 *  fallback, copied from it (2026-10-03). */
const FALLBACK_RARITIES: [string, string][] = [
  ['grey', 'Common'],
  ['green', 'Uncommon'],
  ['blue', 'Rare'],
  ['infamous_rare', 'Infamous Rare'],
  ['purple', 'Epic'],
  ['underworld_epic', 'Underworld Epic'],
  ['gold', 'Legendary'],
  ['crowned_legendary', 'Crowned Legendary'],
  ['red', 'Mythic'],
  ['fifth_family_mythic', 'Fifth Family Mythic'],
];

interface InvItem {
  card: Element;
  invId: number;
  /** `data-name`: lowercased, no `+N`. The key every copy shares. */
  key: string;
  /** As the game shows it, with `+N`. */
  label: string;
  /** Title-case name without `+N`, what the quote's `name` echoes. */
  baseName: string;
  quality: string;
  type: string;
  crime: boolean;
  locked: boolean;
  sellable: boolean;
  upgrade: number;
}

interface CrimeGroup {
  key: string;
  baseName: string;
  copies: InvItem[];
  lockedCount: number;
  /** The copy held back (and the one "Lock one of each" locks) when none is
   *  locked yet. */
  best: InvItem;
}

interface PlannedSale {
  item: InvItem;
  price: CardPrice;
}

interface Plan {
  sell: PlannedSale[];
  keptCrime: InvItem[];
  overCap: InvItem[];
}

interface Summary {
  kind: 'sell' | 'lock';
  done: number;
  payout: number;
  overPrice: number;
  skipped: number;
  stopped: string | null;
  cancelled: boolean;
}

let criteria: InventoryAutoSellCriteria = { rarities: [], slots: [], maxUpgrade: null, maxPrice: null, neverSell: [] };
let book: QuickSellPriceBook = { shopByInv: {}, shopByName: {}, quotes: {}, quotesByName: {} };

let expanded = false;
let mode: 'idle' | 'confirm-sell' | 'confirm-lock' | 'running' = 'idle';
let runningKind: 'sell' | 'lock' = 'sell';
let progressText = '';
let progressDone = 0;
let progressTotal = 0;
let cancelRequested = false;
let summary: Summary | null = null;

// Module-level, not per-render: the panel element is rebuilt every time the
// game reloads the inventory, but a batch must never be startable twice.
let batchInFlight = false;

// ---------------------------------------------------------------- reading

const gearNames = new WeakMap<Element, { raw: string; name: string }>();

function gearName(card: Element): string {
  const raw = card.getAttribute('data-gear') ?? '';
  const cached = gearNames.get(card);
  if (cached && cached.raw === raw) return cached.name;
  let name = '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.name === 'string') name = parsed.name;
  } catch {
    // No gear blob: fall back to data-name below.
  }
  gearNames.set(card, { raw, name });
  return name;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function readItems(root: Element): InvItem[] {
  const items: InvItem[] = [];
  for (const card of root.querySelectorAll('.inv-card[data-inv]')) {
    const invId = Number(card.getAttribute('data-inv'));
    const key = card.getAttribute('data-name') ?? '';
    if (!(invId > 0) || !key) continue;
    const label = gearName(card) || titleCase(key);
    const upgradeMatch = label.match(/\s\+(\d+)\s*$/);
    items.push({
      card,
      invId,
      key,
      label,
      baseName: upgradeMatch ? label.slice(0, upgradeMatch.index).trim() : label,
      quality: card.getAttribute('data-quality') ?? '',
      type: card.getAttribute('data-type') ?? '',
      crime: card.getAttribute('data-crime') === '1',
      locked: card.getAttribute('data-locked') === '1',
      sellable: card.querySelector(QUICKSELL_BUTTON_SELECTOR) !== null,
      upgrade: upgradeMatch ? Number(upgradeMatch[1]) : 0,
    });
  }
  return items;
}

function crimeGroups(items: InvItem[]): CrimeGroup[] {
  const byKey = new Map<string, InvItem[]>();
  for (const item of items) {
    if (!item.crime) continue;
    const list = byKey.get(item.key) ?? [];
    list.push(item);
    byKey.set(item.key, list);
  }
  return [...byKey.entries()].map(([key, copies]) => {
    const unlocked = copies.filter((c) => !c.locked);
    const best = (unlocked.length ? unlocked : copies).reduce((a, b) => (b.upgrade > a.upgrade || (b.upgrade === a.upgrade && b.invId < a.invId) ? b : a));
    return { key, baseName: best.baseName, copies, lockedCount: copies.length - unlocked.length, best };
  });
}

function rarityOptions(): [string, string][] {
  const select = document.getElementById(RARITY_SELECT_ID) as HTMLSelectElement | null;
  if (!select) return FALLBACK_RARITIES;
  const options = [...select.options].filter((o) => o.value && o.value !== 'all').map((o) => [o.value, o.textContent?.trim() || o.value] as [string, string]);
  return options.length ? options : FALLBACK_RARITIES;
}

function priceBounds(price: CardPrice): { low: number; high: number } | null {
  switch (price.kind) {
    case 'quote':
    case 'shared-quote':
    case 'estimate':
      return { low: price.cash, high: price.cash };
    case 'crime-range':
      return { low: price.low, high: price.high };
    case 'unknown':
      return null;
  }
}

function plan(items: InvItem[], groups: CrimeGroup[]): Plan {
  const keepIds = new Set(groups.filter((g) => g.lockedCount === 0).map((g) => g.best.invId));
  const neverSell = new Set(criteria.neverSell);
  const result: Plan = { sell: [], keptCrime: [], overCap: [] };

  for (const item of items) {
    if (!item.sellable || item.locked) continue;
    if (!criteria.rarities.includes(item.quality)) continue;
    if (criteria.slots.length && !criteria.slots.includes(item.type)) continue;
    if (criteria.maxUpgrade != null && item.upgrade > criteria.maxUpgrade) continue;
    if (neverSell.has(item.key)) continue;
    if (keepIds.has(item.invId)) {
      result.keptCrime.push(item);
      continue;
    }
    const price = priceFor(item.card, book);
    const bounds = priceBounds(price);
    if (criteria.maxPrice != null && bounds && bounds.low > criteria.maxPrice) {
      result.overCap.push(item);
      continue;
    }
    result.sell.push({ item, price });
  }
  return result;
}

// ---------------------------------------------------------------- rendering

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function priceText(price: CardPrice): string {
  switch (price.kind) {
    case 'quote':
    case 'shared-quote':
      return money(price.cash);
    case 'estimate':
      return `≈ ${money(price.cash)}`;
    case 'crime-range':
      return `≈ ${money(price.low)}–${money(price.high)}`;
    case 'unknown':
      return 'no price yet';
  }
}

function totalText(sales: PlannedSale[]): string {
  let low = 0;
  let high = 0;
  let exact = true;
  let unknown = 0;
  for (const { price } of sales) {
    const b = priceBounds(price);
    if (!b) {
      unknown++;
      continue;
    }
    low += b.low;
    high += b.high;
    if (price.kind !== 'quote' && price.kind !== 'shared-quote') exact = false;
  }
  if (unknown === sales.length) return 'an unknown amount (open the Item Market once to fill in prices)';
  const range = low === high ? `${exact ? '' : '≈ '}${money(low)}` : `≈ ${money(low)}–${money(high)}`;
  return unknown ? `${range} + ${plural(unknown, 'unpriced item')}` : range;
}

function renderCrime(groups: CrimeGroup[]): string {
  if (groups.length === 0) return '';
  const missing = groups.filter((g) => g.lockedCount === 0);
  if (missing.length === 0) {
    return `<div class="ff-as-note">Every Crime Req item you own has a locked copy.</div>`;
  }
  const chips = missing
    .map((g) => `<span class="ff-as-chip-static" title="${esc(g.copies.length === 1 ? 'Your only copy.' : `Would lock ${g.best.label}.`)}">${esc(g.baseName)}${g.copies.length > 1 ? ` ×${g.copies.length}` : ''}</span>`)
    .join('');
  const busy = mode !== 'idle';
  return `
    <div class="ff-as-crime">
      <div class="ff-as-crime-head">${plural(missing.length, 'Crime Req item')} with no locked copy. Selling or using the last one loses it for your crimes.</div>
      <div class="ff-as-chips">${chips}</div>
      <button type="button" class="ff-as-btn ff-as-btn-lock" data-action="lock-start" ${busy ? 'disabled' : ''}>Lock one of each (${missing.length})</button>
    </div>`;
}

function chip(field: 'rarity' | 'slot', value: string, label: string, count: number, on: boolean): string {
  return `<button type="button" class="ff-as-chip${on ? ' on' : ''}" data-chip="${field}" data-value="${esc(value)}">${esc(label)} <span class="ff-as-chip-n">${count}</span></button>`;
}

function renderForm(items: InvItem[]): string {
  const candidates = items.filter((i) => i.sellable && !i.locked);
  const countBy = (pick: (i: InvItem) => string) => {
    const m = new Map<string, number>();
    for (const i of candidates) m.set(pick(i), (m.get(pick(i)) ?? 0) + 1);
    return m;
  };
  const byRarity = countBy((i) => i.quality);
  const byType = countBy((i) => i.type);

  const rarityChips = rarityOptions()
    .filter(([value]) => byRarity.has(value) || criteria.rarities.includes(value))
    .map(([value, label]) => chip('rarity', value, label, byRarity.get(value) ?? 0, criteria.rarities.includes(value)))
    .join('');
  const slotChips = [...new Set([...byType.keys(), ...criteria.slots])]
    .filter(Boolean)
    .sort()
    .map((t) => chip('slot', t, titleCase(t), byType.get(t) ?? 0, criteria.slots.includes(t)))
    .join('');

  return `
    <div class="ff-as-field"><div class="ff-as-label">Rarity <span class="ff-as-req">required</span></div><div class="ff-as-chips">${rarityChips || '<span class="ff-as-note">No sellable items.</span>'}</div></div>
    <div class="ff-as-field"><div class="ff-as-label">Slot <span class="ff-as-hint">none picked = every slot</span></div><div class="ff-as-chips">${slotChips}</div></div>
    <div class="ff-as-row">
      <label class="ff-as-field"><span class="ff-as-label">Highest upgrade</span><input type="number" min="0" step="1" data-input="maxUpgrade" placeholder="any" value="${criteria.maxUpgrade ?? ''}"></label>
      <label class="ff-as-field"><span class="ff-as-label">Keep items worth over $</span><input type="number" min="0" step="1000" data-input="maxPrice" placeholder="no cap" value="${criteria.maxPrice ?? ''}"></label>
    </div>
    <label class="ff-as-field"><span class="ff-as-label">Never sell <span class="ff-as-hint">one item name per line</span></span><textarea rows="2" data-input="neverSell" placeholder="e.g. Old Money Gloves">${esc(criteria.neverSell.map(titleCase).join('\n'))}</textarea></label>`;
}

function renderPreview(p: Plan): string {
  if (criteria.rarities.length === 0) return `<div class="ff-as-note">Pick at least one rarity to see what would be sold.</div>`;
  const lines: string[] = [];
  if (p.sell.length === 0) {
    lines.push(`<div class="ff-as-note">Nothing matches these criteria.</div>`);
  } else {
    lines.push(`<div class="ff-as-main"><b>${plural(p.sell.length, 'item')}</b> would sell for <span class="ff-as-total">${totalText(p.sell)}</span></div>`);
    const rows = p.sell
      .map(
        ({ item, price }) =>
          `<div class="ff-as-item"><span class="ff-as-item-name">${esc(item.label)}</span>${item.crime ? '<span class="ff-as-tag-crime">crime spare</span>' : ''}<span class="ff-as-item-price">${priceText(price)}</span></div>`,
      )
      .join('');
    lines.push(`<div class="ff-as-list">${rows}</div>`);
  }
  if (p.keptCrime.length) {
    lines.push(
      `<div class="ff-as-note ff-as-warn">Keeping 1 copy each of ${p.keptCrime.map((i) => esc(i.baseName)).join(', ')}: Crime Req with no locked copy. Lock them above to keep them safe for good.</div>`,
    );
  }
  if (p.overCap.length) lines.push(`<div class="ff-as-note">${plural(p.overCap.length, 'item')} over your price cap kept.</div>`);
  if (criteria.maxPrice != null && p.sell.length) lines.push(`<div class="ff-as-note">The cap is checked again against the game's own quote before each sale.</div>`);
  return lines.join('');
}

function renderControls(p: Plan, groups: CrimeGroup[]): string {
  if (mode === 'running') {
    const pct = progressTotal ? Math.round((progressDone / progressTotal) * 100) : 0;
    return `
      <div class="ff-as-run">
        <div class="ff-as-run-text"><span class="ff-as-spin"></span>${esc(progressText)}</div>
        <div class="ff-as-bar"><div style="width:${pct}%"></div></div>
        <button type="button" class="ff-as-btn ff-as-btn-ghost" data-action="stop" ${cancelRequested ? 'disabled' : ''}>${cancelRequested ? 'Stopping after this item…' : `Stop after this ${runningKind === 'sell' ? 'sale' : 'lock'}`}</button>
      </div>`;
  }
  if (mode === 'confirm-sell') {
    return `
      <div class="ff-as-confirm">
        <div>Quick-sell ${plural(p.sell.length, 'item')} for ${totalText(p.sell)}? Sold items are gone for good.</div>
        <div class="ff-as-actions"><button type="button" class="ff-as-btn ff-as-btn-danger" data-action="sell-confirm">Confirm</button><button type="button" class="ff-as-btn ff-as-btn-ghost" data-action="cancel">Cancel</button></div>
      </div>`;
  }
  if (mode === 'confirm-lock') {
    const missing = groups.filter((g) => g.lockedCount === 0);
    return `
      <div class="ff-as-confirm">
        <div>Lock ${missing.map((g) => esc(g.best.label)).join(', ')}?</div>
        <div class="ff-as-actions"><button type="button" class="ff-as-btn" data-action="lock-confirm">Confirm</button><button type="button" class="ff-as-btn ff-as-btn-ghost" data-action="cancel">Cancel</button></div>
      </div>`;
  }
  if (!expanded) return '';
  return `<button type="button" class="ff-as-btn ff-as-btn-danger" data-action="sell-start" ${p.sell.length ? '' : 'disabled'}>Sell ${plural(p.sell.length, 'item')}</button>`;
}

function renderSummary(): string {
  if (!summary) return '';
  const s = summary;
  const parts: string[] = [];
  if (s.kind === 'sell') {
    parts.push(`Sold ${plural(s.done, 'item')} for ${money(s.payout)}.`);
    if (s.overPrice) parts.push(`${plural(s.overPrice, 'item')} quoted over your cap and kept.`);
  } else {
    parts.push(`Locked ${plural(s.done, 'item')}.`);
  }
  if (s.skipped) parts.push(`${plural(s.skipped, 'item')} skipped (gone or locked since the preview).`);
  if (s.cancelled) parts.push('Stopped by you.');
  const stopped = s.stopped ? `<div class="ff-as-stop">Stopped: ${esc(s.stopped)}</div>` : '';
  return `<div class="ff-as-summary"><button type="button" class="ff-as-x" data-action="dismiss" title="Dismiss">✕</button>${parts.join(' ')}${stopped}</div>`;
}

const renderedHtml = new WeakMap<Element, string>();

function setHtml(el: Element | null, html: string): void {
  if (!el || renderedHtml.get(el) === html) return;
  renderedHtml.set(el, html);
  el.innerHTML = html;
}

function paintCrimeTags(items: InvItem[], groups: CrimeGroup[]): void {
  const flagged = new Set(groups.filter((g) => g.lockedCount === 0).map((g) => g.key));
  for (const item of items) {
    const want = item.crime && !item.locked && flagged.has(item.key);
    let tag = item.card.querySelector(`.${CRIME_TAG_CLASS}`);
    if (!want) {
      tag?.remove();
      continue;
    }
    if (tag) continue;
    tag = document.createElement('div');
    tag.className = CRIME_TAG_CLASS;
    tag.textContent = 'Crime item · none locked';
    tag.setAttribute('title', 'A crime needs you to own this, and no copy of it is locked yet.');
    (item.card.querySelector('.inv-info') ?? item.card).appendChild(tag);
  }
}

function render(): void {
  const panel = document.getElementById(PANEL_ID);
  const root = document.getElementById(SEARCH_INPUT_ID)?.parentElement;
  if (!panel || !root) return;

  const items = readItems(root);
  const groups = crimeGroups(items);
  const p = plan(items, groups);
  paintCrimeTags(items, groups);

  setHtml(panel.querySelector('.ff-as-crime-slot'), renderCrime(groups));
  setHtml(
    panel.querySelector('.ff-as-toggle-slot'),
    `<button type="button" class="ff-as-toggle" data-action="toggle">${expanded ? '▾' : '▸'} Auto-Sell${!expanded && criteria.rarities.length ? ` <span class="ff-as-hint">${plural(p.sell.length, 'item')} match</span>` : ''}</button>`,
  );

  const form = panel.querySelector('.ff-as-form-slot');
  // Typing in a field must not have the field rebuilt under the cursor; the
  // chip counts it would refresh can wait for the next change elsewhere.
  const typing = form?.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
  if (!typing) setHtml(form, expanded ? renderForm(items) : '');
  setHtml(panel.querySelector('.ff-as-preview-slot'), expanded ? renderPreview(p) : '');
  setHtml(panel.querySelector('.ff-as-controls-slot'), renderControls(p, groups));
  setHtml(panel.querySelector('.ff-as-summary-slot'), renderSummary());
}

let scheduled = false;
function scheduleRender(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    render();
  });
}

// ---------------------------------------------------------------- batches

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gap([lo, hi]: [number, number]): number {
  return Math.max(0, lo + Math.random() * (hi - lo) - ACTION_PACING_MS);
}

/** The live card for `invId`, or why the batch can't go on. */
function liveCard(invId: number): { card: Element | null; leftPage: boolean } {
  const root = document.getElementById(SEARCH_INPUT_ID)?.parentElement;
  if (!root) return { card: null, leftPage: true };
  return { card: root.querySelector(`.inv-card[data-inv="${invId}"]`), leftPage: false };
}

function reloadInventory(): void {
  window.postMessage({ source: 'ff-content', type: 'reload-panel', panel: 'inventory' }, window.location.origin);
}

async function runBatch(kind: 'sell' | 'lock', run: (s: Summary) => Promise<void>): Promise<void> {
  if (batchInFlight) return;
  batchInFlight = true;
  mode = 'running';
  runningKind = kind;
  cancelRequested = false;
  summary = null;
  const s: Summary = { kind, done: 0, payout: 0, overPrice: 0, skipped: 0, stopped: null, cancelled: false };
  try {
    await run(s);
  } catch (err) {
    s.stopped = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, `inventory ${kind} batch failed`, err);
  } finally {
    chrome.runtime.sendMessage({ type: 'inventory-batch-finished' }).catch(() => {});
    batchInFlight = false;
    mode = 'idle';
    summary = s;
    if (s.done > 0) reloadInventory();
    scheduleRender();
  }
}

function sellBatch(sales: PlannedSale[], maxPrice: number | null): Promise<void> {
  return runBatch('sell', async (s) => {
    progressTotal = sales.length;
    for (let i = 0; i < sales.length; i++) {
      if (cancelRequested) {
        s.cancelled = true;
        return;
      }
      const { item } = sales[i];
      const { card, leftPage } = liveCard(item.invId);
      if (leftPage) {
        s.stopped = 'you left the inventory page.';
        return;
      }
      if (!card || card.getAttribute('data-locked') === '1') {
        s.skipped++;
        continue;
      }
      progressDone = i;
      progressText = `Selling ${item.label} (${i + 1} of ${sales.length})`;
      scheduleRender();
      if (i > 0) await sleep(gap(BETWEEN_SALES_MS));

      const result = (await chrome.runtime.sendMessage({
        type: 'inventory-sell-item-requested',
        invId: item.invId,
        expectedName: item.baseName,
        isCrime: item.crime,
        maxPrice,
      })) as InventorySellResult;

      if (result.status === 'stopped') {
        s.stopped = `${item.label}: ${result.error}`;
        return;
      }
      if (result.status === 'over-price') {
        s.overPrice++;
        // So the next preview already knows it's over the cap.
        recordQuote(String(item.invId), item.baseName, result.cash);
        continue;
      }
      s.done++;
      s.payout += result.payout;
      // Gone from the server, so the card shouldn't be offered again by a
      // re-plan before the inventory reloads.
      card.remove();
      if (result.stopAfter) {
        s.stopped = result.stopAfter;
        return;
      }
    }
    progressDone = sales.length;
  });
}

function lockBatch(targets: InvItem[]): Promise<void> {
  return runBatch('lock', async (s) => {
    progressTotal = targets.length;
    for (let i = 0; i < targets.length; i++) {
      if (cancelRequested) {
        s.cancelled = true;
        return;
      }
      const item = targets[i];
      const { card, leftPage } = liveCard(item.invId);
      if (leftPage) {
        s.stopped = 'you left the inventory page.';
        return;
      }
      if (!card || card.getAttribute('data-locked') === '1') {
        s.skipped++;
        continue;
      }
      progressDone = i;
      progressText = `Locking ${item.label} (${i + 1} of ${targets.length})`;
      scheduleRender();
      if (i > 0) await sleep(gap(BETWEEN_LOCKS_MS));

      const result = (await chrome.runtime.sendMessage({ type: 'inventory-lock-item-requested', invId: item.invId })) as InventoryLockResult;
      if (result.status === 'stopped') {
        s.stopped = `${item.label}: ${result.error}`;
        return;
      }
      s.done++;
      // Marked here too, so the flags clear right away rather than after the
      // reload, and a re-plan already treats it as the kept copy.
      card.setAttribute('data-locked', '1');
    }
    progressDone = targets.length;
  });
}

// ---------------------------------------------------------------- events

let saveTimer: number | undefined;
function saveCriteria(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    storage.setInventoryAutoSellCriteria(criteria).catch((err) => console.error(LOG_PREFIX, 'saving auto-sell criteria failed', err));
  }, 400);
}

function currentPlan(): { p: Plan; groups: CrimeGroup[] } | null {
  const root = document.getElementById(SEARCH_INPUT_ID)?.parentElement;
  if (!root) return null;
  const items = readItems(root);
  const groups = crimeGroups(items);
  return { p: plan(items, groups), groups };
}

function onClick(event: Event): void {
  const target = (event.target as Element).closest<HTMLElement>('[data-action], [data-chip]');
  if (!target || !document.getElementById(PANEL_ID)?.contains(target)) return;
  event.preventDefault();
  event.stopPropagation();

  const chipField = target.dataset.chip;
  if (chipField && mode === 'idle') {
    const list = chipField === 'rarity' ? criteria.rarities : criteria.slots;
    const value = target.dataset.value ?? '';
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    criteria = chipField === 'rarity' ? { ...criteria, rarities: next } : { ...criteria, slots: next };
    saveCriteria();
    scheduleRender();
    return;
  }

  switch (target.dataset.action) {
    case 'toggle':
      expanded = !expanded;
      break;
    case 'sell-start':
      if (mode === 'idle') mode = 'confirm-sell';
      break;
    case 'lock-start':
      if (mode === 'idle') mode = 'confirm-lock';
      break;
    case 'cancel':
      if (mode !== 'running') mode = 'idle';
      break;
    case 'stop':
      cancelRequested = true;
      break;
    case 'dismiss':
      summary = null;
      break;
    case 'sell-confirm': {
      // Re-planned from the live page at the moment of confirming, not
      // taken from whatever the preview last showed.
      const current = currentPlan();
      if (mode !== 'confirm-sell' || !current || current.p.sell.length === 0) {
        mode = 'idle';
        break;
      }
      void sellBatch(current.p.sell, criteria.maxPrice);
      break;
    }
    case 'lock-confirm': {
      const current = currentPlan();
      const targets = current?.groups.filter((g) => g.lockedCount === 0).map((g) => g.best) ?? [];
      if (mode !== 'confirm-lock' || targets.length === 0) {
        mode = 'idle';
        break;
      }
      void lockBatch(targets);
      break;
    }
  }
  scheduleRender();
}

function onInput(event: Event): void {
  const el = event.target as HTMLInputElement | HTMLTextAreaElement;
  const field = el.dataset?.input;
  if (!field || !document.getElementById(PANEL_ID)?.contains(el)) return;
  event.stopPropagation();

  if (field === 'neverSell') {
    const names = el.value
      .split(/[\n,]/)
      .map((n) => n.trim().toLowerCase().replace(/[’‘]/g, "'"))
      .filter(Boolean);
    criteria = { ...criteria, neverSell: [...new Set(names)] };
  } else {
    const n = el.value.trim() === '' ? null : Math.max(0, Math.floor(Number(el.value)));
    const value = n == null || Number.isNaN(n) ? null : n;
    criteria = field === 'maxUpgrade' ? { ...criteria, maxUpgrade: value } : { ...criteria, maxPrice: value };
  }
  saveCriteria();
  scheduleRender();
}

// ---------------------------------------------------------------- mounting

let rootObserver: MutationObserver | null = null;
let observedRoot: Element | null = null;

function ensurePanel(): void {
  const input = document.getElementById(SEARCH_INPUT_ID);
  const root = input?.parentElement;
  if (!input || !root) return;

  // After the Quick Sell bar when that's on, so the two features never
  // fight over the slot right under the search box.
  const anchor = input.nextElementSibling?.id === QS_BAR_ID ? input.nextElementSibling : input;
  let changed = false;
  if (anchor.nextElementSibling?.id !== PANEL_ID) {
    document.getElementById(PANEL_ID)?.remove();
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `${brandBadgeHtml('Auto-Sell & Crime Locks')}<div class="ff-as-crime-slot"></div><div class="ff-as-toggle-slot"></div><div class="ff-as-form-slot"></div><div class="ff-as-preview-slot"></div><div class="ff-as-controls-slot"></div><div class="ff-as-summary-slot"></div>`;
    panel.addEventListener('click', onClick);
    panel.addEventListener('input', onInput);
    // The game's inventory has its own key handlers on the search box area;
    // typing in this panel's fields must stay here.
    panel.addEventListener('keydown', (e) => e.stopPropagation());
    anchor.insertAdjacentElement('afterend', panel);
    changed = true;
  }

  if (observedRoot !== root) {
    rootObserver?.disconnect();
    observedRoot = root;
    rootObserver = new MutationObserver(scheduleRender);
    rootObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-locked', 'class'] });
    changed = true;
  }
  if (changed) scheduleRender();
}

const STYLE = `
#${PANEL_ID} {
  margin: 0 0 10px; padding: 10px 12px;
  background: rgba(245,158,11,0.04); border: 1px solid rgba(245,158,11,0.22); border-radius: 10px;
  font-family: 'Inter', system-ui, sans-serif; display: flex; flex-direction: column; gap: 7px;
  font-size: 0.7rem; color: #d1d5db;
}
#${PANEL_ID} button { font-family: inherit; }
.ff-as-note { font-size: 0.65rem; color: #9ca3af; line-height: 1.5; }
.ff-as-warn { color: #fbbf24; }
.ff-as-hint { font-weight: 500; color: #6b7280; text-transform: none; letter-spacing: 0; }
.ff-as-req { font-weight: 700; color: #f59e0b; text-transform: none; letter-spacing: 0; }
.ff-as-crime { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; background: rgba(245,158,11,0.07); border: 1px solid rgba(245,158,11,0.25); }
.ff-as-crime-head { color: #fbbf24; font-weight: 700; line-height: 1.4; }
.ff-as-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.ff-as-chip-static { padding: 3px 7px; border-radius: 6px; background: rgba(0,0,0,0.3); border: 1px solid rgba(245,158,11,0.3); color: #fde68a; font-size: 0.62rem; font-weight: 700; }
.ff-as-chip { padding: 4px 8px; border-radius: 6px; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.1); color: #9ca3af; font-size: 0.62rem; font-weight: 700; cursor: pointer; }
.ff-as-chip.on { background: rgba(74,222,128,0.12); border-color: rgba(74,222,128,0.45); color: #bbf7d0; }
.ff-as-chip-n { opacity: 0.6; margin-left: 2px; }
.ff-as-toggle { align-self: flex-start; background: none; border: none; padding: 0; color: #f3f4f6; font-size: 0.75rem; font-weight: 800; cursor: pointer; }
.ff-as-form-slot { display: flex; flex-direction: column; gap: 8px; }
.ff-as-form-slot:empty, .ff-as-preview-slot:empty, .ff-as-controls-slot:empty, .ff-as-summary-slot:empty, .ff-as-crime-slot:empty { display: none; }
.ff-as-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.ff-as-label { font-size: 0.58rem; font-weight: 800; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.06em; }
.ff-as-row { display: flex; gap: 8px; }
#${PANEL_ID} input, #${PANEL_ID} textarea {
  width: 100%; box-sizing: border-box; padding: 6px 8px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px; color: #fff; font-size: 0.7rem; font-family: inherit; resize: vertical;
}
.ff-as-preview-slot { display: flex; flex-direction: column; gap: 5px; }
.ff-as-main { font-size: 0.78rem; }
.ff-as-main b { color: #f3f4f6; }
.ff-as-total { font-family: 'SF Mono', 'Roboto Mono', ui-monospace, Menlo, monospace; font-weight: 800; color: #4ade80; }
.ff-as-list { max-height: 180px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; }
.ff-as-item { display: flex; align-items: center; gap: 6px; padding: 4px 8px; font-size: 0.64rem; border-bottom: 1px solid rgba(255,255,255,0.04); }
.ff-as-item:last-child { border-bottom: none; }
.ff-as-item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e5e7eb; }
.ff-as-item-price { font-family: 'SF Mono', 'Roboto Mono', ui-monospace, Menlo, monospace; color: #86efac; white-space: nowrap; }
.ff-as-tag-crime { font-size: 0.55rem; font-weight: 800; color: #f59e0b; white-space: nowrap; }
.ff-as-btn { align-self: flex-start; padding: 7px 12px; border-radius: 7px; border: 1px solid rgba(74,222,128,0.35); background: rgba(74,222,128,0.1); color: #4ade80; font-size: 0.65rem; font-weight: 800; cursor: pointer; text-transform: uppercase; letter-spacing: 0.04em; }
.ff-as-btn:disabled { opacity: 0.4; cursor: default; }
.ff-as-btn-lock { border-color: rgba(245,158,11,0.4); background: rgba(245,158,11,0.12); color: #fbbf24; }
.ff-as-btn-danger { border-color: rgba(248,113,113,0.4); background: rgba(248,113,113,0.1); color: #f87171; }
.ff-as-btn-ghost { border-color: rgba(255,255,255,0.12); background: transparent; color: #9ca3af; }
.ff-as-confirm { display: flex; flex-direction: column; gap: 8px; padding: 8px; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); line-height: 1.5; }
.ff-as-actions { display: flex; gap: 6px; }
.ff-as-run { display: flex; flex-direction: column; gap: 6px; }
.ff-as-run-text { display: flex; align-items: center; gap: 6px; }
.ff-as-spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid rgba(74,222,128,0.25); border-top-color: #4ade80; animation: ff-as-spin 0.8s linear infinite; flex-shrink: 0; }
@keyframes ff-as-spin { to { transform: rotate(360deg); } }
.ff-as-bar { height: 4px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden; }
.ff-as-bar > div { height: 100%; background: #4ade80; transition: width 0.3s; }
.ff-as-summary { position: relative; padding: 8px 24px 8px 8px; border-radius: 8px; background: rgba(74,222,128,0.06); border: 1px solid rgba(74,222,128,0.2); line-height: 1.5; }
.ff-as-stop { color: #f87171; margin-top: 3px; }
.ff-as-x { position: absolute; top: 4px; right: 6px; background: none; border: none; color: #6b7280; cursor: pointer; font-size: 0.7rem; }
.${CRIME_TAG_CLASS} { font-size: 0.55rem; font-weight: 800; margin-top: 3px; letter-spacing: 0.02em; color: #f59e0b; }
`;

export function initInventoryAutoSell(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + STYLE);

  storage.getInventoryAutoSellCriteria().then((c) => {
    criteria = c;
    scheduleRender();
  });
  storage.getQuickSellPriceBook().then((b) => {
    book = b;
    scheduleRender();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const nextBook = changes[STORAGE_KEYS.QUICK_SELL_PRICE_BOOK]?.newValue as QuickSellPriceBook | undefined;
    if (nextBook) {
      book = nextBook;
      scheduleRender();
    }
  });

  const observer = new MutationObserver(() => {
    if (document.getElementById(SEARCH_INPUT_ID)) ensurePanel();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
