import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import type { CourierStatus, PetRosterEntry } from '@/shared/types';

/**
 * Menagerie Assistant — an overlay on the live Menagerie "Care" tab that answers
 * the one question that tab can't answer on its own: "is this pet's banked Pet
 * Points balance actually enough to cross its next capacity/speed milestone?"
 *
 * See docs/pet-training.md for the mechanic this is built around. Short version:
 * Feed/Train (this page) only fill a spendable Pet Points balance; whether that's
 * *enough* to clear a milestone is answered by a completely different page's copy
 * (Smuggling's "+N more STR/DEF/AGI/DEX for the next milestone" note). Checking
 * meant Set Active on a pet here, tab over to Smuggling, find that pet's card,
 * tab back — repeated once per pet. This does that lookup for the whole roster at
 * once.
 *
 * Same shape as the Real Estate Advisor: a floating badge that expands into a
 * panel, reading the live DOM (this page always renders "Stat Points Ready" for
 * whichever pet is Active, and each roster row's own lifetime Pet Points total —
 * enough to compute "ready" for every pet without switching Active pet at all)
 * combined with whatever milestone data the Smuggling page most recently revealed
 * (persisted roster, fetched once via the same 'courier-status-requested' message
 * the Pet Courier panel already uses — see background/index.ts). That data is
 * necessarily "as of last seen," not live, since the Smuggling page only exposes
 * per-pet milestone notes when the account has zero active shipments (see
 * docs/smuggling-v2-plan.md's "Pet roster discovery" note) — flagged per-row via
 * `PetRosterEntry.lastSeen` rather than hidden.
 *
 * Info-only, deliberately: this reads and displays, it never clicks Allocate (or
 * anything else) on the player's behalf. See the "one-click shortcut" option that
 * was considered and set aside — same reasoning as why the Real Estate Advisor
 * only ever shows a recommendation and never fires the upgrade itself.
 */

const CONTAINER_ID = 'ff-men-assist';
const STYLE_ID = 'ff-men-assist-style';
const CARE_MARKER = '.men-care';

const STYLE = `
#${CONTAINER_ID} {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif;
  display: none;
}
#${CONTAINER_ID}.ff-men-visible { display: block; }

.ff-men-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: linear-gradient(180deg, rgba(20,20,28,0.96), rgba(10,10,15,0.96));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 999px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.ff-men-badge:hover { border-color: rgba(201,168,76,0.8); transform: translateY(-1px); }
.ff-men-badge-alert {
  display: none;
  min-width: 17px; height: 17px; padding: 0 4px;
  border-radius: 999px;
  background: #22c55e; color: #fff;
  font-size: 9.5px; font-weight: 800;
  align-items: center; justify-content: center;
  line-height: 1;
}
.ff-men-badge-alert.ff-men-show { display: flex; }
.ff-men-badge-arrow { font-size: 10.5px; color: #d9c48a; font-weight: 700; }

.ff-men-panel {
  display: none;
  width: 330px;
  max-height: 76vh;
  overflow-y: auto;
  padding: 16px;
  background: linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 14px;
  box-shadow: 0 10px 34px rgba(0,0,0,0.6);
  color: #ccc;
}
#${CONTAINER_ID}.ff-men-expanded .ff-men-panel { display: block; }
#${CONTAINER_ID}.ff-men-expanded .ff-men-badge { display: none; }

.ff-men-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
.ff-men-close {
  background: none; border: none; color: #8b8f9e; font-size: 16px; line-height: 1;
  cursor: pointer; padding: 2px 6px;
}
.ff-men-close:hover { color: #fff; }

.ff-men-summary { margin: 4px 0 12px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 11.5px; color: #9199a8; line-height: 1.5; }
.ff-men-summary b { color: #e4e4e7; }

.ff-men-rows { display: flex; flex-direction: column; gap: 8px; }
.ff-men-row {
  padding: 10px 11px;
  border-radius: 9px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.05);
}
.ff-men-row[data-ff-status="ready"] { border-color: rgba(34,197,94,0.3); background: rgba(34,197,94,0.05); }
.ff-men-row-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ff-men-row-name { font-size: 11.5px; font-weight: 700; color: #e4e4e7; }
.ff-men-row-cap { font-family: 'Courier New', ui-monospace, monospace; font-size: 11px; font-weight: 800; color: #fff; white-space: nowrap; }
.ff-men-row-cap small { font-size: 8.5px; font-weight: 700; color: #71717a; }
.ff-men-row-meta { margin-top: 4px; font-size: 9.5px; color: #71717a; }
.ff-men-row-status { margin-top: 6px; font-size: 10.5px; font-weight: 800; }
.ff-men-row-status[data-ff-sev="ready"] { color: #4ade80; }
.ff-men-row-status[data-ff-sev="close"] { color: #fbbf24; }
.ff-men-row-status[data-ff-sev="far"] { color: #71717a; font-weight: 700; }
.ff-men-row-cooldowns { margin-top: 5px; display: flex; gap: 10px; font-size: 9px; color: #6b6455; }
.ff-men-row-cooldowns span[data-ff-ready="1"] { color: #6ee7b7; }
`;

interface CarePet {
  name: string;
  petPoints: number;
  statPointsReady: number;
  feedReady: boolean | null;
  trainReady: boolean | null;
}

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

function numberFrom(text: string): number {
  const n = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/** Reads by label text (`.men-points-lbl`) rather than position — same reasoning
 *  as realEstate/index.ts's `parseLevelRow`: nothing in the markup guarantees
 *  which of the two boxes comes first. */
function pointsBoxValue(root: ParentNode, label: string): number | null {
  for (const box of Array.from(root.querySelectorAll('.men-points-box'))) {
    if (textOf(box.querySelector('.men-points-lbl')) !== label) continue;
    const n = numberFrom(textOf(box.querySelector('.men-points-big')));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A Feed/Train button reports its own cooldown via the `is-off` class plus a
 *  `disabled` attribute (both, consistently, in every capture this was checked
 *  against) rather than either alone — checking both is cheap insurance against
 *  reading one mid-toggle. */
function actionReady(btn: Element | null): boolean | null {
  if (!btn) return null;
  return !btn.classList.contains('is-off') && !btn.hasAttribute('disabled');
}

function parseActivePet(careRoot: ParentNode): CarePet | null {
  const name = textOf(careRoot.querySelector('.men-active-name'));
  if (!name) return null;
  const petPoints = pointsBoxValue(careRoot, 'PET POINTS');
  const statPointsReady = pointsBoxValue(careRoot, 'STAT POINTS READY');
  if (petPoints === null || statPointsReady === null) return null;

  // The active pet's own Feed/Train buttons live in a separate `.men-care-card`
  // (the "act row"), not inside `.men-active-head` — matched by icon class since
  // that card carries no id/name to key off, unlike the "Other Pets" rows below.
  const feedBtn = careRoot.querySelector('.men-act-btn .fa-bone')?.closest('button') ?? null;
  const trainBtn = careRoot.querySelector('.men-act-btn .fa-dumbbell')?.closest('button') ?? null;

  return { name, petPoints, statPointsReady, feedReady: actionReady(feedBtn), trainReady: actionReady(trainBtn) };
}

/** Every pet *except* whichever one is currently Active — that one only shows
 *  its own "N pts" total here (no "ready" tile the way the active card has), so
 *  ready points are derived from `COST_PER_STAT`, confirmed 5 (see
 *  docs/pet-training.md's `cost_per_stat` note) rather than re-derived per pet. */
const COST_PER_STAT = 5;

function parseOtherPets(careRoot: ParentNode): CarePet[] {
  const pets: CarePet[] = [];
  for (const row of Array.from(careRoot.querySelectorAll('.men-other-list .men-other-pet'))) {
    const name = textOf(row.querySelector('.men-other-name'));
    const sub = textOf(row.querySelector('.men-other-sub'));
    const ptsMatch = sub.match(/(\d+)\s*pts/);
    if (!name || !ptsMatch) continue;
    const petPoints = Number(ptsMatch[1]);
    const feedBtn = row.querySelector('.fa-bone')?.closest('button') ?? null;
    const trainBtn = row.querySelector('.fa-dumbbell')?.closest('button') ?? null;
    pets.push({
      name,
      petPoints,
      statPointsReady: Math.floor(petPoints / COST_PER_STAT),
      feedReady: actionReady(feedBtn),
      trainReady: actionReady(trainBtn),
    });
  }
  return pets;
}

function formatAgo(atMs: number, nowMs: number = Date.now()): string {
  const minutes = Math.round((nowMs - atMs) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Pulls a fully-formed milestone requirement out of a cached roster snapshot, or
 * null if one isn't available. `typeof ... === 'number'` (not `!== null`)
 * deliberately catches both a genuinely-absent milestone note (stored as `null`
 * by parseMilestone) *and* a record written before this feature existed, whose
 * stored object never had these keys at all (`undefined` when read back) — the
 * distinction doesn't matter to the UI, both mean "nothing to show," but treating
 * only one of the two as "unknown" is exactly what produced `NaN`/`undefined` in
 * the rendered text the first time this shipped.
 */
function milestoneOf(snapshot: PetRosterEntry | undefined): { needed: number; nextCapacity: number; nextTravelPct: number } | null {
  if (!snapshot) return null;
  const { pointsNeededForNextMilestone: needed, nextMilestoneCapacity: nextCapacity, nextMilestoneTravelPenaltyPct: nextTravelPct } = snapshot;
  if (typeof needed !== 'number' || typeof nextCapacity !== 'number' || typeof nextTravelPct !== 'number') return null;
  return { needed, nextCapacity, nextTravelPct };
}

function renderRow(pet: CarePet, snapshot: PetRosterEntry | undefined): string {
  const capLine = snapshot
    ? `${snapshot.capacity} units, +${snapshot.travelPenaltyPct}% travel`
    : 'No Smuggling data yet — view that page once with pets idle';

  const milestone = milestoneOf(snapshot);
  let status = '';
  if (milestone) {
    const { needed, nextCapacity, nextTravelPct } = milestone;
    const capNote = nextCapacity === snapshot!.capacity ? `travel only, still ${nextCapacity}` : `${nextCapacity}`;
    if (pet.statPointsReady >= needed) {
      status = `<div class="ff-men-row-status" data-ff-sev="ready">✓ Ready — allocate ${needed} for ${capNote} at +${nextTravelPct}%</div>`;
    } else {
      const short = needed - pet.statPointsReady;
      status = `<div class="ff-men-row-status" data-ff-sev="close">Needs ${short} more (has ${pet.statPointsReady}/${needed})</div>`;
    }
  } else if (snapshot) {
    status = `<div class="ff-men-row-status" data-ff-sev="far">Maxed, or milestone data not seen yet — view Smuggling once with pets idle to refresh</div>`;
  }

  const cooldowns = `
    <div class="ff-men-row-cooldowns">
      <span data-ff-ready="${pet.feedReady ? '1' : '0'}">${pet.feedReady === null ? '' : pet.feedReady ? '● Feed ready' : '○ Fed today'}</span>
      <span data-ff-ready="${pet.trainReady ? '1' : '0'}">${pet.trainReady === null ? '' : pet.trainReady ? '● Train ready' : '○ Trained this week'}</span>
    </div>
  `;

  const staleness = snapshot ? ` · seen ${formatAgo(snapshot.lastSeen)}` : '';

  return `
    <div class="ff-men-row" data-ff-status="${milestone && pet.statPointsReady >= milestone.needed ? 'ready' : 'none'}">
      <div class="ff-men-row-top">
        <span class="ff-men-row-name">${escapeHtml(pet.name)}</span>
        <span class="ff-men-row-cap">${pet.statPointsReady}<small> ready</small></span>
      </div>
      <div class="ff-men-row-meta">${capLine}${staleness}</div>
      ${status}
      ${cooldowns}
    </div>
  `;
}

let panelEl: HTMLDivElement | null = null;
let cachedRoster: PetRosterEntry[] | null = null;
let lastSignature = '';

async function loadRoster(): Promise<void> {
  try {
    const status = (await chrome.runtime.sendMessage({ type: 'courier-status-requested' })) as CourierStatus;
    cachedRoster = status.roster;
  } catch (err) {
    console.error(LOG_PREFIX, 'menagerieAssistant: failed to load courier status', err);
  }
}

function computeSignature(pets: CarePet[]): string {
  return pets.map((p) => [p.name, p.petPoints, p.statPointsReady, p.feedReady, p.trainReady].join(',')).join(';');
}

function refresh(force: boolean) {
  if (!panelEl) return;
  const careRoot = document.querySelector(CARE_MARKER);
  const visible = careRoot !== null;
  panelEl.classList.toggle('ff-men-visible', visible);
  if (!visible) return;

  const active = parseActivePet(careRoot);
  const others = parseOtherPets(careRoot);
  const pets = active ? [active, ...others] : others;
  if (pets.length === 0) return;

  const signature = computeSignature(pets);
  if (!force && signature === lastSignature) return;
  lastSignature = signature;

  const rosterByName = new Map((cachedRoster ?? []).map((r) => [r.name, r]));
  const rows = pets.map((pet) => ({ pet, snapshot: rosterByName.get(pet.name) }));

  const readyNow = rows.filter(({ pet, snapshot }) => {
    const milestone = milestoneOf(snapshot);
    return milestone !== null && pet.statPointsReady >= milestone.needed;
  });
  const rest = rows.filter((r) => !readyNow.includes(r));

  const summaryEl = panelEl.querySelector('.ff-men-summary');
  if (summaryEl) {
    summaryEl.innerHTML = readyNow.length > 0
      ? `<b>${readyNow.length}</b> pet${readyNow.length === 1 ? '' : 's'} ha${readyNow.length === 1 ? 's' : 've'} enough banked points to cross their next milestone right now.`
      : cachedRoster && cachedRoster.length > 0
        ? 'No pet has enough banked points for its next milestone yet.'
        : 'No Smuggling data cached yet — view that page once with every pet idle to populate this.';
  }

  const rowsEl = panelEl.querySelector('.ff-men-rows');
  if (rowsEl) {
    rowsEl.innerHTML = [...readyNow, ...rest].map(({ pet, snapshot }) => renderRow(pet, snapshot)).join('');
  }

  const alertEl = panelEl.querySelector('.ff-men-badge-alert');
  if (alertEl) {
    alertEl.textContent = String(readyNow.length);
    alertEl.classList.toggle('ff-men-show', readyNow.length > 0);
  }
}

function setExpanded(next: boolean) {
  panelEl?.classList.toggle('ff-men-expanded', next);
  if (next) {
    // Refresh the cached roster on every open, not continuously — the data
    // this answers ("did George cross his milestone yet") is worth a fresh
    // look each time the panel is actually opened, but polling on every DOM
    // mutation this page produces (countdown-free, so infrequent, but no
    // reason to assume that) would just be a wasted message round-trip.
    void loadRoster().then(() => refresh(true));
  }
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.innerHTML = `
    <button class="ff-men-badge" type="button">
      ${brandBadgeHtml('Menagerie')}
      <span class="ff-men-badge-alert">0</span>
      <span class="ff-men-badge-arrow">▲</span>
    </button>
    <div class="ff-men-panel">
      <div class="ff-men-head">
        ${brandBadgeHtml('Menagerie Assistant')}
        <button class="ff-men-close" type="button" title="Collapse">✕</button>
      </div>
      <div class="ff-men-summary"></div>
      <div class="ff-men-rows"></div>
    </div>
  `;

  el.querySelector('.ff-men-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-men-close')?.addEventListener('click', () => setExpanded(false));

  return el;
}

export async function initMenagerieAssistant(): Promise<void> {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + STYLE);

  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);

  await loadRoster();
  refresh(true);

  // Same "watch the live DOM, react to what's actually there" approach as the
  // Real Estate Advisor and Fight Club's toolbar — the game swaps panel content
  // via innerHTML on the same page, so there's no navigation event to hook
  // instead. Doesn't re-fetch the roster on every tick (see setExpanded) —
  // only re-parses the page's own DOM, which is free.
  const observer = new MutationObserver(() => refresh(false));
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
