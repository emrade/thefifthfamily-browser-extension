import { injectStyleOnce } from '@/content/shared/injectStyle';
import { parseDollarRange } from '@/shared/parseDollarRange';
import { storage } from '@/shared/storage';
import { computeEstimate, sumSharedModifiers } from '@/shared/streetIntelEstimate';

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
.si-approach.ff-si-best-guess {
  position: relative;
  border-color: rgba(96,165,250,.5) !important;
  background: rgba(96,165,250,.06) !important;
}
.si-approach.ff-si-best-guess::after {
  content: 'FF BEST GUESS';
  position: absolute; top: 8px; right: 10px;
  background: linear-gradient(135deg, #60a5fa, #3b82f6);
  color: #0a1628;
  font-size: 0.5rem;
  font-weight: 900;
  letter-spacing: .5px;
  padding: 2px 7px;
  border-radius: 4px;
  z-index: 2;
}
/* The real winner is ALSO the single best approach on the whole card by the
   formula's own reckoning (no hidden approach estimates higher) — a
   distinct, glowing state rather than either plain badge alone. See
   annotateApproaches's doc comment for why this is its own state instead of
   showing both (impossible anyway — both are ::after pseudo-elements, and
   an element can only have one) or silently just "FF Best Odds". */
.si-approach.ff-si-confirmed {
  position: relative;
  border-color: rgba(251,191,36,.85) !important;
  background: rgba(251,191,36,.09) !important;
  animation: ffSiConfirmGlow 1.8s ease-in-out infinite;
}
.si-approach.ff-si-confirmed::after {
  content: 'FF CONFIRMED';
  position: absolute; top: 8px; right: 10px;
  background: linear-gradient(135deg, #fde68a, #fbbf24, #d4af37);
  color: #1a1000;
  font-size: 0.5rem;
  font-weight: 900;
  letter-spacing: .5px;
  padding: 2px 7px;
  border-radius: 4px;
  z-index: 2;
  box-shadow: 0 0 10px rgba(251,191,36,.55);
}
@keyframes ffSiConfirmGlow {
  0%, 100% { box-shadow: 0 0 6px rgba(251,191,36,.25); }
  50% { box-shadow: 0 0 20px rgba(251,191,36,.6); }
}
@media (prefers-reduced-motion: reduce) {
  .si-approach.ff-si-confirmed { animation: none; }
}
.si-approach { position: relative; }
.ff-si-estimate-badge {
  position: absolute;
  top: 8px; right: 10px;
  background: rgba(167,139,250,.16);
  color: #c4b5fd;
  border: 1px solid rgba(167,139,250,.4);
  font-size: 0.5rem;
  font-weight: 900;
  letter-spacing: .5px;
  padding: 2px 7px;
  border-radius: 4px;
  z-index: 2;
  white-space: nowrap;
}
/* A row that already carries a real corner badge (the one genuinely-revealed
   approach, or a Go-Blind dialog's best guess) needs its own estimate badge
   pushed down instead of overlapping that one — see annotateApproaches,
   which now labels every row, real included, so the two can be compared. */
.si-approach.ff-si-best-approach .ff-si-estimate-badge,
.si-approach.ff-si-best-guess .ff-si-estimate-badge,
.si-approach.ff-si-confirmed .ff-si-estimate-badge {
  top: 32px;
}
`;

// `.includes` rather than an exact match — the reward stat's label was renamed
// from "Reward" to "Success Reward" in the same markup refresh that switched
// reward figures to k/m notation (see parseDollarRange.ts), and an exact match
// against 'reward' can no longer find it. Substring matching survives this kind
// of label wording change without needing to know the exact current text.
function statValue(card: Element, label: string): string {
  for (const stat of Array.from(card.querySelectorAll('.si-card-stat'))) {
    if ((stat.querySelector('.lbl')?.textContent ?? '').trim().toLowerCase().includes(label)) {
      return stat.querySelector('.val')?.textContent ?? '';
    }
  }
  return '';
}

function rewardMidpoint(text: string): number | null {
  const range = parseDollarRange(text);
  return range ? (range.min + range.max) / 2 : null;
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

  // Only the real-number winner is found here — `annotateApproaches` owns
  // *every* badge class (`ff-si-best-approach`/`ff-si-best-guess`/
  // `ff-si-confirmed`) itself, deciding all three together in one place,
  // since which one applies depends on comparing this real value against
  // every hidden approach's own computed estimate. Splitting that decision
  // across two functions caused a real, confirmed bug before (see
  // `annotateApproaches`'s own doc comment on the ff-si-best-guess race) —
  // not repeating that pattern for a three-way decision.
  let realBest: Element | null = null;
  let realBestPct = -1;
  for (const approach of approaches) {
    // NOT stripped here — see the comment above this loop. `annotateApproaches`
    // owns the full remove-then-add cycle for this class now; a leftover
    // synchronous strip here was the exact race this whole restructure was
    // meant to avoid (confirmed live, 2026-09-07: page-timer-driven
    // MutationObserver firings kept re-stripping this class faster than the
    // async add-back could land, so "FF Best Odds" never stayed visible).
    const match = (approach.querySelector('.scout-pct')?.textContent ?? '').match(/(\d+)%/);
    if (!match) continue; // unscouted ("Go Blind") dialog, or a hidden partial-reveal row — no real odds to rank

    const pct = Number(match[1]);
    if (pct > realBestPct) {
      realBestPct = pct;
      realBest = approach;
    }
  }

  void annotateApproaches(approaches, realBest, realBestPct);
}

interface ScoutEstimateEntry {
  key: string;
  label: string;
  stat: string;
  base_pct: number | null;
  estimate_pct: number | null;
  modifiers: Record<string, number> | null;
  revealed: boolean;
}

interface CardApproachDef {
  key: string;
  label: string;
  stat: string;
  bonus: number;
  autofail: boolean;
}

// The most recent *real* revealed approach seen this session, from any
// card's scout response — see `recordScoutResponse`. Not reset between
// cards: its `base_pct`/shared modifiers stay a valid stand-in for a
// *different*, never-scouted card too (see the "approx" path in
// `annotateApproaches`), since most of them are account-progression values
// that don't change between one card and the next.
let lastScoutSeed: ScoutEstimateEntry | null = null;

/** Minimal decode for the handful of HTML entities the game double-encodes
 *  into a `data-*` attribute's JSON — same as the background parser's own
 *  `decodeAttrEntities` (streetIntelPanelRegexParser.ts), duplicated here
 *  rather than imported since content and background code don't share a
 *  module boundary in this codebase. */
function decodeAttrEntities(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
}

function parseCardApproaches(attrValue: string | null): CardApproachDef[] | null {
  if (!attrValue) return null;
  try {
    const parsed = JSON.parse(decodeAttrEntities(attrValue));
    if (!Array.isArray(parsed)) return null;
    return parsed.map((a) => ({
      key: String(a.key ?? ''),
      label: String(a.label ?? ''),
      stat: String(a.stat ?? ''),
      bonus: Number(a.bonus) || 0,
      autofail: Boolean(a.autofail),
    }));
  } catch {
    return null;
  }
}

/**
 * Captures a `scout` response's raw data (network-intercepted — see
 * content/features/streetIntel/index.ts). Only the one real revealed
 * approach is kept (`estimateExactly` below needs its `base_pct` and
 * `modifiers`) — everything else this feature needs (which approach is
 * hidden, its pre-scout `bonus`/`autofail`, the card's risk tier) is read
 * fresh from the live DOM at render time via `findOwningCard` instead of
 * cached here, since that lookup works identically whether the current
 * dialog came from Scout or Go Blind.
 */
export function recordScoutResponse(requestBody: string, responseText: string): void {
  const params = new URLSearchParams(requestBody);
  if (params.get('action') !== 'scout') return;

  let json: any;
  try {
    json = JSON.parse(responseText);
  } catch {
    return;
  }
  if (!json?.ok || !Array.isArray(json.estimates)) return;

  const seed = json.estimates.find((e: any) => e.revealed && typeof e.estimate_pct === 'number' && e.modifiers && typeof e.base_pct === 'number');
  if (!seed) return;
  lastScoutSeed = seed;

  // The scout response reaches here through an async network-interception
  // relay, but the game's own client JS opens the "Choose Your Approach"
  // dialog synchronously right after its own request resolves — a real race
  // confirmed live (2026-09-06): the dialog's first annotation pass (from
  // the MutationObserver below) can run *before* `lastScoutSeed` updates,
  // computing the freshly-scouted card's own revealed approach against
  // stale seed data (wrong 'approx' confidence instead of 'exact', and a
  // meaningfully different number). Updating `lastScoutSeed` isn't itself a
  // DOM mutation, so nothing would otherwise re-trigger a correction — do it
  // directly, right when the real data actually becomes available.
  const approach = document.querySelector(APPROACH_SELECTOR);
  if (approach) refreshApproaches(approach.closest('.si-detail') ?? document.body);
}

// Risk-tier band means for `base_pct`, empirically verified against 819 real
// scouted cards (see docs/street-intel-estimate-calculation.md's "How
// base_pct is set" section) — used only as a fallback when a card has never
// been scouted this session at all, so there's no real `base_pct` to work
// from. A real band, not a guess: low 46-61 (mean 53.6), medium 38-46 (41.7),
// high 26-33 (29.3), extreme 17-23 (19.4) — meaningfully less precise than a
// real scouted base_pct, which is why this path is labeled differently in
// the UI (see `annotateApproaches`).
const BASE_PCT_BY_RISK_TIER: Record<'low' | 'medium' | 'high' | 'extreme', number> = {
  low: 53.6,
  medium: 41.7,
  high: 29.3,
  extreme: 19.4,
};

/** Same class-based detection as `riskTier()` above, but always returns a
 *  tier (defaults to `'low'`) rather than `null` for a plain card — that
 *  function only cares about tiers worth a glow (medium and up), this one
 *  needs the real tier of *every* card to look up its `base_pct` band. */
function estimateRiskTier(card: Element): keyof typeof BASE_PCT_BY_RISK_TIER {
  const cls = card.className;
  if (cls.includes('risk-extreme')) return 'extreme';
  if (cls.includes('risk-high')) return 'high';
  if (cls.includes('risk-medium')) return 'medium';
  return 'low';
}

/**
 * Finds which `.si-card` the currently-open dialog belongs to — needed for
 * both a partial-reveal dialog (to read the hidden approaches' own pre-scout
 * `bonus`/`autofail`) and a Go Blind dialog (same data, plus the card's risk
 * tier for the `base_pct` fallback). There's no id exposed anywhere in the
 * dialog's own DOM, so this matches on content instead: a card is "the"
 * owning card only if *every one* of its own approaches' labels shows up
 * somewhere in the dialog's rows — cheap enough (a handful of cards, 3-4
 * approaches each) and self-validating, since a false match would need every
 * label to coincidentally collide.
 *
 * `data-approaches` lives on the card's own Scout/Go Blind `<button>`
 * elements, not on `.si-card` itself (confirmed against a real capture,
 * 2026-09-06) — both buttons on a card carry an identical value, so matching
 * either one and walking up to its `.si-card` ancestor is equivalent to
 * matching the card directly. Scoped to `.si-cards` (the opportunity list
 * container) rather than the whole document to avoid any coincidental match
 * elsewhere on the page.
 */
function findOwningCard(rowTexts: string[]): { approaches: CardApproachDef[]; riskTier: keyof typeof BASE_PCT_BY_RISK_TIER } | null {
  for (const btn of Array.from(document.querySelectorAll('.si-cards [data-approaches]'))) {
    const approaches = parseCardApproaches(btn.getAttribute('data-approaches'));
    if (!approaches || approaches.length === 0) continue;
    if (approaches.every((a) => rowTexts.some((t) => t.includes(a.label)))) {
      const card = btn.closest('.si-card');
      return { approaches, riskTier: card ? estimateRiskTier(card) : 'low' };
    }
  }
  return null;
}

/**
 * Adds a small "~NN% est." corner badge to every approach row this formula
 * can score — a partial-reveal hidden row, every row of a Go Blind dialog,
 * *and* (unlike before) the one row that already has a real number, so the
 * formula's own guess sits right next to the real value for a direct,
 * always-available accuracy check rather than only ever being checkable
 * once a hidden approach happens to get revealed some other time.
 *
 * Also decides, together with `refreshApproaches`'s real-number search,
 * which of three mutually exclusive outcomes applies to this dialog:
 * - **FF Best Odds** (gold): the real winner, when some hidden approach's
 *   estimate is still higher — i.e. the real number isn't necessarily the
 *   best on the card, just the best *confirmed* one.
 * - **FF Best Guess** (blue): the hidden approach with the single highest
 *   estimate, when it beats the real winner (or there is no real winner at
 *   all, a fully-unscored Go Blind dialog).
 * - **FF Confirmed** (gold, glowing): the real winner *is* also the single
 *   best approach on the whole card by the formula's own reckoning — no
 *   hidden approach estimates higher. Deliberately its own distinct state
 *   rather than showing both plain badges on one row (impossible anyway —
 *   both were originally `::after` pseudo-elements, and an element can only
 *   have one) or silently keeping just "FF Best Odds": tagging some
 *   hidden approach as a "guess" worth trying when it's already known to
 *   estimate lower than a real number you already have would be actively
 *   misleading, not just redundant.
 *
 * Two confidence levels for the estimate itself, labeled differently:
 * - **exact**: this exact card was scouted this session (`lastScoutSeed`'s
 *   own label appears among this dialog's rows) — its real `base_pct` and
 *   modifiers are used directly, same near-perfect accuracy as the formula
 *   itself.
 * - **approx**: this card has never been scouted this session — reuses
 *   `lastScoutSeed`'s modifiers (account-progression values, valid across
 *   different cards) but estimates `base_pct` from this card's own risk
 *   tier band instead of a real number. Meaningfully less precise; labeled
 *   accordingly.
 *
 * No-ops entirely if nothing has been scouted at all yet this session
 * (nothing to seed shared modifiers from) or if `findOwningCard` can't
 * identify which card this dialog belongs to.
 */
async function annotateApproaches(approaches: Element[], realBest: Element | null, realBestPct: number): Promise<void> {
  const seed = lastScoutSeed;
  if (!seed?.modifiers || seed.base_pct === null) return;

  const rowTexts = approaches.map((el) => el.textContent ?? '');
  const owning = findOwningCard(rowTexts);
  if (!owning) return;

  const seedIsThisCard = rowTexts.some((t) => t.includes(seed.label));
  const basePct = seedIsThisCard ? seed.base_pct : BASE_PCT_BY_RISK_TIER[owning.riskTier];
  const confidence: 'exact' | 'approx' = seedIsThisCard ? 'exact' : 'approx';
  const sharedMods = sumSharedModifiers(seed.modifiers);

  const stats = await storage.getLatestStats();
  if (!stats) return;

  // Owns the full remove-then-add cycle for all three outcome classes
  // itself (see `refreshApproaches`'s own comment on why) — deciding which
  // one applies to which row needs every real and computed value together,
  // atomically within one render pass, the same reasoning that already
  // applied to `ff-si-best-guess` alone before this added the third state.
  for (const approach of approaches) approach.classList.remove('ff-si-best-approach', 'ff-si-best-guess', 'ff-si-confirmed');

  // The overall winner across the whole card, using each row's best
  // available number — real where one exists, the formula's estimate where
  // it doesn't — the same ranking rule the auto-runner's own "computed"
  // odds mode uses (see actionRunner.ts). Seeded with the real winner (if
  // any) so a hidden approach only displaces it by genuinely estimating
  // higher, never just by existing.
  let overallBest: Element | null = realBest;
  let overallBestPct = realBestPct;

  for (let i = 0; i < approaches.length; i++) {
    const approach = approaches[i];
    // A Go Blind dialog never renders `.scout-info`/`.scout-pct` at all for
    // any row — the game's own client JS only builds that markup `if
    // (scouted && scoutData)`, and Go Blind calls its dialog builder with
    // `scouted: false, scoutData: null` (confirmed against a real capture,
    // 2026-09-06). So its absence here just means "no real number," same as
    // a partial-reveal hidden row — not a reason to skip the row entirely,
    // which previously left every Go Blind row with no estimate at all.
    const scoutEl = approach.querySelector('.scout-pct');
    const hasReal = scoutEl !== null && /\d+%/.test(scoutEl.textContent ?? '');

    const hidden = owning.approaches.find((a) => rowTexts[i].includes(a.label));
    if (!hidden) continue;
    const rawStat = (stats as unknown as Record<string, number>)[hidden.stat];
    if (typeof rawStat !== 'number') continue;

    const predicted = computeEstimate(basePct, sharedMods, hidden, rawStat);

    // Updated in place rather than "create once and leave it" — `confidence`
    // (and therefore the number itself) can legitimately change between
    // renders of the *same* dialog, specifically the race `recordScoutResponse`
    // now works around: its first pass can run against a stale seed before
    // the real one arrives, and only a fresh render afterward corrects it.
    let badge = approach.querySelector('.ff-si-estimate-badge') as HTMLElement | null;
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'ff-si-estimate-badge';
      approach.appendChild(badge);
    }
    badge.title = hasReal
      ? "Extension's own formula estimate for this same, already-revealed approach — compare it against the real number to see how accurate the formula is. See docs/street-intel-estimate-calculation.md."
      : confidence === 'exact'
        ? "Extension estimate, computed from this card's own scouted odds — see docs/street-intel-estimate-calculation.md."
        : "Extension estimate — this card hasn't been scouted, so its base odds are guessed from its risk tier, not known exactly.";
    badge.textContent = confidence === 'exact' ? `~${predicted}% est.` : `~${predicted}% est.*`;

    // A real row's own ranking value is its real number (`realBestPct`,
    // already seeded above), never this re-derived formula estimate — so a
    // hidden row only ever displaces the current best by beating the real
    // value outright, not by beating a formula's own approximation of it.
    if (!hasReal && predicted > overallBestPct) {
      overallBestPct = predicted;
      overallBest = approach;
    }
  }

  if (realBest && overallBest === realBest) {
    realBest.classList.add('ff-si-confirmed');
  } else {
    realBest?.classList.add('ff-si-best-approach');
    // Only ever a *different* row than `realBest` at this point (or
    // `realBest` is null — a fully-unscored Go Blind dialog) — see the
    // branch above.
    if (overallBest && overallBest !== realBest) overallBest.classList.add('ff-si-best-guess');
  }
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
