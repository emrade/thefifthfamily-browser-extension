import { storage } from '@/shared/storage';
import type { FightClubFilterPrefs } from '@/shared/types';

/**
 * Injects a branded sort/filter toolbar directly into the live Fight Club target
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

type SortKey = FightClubFilterPrefs['sort'];

// Level sorting is left to the game's own Filters sheet (fc_levels/fc_sort already
// cover it) — this only adds what that sheet can't do: sorting by Rating/Respect
// ascending, i.e. easiest targets first, without a full server round-trip.
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'default', label: 'Page Order' },
  { id: 'rating_asc', label: 'Lowest Rating' },
  { id: 'respect_asc', label: 'Lowest Respect' },
];

const TOOLBAR_ID = 'ff-fc-toolbar';
const STYLE_ID = 'ff-fc-style';
const GRID_SELECTOR = '.fc-player-grid';
const HERO_RATING_SELECTOR = '.fc-hero-cell.rating .fc-hero-cell-num';

// Module-level — the source of truth while the page is open. Seeded from
// chrome.storage before the observer starts (see initFightClubControls), and
// written back on every change, so a max-rating cutoff set once doesn't need
// re-entering on the next visit.
let activeSort: SortKey = 'default';
let maxRating: number | null = null;

function persist() {
  storage.setFightClubFilter({ sort: activeSort, maxRating });
}

function parseNumber(text: string): number {
  const n = Number(text.replace(/[^0-9,]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function statFor(card: Element, selector: string): number {
  return parseNumber(card.querySelector(selector)?.textContent ?? '');
}

function ownRating(): number | null {
  const text = document.querySelector(HERO_RATING_SELECTOR)?.textContent ?? '';
  return text.trim() ? parseNumber(text) : null;
}

function applySort(grid: Element) {
  if (activeSort === 'default') return; // leave whatever order the server sent

  const cards = Array.from(grid.querySelectorAll(':scope > .fc-p-card'));
  const keyed = cards.map((card) => ({
    card,
    rating: statFor(card, '.fc-p-stat-num.rating'),
    respect: statFor(card, '.fc-p-stat-num.respect'),
  }));

  if (activeSort === 'rating_asc') keyed.sort((a, b) => a.rating - b.rating);
  else keyed.sort((a, b) => a.respect - b.respect);

  // appendChild on a node already in the document just moves it to the end —
  // no clone, no re-render, so every card keeps its real event handlers.
  for (const { card } of keyed) grid.appendChild(card);
}

/** Hides every card whose rating exceeds the cutoff, and reports how many stayed
 * visible so the toolbar's counter can reflect it. */
function applyFilter(grid: Element): { total: number; shown: number } {
  const cards = Array.from(grid.querySelectorAll(':scope > .fc-p-card'));
  let shown = 0;

  for (const card of cards) {
    const el = card as HTMLElement;
    const match = maxRating === null || statFor(card, '.fc-p-stat-num.rating') <= maxRating;
    el.style.display = match ? '' : 'none';
    if (match) shown += 1;
  }

  return { total: cards.length, shown };
}

const STYLE = `
#${TOOLBAR_ID} {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  margin-bottom: 14px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(20,16,18,.98) 0%, rgba(10,8,10,1) 100%);
  border: 1px solid rgba(201,168,76,.25);
  box-shadow: 0 6px 18px rgba(0,0,0,.45), inset 0 1px 0 rgba(201,168,76,.08);
}
#${TOOLBAR_ID}::before {
  content: '';
  position: absolute; top: 0; left: 8%; right: 8%; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(201,168,76,.6), transparent);
}
.ff-fc-brand { display: flex; align-items: center; gap: 8px; }
.ff-fc-crest {
  width: 22px; height: 22px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transform: rotate(45deg);
  background: linear-gradient(135deg, rgba(201,168,76,.24), rgba(201,168,76,.05));
  border: 1px solid rgba(201,168,76,.5);
  border-radius: 4px;
}
.ff-fc-crest span {
  transform: rotate(-45deg);
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: 800;
  font-size: 10.5px;
  color: #e8c766;
}
.ff-fc-brand-text { display: flex; flex-direction: column; gap: 1px; line-height: 1; }
.ff-fc-brand-text strong {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .06em;
  color: #d9c48a;
  white-space: nowrap;
}
.ff-fc-brand-text small {
  font-family: 'Courier New', ui-monospace, monospace;
  font-size: 7px;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: #6b6455;
  white-space: nowrap;
}
.ff-fc-group { display: flex; align-items: center; gap: 7px; }
.ff-fc-group-label {
  font-family: 'Courier New', ui-monospace, monospace;
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: #8a7548;
  white-space: nowrap;
}
.ff-fc-select, .ff-fc-input {
  font-family: 'Courier New', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  color: #e5e0d3;
  background: rgba(0,0,0,.4);
  border: 1px solid rgba(201,168,76,.25);
  border-radius: 5px;
  padding: 5px 9px;
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s;
}
.ff-fc-select:hover, .ff-fc-input:hover { border-color: rgba(201,168,76,.55); }
.ff-fc-select:focus, .ff-fc-input:focus {
  outline: none; border-color: #ef4444; box-shadow: 0 0 0 2px rgba(239,68,68,.16);
}
.ff-fc-input { width: 62px; text-align: center; cursor: text; }
.ff-fc-input::-webkit-inner-spin-button, .ff-fc-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.ff-fc-vs {
  font-family: 'Courier New', ui-monospace, monospace;
  font-size: 9px;
  color: #6b6455;
  white-space: nowrap;
}
.ff-fc-vs strong { color: #a78bfa; font-weight: 800; }
.ff-fc-count {
  margin-left: auto;
  font-family: 'Courier New', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: #6b6455;
  white-space: nowrap;
}
.ff-fc-count strong { color: #4ade80; font-weight: 800; }
@media (prefers-reduced-motion: reduce) {
  .ff-fc-select, .ff-fc-input { transition: none; }
}
`;

function ensureStyleInjected() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function refresh(grid: Element, countEl: HTMLElement) {
  applySort(grid);
  const { total, shown } = applyFilter(grid);
  countEl.innerHTML = `<strong>${shown}</strong> of ${total} shown`;
}

function buildToolbar(grid: Element): HTMLElement {
  ensureStyleInjected();

  const bar = document.createElement('div');
  bar.id = TOOLBAR_ID;

  const brand = document.createElement('div');
  brand.className = 'ff-fc-brand';
  brand.innerHTML = '<div class="ff-fc-crest"><span>V</span></div>'
    + '<div class="ff-fc-brand-text"><strong>Fifth Family</strong><small>Field Tools</small></div>';
  bar.appendChild(brand);

  const sortGroup = document.createElement('div');
  sortGroup.className = 'ff-fc-group';
  const sortLabel = document.createElement('span');
  sortLabel.className = 'ff-fc-group-label';
  sortLabel.textContent = 'Sort';
  sortGroup.appendChild(sortLabel);

  const sortSelect = document.createElement('select');
  sortSelect.className = 'ff-fc-select';
  for (const s of SORTS) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    opt.selected = s.id === activeSort;
    sortSelect.appendChild(opt);
  }
  sortGroup.appendChild(sortSelect);
  bar.appendChild(sortGroup);

  const filterGroup = document.createElement('div');
  filterGroup.className = 'ff-fc-group';
  const filterLabel = document.createElement('span');
  filterLabel.className = 'ff-fc-group-label';
  filterLabel.textContent = 'Max Rating';
  filterGroup.appendChild(filterLabel);

  const ratingInput = document.createElement('input');
  ratingInput.className = 'ff-fc-input';
  ratingInput.type = 'number';
  ratingInput.placeholder = 'any';
  ratingInput.value = maxRating !== null ? String(maxRating) : '';
  filterGroup.appendChild(ratingInput);

  const vs = document.createElement('span');
  vs.className = 'ff-fc-vs';
  const mine = ownRating();
  vs.innerHTML = mine !== null ? `vs. yours: <strong>${mine}</strong>` : '';
  filterGroup.appendChild(vs);
  bar.appendChild(filterGroup);

  const count = document.createElement('span');
  count.className = 'ff-fc-count';
  bar.appendChild(count);

  sortSelect.addEventListener('change', () => {
    activeSort = sortSelect.value as SortKey;
    persist();
    refresh(grid, count);
  });

  ratingInput.addEventListener('input', () => {
    maxRating = ratingInput.value.trim() === '' ? null : Number(ratingInput.value);
    persist();
    refresh(grid, count);
  });

  refresh(grid, count);
  return bar;
}

/** (Re)installs the toolbar right above whichever `.fc-player-grid` is currently
 * live, if it isn't there already. Safe to call on every DOM settle — it's a no-op
 * once the toolbar is already in place. */
function ensureToolbar(grid: Element) {
  if (grid.previousElementSibling?.id === TOOLBAR_ID) return;

  document.getElementById(TOOLBAR_ID)?.remove(); // stale copy from a replaced grid
  grid.parentElement?.insertBefore(buildToolbar(grid), grid);
}

const INSTALL_FLAG = '__ffFightClubControlsInstalled';

export async function initFightClubControls() {
  if ((window as unknown as Record<string, boolean>)[INSTALL_FLAG]) return;
  (window as unknown as Record<string, boolean>)[INSTALL_FLAG] = true;

  const saved = await storage.getFightClubFilter();
  if (saved) {
    activeSort = saved.sort;
    maxRating = saved.maxRating;
  }

  const observer = new MutationObserver(() => {
    const grid = document.querySelector(GRID_SELECTOR);
    if (grid) ensureToolbar(grid);
  });

  // document.documentElement (not document.body) — this runs at document_start,
  // before <body> necessarily exists yet.
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
