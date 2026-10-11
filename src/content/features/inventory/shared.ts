/**
 * What the inventory's Quick-Sell bar and Auto-Sell panel share.
 *
 * A card's $ button: `Game.disposeItemV2(id,'quicksell',name)` until
 * 2026-10-11, when the Item Market was rebuilt and it became
 * `IMV2.sellSheet(id, …)`, opening the new market's sell sheet. Both
 * spellings are matched, so a card from a stale panel still counts.
 *
 * The button alone no longer means "quick-sellable": the old one only ever
 * sat on unlocked gear, but the sell sheet is for listing too, so since the
 * rebuild consumables carry it as well (every consumable sheet seen so far
 * says `quicksell: false`). These features are for equipment only, by the
 * player's choice, so a card also has to be one of the seven gear slots.
 */
const QUICKSELL_BUTTON_SELECTOR = `[onclick*="IMV2.sellSheet("], [onclick*="'quicksell'"]`;

/** The Item Market's gear categories (`view=home` `cats`, minus
 *  `consumable`), matched against the card's `data-type`. */
const EQUIPMENT_TYPES = new Set(['weapon', 'armor', 'helmet', 'gloves', 'belt', 'necklace', 'special']);

/** Equipment with a $ button. Locked cards have none. */
export function isQuickSellable(card: Element): boolean {
  return EQUIPMENT_TYPES.has(card.getAttribute('data-type') ?? '') && card.querySelector(QUICKSELL_BUTTON_SELECTOR) !== null;
}

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
