/**
 * One-off repair for trades corrupted by the dropped-top-up-buy bug.
 *
 * WHERE TO RUN (Firefox): about:debugging#/runtime/this-firefox -> find "The Fifth
 * Family Enhancements" -> click "Inspect" -> the Console tab of the window that opens.
 * That console is the extension's background event page, which is the only context on
 * the moz-extension:// origin where the Dexie database exists. (Firefox may need the
 * console's "Paste" confirmation typed once before it accepts pasted script.)
 *
 * Starts in DRY RUN: it prints every change it would make and writes nothing.
 * Review the output, then set DRY_RUN = false below and paste again to apply.
 */
const DRY_RUN = false;

(async () => {
  const DB_NAME = 'FifthFamilyTradeAssistant';

  const openDb = () =>
    new Promise((resolve, reject) => {
      // No version argument — attaching at whatever version exists on disk, so this
      // never triggers a schema upgrade of its own.
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  const readAll = (db, store) =>
    new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  // Firefox's promise-based namespace is `browser`; `chrome` is the Chromium spelling.
  // Preferring whichever exists keeps this paste-able in either console.
  const api = globalThis.browser ?? globalThis.chrome;

  const db = await openDb();
  const trades = await readAll(db, 'trades');
  const ctx = (await api.storage.local.get('ff_last_smuggling_context'))['ff_last_smuggling_context'] ?? null;

  const money = (n) => `$${Math.round(n).toLocaleString()}`;
  const repairs = [];

  // --- 1. The live open trade -------------------------------------------------
  // The smuggling panel's stash count is authoritative for what is actually in the
  // hold; the trade record's `quantity` is only what the extension managed to capture.
  // Where they disagree, the units it missed were bought at the same posted district
  // price as the ones it saw, so the recorded unit cost prices the whole hold.
  if (ctx?.heldItem && ctx.heldQuantity > 0) {
    const open = trades.filter((t) => t.status === 'open' && t.item === ctx.heldItem).pop();

    if (!open) {
      console.warn(`[repair] holding ${ctx.heldQuantity}x ${ctx.heldItem} but no open trade on record — nothing to fix`);
    } else if (open.quantity === ctx.heldQuantity) {
      console.log(`[repair] open trade for ${open.item} already matches the hold (${open.quantity}) — no change`);
    } else if (!(open.quantity > 0) || !(open.buyPrice > 0)) {
      console.warn(`[repair] open trade ${open.id} has no usable unit cost (qty ${open.quantity}, basis ${open.buyPrice}) — skipping`);
    } else {
      const unitCost = open.buyPrice / open.quantity;
      repairs.push({
        record: { ...open, quantity: ctx.heldQuantity, buyPrice: Math.round(unitCost * ctx.heldQuantity) },
        why: `open ${open.item}: qty ${open.quantity} -> ${ctx.heldQuantity}, ` +
             `basis ${money(open.buyPrice)} -> ${money(unitCost * ctx.heldQuantity)} (at ${money(unitCost)}/unit)`,
      });
    }
  } else {
    console.log('[repair] no cargo currently held — skipping open-trade check');
  }

  // --- 2. Closed trades -------------------------------------------------------
  // For a captured sell, the game reports both the sale total and its own profit
  // figure, so `sellPrice - grossProfit` is the cost basis the game itself used —
  // exact, and independent of anything the extension inferred from price snapshots.
  // Reconciled trades are excluded: their grossProfit was *derived from* buyPrice, so
  // the identity holds trivially and proves nothing.
  for (const t of trades) {
    if (t.status !== 'closed' || t.reconciled) continue;
    if (t.sellPrice == null || t.grossProfit == null) continue;

    const trueBasis = t.sellPrice - t.grossProfit;
    if (!(trueBasis > 0) || Math.abs(trueBasis - t.buyPrice) <= 1) continue;

    const costBasis = trueBasis + (t.travelCost ?? 0) + (t.bribe ?? 0);
    const roi = t.profit != null && costBasis > 0 ? t.profit / costBasis : t.roi;
    repairs.push({
      record: { ...t, buyPrice: trueBasis, roi },
      why: `closed #${t.id} ${t.item}: basis ${money(t.buyPrice)} -> ${money(trueBasis)}, ` +
           `roi ${t.roi == null ? 'null' : (t.roi * 100).toFixed(1) + '%'} -> ${roi == null ? 'null' : (roi * 100).toFixed(1) + '%'}`,
    });
  }

  // --- report / apply ---------------------------------------------------------
  if (repairs.length === 0) {
    console.log('[repair] nothing to fix.');
    db.close();
    return;
  }

  console.log(`[repair] ${repairs.length} record(s) to fix:`);
  for (const r of repairs) console.log('   ' + r.why);

  if (DRY_RUN) {
    console.log('[repair] DRY RUN — nothing written. Set DRY_RUN = false and run again to apply.');
    db.close();
    return;
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction('trades', 'readwrite');
    const store = tx.objectStore('trades');
    for (const r of repairs) store.put(r.record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  console.log(`[repair] applied ${repairs.length} fix(es).`);
  db.close();
})().catch((err) => console.error('[repair] failed', err));
