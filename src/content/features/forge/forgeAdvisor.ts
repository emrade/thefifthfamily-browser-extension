import { injectStyleOnce } from '@/content/shared/injectStyle';
import { FORGE_MAX_RANK, expectedForgeCost } from '@/shared/forge';

/**
 * Forge Advisor: one line under each item on the Forge page with what the
 * game's own card leaves out — what landing the next rank actually costs once
 * failures are counted (a failed attempt charges the full cash; the item is
 * kept), the cash per stat point that rank adds, and the expected total to
 * reach +8 and +10.
 *
 * Every number comes from the page where the page has it: the card's next
 * rank, cost, chance and per-stat gains, and each rank's chance from the
 * page's own "Tempering Odds" table. Costs past the next rank follow the
 * measured ladder (`@/shared/forge`); ranks 7–10 are the wiki's and marked
 * so. Read-only — nothing is clicked or sent.
 */

const STYLE_ID = 'ff-forge-advisor-style';
const LINE_CLASS = 'ff-fg-line';

const CSS = `
.${LINE_CLASS} {
  margin-top: 9px; padding: 7px 10px; border-radius: 8px;
  background: rgba(201,168,76,0.06); border: 1px solid rgba(201,168,76,0.18);
  font-family: 'Inter', system-ui, sans-serif; font-size: 0.6rem; line-height: 1.55; color: #cfc8b6;
}
.${LINE_CLASS} b { color: #e8c766; font-weight: 800; font-variant-numeric: tabular-nums; }
.${LINE_CLASS} .ff-fg-sep { color: #4b4a45; margin: 0 5px; }
.${LINE_CLASS} .ff-fg-note { color: #8b8578; }
`;

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

/** Visible text of every element with no element children, in order — the
 *  page's numbers sit in small spans/divs of their own. */
function leafTexts(root: Element): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.children.length === 0) {
      const t = (el.textContent ?? '').trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/** "+1 95% +2 90% …" from the page's Tempering Odds table, as 0–1. */
function readOddsTable(root: Element): Record<number, number> {
  const texts = leafTexts(root);
  const start = texts.findIndex((t) => /^Tempering Odds$/i.test(t));
  const odds: Record<number, number> = {};
  if (start < 0) return odds;
  for (let i = start + 1; i < texts.length - 1 && i < start + 40; i++) {
    const rank = texts[i].match(/^\+(\d+)$/);
    const pct = texts[i + 1].match(/^(\d+(?:\.\d+)?)%$/);
    if (rank && pct) odds[Number(rank[1])] = Number(pct[1]) / 100;
  }
  return odds;
}

interface ForgeCard {
  rank: number;
  nextRank: number;
  nextCost: number;
  nextChance: number;
  gain: number;
}

function readCard(card: HTMLElement): ForgeCard | null {
  const button = card.querySelector('button');
  const buttonText = button?.textContent ?? '';
  const next = buttonText.match(/\+(\d+)/);
  const cost = buttonText.match(/\$([\d,]+)/);
  if (!next || !cost) return null; // maxed, or not a forgeable row
  const nextRank = Number(next[1]);
  // The rank badge on the item image ("+5"); no badge means +0.
  const badge = Array.from(card.querySelectorAll('div')).find((d) => d.children.length === 0 && /^\+\d+$/.test((d.textContent ?? '').trim()));
  const rank = badge ? Number((badge.textContent ?? '').trim().slice(1)) : nextRank - 1;
  // Read from the block under the button ("40% chance / 3g on success"),
  // not the whole card: the card's text runs the cost and the chance
  // together ("$1,042,50095% chance").
  const chance = (button?.nextElementSibling?.textContent ?? '').match(/(\d+(?:\.\d+)?)%\s*chance/i);
  // "DEF 171 +18": the stat, then what the next rank adds to it. Each stat
  // is its own span; no word boundary to lean on ("+3DEF 171 +18").
  let gain = 0;
  for (const span of Array.from(card.querySelectorAll('span'))) {
    const m = (span.textContent ?? '').trim().match(/^(?:STR|DEF|AGI|DEX)\s+[\d,]+\s*\+(\d+)$/);
    if (m) gain += Number(m[1]);
  }
  if (!chance || nextRank !== rank + 1) return null;
  return { rank, nextRank, nextCost: Number(cost[1].replace(/,/g, '')), nextChance: Number(chance[1]) / 100, gain };
}

function lineFor(card: ForgeCard, odds: Record<number, number>): string {
  const chances = { ...odds, [card.nextRank]: card.nextChance };
  const next = expectedForgeCost(card.rank, card.nextRank, card.nextCost, chances);
  if (!next) return '';
  const parts = [
    `Landing +${card.nextRank}: <b>~${money(next.cash)}</b> <span class="ff-fg-note">(${next.tries.toFixed(1)} tries on average, failures included)</span>`,
  ];
  if (card.gain > 0) parts.push(`<b>~${money(next.cash / card.gain)}</b> per stat point`);
  let unmeasured = false;
  for (const target of [8, FORGE_MAX_RANK]) {
    if (target <= card.nextRank) continue;
    const to = expectedForgeCost(card.rank, target, card.nextCost, chances);
    if (!to) continue;
    unmeasured ||= to.usesUnmeasured;
    parts.push(`to +${target}: <b>~${money(to.cash)}</b>${to.usesUnmeasured ? '*' : ''}`);
  }
  const note = unmeasured ? '<br><span class="ff-fg-note">* Costs for +7 and up are the wiki’s; the game shows only the next rank’s price.</span>' : '';
  return parts.join('<span class="ff-fg-sep">·</span>') + note;
}

function annotate(): void {
  const items = Array.from(document.querySelectorAll<HTMLElement>('.forge-item'));
  if (!items.length) return;
  const root = items[0].closest('.forge-group')?.parentElement ?? document.body;
  const odds = readOddsTable(root);
  for (const item of items) {
    const card = readCard(item);
    const html = card ? lineFor(card, odds) : '';
    let line = item.querySelector<HTMLElement>(`:scope > .${LINE_CLASS}`);
    if (!html) {
      line?.remove();
      continue;
    }
    if (!line) {
      line = document.createElement('div');
      line.className = LINE_CLASS;
      item.appendChild(line);
    }
    if (line.innerHTML !== html) line.innerHTML = html;
  }
}

const INSTALL_FLAG = '__ffForgeAdvisorInstalled';

export function initForgeAdvisor(): void {
  if ((window as unknown as Record<string, boolean>)[INSTALL_FLAG]) return;
  (window as unknown as Record<string, boolean>)[INSTALL_FLAG] = true;
  injectStyleOnce(STYLE_ID, CSS);
  let queued = false;
  // The game re-renders the Forge panel after every attempt; re-annotate,
  // batched to one pass per frame (our own line insertions trigger this too,
  // but `annotate` only writes when a line actually changes).
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (document.querySelector('.forge-item')) annotate();
    });
  });
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  if (document.querySelector('.forge-item')) annotate();
}
