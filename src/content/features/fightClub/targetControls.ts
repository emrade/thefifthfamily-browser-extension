/**
 * Injects sort and rating-filter controls directly into the live Fight Club target
 * list on thefifthfamily.com — acting on the real `.fc-p-card` DOM nodes in place
 * rather than showing a separate copy of the data somewhere the player can't act
 * on it. Sort moves the actual elements (not clones) and the filter only ever
 * toggles `display`, so every card's real Attack button — and its
 * `onclick="Game.attackPlayer(id)"` handler — stays fully live throughout.
 *
 * The game ships all three Fight Club tabs (Targets/Combat Log/Top Fighters) in one
 * `panel.php?type=attack_hub` response and swaps its `.fight-tab-content`
 * innerHTML wholesale on load and on pagination, so this doesn't hook into that
 * fetch at all — it just watches the live DOM for `.fc-player-grid` appearing and
 * (re)acts on whatever's actually there.
 */

type SortKey = 'default' | 'rating_asc' | 'respect_asc';
type FilterDir = 'lt' | 'gt';

// Level sorting is left to the game's own Filters sheet (fc_levels/fc_sort already
// cover it) — this only adds what that sheet can't do: sorting by Rating/Respect
// ascending, i.e. easiest targets first, without a full server round-trip.
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'default', label: 'Page Order' },
  { id: 'rating_asc', label: 'Lowest Rating' },
  { id: 'respect_asc', label: 'Lowest Respect' },
];

const TOOLBAR_ID = 'ff-fc-toolbar';
const GRID_SELECTOR = '.fc-player-grid';
const HERO_RATING_SELECTOR = '.fc-hero-cell.rating .fc-hero-cell-num';

// Module-level, not persisted — carries the player's chosen sort/filter across a
// pagination reload (the grid node itself gets replaced) within one page session,
// which is exactly when it's useful; a fresh page load reasonably starts over.
let activeSort: SortKey = 'default';
let filterDir: FilterDir = 'lt';
let filterValue: number | null = null;
// Only auto-fill the rating filter from the player's own score once, the first
// time the toolbar is built — after that, whatever the player set (including
// clearing it) carries forward across pagination untouched.
let filterInitialized = false;

function parseNumber(text: string): number {
  const n = Number(text.replace(/[^0-9,]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function statFor(card: Element, selector: string): number {
  return parseNumber(card.querySelector(selector)?.textContent ?? '');
}

function applySort(grid: Element) {
  if (activeSort === 'default') return; // leave whatever order the server sent

  const cards = Array.from(grid.querySelectorAll(':scope > .fc-p-card'));
  const keyed = cards.map((card) => ({
    card,
    rating: statFor(card, '.fc-p-stat-num.rating'),
    respect: statFor(card, '.fc-p-stat-num.respect'),
  }));

  switch (activeSort) {
    case 'rating_asc': keyed.sort((a, b) => a.rating - b.rating); break;
    case 'respect_asc': keyed.sort((a, b) => a.respect - b.respect); break;
  }

  // appendChild on a node already in the document just moves it to the end —
  // no clone, no re-render, so every card keeps its real event handlers.
  for (const { card } of keyed) grid.appendChild(card);
}

function applyFilter(grid: Element) {
  for (const card of Array.from(grid.querySelectorAll(':scope > .fc-p-card'))) {
    const el = card as HTMLElement;
    if (filterValue === null) {
      el.style.display = '';
      continue;
    }
    const rating = statFor(card, '.fc-p-stat-num.rating');
    const match = filterDir === 'lt' ? rating < filterValue : rating > filterValue;
    el.style.display = match ? '' : 'none';
  }
}

function refresh(grid: Element) {
  applySort(grid);
  applyFilter(grid);
}

function labelEl(text: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = text;
  el.style.cssText = 'font-size:0.6rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#6b7280;';
  return el;
}

const CONTROL_STYLE = 'padding:5px 10px;font-size:0.62rem;font-weight:800;'
  + 'letter-spacing:0.5px;border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.04);'
  + 'color:#e5e7eb;border:1px solid rgba(255,255,255,0.08);';

function ownRatingFromHero(): number | null {
  const text = document.querySelector(HERO_RATING_SELECTOR)?.textContent ?? '';
  return text.trim() ? parseNumber(text) : null;
}

function buildToolbar(grid: Element): HTMLElement {
  const bar = document.createElement('div');
  bar.id = TOOLBAR_ID;
  bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px;';

  bar.appendChild(labelEl('Sort'));

  const sortSelect = document.createElement('select');
  sortSelect.style.cssText = CONTROL_STYLE + 'text-transform:uppercase;';
  for (const s of SORTS) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    opt.selected = s.id === activeSort;
    sortSelect.appendChild(opt);
  }
  sortSelect.addEventListener('change', () => {
    activeSort = sortSelect.value as SortKey;
    refresh(grid);
  });
  bar.appendChild(sortSelect);

  if (!filterInitialized) {
    filterInitialized = true;
    filterValue = ownRatingFromHero();
  }

  bar.appendChild(labelEl('Rating'));

  const dirSelect = document.createElement('select');
  dirSelect.style.cssText = CONTROL_STYLE;
  const dirOptions: { id: FilterDir; label: string }[] = [{ id: 'lt', label: '<' }, { id: 'gt', label: '>' }];
  for (const d of dirOptions) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.label;
    opt.selected = d.id === filterDir;
    dirSelect.appendChild(opt);
  }
  dirSelect.addEventListener('change', () => {
    filterDir = dirSelect.value as FilterDir;
    applyFilter(grid);
  });
  bar.appendChild(dirSelect);

  const valueInput = document.createElement('input');
  valueInput.type = 'number';
  valueInput.placeholder = 'any';
  valueInput.value = filterValue !== null ? String(filterValue) : '';
  valueInput.style.cssText = CONTROL_STYLE + 'width:64px;';
  valueInput.addEventListener('input', () => {
    filterValue = valueInput.value.trim() === '' ? null : Number(valueInput.value);
    applyFilter(grid);
  });
  bar.appendChild(valueInput);

  return bar;
}

/** (Re)installs the toolbar right above whichever `.fc-player-grid` is currently
 * live, if it isn't there already, and (re)applies the current sort/filter to it.
 * Safe to call on every DOM settle — it's a no-op once the toolbar is already in
 * place. */
function ensureToolbar(grid: Element) {
  if (grid.previousElementSibling?.id === TOOLBAR_ID) return;

  document.getElementById(TOOLBAR_ID)?.remove(); // stale copy from a replaced grid
  grid.parentElement?.insertBefore(buildToolbar(grid), grid);
  refresh(grid);
}

const INSTALL_FLAG = '__ffFightClubControlsInstalled';

export function initFightClubControls() {
  if ((window as unknown as Record<string, boolean>)[INSTALL_FLAG]) return;
  (window as unknown as Record<string, boolean>)[INSTALL_FLAG] = true;

  const observer = new MutationObserver(() => {
    const grid = document.querySelector(GRID_SELECTOR);
    if (grid) ensureToolbar(grid);
  });

  // document.documentElement (not document.body) — this runs at document_start,
  // before <body> necessarily exists yet.
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
