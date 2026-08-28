import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { analyzeProperty, type PropertyAdvice } from '@/shared/realEstateAdvisor';

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
`;

interface ParsedCard {
  el: HTMLElement;
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
    const costMatch = onclick.match(/Rev2\.upgrade\(\d+,\s*'(?:revenue|vault)',\s*(\d+)\)/);
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
  return {
    el: el as HTMLElement,
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

function renderRibbon(card: ParsedCard, advice: PropertyAdvice) {
  card.el.classList.add('ff-re-card');
  let ribbon = card.el.querySelector<HTMLDivElement>(':scope > .ff-re-ribbon');
  if (!ribbon) {
    ribbon = document.createElement('div');
    ribbon.className = 'ff-re-ribbon';
    card.el.prepend(ribbon);
  }
  const amount = `<span class="ff-re-ribbon-amt">${formatMoney(advice.effectiveDaily)}<small>/24h</small></span>`;
  if (advice.isOverflowing) {
    ribbon.dataset.ffStatus = severity(advice.lossDaily / advice.theoreticalDaily);
    ribbon.innerHTML = `${amount}<span class="ff-re-ribbon-loss">-${formatMoney(advice.lossDaily)}/day</span>`;
  } else {
    ribbon.dataset.ffStatus = 'balanced';
    ribbon.innerHTML = amount;
  }
}

function renderRow(card: ParsedCard, advice: PropertyAdvice): string {
  const revenueLabel = card.revenueLevel >= 11 ? 'Revenue L11 (maxed)' : `Revenue L${card.revenueLevel}`;
  const vaultLabel = card.vaultLevel >= 11 ? 'Vault L11 (maxed)' : `Vault L${card.vaultLevel}`;
  const meta = `${revenueLabel} · ${vaultLabel} · fills in ${formatHours(advice.fillHours)}`;

  let body: string;
  if (advice.isOverflowing) {
    const sev = severity(advice.lossDaily / advice.theoreticalDaily);
    const gaugePct = Math.min(100, (advice.effectiveDaily / advice.theoreticalDaily) * 100);
    let action: string;
    if (advice.targetLevel === null) {
      action = `Vault is already maxed — still short ${formatMoney(advice.residualLossAtTarget)}/day. Collect more often to close the rest.`;
    } else if (advice.structurallyCapped) {
      action = `Best possible: Vault → L${advice.targetLevel} for ${formatMoney(advice.costToTarget ?? 0)} — still short ${formatMoney(advice.residualLossAtTarget)}/day. Collect more often to close the rest.`;
    } else {
      action = `Upgrade Vault → L${advice.targetLevel} for ${formatMoney(advice.costToTarget ?? 0)}`;
    }
    body = `
      <div class="ff-re-row-loss" data-ff-sev="${sev}">Losing ${formatMoney(advice.lossDaily)}/day</div>
      <div class="ff-re-row-advice">${action}</div>
      <div class="ff-re-row-gauge"><div class="ff-re-row-gauge-fill" data-ff-sev="${sev}" style="width:${gaugePct}%"></div></div>
    `;
  } else {
    body = `<div class="ff-re-row-ok">✓ Vault comfortably covers this cadence</div>`;
  }

  // Revenue and Vault are independent purchases — maxing one says nothing
  // about whether the other is worth touching (a property can need Revenue
  // maxed but only a couple of Vault levels, or vice versa). Reported as two
  // separate lines rather than one combined total so that never reads as a
  // single bundled recommendation. The Vault-to-L11 cost is only shown when
  // it's more than what's actually needed to stop the leak (`!structurallyCapped`,
  // i.e. maxing is genuinely optional) — when Vault is already maxed for
  // real, `costToTarget` above already said the same thing and repeating it
  // here would just be the same number twice.
  const maxLines: string[] = [];
  if (advice.costToMaxRevenue > 0) {
    maxLines.push(`<div class="ff-re-row-max">Max Revenue → L11: ${formatMoney(advice.costToMaxRevenue)}</div>`);
  }
  if (advice.costToMaxVault > 0 && !advice.structurallyCapped) {
    const note = advice.isOverflowing
      ? ` — optional beyond L${advice.targetLevel}, which already stops the leak`
      : ' — optional, already covers this cadence';
    maxLines.push(`<div class="ff-re-row-max">Max Vault → L11: ${formatMoney(advice.costToMaxVault)}${note}</div>`);
  }
  const maxLine = advice.costToMaxRevenue === 0 && advice.costToMaxVault === 0
    ? `<div class="ff-re-row-max ff-re-row-max--done">✓ Revenue and Vault both maxed (L11)</div>`
    : maxLines.join('');

  return `
    <div class="ff-re-row" data-ff-status="${advice.isOverflowing ? 'leaking' : 'balanced'}">
      <div class="ff-re-row-top">
        <span class="ff-re-row-name">${escapeHtml(card.title)}</span>
        <span class="ff-re-row-amt">${formatMoney(advice.effectiveDaily)}<small>/24h</small></span>
      </div>
      <div class="ff-re-row-meta">${meta}</div>
      ${body}
      ${maxLine}
    </div>
  `;
}

let panelEl: HTMLDivElement | null = null;
let cadenceHours = 24;
// Skips re-touching the DOM when nothing the game reports has actually
// changed since the last pass — without this, every mutation this feature's
// own ribbons/panel writes would re-trigger the same document-wide observer
// that's watching for the game's own changes, recomputing (and rewriting)
// forever. Built only from what the game renders (never from our own
// injected elements), so our writes can't feed back into it.
let lastSignature = '';

function computeSignature(cards: ParsedCard[]): string {
  return `${cadenceHours}|${cards
    .map((c) => [c.title, c.hourly, c.vaultCap, c.vaultLevel, c.nextVaultUpgradeCost, c.revenueLevel, c.nextRevenueUpgradeCost].join(','))
    .join(';')}`;
}

function refresh(force: boolean) {
  if (!panelEl) return;
  const cardEls = Array.from(document.querySelectorAll(CARD_SELECTOR));
  const visible = cardEls.length > 0;
  panelEl.classList.toggle('ff-re-visible', visible);
  if (!visible && !force) return;

  const cards = cardEls.map(parseCard).filter((c): c is ParsedCard => c !== null);
  const signature = computeSignature(cards);
  if (!force && signature === lastSignature) return;
  lastSignature = signature;

  const advice = cards.map((card) => ({ card, advice: analyzeProperty(toAdviceInput(card), cadenceHours) }));

  for (const { card, advice: a } of advice) renderRibbon(card, a);

  const leaking = advice.filter((x) => x.advice.isOverflowing).sort((a, b) => b.advice.lossDaily - a.advice.lossDaily);
  const balanced = advice.filter((x) => !x.advice.isOverflowing);

  const totalTheoretical = advice.reduce((sum, x) => sum + x.advice.theoreticalDaily, 0);
  const totalEffective = advice.reduce((sum, x) => sum + x.advice.effectiveDaily, 0);
  const totalLoss = totalTheoretical - totalEffective;

  const summaryEl = panelEl.querySelector('.ff-re-summary');
  if (summaryEl) {
    if (totalLoss < 1) {
      summaryEl.innerHTML = `<div class="ff-re-summary-ok">✓ Every property is earning its full ${formatMoney(totalTheoretical)}/24h — nothing overflowing at this cadence.</div>`;
    } else {
      const pct = Math.round((totalLoss / totalTheoretical) * 100);
      summaryEl.innerHTML = `
        <div class="ff-re-summary-line"><b>${formatMoney(totalEffective)}</b> / ${formatMoney(totalTheoretical)} possible per day</div>
        <div class="ff-re-summary-loss">Losing ${formatMoney(totalLoss)}/day (${pct}%) across ${leaking.length} propert${leaking.length === 1 ? 'y' : 'ies'}</div>
      `;
    }
  }

  const rowsEl = panelEl.querySelector('.ff-re-rows');
  if (rowsEl) {
    rowsEl.innerHTML = [...leaking, ...balanced].map((x) => renderRow(x.card, x.advice)).join('');
  }

  const alertEl = panelEl.querySelector('.ff-re-badge-alert');
  if (alertEl) {
    alertEl.textContent = String(leaking.length);
    alertEl.classList.toggle('ff-re-show', leaking.length > 0);
  }
}

function setExpanded(next: boolean) {
  panelEl?.classList.toggle('ff-re-expanded', next);
}

async function setCadence(hours: number) {
  cadenceHours = hours;
  panelEl?.querySelectorAll<HTMLButtonElement>('.ff-re-chip').forEach((chip) => {
    chip.classList.toggle('ff-re-chip-active', Number(chip.dataset.hours) === hours);
  });
  refresh(true);
  try {
    await storage.setRealEstateAdvisorPreferences({ cadenceHours: hours });
  } catch (err) {
    console.error(LOG_PREFIX, 'failed to save real estate advisor cadence', err);
  }
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  const chips = CADENCE_OPTIONS
    .map((h) => `<button class="ff-re-chip${h === cadenceHours ? ' ff-re-chip-active' : ''}" type="button" data-hours="${h}">${h}h</button>`)
    .join('');
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
      <div class="ff-re-cadence">
        <span class="ff-re-cadence-label">Collect every</span>
        ${chips}
      </div>
      <div class="ff-re-summary"></div>
      <div class="ff-re-rows"></div>
    </div>
  `;

  el.querySelector('.ff-re-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-re-close')?.addEventListener('click', () => setExpanded(false));
  el.querySelectorAll<HTMLButtonElement>('.ff-re-chip').forEach((chip) => {
    chip.addEventListener('click', () => void setCadence(Number(chip.dataset.hours)));
  });

  return el;
}

export async function initRealEstateAdvisor(): Promise<void> {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + STYLE);

  try {
    const prefs = await storage.getRealEstateAdvisorPreferences();
    cadenceHours = prefs.cadenceHours;
  } catch (err) {
    console.error(LOG_PREFIX, 'failed to load real estate advisor preferences', err);
  }

  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);
  refresh(true);

  // Same "watch the live DOM, react to what's actually there" approach as
  // Fight Club's toolbar and Street Intel's highlights — the game swaps panel
  // content via innerHTML on the same page, so there's no navigation event to
  // hook instead.
  const observer = new MutationObserver(() => refresh(false));
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
