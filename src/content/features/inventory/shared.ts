/**
 * What the inventory's Quick-Sell bar and Auto-Sell panel share: where the
 * page is, how to read an item tile, and the one-batch-at-a-time guard.
 *
 * The inventory was rebuilt on 2026-10-15 (`iv2`, between 10:30 and 13:37
 * UTC). Before it, items were `.inv-card` elements under `#invSearch`, with
 * the upgrade level only as a "+N" on the name and a $ button on every
 * sellable card. Now each item is a `.iv2-tile` carrying everything as
 * attributes:
 *
 * | attribute  | meaning                                             |
 * |------------|-----------------------------------------------------|
 * | `data-id`  | inventory id (what every sell/lock call takes)      |
 * | `data-k`   | `gear` or `cons`                                    |
 * | `data-t`   | slot: weapon, armor, helmet, … or `consumable`      |
 * | `data-q`   | rarity, same values as the rarity dropdown          |
 * | `data-e`   | upgrade level (no longer part of the name)          |
 * | `data-lk`  | `1` when locked                                     |
 * | `data-cr`  | `1` for a Crime Req item                            |
 *
 * `data-n` is not the name: it's the search text ("name set rarity slot"),
 * so the name is read from `.iv2-nm`. Equipped gear isn't a tile, same as
 * before. Checked on every tile of the 2026-10-16 09:17 panel: `data-e` and
 * `data-cr` match the page's own item data (`#iv2-data`) on all 195.
 *
 * Only unlocked equipment counts as quick-sellable, by the player's choice:
 * consumables carry a sell option too, but these features are for gear.
 * Variable items are left out too, as the game won't sell them.
 * The server side didn't change with the rebuild: the page's own bulk sell
 * still sends `quicksell_bulk_quote` / `quicksell_bulk`.
 */

const ROOT_ID = 'iv2';
const TOOLBAR_SELECTOR = '.iv2-bar2';
export const CARD_SELECTOR = '.iv2-tile[data-id]';
export const RARITY_SELECT_ID = 'iv2-rar';
/** Tile attributes that change when an item is locked, or shown/hidden by
 *  the page's tabs, chips, rarity and search. */
export const WATCHED_ATTRIBUTES = ['data-lk', 'data-tab', 'hidden', 'style', 'class'];

/** The Item Market's gear categories (`view=home` `cats`, minus
 *  `consumable`), matched against the tile's slot. */
const EQUIPMENT_TYPES = new Set(['weapon', 'armor', 'helmet', 'gloves', 'belt', 'necklace', 'special']);

/** The inventory page, when it's open. */
export function inventoryRoot(): HTMLElement | null {
  return document.getElementById(ROOT_ID);
}

/** The search/sort/filter toolbar our panels sit under. */
export function inventoryToolbar(root: Element): Element | null {
  return root.querySelector(TOOLBAR_SELECTOR);
}

export function cardInvId(card: Element): number {
  return Number(card.getAttribute('data-id'));
}

/** As the game shows it, without the upgrade level. */
export function cardDisplayName(card: Element): string {
  return card.querySelector('.iv2-nm')?.textContent?.trim() ?? '';
}

/** Lowercased name: the key every copy of an item shares, and what the
 *  price book is keyed by. */
export function cardKey(card: Element): string {
  return cardDisplayName(card).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
}

export function cardUpgrade(card: Element): number {
  const n = Number(card.getAttribute('data-e'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function cardQuality(card: Element): string {
  return card.getAttribute('data-q') ?? '';
}

export function cardType(card: Element): string {
  return card.getAttribute('data-t') ?? '';
}

export function isCrimeCard(card: Element): boolean {
  return card.getAttribute('data-cr') === '1';
}

export function isLockedCard(card: Element): boolean {
  return card.getAttribute('data-lk') === '1';
}

/** Marks a tile locked right away, before the inventory reloads. */
export function markCardLocked(card: Element): void {
  card.setAttribute('data-lk', '1');
}

/** Where on a tile our price and crime tags go. */
export function cardTagHost(card: Element): Element {
  return card.querySelector('.iv2-tb') ?? card;
}

export function findCard(root: Element, invId: number): Element | null {
  return root.querySelector(`${CARD_SELECTOR}[data-id="${invId}"]`);
}

/**
 * A variable item: gear with a "VR" tag (`.iv2-tvr`), `vr: 1` in the page's
 * item data, with a ladder of ten versions from Common to Fifth Family
 * Mythic. The game won't sell these: every sell sheet opened on one says
 * `tradeable:false`, and `quicksell:false` since at least 2026-10-15
 * (Reaper's Finger 10-15, Devil Costume 10-18; Opal Pin still quick-sold on
 * 10-11). No other item has ever come back untradeable. The tile carries no
 * attribute for it, only the tag.
 */
export function isVariableCard(card: Element): boolean {
  return card.querySelector('.iv2-tvr') !== null;
}

/** Unlocked equipment, not variable. */
export function isQuickSellable(card: Element): boolean {
  return card.getAttribute('data-k') === 'gear' && EQUIPMENT_TYPES.has(cardType(card)) && !isLockedCard(card) && !isVariableCard(card);
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
