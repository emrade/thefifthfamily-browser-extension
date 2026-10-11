import { GAME_ORIGIN } from '@/shared/constants';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import type { InventoryLockResult, InventoryPriceResult, InventorySellResult } from '@/shared/types';
import { ACTION_PACING_MS, postAction, sleep } from '../../gameAction';

/**
 * Backs the Inventory Auto-Sell panel's two manual, confirm-first batches:
 * quick-selling every item that matches the player's criteria, and locking
 * one copy of each Crime Req item. Same shape as `features/garage`: one real
 * game action (or action pair) per exported function, called once per item
 * by the page's own batch loop.
 *
 * Request shapes, from every capture in the 2026-08-11 → 2026-10-03 archives:
 *
 * - `POST /actions/shops_v2.php action=dispose_quote&inv_id=N` (87 seen) →
 *   `{ok, name, cash, gold, capstone_warning?}`. `capstone_warning` (a crime
 *   name, e.g. "Debt Collection") only ever appears on Crime Req items.
 * - `POST /actions/shops_v2.php action=quicksell&inv_id=N` (61 seen) →
 *   `{ok, inv_id, remaining, message, kind:"quicksell", payout}`. Every one
 *   was preceded by a `dispose_quote` for the same `inv_id`, 0.8–5.6s
 *   earlier, every one echoed `remaining: 0`, and every `payout` equalled
 *   the quote's `cash`. Neither action has ever been seen with any other
 *   field, so `action`, `inv_id` and `_csrf` are the whole request.
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

/** Quote → sale gap, total including `postAction`'s own pacing. The player's
 *  own 61 sales ran 0.8–5.6s apart, most of them 1–2.5s. */
const QUOTE_TO_SELL_MS: [number, number] = [900, 2400];

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

export async function sellItem(
  invId: number,
  expectedName: string,
  isCrime: boolean,
  maxPrice: number | null,
  tabId: number | undefined,
): Promise<InventorySellResult> {
  if (!claimLease(tabId)) return BUSY;
  try {
    const quote = await postAction('/actions/shops_v2.php', { action: 'dispose_quote', inv_id: invId });
    if (quote.ok !== true) return { status: 'stopped', error: `Quote refused: ${errorText(quote, 'no reason given')}` };
    if (typeof quote.cash !== 'number' || typeof quote.name !== 'string') {
      return { status: 'stopped', error: 'The quote came back in a shape this tool doesn’t recognize, so nothing was sold.' };
    }
    if (normalizeName(quote.name) !== normalizeName(expectedName)) {
      return { status: 'stopped', error: `Quoted "${quote.name}" for a card named "${expectedName}", so it wasn't sold.` };
    }
    if (quote.capstone_warning && !isCrime) {
      return {
        status: 'stopped',
        error: `${quote.name} came back tied to the crime "${quote.capstone_warning}" though its card isn't marked Crime Req, so it wasn't sold.`,
      };
    }
    if (maxPrice != null && quote.cash > maxPrice) return { status: 'over-price', cash: quote.cash };

    await sleep(Math.max(0, randomBetween(QUOTE_TO_SELL_MS) - ACTION_PACING_MS));
    lease = { tabId, at: Date.now() };

    const sale = await postAction('/actions/shops_v2.php', { action: 'quicksell', inv_id: invId });
    lease = { tabId, at: Date.now() };
    if (sale.ok !== true) return { status: 'stopped', error: `Sale refused: ${errorText(sale, 'no reason given')}` };
    if (typeof sale.payout !== 'number' || Number(sale.inv_id) !== invId || sale.kind !== 'quicksell') {
      return { status: 'stopped', error: 'The sale came back in a shape this tool doesn’t recognize. Check your inventory before running again.' };
    }

    const message = typeof sale.message === 'string' ? sale.message : '';
    let stopAfter: string | undefined;
    if (sale.payout !== quote.cash) stopAfter = `${quote.name} paid $${sale.payout.toLocaleString()}, not the quoted $${quote.cash.toLocaleString()}.`;
    else if (Number(sale.remaining) !== 0) stopAfter = `${quote.name} left ${sale.remaining} behind after selling, which hasn't happened before.`;
    return { status: 'sold', payout: sale.payout, message, stopAfter };
  } catch (err) {
    return { status: 'stopped', error: err instanceof Error ? err.message : String(err) };
  }
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
