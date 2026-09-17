import type { CapturedRequest } from '@/shared/messaging';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';

/**
 * Badges the live boss card on the Arena page with its real win% — the boss
 * never gets a "N% CHANCE" badge in the game's own UI (unlike every regular
 * opponent), but the server computes one anyway and hands it straight to the
 * client in `open_next_page`'s own response (`boss_data.win_pct`, confirmed
 * real — see docs/game-mechanics.md's Arena section). This only surfaces a
 * number the game already gave the page; nothing here estimates anything.
 *
 * Only ever populated by the *game's own* client JS calling `open_next_page`
 * (opening a page manually, or Refresh) — this content script sees that as a
 * normal same-origin page request. Auto-Attack's own automation calls the
 * same action directly from the background service worker, not through the
 * page, so this never observes those calls; a page Auto-Attack opened itself
 * (or one already open before this tab loaded) simply shows no badge — the
 * same "genuinely unrecoverable, not a bug" limitation `runner.ts`'s own
 * `resolveOpenPage` already documents for the identical reason.
 *
 * Keyed by boss *name*, not just cached blindly: the boss card can be
 * replaced wholesale by the game's own re-render between pages, and without
 * checking the name against what's actually on screen, a badge painted from
 * a previous page's boss could flash onto the next page's different boss
 * for the brief window before a fresh capture arrives. Matching names means
 * a mismatch (or no capture at all yet) always renders nothing instead of a
 * wrong number.
 */

const BOSS_CARD_SELECTOR = '.ar-opp.ar-opp-boss';
const BADGE_CLASS = 'ff-ar-boss-winpct';
const FEATURE_KEY = 'arena';

let lastBoss: { name: string; winPct: number } | null = null;

function winPctClass(pct: number): string {
  // Approximate — mirrors the three buckets the game's own regular-opponent
  // badges use (`ar-winpct-low/mid/high`), reverse-engineered from real
  // captures (38→low, 52/67→mid, 73→high). Cosmetic only; nothing in this
  // extension's own logic depends on the boundary being exact.
  if (pct >= 65) return 'ar-winpct-high';
  if (pct >= 45) return 'ar-winpct-mid';
  return 'ar-winpct-low';
}

function paintBossBadge(): void {
  if (!lastBoss) return;
  const card = document.querySelector(BOSS_CARD_SELECTOR);
  if (!card) return;

  const nameEl = card.querySelector('.ar-opp-name');
  if (nameEl?.textContent?.trim() !== lastBoss.name) return;

  const meta = card.querySelector('.ar-opp-meta');
  if (!meta || meta.querySelector(`.${BADGE_CLASS}`)) return;

  const span = document.createElement('span');
  // Same base class as the game's own regular-opponent badge so this looks
  // native sitting right next to the bounty badge, not like an injected add-on.
  span.className = `ar-opp-winpct ${BADGE_CLASS} ${winPctClass(lastBoss.winPct)}`;
  span.innerHTML = `${lastBoss.winPct}<span class="ar-pts-suffix">% CHANCE</span>`;
  meta.appendChild(span);
}

export function handleCapturedRequest(req: CapturedRequest): void {
  if (req.method !== 'POST') return;
  if (!req.url.includes('/actions/arena_v2.php')) return;
  if (new URLSearchParams(req.requestBody ?? '').get('action') !== 'open_next_page') return;

  try {
    const data = JSON.parse(req.responseText);
    const name = data?.new_page?.boss_data?.name;
    const winPct = data?.new_page?.boss_data?.win_pct;
    if (typeof name !== 'string' || typeof winPct !== 'number') {
      recordParseFailure(FEATURE_KEY);
      return;
    }
    recordParseSuccess(FEATURE_KEY);
    lastBoss = { name, winPct };
    paintBossBadge();
  } catch {
    recordParseFailure(FEATURE_KEY);
  }
}

export function initArenaBossOdds(): void {
  paintBossBadge();
  const observer = new MutationObserver(() => paintBossBadge());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}
