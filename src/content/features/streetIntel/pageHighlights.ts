import { injectStyleOnce } from '@/content/shared/injectStyle';

/**
 * Marks up the live Street Intel page directly — no separate list anywhere the
 * player can't act on it (same lesson as Fight Club's targetControls.ts):
 *
 * 1. The single best-value opportunity (highest reward-midpoint per Stamina spent,
 *    among cards not already completed this cycle) gets a "Best Value" ribbon.
 * 2. Any medium/high/extreme/legendary-risk card gets a colored glow — those are
 *    rare among an otherwise mostly-low-risk list and pay well, so they're worth
 *    catching without reading every risk badge.
 * 3. Once a scout reveals per-approach odds, the approach with the best success %
 *    in the "Choose Your Approach" dialog gets a "Best Odds" badge.
 *
 * All of this reads directly off the real DOM nodes and only ever adds classes/
 * attributes — nothing is cloned or replaced, so every button (Scout, Go Blind, the
 * approach rows themselves) stays exactly as clickable as the game shipped it.
 */

const STYLE_ID = 'ff-si-style';
const CARDS_SELECTOR = '.si-cards';
const APPROACH_SELECTOR = '.si-overlay .si-approach';

const STYLE = `
.si-card.ff-si-best { position: relative; }
.si-card.ff-si-best::before {
  content: 'FF BEST VALUE';
  position: absolute; top: 0; left: 0;
  background: linear-gradient(135deg, #d4af6a, #c9a84c);
  color: #1a1000;
  font-family: 'Courier New', ui-monospace, monospace;
  font-size: 0.5rem;
  font-weight: 900;
  letter-spacing: 1px;
  padding: 3px 10px;
  border-radius: 0 0 8px 0;
  z-index: 5;
}
.si-card[data-ff-risk] { animation: ffSiPulse 2.2s ease-in-out infinite; }
.si-card[data-ff-risk="medium"] { box-shadow: 0 0 0 1px rgba(251,191,36,.5), 0 0 20px rgba(251,191,36,.25); }
.si-card[data-ff-risk="high"] { box-shadow: 0 0 0 1px rgba(249,115,22,.55), 0 0 22px rgba(249,115,22,.3); }
.si-card[data-ff-risk="extreme"] { box-shadow: 0 0 0 1px rgba(239,68,68,.6), 0 0 24px rgba(239,68,68,.35); }
.si-card[data-ff-risk="legendary"] { box-shadow: 0 0 0 1px rgba(251,191,36,.7), 0 0 26px rgba(251,191,36,.4); }
@keyframes ffSiPulse { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.14); } }
@media (prefers-reduced-motion: reduce) {
  .si-card[data-ff-risk] { animation: none; }
}
.si-approach.ff-si-best-approach {
  position: relative;
  border-color: rgba(201,168,76,.55) !important;
  background: rgba(201,168,76,.07) !important;
}
.si-approach.ff-si-best-approach::after {
  content: 'FF BEST ODDS';
  position: absolute; top: 8px; right: 10px;
  background: linear-gradient(135deg, #d4af6a, #c9a84c);
  color: #1a1000;
  font-size: 0.5rem;
  font-weight: 900;
  letter-spacing: .5px;
  padding: 2px 7px;
  border-radius: 4px;
  z-index: 2;
}
`;

function statValue(card: Element, label: string): string {
  for (const stat of Array.from(card.querySelectorAll('.si-card-stat'))) {
    if ((stat.querySelector('.lbl')?.textContent ?? '').trim().toLowerCase() === label) {
      return stat.querySelector('.val')?.textContent ?? '';
    }
  }
  return '';
}

function rewardMidpoint(text: string): number | null {
  const match = text.match(/\$([\d,]+)\s*[–-]\s*\$([\d,]+)/);
  if (!match) return null;
  return (Number(match[1].replace(/,/g, '')) + Number(match[2].replace(/,/g, ''))) / 2;
}

function staminaCost(text: string): number | null {
  const n = Number(text.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function riskTier(card: Element): 'medium' | 'high' | 'extreme' | 'legendary' | null {
  const cls = card.className;
  if (cls.includes('legendary')) return 'legendary';
  if (cls.includes('risk-extreme')) return 'extreme';
  if (cls.includes('risk-high')) return 'high';
  if (cls.includes('risk-medium')) return 'medium';
  return null;
}

function refreshCards(container: Element) {
  const cards = Array.from(container.querySelectorAll(':scope > .si-card'));
  let bestCard: Element | null = null;
  let bestRatio = -Infinity;

  for (const card of cards) {
    card.classList.remove('ff-si-best');

    const tier = riskTier(card);
    if (tier) card.setAttribute('data-ff-risk', tier);
    else card.removeAttribute('data-ff-risk');

    if (card.querySelector('.si-btn.done')) continue; // already resolved this cycle

    const reward = rewardMidpoint(statValue(card, 'reward'));
    const stamina = staminaCost(statValue(card, 'stamina'));
    if (reward === null || stamina === null) continue;

    const ratio = reward / stamina;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestCard = card;
    }
  }

  bestCard?.classList.add('ff-si-best');
}

function refreshApproaches(detail: Element) {
  const approaches = Array.from(detail.querySelectorAll('.si-approach'));
  let best: Element | null = null;
  let bestPct = -1;

  for (const approach of approaches) {
    approach.classList.remove('ff-si-best-approach');
    const match = (approach.querySelector('.scout-pct')?.textContent ?? '').match(/(\d+)%/);
    if (!match) continue; // unscouted ("Go Blind") dialog — no odds to rank

    const pct = Number(match[1]);
    if (pct > bestPct) {
      bestPct = pct;
      best = approach;
    }
  }

  best?.classList.add('ff-si-best-approach');
}

const INSTALL_FLAG = '__ffStreetIntelHighlightsInstalled';

export function initStreetIntelHighlights() {
  if ((window as unknown as Record<string, boolean>)[INSTALL_FLAG]) return;
  (window as unknown as Record<string, boolean>)[INSTALL_FLAG] = true;

  injectStyleOnce(STYLE_ID, STYLE);

  const observer = new MutationObserver(() => {
    const cards = document.querySelector(CARDS_SELECTOR);
    if (cards) refreshCards(cards);

    const approach = document.querySelector(APPROACH_SELECTOR);
    if (approach) refreshApproaches(approach.closest('.si-detail') ?? document.body);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}
