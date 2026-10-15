import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { STORAGE_KEYS } from '@/shared/constants';
import {
  analyzeProperty,
  measureFromCollections,
  planProperty,
  MEASURE_WINDOW_DAYS,
  type CollectionEvent,
  type MeasuredPortfolio,
  type MeasuredProperty,
  type PropertyAdvice,
  type PropertyPlan,
} from '@/shared/realEstateAdvisor';
import type { RealEstateVaultState } from '@/shared/types';
import { autoSectionStyle, mountAutoCollect, setFirstFill } from './autoCollectSection';

/**
 * Real Estate Advisor — an overlay on the live "Real Estate Empire" panel that
 * does the arithmetic the game itself doesn't: for every owned property, what
 * it actually earns you per day given its vault cap and how often you collect
 * (not just its headline Hourly Income), whether that vault is too small for
 * the revenue it's paired with, and — if so — the exact vault level (and
 * total cost) that stops the leak. See shared/realEstateAdvisor.ts for the
 * math and where it comes from.
 *
 * Two pieces, reusing the two interaction patterns already established
 * elsewhere in this extension rather than inventing a third:
 *
 * 1. A ribbon on each owned card (same corner/technique as Street Intel's
 *    "FF BEST VALUE" ribbon in pageHighlights.ts) — the number the game
 *    doesn't show you, right where you're already looking to decide whether
 *    to upgrade. Every card gets one, not just the leaking ones: the
 *    per-property daily-earnings figure is useful even when nothing's wrong.
 * 2. A floating collapsed-badge-that-expands panel (same shape as the Pet
 *    Courier panel) for the things that don't fit on a card: a portfolio-wide
 *    total, the collection-cadence assumption driving every number (adjustable
 *    live, since "how often do you actually collect" isn't something the game
 *    tracks), and the full recommendation with its cost.
 * 3. A plan on each property not owned yet (other districts, locked ones
 *    too): buy, max Revenue, the Vault level that holds the player's
 *    collection gap, what it then earns, and how long it takes to pay back.
 *
 * Figures come in two bases (2026-10-15). "My collections", the default,
 * replays the player's own last week of collections (recorded by the vault
 * reminder in background/features/realEstate) against each property's vault:
 * what each one actually netted per day, and Vault advice sized for the
 * longest gap they stay within on 3 days in 4. "What if" keeps the old fixed cadences (collect exactly
 * once every 12/24/48h), which overstated this account's loss 16× (16% at
 * 24h against ~1% measured).
 *
 * Reads the live DOM directly rather than the captured API responses — same
 * choice Street Intel's highlights make, and for the same reason: the numbers
 * only need to be right for what's on screen right now, and the game already
 * re-renders this panel's HTML on every collect/upgrade, which a
 * MutationObserver can just react to.
 */

const CONTAINER_ID = 'ff-re-advisor';
const STYLE_ID = 'ff-re-advisor-style';
const CARD_SELECTOR = '.rev2-card.owned';
const CADENCE_OPTIONS = [12, 24, 48] as const;
/** Cadence used when the basis is "My collections" but there isn't a day of
 *  them yet. */
const FALLBACK_CADENCE_HOURS = 24;

const STYLE = `
#${CONTAINER_ID} {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif;
  display: none;
}
#${CONTAINER_ID}.ff-re-visible { display: block; }

.ff-re-badge {
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
.ff-re-badge:hover { border-color: rgba(201,168,76,0.8); transform: translateY(-1px); }
.ff-re-badge-alert {
  display: none;
  min-width: 17px; height: 17px; padding: 0 4px;
  border-radius: 999px;
  background: #ef4444; color: #fff;
  font-size: 9.5px; font-weight: 800;
  align-items: center; justify-content: center;
  line-height: 1;
}
.ff-re-badge-alert.ff-re-show { display: flex; }
.ff-re-badge-arrow { font-size: 10.5px; color: #d9c48a; font-weight: 700; }

.ff-re-panel {
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
#${CONTAINER_ID}.ff-re-expanded .ff-re-panel { display: block; }
#${CONTAINER_ID}.ff-re-expanded .ff-re-badge { display: none; }

.ff-re-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.ff-re-close {
  background: none; border: none; color: #8b8f9e; font-size: 16px; line-height: 1;
  cursor: pointer; padding: 2px 6px;
}
.ff-re-close:hover { color: #fff; }

.ff-re-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
#${CONTAINER_ID} .ff-re-tab {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  margin: 0; padding: 7px 4px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px; color: #9ca3af; font-size: 10px; font-weight: 800; line-height: 1.2; white-space: nowrap; cursor: pointer;
}
#${CONTAINER_ID} .ff-re-tab:hover { color: #ccc; }
#${CONTAINER_ID} .ff-re-tab.ff-re-tab-on { background: rgba(201,168,76,0.16); border-color: rgba(201,168,76,0.55); color: #f4d160; }
/* Auto-Collect's state at a glance, so a stop shows from the Advisor tab. */
.ff-re-tab[data-ff-state]::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #52525b; }
.ff-re-tab[data-ff-state="on"]::after { background: #10b981; }
.ff-re-tab[data-ff-state="stopped"]::after { background: #ef4444; }
.ff-re-pane { display: none; }
.ff-re-pane.ff-re-pane-on { display: block; }

.ff-re-cadence { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }
.ff-re-cadence-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b6455; margin-right: 2px; }
.ff-re-chip {
  padding: 4px 10px; border-radius: 999px; font-size: 10px; font-weight: 800;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
  color: #9199a8; cursor: pointer;
}
.ff-re-chip:hover { border-color: rgba(201,168,76,0.5); color: #d9c48a; }
.ff-re-chip.ff-re-chip-active {
  background: rgba(201,168,76,0.16); border-color: rgba(201,168,76,0.55); color: #f4d160;
}

.ff-re-summary { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.ff-re-summary-line { font-size: 12.5px; color: #e4e4e7; }
.ff-re-summary-line b { font-family: 'Courier New', ui-monospace, monospace; color: #fff; }
.ff-re-summary-loss { margin-top: 4px; font-size: 10.5px; font-weight: 700; color: #f87171; }
.ff-re-summary-ok { font-size: 11.5px; color: #6ee7b7; line-height: 1.5; }

.ff-re-rows { display: flex; flex-direction: column; gap: 10px; }
.ff-re-row {
  padding: 10px 11px;
  border-radius: 9px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.05);
}
.ff-re-row[data-ff-status="leaking"] { border-color: rgba(239,68,68,0.25); background: rgba(239,68,68,0.045); }
.ff-re-row-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ff-re-row-name { font-size: 11.5px; font-weight: 700; color: #e4e4e7; }
.ff-re-row-amt { font-family: 'Courier New', ui-monospace, monospace; font-size: 11.5px; font-weight: 800; color: #fff; white-space: nowrap; }
.ff-re-row-amt small { font-size: 8.5px; font-weight: 700; color: #71717a; margin-left: 2px; }
.ff-re-row-meta { margin-top: 3px; font-size: 9.5px; color: #71717a; }
.ff-re-row-loss { margin-top: 6px; font-size: 10.5px; font-weight: 800; }
.ff-re-row-loss[data-ff-sev="medium"] { color: #fbbf24; }
.ff-re-row-loss[data-ff-sev="high"] { color: #f97316; }
.ff-re-row-loss[data-ff-sev="extreme"] { color: #ef4444; }
.ff-re-row-advice { margin-top: 2px; font-size: 10px; color: #ccc; line-height: 1.4; }
.ff-re-row-ok { margin-top: 6px; font-size: 10px; color: #6ee7b7; }
.ff-re-row-max { margin-top: 6px; font-size: 9px; color: #6b6455; }
.ff-re-row-max--done { color: #34d399; }
.ff-re-row-gauge { margin-top: 7px; height: 4px; border-radius: 999px; background: rgba(255,255,255,0.06); overflow: hidden; }
.ff-re-row-gauge-fill { height: 100%; border-radius: 999px; }
.ff-re-row-gauge-fill[data-ff-sev="medium"] { background: #fbbf24; }
.ff-re-row-gauge-fill[data-ff-sev="high"] { background: #f97316; }
.ff-re-row-gauge-fill[data-ff-sev="extreme"] { background: #ef4444; }

.ff-re-card { position: relative; }
.ff-re-ribbon {
  position: absolute; top: 0; left: 0; z-index: 5;
  display: flex; flex-direction: column; gap: 1px;
  padding: 4px 10px 5px;
  border-radius: 0 0 10px 0;
  font-family: 'Courier New', ui-monospace, monospace;
}
.ff-re-ribbon[data-ff-status="balanced"] { background: rgba(52,211,153,0.18); border-right: 1px solid rgba(52,211,153,.4); border-bottom: 1px solid rgba(52,211,153,.4); }
.ff-re-ribbon[data-ff-status="medium"] { background: rgba(251,191,36,0.22); border-right: 1px solid rgba(251,191,36,.5); border-bottom: 1px solid rgba(251,191,36,.5); }
.ff-re-ribbon[data-ff-status="high"] { background: rgba(249,115,22,0.24); border-right: 1px solid rgba(249,115,22,.55); border-bottom: 1px solid rgba(249,115,22,.55); }
.ff-re-ribbon[data-ff-status="extreme"] { background: rgba(239,68,68,0.26); border-right: 1px solid rgba(239,68,68,.6); border-bottom: 1px solid rgba(239,68,68,.6); }
.ff-re-ribbon-amt { font-size: 11px; font-weight: 800; color: #fff; }
.ff-re-ribbon-amt small { font-size: 8px; font-weight: 700; opacity: .75; margin-left: 2px; }
.ff-re-ribbon-loss { font-size: 8.5px; font-weight: 700; color: #fff; opacity: .95; }
.ff-re-ribbon[data-ff-status="balanced"] .ff-re-ribbon-amt { color: #a7f3d0; }

.ff-re-cadence-group { display: flex; align-items: center; gap: 4px; margin-left: 4px; padding-left: 8px; border-left: 1px solid rgba(255,255,255,0.08); }
.ff-re-basis-note { margin: -6px 0 12px; font-size: 9.5px; color: #8b8578; line-height: 1.45; }
.ff-re-plans { margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06); }
.ff-re-plans-h { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b6455; margin-bottom: 8px; }
.ff-re-plans-row { font-size: 10.5px; color: #ccc; line-height: 1.45; margin-bottom: 6px; }
.ff-re-plans-row b { color: #fff; }
.ff-re-plans-row.ff-re-locked { opacity: 0.6; }

.ff-re-plan {
  margin: 10px 0; padding: 8px 10px; border-radius: 8px;
  background: rgba(201,168,76,0.07); border: 1px solid rgba(201,168,76,0.3);
  font-size: 11px; line-height: 1.5; color: #d4d4d8;
}
.ff-re-plan.ff-re-locked { opacity: 0.6; }
.ff-re-plan-h { font-size: 9px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #d9c48a; margin-bottom: 3px; }
.ff-re-plan b { color: #fff; font-family: 'Courier New', ui-monospace, monospace; }
.ff-re-plan-sub { font-size: 10px; color: #a1a1aa; }

.ff-re-fill {
  display: flex; justify-content: space-between; gap: 6px;
  margin: 8px 0 12px; padding: 6px 12px; border-radius: 8px;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 11.5px; font-weight: 800; line-height: 1.4;
}
.ff-re-fill small { font-weight: 600; opacity: 0.8; }
.ff-re-fill[data-ff-fill="ok"] { background: rgba(52,211,153,0.1); color: #6ee7b7; }
.ff-re-fill[data-ff-fill="soon"] { background: rgba(251,191,36,0.16); color: #fbbf24; border: 1px solid rgba(251,191,36,0.4); }
.ff-re-fill[data-ff-fill="full"] { background: rgba(239,68,68,0.16); color: #f87171; border: 1px solid rgba(239,68,68,0.45); }
`;

interface ParsedCard {
  el: HTMLElement;
  /** The game's property id (its Collect button), matching collections. */
  key: string | null;
  /** Income bonus shown under Hourly Income ("+19.75%"), or 0. */
  bonusPct: number;
  title: string;
  hourly: number;
  vaultCap: number;
  vaultLevel: number;
  nextVaultUpgradeCost: number | null;
  revenueLevel: number;
  nextRevenueUpgradeCost: number | null;
}

function parseMoney(text: string | null | undefined): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Looked up by label text ("Revenue"/"Vault") rather than DOM position —
// nothing in the markup guarantees which row comes first, and this survives
// that changing.
function parseLevelRow(card: Element, label: 'Revenue' | 'Vault'): { level: number; nextCost: number | null } | null {
  for (const row of Array.from(card.querySelectorAll('.rev2-level'))) {
    if (row.querySelector('.rev2-level-l')?.textContent?.trim() !== label) continue;
    const levelMatch = row.querySelector('.rev2-level-v')?.textContent?.match(/L(\d+)/);
    if (!levelMatch) return null;
    const onclick = row.querySelector('.rev2-level-upgrade')?.getAttribute('onclick') ?? '';
    // The price is the third argument. Since 2026-09-28 the game passes a
    // fourth (the tooltip text: 'Hourly income $125,737 &rarr; …'), so the
    // price can be followed by a comma, not just the closing paren. Matching
    // only `)` read every price as missing, i.e. "maxed".
    const costMatch = onclick.match(/Rev2\.upgrade\(\d+,\s*'(?:revenue|vault)',\s*(\d+)\s*[,)]/);
    return { level: Number(levelMatch[1]), nextCost: costMatch ? Number(costMatch[1]) : null };
  }
  return null;
}

function parseCard(el: Element): ParsedCard | null {
  const title = el.querySelector('.rev2-card-title')?.textContent?.trim();
  const hourly = parseMoney(el.querySelector('.rev2-stat-v.g')?.textContent);
  const vaultCap = parseMoney(el.querySelector('.rev2-stat-v.b')?.textContent);
  const revenue = parseLevelRow(el, 'Revenue');
  const vault = parseLevelRow(el, 'Vault');
  if (!title || !hourly || !vaultCap || !revenue || !vault) return null;
  const key = el.querySelector('.rev2-btn-collect')?.getAttribute('onclick')?.match(/Rev2\.collect\((\d+)\)/)?.[1] ?? null;
  const bonus = el.querySelector('.rev2-stat-base .up')?.textContent?.match(/([\d.]+)%/)?.[1];
  return {
    el: el as HTMLElement,
    key,
    bonusPct: bonus ? Number(bonus) : 0,
    title, hourly, vaultCap,
    vaultLevel: vault.level, nextVaultUpgradeCost: vault.nextCost,
    revenueLevel: revenue.level, nextRevenueUpgradeCost: revenue.nextCost,
  };
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function formatHours(h: number): string {
  if (!Number.isFinite(h)) return '—';
  return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h)}h`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function severity(lossFraction: number): 'medium' | 'high' | 'extreme' {
  if (lossFraction >= 0.5) return 'extreme';
  if (lossFraction >= 0.2) return 'high';
  return 'medium';
}

function toAdviceInput(card: ParsedCard) {
  return {
    hourly: card.hourly,
    vaultCap: card.vaultCap,
    vaultLevel: card.vaultLevel,
    nextVaultUpgradeCost: card.nextVaultUpgradeCost,
    revenueLevel: card.revenueLevel,
    nextRevenueUpgradeCost: card.nextRevenueUpgradeCost,
  };
}

/** One owned property's figures under the current basis. */
interface RowFigures {
  /** Nets per day: measured, or modelled at the what-if cadence. */
  netDaily: number;
  lossDaily: number;
  theoreticalDaily: number;
  /** Vault advice, sized for the usual longest gap or the what-if cadence. */
  advice: PropertyAdvice;
  measured: boolean;
  /** "My collections" with none recorded yet: show what the property makes
   *  and how often it needs collecting, not a loss from a guessed cadence. */
  noData: boolean;
}

function figuresFor(card: ParsedCard, cadence: number, measured: MeasuredProperty | undefined, noData: boolean): RowFigures {
  const advice = analyzeProperty(toAdviceInput(card), cadence);
  if (noData) {
    return { netDaily: advice.theoreticalDaily, lossDaily: 0, theoreticalDaily: advice.theoreticalDaily, advice, measured: false, noData };
  }
  if (measured) {
    return { netDaily: measured.netDaily, lossDaily: measured.lostDaily, theoreticalDaily: advice.theoreticalDaily, advice, measured: true, noData };
  }
  return { netDaily: advice.effectiveDaily, lossDaily: advice.lossDaily, theoreticalDaily: advice.theoreticalDaily, advice, measured: false, noData };
}

/** Losing at least this share of a property's income counts as leaking.
 *  Below it (a stray long gap) the row stays green. */
const LEAK_SHARE = 0.01;

function isLeaking(f: RowFigures): boolean {
  return f.lossDaily >= f.theoreticalDaily * LEAK_SHARE;
}

function renderRibbon(card: ParsedCard, f: RowFigures) {
  card.el.classList.add('ff-re-card');
  let ribbon = card.el.querySelector<HTMLDivElement>(':scope > .ff-re-ribbon');
  if (!ribbon) {
    ribbon = document.createElement('div');
    ribbon.className = 'ff-re-ribbon';
    card.el.prepend(ribbon);
  }
  const amount = `<span class="ff-re-ribbon-amt">${formatMoney(f.netDaily)}<small>/day${f.noData ? ' max' : ''}</small></span>`;
  let html: string;
  if (isLeaking(f)) {
    ribbon.dataset.ffStatus = severity(f.lossDaily / f.theoreticalDaily);
    html = `${amount}<span class="ff-re-ribbon-loss">-${formatMoney(f.lossDaily)}/day</span>`;
  } else {
    ribbon.dataset.ffStatus = 'balanced';
    html = amount;
  }
  if (ribbon.innerHTML !== html) ribbon.innerHTML = html;
}

function renderRow(card: ParsedCard, f: RowFigures, gapLabel: string): string {
  const { advice } = f;
  const revenueLabel = card.revenueLevel >= 11 ? 'Revenue L11 (maxed)' : `Revenue L${card.revenueLevel}`;
  const vaultLabel = card.vaultLevel >= 11 ? 'Vault L11 (maxed)' : `Vault L${card.vaultLevel}`;
  const meta = `${revenueLabel} · ${vaultLabel} · fills in ${formatHours(advice.fillHours)}`;
  const leaking = isLeaking(f);

  let body = '';
  if (f.noData) {
    body = `<div class="ff-re-row-ok">Collect at least every ${formatHours(advice.fillHours)} to get all of it.</div>`;
  } else if (leaking) {
    const sev = severity(f.lossDaily / f.theoreticalDaily);
    const gaugePct = Math.min(100, (f.netDaily / f.theoreticalDaily) * 100);
    const pct = Math.round((f.lossDaily / f.theoreticalDaily) * 100);
    body = `
      <div class="ff-re-row-loss" data-ff-sev="${sev}">${f.measured ? 'Lost' : 'Losing'} ${formatMoney(f.lossDaily)}/day of ${formatMoney(f.theoreticalDaily)} possible (${pct}%)</div>
      <div class="ff-re-row-gauge"><div class="ff-re-row-gauge-fill" data-ff-sev="${sev}" style="width:${gaugePct}%"></div></div>
    `;
  }
  if (f.noData) {
    // No gap to size a vault for yet.
  } else if (advice.isOverflowing) {
    let action: string;
    if (advice.targetLevel === null) {
      action = `Vault is maxed and fills in ${formatHours(advice.fillHours)}, less than ${gapLabel}. Only collecting sooner closes it.`;
    } else if (advice.structurallyCapped) {
      action = `Best possible: Vault → L${advice.targetLevel} for ${formatMoney(advice.costToTarget ?? 0)}, still short of ${gapLabel}. Collect sooner to close the rest.`;
    } else {
      action = `Vault → L${advice.targetLevel} for ${formatMoney(advice.costToTarget ?? 0)} would hold ${gapLabel}.`;
    }
    body += `<div class="ff-re-row-advice">${action}</div>`;
  } else if (!leaking) {
    body += `<div class="ff-re-row-ok">✓ Vault holds ${gapLabel}</div>`;
  }

  // Revenue and Vault are independent purchases — maxing one says nothing
  // about whether the other is worth touching. Reported as two separate
  // lines rather than one combined total so that never reads as a single
  // bundled recommendation. The Vault-to-L11 cost is only shown when maxing
  // is genuinely optional (`!structurallyCapped`).
  const maxLines: string[] = [];
  if (advice.costToMaxRevenue > 0) {
    maxLines.push(`<div class="ff-re-row-max">Max Revenue → L11: ${formatMoney(advice.costToMaxRevenue)}</div>`);
  }
  if (advice.costToMaxVault > 0 && !advice.structurallyCapped) {
    const note = advice.isOverflowing
      ? ` — optional beyond L${advice.targetLevel}`
      : ' — optional, already holds it';
    maxLines.push(`<div class="ff-re-row-max">Max Vault → L11: ${formatMoney(advice.costToMaxVault)}${note}</div>`);
  }
  const bothMaxed = card.revenueLevel >= 11 && card.vaultLevel >= 11;
  const maxLine = bothMaxed ? `<div class="ff-re-row-max ff-re-row-max--done">✓ Revenue and Vault both maxed (L11)</div>` : maxLines.join('');

  return `
    <div class="ff-re-row" data-ff-status="${leaking ? 'leaking' : 'balanced'}">
      <div class="ff-re-row-top">
        <span class="ff-re-row-name">${escapeHtml(card.title)}</span>
        <span class="ff-re-row-amt">${formatMoney(f.netDaily)}<small>/day${f.noData ? ' max' : ''}</small></span>
      </div>
      <div class="ff-re-row-meta">${meta}</div>
      ${body}
      ${maxLine}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Plans for properties not owned yet
// ---------------------------------------------------------------------------

interface UnownedCard {
  el: HTMLElement;
  title: string;
  district: string;
  /** Lowest player level the district allows, from its header ("L121–140"). */
  minLevel: number | null;
  price: number;
  baseHourly: number;
  baseVault: number;
}

function statByLabel(el: Element, label: string): number | null {
  for (const stat of Array.from(el.querySelectorAll('.rev2-stats > div'))) {
    if (stat.querySelector('.rev2-stat-l')?.textContent?.trim() === label) return parseMoney(stat.querySelector('.rev2-stat-v')?.textContent);
  }
  return null;
}

function parseUnownedCard(el: Element): UnownedCard | null {
  const title = el.querySelector('.rev2-card-title')?.textContent?.trim();
  const price = statByLabel(el, 'Cost');
  const baseHourly = statByLabel(el, 'Base Hourly');
  const baseVault = statByLabel(el, 'Base Vault');
  if (!title || !price || !baseHourly || !baseVault) return null;
  const district = el.querySelector('.rev2-card-district')?.textContent?.trim() ?? '';
  const head = el.closest('.rev2-grid')?.previousElementSibling;
  const range = head?.classList.contains('rev2-district-head') ? head.textContent?.match(/L(\d+)\s*[–-]/) : null;
  return { el: el as HTMLElement, title, district, minLevel: range ? Number(range[1]) : null, price, baseHourly, baseVault };
}

function formatShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n / 1000)}k`;
}

function isLocked(card: UnownedCard): boolean {
  return card.minLevel !== null && playerLevel !== null && playerLevel < card.minLevel;
}

function renderPlan(card: UnownedCard, plan: PropertyPlan, gapLabel: string): void {
  let el = card.el.querySelector<HTMLDivElement>(':scope > .ff-re-plan');
  if (!el) {
    el = document.createElement('div');
    el.className = 'ff-re-plan';
    const stats = card.el.querySelector(':scope > .rev2-stats');
    if (stats) stats.after(el);
    else card.el.append(el);
  }
  const locked = isLocked(card);
  el.classList.toggle('ff-re-locked', locked);
  const html = `
    <div class="ff-re-plan-h">FF plan${locked ? ` · unlocks at level ${card.minLevel}` : ''}</div>
    <div>Buy ${formatShort(plan.price)} → Revenue L11 ${formatShort(plan.revenueCost)} → Vault L${plan.vaultLevel} ${formatShort(plan.vaultCost)} = <b>${formatShort(plan.total)}</b></div>
    <div>Earns ~<b>${formatShort(plan.hourly)}</b>/h (${formatShort(plan.daily)}/day) · pays back in ~<b>${Math.round(plan.paybackDays)}</b> days</div>
    <div class="ff-re-plan-sub">Vault L${plan.vaultLevel} holds ~${formatHours(plan.vaultHours)}, enough for ${gapLabel}. Upgrade prices estimated from your own upgrades; the first real price confirms them.</div>
  `;
  if (el.innerHTML !== html) el.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Vault fill badge
// ---------------------------------------------------------------------------

/** Amber once a vault is this close to full. */
const FILL_WARN_HOURS = 2;
/** A property earning less than this share of income (the Dive Bar, 0.1%)
 *  filling early doesn't matter; the first one above it does. */
const MEANINGFUL_SHARE = 0.02;

/** Each property's vault as first shown at its current amount: the game only
 *  re-renders the amount when the panel reloads, so the countdown runs from
 *  when this amount appeared. Vaults grow by whole hours of income, so it
 *  can be up to an hour out either way. */
const vaultSeen = new Map<string, { vault: number; at: number }>();

function formatLeft(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function renderFillBadge(): void {
  const now = Date.now();
  const props: { title: string; hourly: number; left: number }[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(CARD_SELECTOR))) {
    const card = parseCard(el);
    const vault = parseMoney(el.querySelector('.rev2-vault-row .n')?.textContent);
    if (!card || vault === null || card.hourly <= 0) continue;
    const id = card.key ?? card.title;
    let seen = vaultSeen.get(id);
    if (!seen || seen.vault !== vault) {
      seen = { vault, at: now };
      vaultSeen.set(id, seen);
    }
    const left = vault >= card.vaultCap ? 0 : seen.at + ((card.vaultCap - vault) / card.hourly) * 3_600_000 - now;
    props.push({ title: card.title, hourly: card.hourly, left });
  }

  let badge = document.querySelector<HTMLDivElement>('.ff-re-fill');
  const total = props.reduce((sum, p) => sum + p.hourly, 0);
  // Tiny earners (the Dive Bar) filling don't count; they'd keep it red.
  const big = props.filter((p) => p.hourly >= total * MEANINGFUL_SHARE).sort((a, b) => a.left - b.left);
  if (!big.length) {
    badge?.remove();
    return;
  }

  const full = big.filter((p) => p.left <= 0);
  let state: 'ok' | 'soon' | 'full';
  let html: string;
  if (full.length) {
    state = 'full';
    const losing = props.filter((p) => p.left <= 0).reduce((sum, p) => sum + p.hourly, 0);
    const more = full.length > 1 ? ` and ${full.length - 1} more` : '';
    html = `<span>${escapeHtml(full[0].title)}${more} full</span><small>losing ${formatMoney(losing)}/h</small>`;
  } else {
    const next = big[0];
    state = next.left <= FILL_WARN_HOURS * 3_600_000 ? 'soon' : 'ok';
    const at = new Date(now + next.left).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    html = `<span>${escapeHtml(next.title)} fills first, in ~${formatLeft(next.left)}</span><small>at ${at}</small>`;
  }

  if (!badge) {
    const anchor = document.querySelector('.rev2-collect-all') ?? document.querySelector('.rev2-grid');
    if (!anchor) return;
    badge = document.createElement('div');
    badge.className = 'ff-re-fill';
    if (anchor.classList.contains('rev2-collect-all')) anchor.after(badge);
    else anchor.before(badge);
  }
  if (badge.dataset.ffFill !== state) badge.dataset.ffFill = state;
  if (badge.innerHTML !== html) badge.innerHTML = html;
}

/** For the Auto-Collect interval hint: the first vault worth caring about to
 *  fill after a collection. */
function firstBigFill(cards: ParsedCard[]): { hours: number; name: string } | null {
  const live = cards.filter((c) => c.hourly > 0);
  const total = live.reduce((sum, c) => sum + c.hourly, 0);
  const big = live.filter((c) => c.hourly >= total * MEANINGFUL_SHARE).sort((a, b) => a.vaultCap / a.hourly - b.vaultCap / b.hourly)[0];
  return big ? { hours: big.vaultCap / big.hourly, name: big.title } : null;
}

// ---------------------------------------------------------------------------
// State and refresh
// ---------------------------------------------------------------------------

let panelEl: HTMLDivElement | null = null;
let basis: 'measured' | 'whatIf' = 'measured';
let cadenceHours = FALLBACK_CADENCE_HOURS;
/** The advisor and Auto-Collect are separate jobs, so they get a tab each. */
let activeTab: 'advisor' | 'auto' = 'advisor';
let collections: CollectionEvent[] = [];
let playerLevel: number | null = null;
// Skips re-touching the DOM when nothing the game reports has actually
// changed since the last pass — without this, every mutation this feature's
// own ribbons/panel writes would re-trigger the same document-wide observer
// that's watching for the game's own changes, recomputing (and rewriting)
// forever. Built only from what the game renders (never from our own
// injected elements), so our writes can't feed back into it.
let lastSignature = '';

function computeSignature(cards: ParsedCard[], unowned: UnownedCard[]): string {
  return [
    basis,
    cadenceHours,
    playerLevel,
    collections.length ? collections[collections.length - 1].at : 0,
    // The measured window slides with time; re-measure at most hourly.
    Math.floor(Date.now() / 3_600_000),
    cards.map((c) => [c.key, c.title, c.hourly, c.vaultCap, c.vaultLevel, c.nextVaultUpgradeCost, c.revenueLevel, c.nextRevenueUpgradeCost, c.bonusPct].join(',')).join(';'),
    unowned.map((u) => [u.title, u.price, u.baseHourly, u.baseVault, u.minLevel].join(',')).join(';'),
  ].join('|');
}

function refresh(force: boolean) {
  if (!panelEl) return;
  const cardEls = Array.from(document.querySelectorAll(CARD_SELECTOR));
  const unownedEls = Array.from(document.querySelectorAll('.rev2-card:not(.owned)'));
  const visible = cardEls.length > 0 || unownedEls.length > 0;
  panelEl.classList.toggle('ff-re-visible', visible);
  if (!visible && !force) return;

  const cards = cardEls.map(parseCard).filter((c): c is ParsedCard => c !== null);
  const unowned = unownedEls.map(parseUnownedCard).filter((c): c is UnownedCard => c !== null);
  const signature = computeSignature(cards, unowned);
  if (!force && signature === lastSignature) return;
  lastSignature = signature;

  const measured: MeasuredPortfolio | null =
    basis === 'measured'
      ? measureFromCollections(
          cards.filter((c) => c.key !== null).map((c) => ({ key: c.key!, hourly: c.hourly, cap: c.vaultCap })),
          collections,
        )
      : null;
  // What a vault has to hold: the usual longest gap, or the what-if cadence.
  const cadence = basis === 'measured' ? Math.max(1, Math.ceil(measured?.usualLongestGapHours ?? FALLBACK_CADENCE_HOURS)) : cadenceHours;
  const gapLabel = basis === 'measured' && measured ? `your longest gap on most days (~${cadence}h)` : `${cadence}h between collections`;

  const noData = basis === 'measured' && !measured;
  const rows = cards.map((card) => ({ card, f: figuresFor(card, cadence, card.key ? measured?.byKey.get(card.key) : undefined, noData) }));
  for (const { card, f } of rows) renderRibbon(card, f);
  renderFillBadge();
  if (cards.length) setFirstFill(firstBigFill(cards));

  const leaking = rows.filter((x) => isLeaking(x.f)).sort((a, b) => b.f.lossDaily - a.f.lossDaily);
  const rest = rows.filter((x) => !isLeaking(x.f));
  const totalTheoretical = rows.reduce((sum, x) => sum + x.f.theoreticalDaily, 0);
  const totalNet = rows.reduce((sum, x) => sum + x.f.netDaily, 0);
  const totalLoss = rows.reduce((sum, x) => sum + x.f.lossDaily, 0);

  const noteEl = panelEl.querySelector('.ff-re-basis-note');
  if (noteEl) {
    noteEl.innerHTML =
      basis === 'whatIf'
        ? `What if you collected exactly once every ${cadenceHours}h. Your real figures are under “My collections”.`
        : measured
          ? `Measured from your ${measured.collections} collections over the last ${formatHours(measured.spanHours)} (up to ${MEASURE_WINDOW_DAYS} days), at today’s rates. Collections on another device aren’t seen and look like one long gap.`
          : `No collections recorded in this browser yet (a day’s worth is needed). Until then each property shows what it makes at most and how often it needs collecting; plans assume a ${FALLBACK_CADENCE_HOURS}h gap.`;
  }

  const summaryEl = panelEl.querySelector('.ff-re-summary');
  if (summaryEl) {
    const lossShare = totalTheoretical > 0 ? totalLoss / totalTheoretical : 0;
    const lossLine =
      totalLoss < 1
        ? `<div class="ff-re-summary-ok">✓ Nothing overflowing${basis === 'measured' && measured ? '' : ' at this cadence'}.</div>`
        : `<div class="ff-re-summary-loss">${measured ? 'Lost' : 'Losing'} ${formatMoney(totalLoss)}/day (${(lossShare * 100).toFixed(lossShare < 0.1 ? 1 : 0)}%)${leaking.length ? ` · mostly ${escapeHtml(leaking[0].card.title)}` : ''}</div>`;
    summaryEl.innerHTML = noData
      ? `<div class="ff-re-summary-line">Up to <b>${formatMoney(totalTheoretical)}</b> per day, collected in time</div>`
      : `
      <div class="ff-re-summary-line"><b>${formatMoney(totalNet)}</b> / ${formatMoney(totalTheoretical)} possible per day</div>
      ${lossLine}
    `;
  }

  const rowsEl = panelEl.querySelector('.ff-re-rows');
  if (rowsEl) rowsEl.innerHTML = [...leaking, ...rest].map((x) => renderRow(x.card, x.f, gapLabel)).join('');

  const alertEl = panelEl.querySelector('.ff-re-badge-alert');
  if (alertEl) {
    alertEl.textContent = String(leaking.length);
    alertEl.classList.toggle('ff-re-show', leaking.length > 0);
  }

  // Plans: the bonus is the player's, read off any owned card.
  const bonusPct = cards.find((c) => c.bonusPct > 0)?.bonusPct ?? 0;
  const byDistrict = new Map<string, { plans: PropertyPlan[]; locked: boolean; minLevel: number | null }>();
  for (const card of unowned) {
    const plan = planProperty(card.price, card.baseHourly, card.baseVault, bonusPct, cadence);
    renderPlan(card, plan, gapLabel);
    const d = byDistrict.get(card.district) ?? { plans: [], locked: isLocked(card), minLevel: card.minLevel };
    d.plans.push(plan);
    byDistrict.set(card.district, d);
  }
  const plansEl = panelEl.querySelector<HTMLElement>('.ff-re-plans');
  if (plansEl) {
    plansEl.style.display = byDistrict.size ? '' : 'none';
    plansEl.innerHTML =
      `<div class="ff-re-plans-h">Not owned yet · buy, max Revenue, Vault for ${gapLabel}</div>` +
      [...byDistrict.entries()]
        .map(([name, d]) => {
          const total = d.plans.reduce((s, p) => s + p.total, 0);
          const daily = d.plans.reduce((s, p) => s + p.daily, 0);
          return `<div class="ff-re-plans-row${d.locked ? ' ff-re-locked' : ''}"><b>${escapeHtml(name || 'Unknown district')}</b>${
            d.locked ? ` · unlocks at level ${d.minLevel}` : ''
          }<br>${d.plans.length} propert${d.plans.length === 1 ? 'y' : 'ies'}: ~<b>${formatShort(total)}</b> → ~${formatShort(daily)}/day, pays back in ~${Math.round(total / daily)} days</div>`;
        })
        .join('');
  }
}

function setExpanded(next: boolean) {
  panelEl?.classList.toggle('ff-re-expanded', next);
}

function setTab(next: 'advisor' | 'auto') {
  activeTab = next;
  panelEl?.querySelectorAll<HTMLElement>('.ff-re-tab').forEach((t) => t.classList.toggle('ff-re-tab-on', t.dataset.tab === next));
  panelEl?.querySelectorAll<HTMLElement>('.ff-re-pane').forEach((p) => p.classList.toggle('ff-re-pane-on', p.dataset.pane === next));
}

function markChips() {
  panelEl?.querySelectorAll<HTMLButtonElement>('.ff-re-chip').forEach((chip) => {
    const active = chip.dataset.basis === 'measured' ? basis === 'measured' : basis === 'whatIf' && Number(chip.dataset.hours) === cadenceHours;
    chip.classList.toggle('ff-re-chip-active', active);
  });
}

async function setBasis(next: 'measured' | 'whatIf', hours = cadenceHours) {
  basis = next;
  cadenceHours = hours;
  markChips();
  refresh(true);
  try {
    await storage.setRealEstateAdvisorPreferences({ basis, cadenceHours });
  } catch (err) {
    console.error(LOG_PREFIX, 'failed to save real estate advisor basis', err);
  }
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  const chips = CADENCE_OPTIONS.map((h) => `<button class="ff-re-chip" type="button" data-hours="${h}">${h}h</button>`).join('');
  el.innerHTML = `
    <button class="ff-re-badge" type="button">
      ${brandBadgeHtml('Real Estate')}
      <span class="ff-re-badge-alert">0</span>
      <span class="ff-re-badge-arrow">▲</span>
    </button>
    <div class="ff-re-panel">
      <div class="ff-re-head">
        ${brandBadgeHtml('Real Estate Advisor')}
        <button class="ff-re-close" type="button" title="Collapse">✕</button>
      </div>
      <div class="ff-re-tabs">
        <button class="ff-re-tab" type="button" data-tab="advisor">Advisor</button>
        <button class="ff-re-tab" type="button" data-tab="auto">Auto-Collect</button>
      </div>
      <div class="ff-re-pane" data-pane="advisor">
        <div class="ff-re-cadence">
          <button class="ff-re-chip" type="button" data-basis="measured">My collections</button>
          <span class="ff-re-cadence-group"><span class="ff-re-cadence-label">What if every</span>${chips}</span>
        </div>
        <div class="ff-re-basis-note"></div>
        <div class="ff-re-summary"></div>
        <div class="ff-re-rows"></div>
        <div class="ff-re-plans"></div>
      </div>
      <div class="ff-re-pane ff-re-auto" data-pane="auto"></div>
    </div>
  `;

  el.querySelector('.ff-re-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-re-close')?.addEventListener('click', () => setExpanded(false));
  el.querySelectorAll<HTMLButtonElement>('.ff-re-tab').forEach((tab) => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab === 'auto' ? 'auto' : 'advisor'));
  });
  el.querySelectorAll<HTMLButtonElement>('.ff-re-chip').forEach((chip) => {
    chip.addEventListener('click', () =>
      void (chip.dataset.basis === 'measured' ? setBasis('measured') : setBasis('whatIf', Number(chip.dataset.hours))),
    );
  });

  return el;
}

function applyVaultState(state: RealEstateVaultState | null | undefined) {
  collections = state?.collections ?? [];
}

export async function initRealEstateAdvisor(): Promise<void> {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + STYLE + autoSectionStyle(`#${CONTAINER_ID}`));

  try {
    const [prefs, vaults, stats] = await Promise.all([
      storage.getRealEstateAdvisorPreferences(),
      storage.getRealEstateVaults(),
      storage.getLatestStats(),
    ]);
    basis = prefs.basis;
    cadenceHours = prefs.cadenceHours;
    applyVaultState(vaults);
    playerLevel = stats?.level ?? null;
  } catch (err) {
    console.error(LOG_PREFIX, 'failed to load real estate advisor state', err);
  }

  panelEl = buildPanel();
  markChips();
  (document.body ?? document.documentElement).appendChild(panelEl);
  setTab(activeTab);
  const autoEl = panelEl.querySelector<HTMLElement>('.ff-re-auto');
  if (autoEl) void mountAutoCollect(autoEl, panelEl.querySelector<HTMLElement>('.ff-re-tab[data-tab="auto"]'));
  refresh(true);

  // New collections (recorded by the background) and a level-up both change
  // what's shown without the game re-rendering anything.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (STORAGE_KEYS.REAL_ESTATE_VAULTS in changes) applyVaultState(changes[STORAGE_KEYS.REAL_ESTATE_VAULTS].newValue as RealEstateVaultState | undefined);
    if (STORAGE_KEYS.LATEST_STATS in changes) playerLevel = (changes[STORAGE_KEYS.LATEST_STATS].newValue as { level?: number } | undefined)?.level ?? playerLevel;
    if (STORAGE_KEYS.REAL_ESTATE_VAULTS in changes || STORAGE_KEYS.LATEST_STATS in changes) refresh(false);
  });

  // Same "watch the live DOM, react to what's actually there" approach as
  // Fight Club's toolbar and Street Intel's highlights — the game swaps panel
  // content via innerHTML on the same page, so there's no navigation event to
  // hook instead.
  // The fill badge changes with the vault amounts (not in the signature) and
  // with the clock, so it's redrawn on every pass and each minute; it only
  // writes when its text changes, so its own writes settle.
  const observer = new MutationObserver(() => {
    refresh(false);
    renderFillBadge();
  });
  setInterval(renderFillBadge, 60_000);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
