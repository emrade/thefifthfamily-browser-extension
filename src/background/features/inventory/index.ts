import { GAME_ORIGIN } from '@/shared/constants';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import type { InventoryBulkQuoteResult, InventoryBulkSellResult, InventoryLockResult, InventoryPriceResult } from '@/shared/types';
import { depositCashOnHand, postAction } from '../../gameAction';

/**
 * Backs the Inventory Auto-Sell panel's two manual, confirm-first batches:
 * quick-selling every item that matches the player's criteria, and locking
 * one copy of each Crime Req item. Same shape as `features/garage`: one real
 * game action per exported function, called by the page's own batch loop
 * (once per item for locks; once per tick and once per sale for selling).
 *
 * Request shapes, from every capture in the 2026-08-11 → 2026-10-14 archives:
 *
 * - `POST /actions/shops_v2.php action=quicksell_bulk_quote&ids=A,B,C`
 *   (32 seen, 2026-10-14, the inventory's Bulk Sell) →
 *   `{ok, count, total, skipped: [], flagged: [{name, note}]}`. The page
 *   re-quotes the whole picked list on every tick and untick, with the ids
 *   always in number order. `flagged` lists Crime Req items with the crime
 *   in `note` ("needed for Back Alley Shakedown"), by name only; it's a
 *   warning, not a block: a flagged Brass Knuckles was sold. `skipped` was
 *   always empty (locked items sit in their own tab and can't be picked).
 * - `POST /actions/shops_v2.php action=quicksell_bulk&ids=…&expect=TOTAL`
 *   (2 seen, 4 and 15 items) → `{ok, sold: [ids], message: "Sold 15 items
 *   for $273,300"}`. Sent 3–4s after a final quote of the same list,
 *   `expect` being that quote's `total`. No other fields on either action.
 * - `POST /actions/shops_v2.php action=dispose_quote&inv_id=N` (87 seen) →
 *   `{ok, name, cash, gold, capstone_warning?}`. `capstone_warning` (a crime
 *   name, e.g. "Debt Collection") only ever appears on Crime Req items.
 *   Still what the sell sheet sends (`priceItem`); selling no longer uses it.
 * - After each `quicksell_bulk`, `POST /actions/bank.php action=deposit&
 *   amount=ALL` (the shared `depositCashOnHand`) banks the payout.
 * - `POST /actions/inventory.php action=lock&inv_id=N` (≈60 seen) →
 *   `{ok, locked: 1, message: "Item locked."}`. Unlock is its own
 *   `action=unlock`, not a toggle, so sending `lock` twice can't unlock.
 *
 * - `GET /actions/item_market_v2.php?view=sell&inv_id=N` (11 seen, all
 *   2026-10-11, the day the Item Market was rebuilt) → `{ok, view:"sell",
 *   item:{name, base, caps, …}, stack:{inv_id, qty, locked, …}, quicksell,
 *   tradeable, …}`. What the inventory's $ button opens; the URL carries
 *   nothing else (no `_t`). Every one was followed 160–190ms later by a
 *   `dispose_quote` for the same `inv_id`: the sheet quotes on open.
 *
 * Every call here returns a result instead of throwing: anything that isn't
 * the response shape above, or any rejection at all, comes back `stopped`
 * so the page ends the whole batch (see feedback: pause on anything
 * unexpected rather than carrying on with the next item).
 */

/** Another tab's batch counts as live for this long after its last call. A
 *  closed tab never sends `inventory-batch-finished`, so a lease that old is
 *  taken over rather than blocking every later batch. */
const LEASE_STALE_MS = 60_000;

let lease: { tabId: number | undefined; at: number } | null = null;

/** Two game tabs each running a batch would quote and sell the same cards
 *  twice over, and the second tab's calls would fail on items the first
 *  already sold — exactly the concurrent-trigger race the other automations
 *  guard against. Only the tab holding the lease may send calls. */
function claimLease(tabId: number | undefined): boolean {
  const now = Date.now();
  if (lease && lease.tabId !== tabId && now - lease.at < LEASE_STALE_MS) return false;
  lease = { tabId, at: now };
  return true;
}

export function releaseLease(tabId: number | undefined): void {
  if (lease?.tabId === tabId) lease = null;
}

const BUSY: { status: 'stopped'; error: string } = {
  status: 'stopped',
  error: 'Another game tab is already running an inventory batch. Let it finish (or close it) and try again.',
};

function randomBetween([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

/** Item names compared the way both sides spell them: the card's `data-name`
 *  is lowercased with `'` decoded, the quote's `name` is title case. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

function errorText(resp: any, fallback: string): string {
  return typeof resp?.error === 'string' ? resp.error : typeof resp?.message === 'string' ? resp.message : fallback;
}

/** The game always sends its picked ids in number order, whatever order they
 *  were ticked in. */
function sortedIds(invIds: number[]): string {
  return [...invIds].sort((a, b) => a - b).join(',');
}

export async function bulkQuote(invIds: number[], tabId: number | undefined): Promise<InventoryBulkQuoteResult> {
  if (!claimLease(tabId)) return BUSY;
  try {
    const quote = await postAction('/actions/shops_v2.php', { action: 'quicksell_bulk_quote', ids: sortedIds(invIds) });
    lease = { tabId, at: Date.now() };
    if (quote.ok !== true) return { status: 'stopped', error: `Quote refused: ${errorText(quote, 'no reason given')}` };
    const flagged = Array.isArray(quote.flagged) ? quote.flagged : null;
    if (
      typeof quote.count !== 'number' ||
      typeof quote.total !== 'number' ||
      !Array.isArray(quote.skipped) ||
      !flagged ||
      !flagged.every((f: any) => typeof f?.name === 'string' && typeof f?.note === 'string')
    ) {
      return { status: 'stopped', error: 'The quote came back in a shape this tool doesn’t recognize, so nothing was sold.' };
    }
    if (quote.skipped.length > 0) {
      return { status: 'stopped', error: `The game skipped ${quote.skipped.length} of the picked items, which hasn't happened before, so nothing was sold.` };
    }
    if (quote.count !== invIds.length) {
      return { status: 'stopped', error: `The game quoted ${quote.count} items for ${invIds.length} picked, so nothing was sold.` };
    }
    return { status: 'quoted', total: quote.total, flagged: flagged.map((f: any) => ({ name: f.name, note: f.note })) };
  } catch (err) {
    return { status: 'stopped', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function bulkSell(invIds: number[], expect: number, tabId: number | undefined): Promise<InventoryBulkSellResult> {
  if (!claimLease(tabId)) return BUSY;
  try {
    const sale = await postAction('/actions/shops_v2.php', { action: 'quicksell_bulk', ids: sortedIds(invIds), expect });
    lease = { tabId, at: Date.now() };
    if (sale.ok !== true) return { status: 'stopped', error: `Sale refused: ${errorText(sale, 'no reason given')}` };
    if (!Array.isArray(sale.sold) || !sale.sold.every((id: unknown) => Number(id) > 0)) {
      return { status: 'stopped', error: 'The sale came back in a shape this tool doesn’t recognize. Check your inventory before running again.' };
    }
    const sold = sale.sold.map(Number) as number[];
    const message = typeof sale.message === 'string' ? sale.message : '';
    const asked = new Set(invIds);
    const paid = Number(message.match(/\$([\d,]+)/)?.[1]?.replace(/,/g, ''));
    let stopAfter: string | undefined;
    if (sold.length !== asked.size || !sold.every((id) => asked.has(id))) {
      stopAfter = `The game sold ${sold.length} of the ${asked.size} items sent, not exactly those. Check your inventory before running again.`;
    } else if (message && paid !== expect) {
      stopAfter = `The game said "${message}", not the quoted $${expect.toLocaleString()}.`;
    }
    const bank = await bankSale();
    return { status: 'sold', sold, payout: expect, message, banked: bank.banked, stopAfter: stopAfter ?? bank.problem };
  } catch (err) {
    return { status: 'stopped', error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sweeps the sale's cash into the bank straight away, like Street Racing and
 *  Real Estate Auto do after a payout: cash on hand is what a mugging takes.
 *  The sale already happened, so a failed deposit doesn't undo it; it comes
 *  back as `problem` and ends the batch so the player knows the cash is still
 *  on hand. "Invalid amount" is the bank's reply with nothing on hand, i.e.
 *  another feature's deposit got there first. */
async function bankSale(): Promise<{ banked: number | null; problem?: string }> {
  let resp: any;
  try {
    resp = await depositCashOnHand('inventory-sell');
  } catch (err) {
    return { banked: null, problem: `Sold, but the deposit failed (${err instanceof Error ? err.message : String(err)}). The cash is on hand.` };
  }
  if (resp?.ok === true) {
    const m = typeof resp.message === 'string' ? /deposited\s+\$([\d,]+)/i.exec(resp.message) : null;
    if (!m) return { banked: null, problem: 'Sold, but the deposit came back in a shape this tool doesn’t recognize. Check your bank.' };
    return { banked: Number(m[1].replace(/,/g, '')) };
  }
  const error = errorText(resp, 'no reason given');
  if (/invalid amount/i.test(error)) return { banked: 0 };
  return { banked: null, problem: `Sold, but the bank refused the deposit: "${error}". The cash is on hand.` };
}

export async function lockItem(invId: number, tabId: number | undefined): Promise<InventoryLockResult> {
  if (!claimLease(tabId)) return BUSY;
  try {
    const resp = await postAction('/actions/inventory.php', { action: 'lock', inv_id: invId });
    lease = { tabId, at: Date.now() };
    if (resp.ok !== true) return { status: 'stopped', error: `Lock refused: ${errorText(resp, 'no reason given')}` };
    if (Number(resp.locked) !== 1) return { status: 'stopped', error: 'The lock came back in a shape this tool doesn’t recognize.' };
    return { status: 'locked' };
  } catch (err) {
    return { status: 'stopped', error: err instanceof Error ? err.message : String(err) };
  }
}

/** What tapping an item's $ button asks for: the sell sheet, then its quote.
 *  Nothing is sold; the batch only wants `item.base` and the exact payout. */
export async function priceItem(invId: number, expectedName: string, tabId: number | undefined): Promise<InventoryPriceResult> {
  if (!claimLease(tabId)) return BUSY;
  try {
    // No pause here or before the quote: the page's gap between items is the
    // "tap", and the real sheet sends its quote the moment the sheet arrives
    // (152–166ms after it in 30 player taps, 2026-10-11 17:01–17:05 UTC,
    // which is just the sheet's own round trip).
    const res = await loggedFetch(`${GAME_ORIGIN}/actions/item_market_v2.php?view=sell&inv_id=${invId}`, { credentials: 'include' });
    let sheet: any;
    try {
      sheet = await res.json();
    } catch {
      return { status: 'stopped', error: `The sell sheet didn't come back as data (status ${res.status}); your session may have expired.` };
    }
    lease = { tabId, at: Date.now() };
    if (sheet?.ok !== true) return { status: 'stopped', error: `Sell sheet refused: ${errorText(sheet, 'no reason given')}` };
    if (sheet.view !== 'sell' || typeof sheet.item?.base !== 'number' || typeof sheet.item?.name !== 'string' || Number(sheet.stack?.inv_id) !== invId) {
      return { status: 'stopped', error: 'The sell sheet came back in a shape this tool doesn’t recognize.' };
    }
    if (normalizeName(sheet.item.name) !== normalizeName(expectedName)) {
      return { status: 'stopped', error: `The sell sheet showed "${sheet.item.name}" for a card named "${expectedName}".` };
    }
    if (sheet.quicksell !== true) {
      return { status: 'stopped', error: `${sheet.item.name} came back as not quick-sellable, which hasn't happened before.` };
    }

    const quote = await postAction('/actions/shops_v2.php', { action: 'dispose_quote', inv_id: invId }, { noPacing: true });
    lease = { tabId, at: Date.now() };
    if (quote.ok !== true) return { status: 'stopped', error: `Quote refused: ${errorText(quote, 'no reason given')}` };
    if (typeof quote.cash !== 'number' || typeof quote.name !== 'string') {
      return { status: 'stopped', error: 'The quote came back in a shape this tool doesn’t recognize.' };
    }
    if (normalizeName(quote.name) !== normalizeName(expectedName)) {
      return { status: 'stopped', error: `Quoted "${quote.name}" for a card named "${expectedName}".` };
    }
    return { status: 'priced', name: quote.name, shopPrice: sheet.item.base, cash: quote.cash };
  } catch (err) {
    return { status: 'stopped', error: err instanceof Error ? err.message : String(err) };
  }
}
