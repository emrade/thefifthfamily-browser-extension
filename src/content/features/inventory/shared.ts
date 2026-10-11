/**
 * What the inventory's Quick-Sell bar and Auto-Sell panel share.
 *
 * A card's $ button: `Game.disposeItemV2(id,'quicksell',name)` until
 * 2026-10-11, when the Item Market was rebuilt and it became
 * `IMV2.sellSheet(id, …)` (opening the new market's sell sheet, which offers
 * both listing and quick-selling). Same cards carry it either way: unlocked
 * gear, never consumables. Both spellings are matched, so a card from a
 * stale panel still counts.
 */
export const QUICKSELL_BUTTON_SELECTOR = `[onclick*="IMV2.sellSheet("], [onclick*="'quicksell'"]`;

export type InventoryBatchKind = 'sell' | 'lock' | 'price';

// Both features send per-item calls from this tab, and background's lease
// only tells tabs apart, so this keeps a price batch and a sell batch in the
// same tab from running at once.
let active: InventoryBatchKind | null = null;

export function beginInventoryBatch(kind: InventoryBatchKind): boolean {
  if (active) return false;
  active = kind;
  return true;
}

export function endInventoryBatch(): void {
  active = null;
}

export function activeInventoryBatch(): InventoryBatchKind | null {
  return active;
}
