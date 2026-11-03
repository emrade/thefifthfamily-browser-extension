import type { CapturedRequest } from '@/shared/messaging';
import { injectStyleOnce } from '@/content/shared/injectStyle';
import { LOG_PREFIX } from '@/shared/log';
import { STORAGE_KEYS } from '@/shared/constants';
import { storage } from '@/shared/storage';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import {
  bossPotLimit,
  expectedPot,
  foldFight,
  leanText,
  LIKELY_AT,
  verdictWord,
  lineupBenchmark,
  recordLineup,
  rerollOutlook,
  recordFight,
  profileFromPreview,
  sampleFromAttack,
  verdictFor,
  bandFor,
  winChance,
  type ArenaOpponentCard,
  type ArenaVerdict,
  type PotFight,
} from '@/shared/arenaCombat';
import type { ArenaBand, ArenaLineupPoints, ArenaMyProfile, ArenaTrackRecord } from '@/shared/types';
import { MASTERY_TIER_LABEL, neededForMastery, type ArenaMasteryState } from '@/shared/arenaMastery';
import { hideHover, injectDetailStyles, openModal, showHover, type FightDetail } from './fightDetails';
import { memoryText, normaliseMemory, rememberFight, type ArenaOpponentMemory, type ArenaOpponentRecord } from '@/shared/arenaOpponentMemory';
import { addQuotedFights, DEFAULT_ARENA_GATE_CONFIG, type ArenaGateConfig } from '@/shared/arenaGate';

/**
 * The Arena fight advisor: badges every live opponent and the boss
 * Beatable / Coin-flip / Avoid from the stats already on their card, numbers
 * the attack order, and puts a plan above the cards: the order, the pot it
 * should bank, what to do about the boss, and whether a Refresh is worth it.
 *
 * Built around the pot, since banked pots are the season score: a win adds
 * the opponent's bounty (read from the card: 25/30/35/40 by level and 45 for
 * the boss since the 28 Oct season — see `ARENA_BOUNTY_LADDER_FROM`), any
 * loss wipes the unbanked pot. The order is
 * riskiest first (the player's own way of playing: every opponent has to be
 * fought to unlock the boss, and an early loss only wipes a small pot), the
 * boss is worth fighting only while the pot is under `bossPotLimit`, and a
 * lineup is worth re-rolling when its expected pot is under what an average
 * re-roll banks: the mean of the fresh lineups seen with this loadout
 * (`lineupBenchmark`), or `TYPICAL_LINEUP_POINTS` until there are enough.
 * Win chances behind all three are the real record of each verdict band
 * (`winChance`). The model and its evidence are in docs/arena-combat-mechanics.md
 * and shared/arenaCombat.ts. The game's own "% CHANCE" badge is left alone;
 * it's repeated in each badge's hover text.
 *
 * The player's own season numbers come from captured responses: the season
 * lock-in's `preview_loadout` gives an estimate, and every `attack`
 * response's combat log gives the real values, which replace it from the
 * first fight on. Captured regardless of whether the badges are switched on,
 * so the Arena panel can show them too.
 *
 * Read-only: nothing here sends a request.
 */

const FEATURE_KEY = 'arena';
const STYLE_ID = 'ff-arena-advisor-style';
const BANNER_ID = 'ff-arv-banner';
const BADGE_CLASS = 'ff-arv-strip';
/** Bounty to assume for a boss card whose bounty can't be read. The
 *  Vigilante Boss pays a flat 45 under the bounty ladder
 *  (`ARENA_BOUNTY_LADDER_FROM`); it was 120–180 before, and 144 here, which
 *  would have made a boss look worth risking a pot ~3× larger than it is. */
const FALLBACK_BOSS_BOUNTY = 45;

// Colours follow the game's own palette: green/amber/red accents on a dark
// tinted fill, uppercase spaced labels like its BOUNTY / PASSIVE tags.
const CSS = `
.${BADGE_CLASS} {
  display: flex; align-items: center; gap: 8px;
  margin: 12px 0 10px; padding: 7px 10px;
  border-radius: 6px; border: 1px solid; border-left-width: 3px;
  font-size: 0.68rem; line-height: 1; cursor: pointer;
  transition: filter 0.12s;
}
.${BADGE_CLASS}:hover, .${BADGE_CLASS}:focus-visible { filter: brightness(1.25); outline: none; }
.${BADGE_CLASS} .ff-arv-verdict {
  font-weight: 800; text-transform: uppercase; letter-spacing: 1.4px;
}
.${BADGE_CLASS} .ff-arv-detail {
  margin-left: auto; color: #a8a098; font-weight: 600; letter-spacing: 0.3px; white-space: nowrap;
}
.ff-arv-order {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 18px; height: 18px; border-radius: 50%;
  border: 1px solid currentColor; font-size: 0.62rem; font-weight: 800;
}
.ff-arv-beatable { color: #4ade80; background: rgba(34,197,94,0.08); border-color: rgba(74,222,128,0.35); }
.ff-arv-coinflip { color: #fbbf24; background: rgba(245,158,11,0.08); border-color: rgba(251,191,36,0.35); }
.ff-arv-avoid    { color: #f87171; background: rgba(239,68,68,0.08); border-color: rgba(248,113,113,0.35); }
.${BADGE_CLASS}.ff-arv-beatable { border-left-color: #4ade80; }
.${BADGE_CLASS}.ff-arv-coinflip { border-left-color: #fbbf24; }
.${BADGE_CLASS}.ff-arv-avoid    { border-left-color: #f87171; }

#${BANNER_ID} {
  margin: 0 0 14px; padding: 12px 16px; border-radius: 10px;
  background: linear-gradient(90deg, rgba(212,175,55,0.08), rgba(10,10,15,0.55));
  border: 1px solid rgba(212,175,55,0.28);
  font-size: 0.78rem; line-height: 1.5; color: #e7dcc0;
}
#${BANNER_ID} .ff-arv-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 3px 0; }
#${BANNER_ID} .ff-arv-label {
  color: #fbbf24; font-weight: 800; text-transform: uppercase; letter-spacing: 1.2px; font-size: 0.66rem;
  min-width: 96px;
}
#${BANNER_ID} .ff-arv-text { flex: 1 1 320px; min-width: 0; }
#${BANNER_ID} .ff-arv-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px 3px 4px; border-radius: 999px; border: 1px solid; font-weight: 700;
}
#${BANNER_ID} .ff-arv-chip { cursor: pointer; }
#${BANNER_ID} .ff-arv-chip .ff-arv-name { color: #f1ede2; }
#${BANNER_ID} .ff-arv-arrow { color: #6b6455; }
#${BANNER_ID} .ff-arv-bounty { color: #fbbf24; font-weight: 800; font-size: 0.66rem; letter-spacing: 0.4px; }
#${BANNER_ID} .ff-arv-word { font-weight: 800; }
#${BANNER_ID} .ff-arv-word.ff-arv-beatable,
#${BANNER_ID} .ff-arv-word.ff-arv-coinflip,
#${BANNER_ID} .ff-arv-word.ff-arv-avoid { background: none; }
#${BANNER_ID} .ff-arv-note { color: #8b8578; font-size: 0.68rem; margin-top: 6px; }
#${BANNER_ID} .ff-arv-warn { color: #f87171; font-weight: 700; }
#${BANNER_ID} .ff-arv-mastery { color: #e8c766; font-weight: 700; }
.${BADGE_CLASS}.ff-arv-has-mem { flex-wrap: wrap; row-gap: 5px; }
.${BADGE_CLASS} .ff-arv-mem { flex-basis: 100%; color: #a8a098; font-weight: 600; letter-spacing: 0.2px; line-height: 1.3; }
.${BADGE_CLASS} .ff-arv-mem.ff-arv-mem-lost { color: #f8a5a5; }
`;

/** How long a result that went against its verdict stays in the banner. */
const SURPRISE_SHOW_MS = 24 * 60 * 60_000;

let profile: ArenaMyProfile | null = null;
let trackRecord: ArenaTrackRecord | null = null;
let lineupRecord: ArenaLineupPoints | null = null;
// The "Arena Needed for Mastery" page setting, and the progress it reads.
let masteryTag = false;
let mastery: ArenaMasteryState | null = null;
/** The verdict each opponent's card showed at its latest paint, by name, so
 *  a fight's result can be scored against what the player saw before
 *  attacking. Never cleared on repaint: the game reloads the page right
 *  after an attack, and the result must still find its verdict. */
const shownVerdicts = new Map<string, { verdict: ArenaVerdict; band: ArenaBand }>();
/** The boss's quoted % from the latest `open_next_page` (never rendered by
 *  the game), keyed by name so a stale value never lands on a new boss. */
let bossQuote: { name: string; pct: number } | null = null;
let enabled = false;
let paintQueued = false;

/** The four opt-in Arena page settings from the 2026-11-03 review
 *  (docs/proposals/arena-advisor-post-patch-review.md). All off by default;
 *  with all four off, verdicts, badges and the plan are exactly as before. */
export interface ArenaAdvisorOptions {
  /** "Arena Game % Safety Gate": regular opponents are Beatable only at
   *  game 90%+ (else Coin-flip) and Avoid under 60%. */
  gamePctGate: boolean;
  /** "Arena Game % on Badges". */
  showGamePct: boolean;
  /** "Arena Bank-or-Fight Hint". */
  bankOrFight: boolean;
  /** "Arena Opponent Memory": record line, and real armour in the score. */
  opponentMemory: boolean;
}
const NO_OPTIONS: ArenaAdvisorOptions = { gamePctGate: false, showGamePct: false, bankOrFight: false, opponentMemory: false };
let options: ArenaAdvisorOptions = NO_OPTIONS;
/** The gate's cut-offs: the player's own (Dashboard → Arena), defaulting to
 *  90 / 60 from the post-patch record (shared/arenaGate.ts). */
let gate: ArenaGateConfig = DEFAULT_ARENA_GATE_CONFIG;
/** The game's % last shown on each regular card, by name, so a fight can be
 *  recorded with the % the player saw before attacking. */
const quotedSeen = new Map<string, number>();
/** Recorded from every regular fight whatever the settings (data only);
 *  only shown and used when `opponentMemory` is on. */
let memory: ArenaOpponentMemory | null = null;
/** Detail behind each strip and attack-order chip, for the hover card and
 *  the click-through modal (fightDetails.ts). */
const details = new WeakMap<Element, FightDetail>();

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

async function saveProfile(next: ArenaMyProfile): Promise<void> {
  profile = next;
  await storage.setArenaMyProfile(next);
  schedulePaint();
}

/** Scores one fight against the verdict its card showed beforehand. Fights
 *  with no shown verdict (no season numbers yet, or the advisor switched
 *  off) aren't counted. */
async function scoreFight(data: any): Promise<void> {
  const name = typeof data?.defender === 'string' ? data.defender : null;
  const shown = name ? shownVerdicts.get(name) : undefined;
  if (!name || !shown || typeof data.won !== 'boolean' || typeof data.att_max_hp !== 'number') return;
  shownVerdicts.delete(name);
  const prev = trackRecord ?? (await storage.getArenaTrackRecord());
  trackRecord = recordFight(prev, { name, verdict: shown.verdict, band: shown.band, won: data.won, maxHp: data.att_max_hp, at: Date.now() });
  await storage.setArenaTrackRecord(trackRecord);
}

export function handleCapturedRequest(req: CapturedRequest): void {
  if (req.method !== 'POST' || !req.url.includes('/actions/arena_v2.php')) return;
  const action = new URLSearchParams(req.requestBody ?? '').get('action');
  if (action !== 'preview_loadout' && action !== 'attack' && action !== 'open_next_page') return;

  let data: any;
  try {
    data = JSON.parse(req.responseText);
  } catch {
    recordParseFailure(FEATURE_KEY);
    return;
  }
  if (data?.ok !== true) return;

  void (async () => {
    if (profile === null) profile = await storage.getArenaMyProfile();

    if (action === 'preview_loadout') {
      const fs = data.fighting_stats;
      if (!fs || typeof fs.strength !== 'number' || typeof data.max_hp !== 'number') {
        recordParseFailure(FEATURE_KEY);
        return;
      }
      recordParseSuccess(FEATURE_KEY);
      const stats = { strength: fs.strength, defence: fs.defence, agility: fs.agility, dexterity: fs.dexterity };
      // A mid-season look at the loadout shouldn't throw away measured
      // numbers for the same locked HP; it only fills in the stats.
      if (profile?.source === 'fights' && profile.maxHp === data.max_hp) {
        await saveProfile({ ...profile, lockedStats: stats });
      } else {
        await saveProfile(profileFromPreview(stats, data.max_hp));
      }
      return;
    }

    if (action === 'attack') {
      await scoreFight(data);
      // Keyed by the capture timestamp, the archive's own value, so a fight
      // seen live and again in an imported export counts once.
      if (memory === null) memory = await storage.getArenaOpponentMemory();
      const remembered = rememberFight(memory, data, req.timestamp);
      if (remembered !== memory) {
        memory = remembered;
        await storage.setArenaOpponentMemory(remembered);
      }
      const quoted = typeof data.defender === 'string' ? quotedSeen.get(data.defender) : undefined;
      if (quoted !== undefined && typeof data.won === 'boolean' && new URLSearchParams(req.requestBody ?? '').get('opponent_id') !== '0') {
        const prevRecord = await storage.getArenaQuoteRecord();
        const nextRecord = addQuotedFights(prevRecord, [{ at: req.timestamp, name: data.defender, quoted, won: data.won }]);
        if (nextRecord !== prevRecord) await storage.setArenaQuoteRecord(nextRecord);
      }
      const sample = sampleFromAttack(data);
      if (!sample) {
        recordParseFailure(FEATURE_KEY);
        return;
      }
      recordParseSuccess(FEATURE_KEY);
      await saveProfile(foldFight(profile, sample));
      return;
    }

    const boss = data?.new_page?.boss_data;
    if (boss && typeof boss.name === 'string' && typeof boss.win_pct === 'number') {
      bossQuote = { name: boss.name, pct: boss.win_pct };
      schedulePaint();
    }
  })().catch((err) => console.error(LOG_PREFIX, 'arena advisor capture failed', err));
}

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

interface CardOnPage {
  el: HTMLElement;
  card: ArenaOpponentCard;
  /** Points a win adds to the pot (the card's own BOUNTY tag). */
  bounty: number | null;
  familyLabel: string | null;
  /** Regular opponent still to fight, or a boss not yet fought. */
  live: boolean;
  bossLocked: boolean;
}

function num(text: string | null | undefined): number | null {
  const m = text?.replace(/,/g, '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

function readCard(el: HTMLElement): CardOnPage | null {
  const isBoss = el.classList.contains('ar-opp-boss');
  const name = el.querySelector('.ar-opp-name')?.textContent?.trim() ?? '';
  const level = num(el.querySelector('.ar-opp-lvl')?.textContent?.match(/L[vV]\.\s*[\d,]+/)?.[0]);
  const strength = num(el.querySelector('.ar-opp-stat-str')?.textContent);
  const defence = num(el.querySelector('.ar-opp-stat-def')?.textContent);
  const agility = num(el.querySelector('.ar-opp-stat-agi')?.textContent);
  const dexterity = num(el.querySelector('.ar-opp-stat-dex')?.textContent);
  if (!name || level === null || strength === null || defence === null || agility === null || dexterity === null) return null;

  const quotedEl = el.querySelector('.ar-opp-winpct');
  const quotedPct = isBoss ? (bossQuote?.name === name ? bossQuote.pct : null) : num(quotedEl?.textContent);
  const family = isBoss ? ([...el.classList].find((c) => c.startsWith('ar-opp-boss-'))?.slice('ar-opp-boss-'.length) ?? null) : null;

  const btn = el.querySelector('.ar-opp-btn');
  const bossLocked = isBoss && /Locked/i.test(btn?.textContent ?? '');
  const bossEngageable = isBoss && (btn?.getAttribute('onclick') ?? '').includes('av2_arenaAttack(0,');
  const live = isBoss ? bossLocked || bossEngageable : !el.classList.contains('fought');

  return {
    el,
    bounty: num(el.querySelector('.ar-opp-bounty')?.textContent),
    card: {
      name, isBoss, level, strength, defence, agility, dexterity,
      passive: el.querySelector('.ar-opp-passive') !== null,
      quotedPct, family,
    },
    familyLabel: isBoss ? el.querySelector('.ar-opp-boss-fam')?.textContent?.trim() ?? null : null,
    live,
    bossLocked,
  };
}

/** The page's unbanked pot: the game's own "Page Pot" box while one is
 *  building, otherwise nothing at risk (fresh page, forfeited, or banked). */
function readPot(): number {
  return num(document.querySelector('.ar-pot-banner.ar-pot-active .ar-pot-val')?.textContent) ?? 0;
}

/** "Locked Max HP" on the page's own loadout summary. A mismatch with the
 *  stored profile means it's from a previous season. */
function readLockedMaxHp(): number | null {
  for (const el of document.querySelectorAll<HTMLElement>('.ar-page div')) {
    if (el.childElementCount <= 1 && el.textContent?.trim() === 'Locked Max HP') {
      return num(el.nextElementSibling?.textContent);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Short right-hand detail on a card's strip. */
function verdictDetail(v: ArenaVerdict, p: number): string {
  const score = v.score > 3 ? 'score 3+' : `score ${v.score.toFixed(2)}`;
  if (v.edgeRisk) return `may hit through · ${score}`;
  // "Likely" already says which way it leans.
  return v.kind === 'coinflip' && p < LIKELY_AT ? `${leanText(p)} · ${score}` : score;
}

interface Judged {
  /** What the badge shows: `raw`, after the safety gate if it's on. */
  v: ArenaVerdict;
  /** The advisor's own verdict (with remembered armour if that's on). What
   *  the track record scores, so the gate never skews the band record. */
  raw: ArenaVerdict;
  /** Remembered fights against this opponent, when memory is on. */
  rec: ArenaOpponentRecord | null;
  /** The armour scored with, when it came from memory rather than the card. */
  armourFromMemory: number | null;
  gated: boolean;
}

/** The verdict for one card, with the opt-in settings applied. With all of
 *  them off this is exactly `verdictFor(card, profile)`. */
function judge(c: CardOnPage, me: ArenaMyProfile): Judged {
  const rec = options.opponentMemory && !c.card.isBoss ? memory?.[c.card.name] ?? null : null;
  const armourFromMemory = rec?.armour ?? null;
  const raw = verdictFor(armourFromMemory !== null ? { ...c.card, defence: armourFromMemory } : c.card, me);
  let v = raw;
  const q = c.card.quotedPct;
  if (options.gamePctGate && !c.card.isBoss && q !== null) {
    if (q < gate.avoidBelow && raw.kind !== 'avoid') v = { ...raw, kind: 'avoid', leansWin: false };
    else if (q < gate.beatableFrom && raw.kind === 'beatable') v = { ...raw, kind: 'coinflip' };
  }
  return { v, raw, rec, armourFromMemory, gated: v !== raw };
}

function paintBadge(c: CardOnPage, j: Judged, order: number | null): void {
  const meta = c.el.querySelector('.ar-opp-meta');
  if (!meta || !profile) return;
  const { v } = j;
  const p = winChance(c.card, v, trackRecord?.bands);
  const q = c.card.quotedPct;
  // The game's % shows when asked for, and always when the gate changed the
  // verdict, so the reason for the change is on the badge.
  const gameNote = q !== null && (options.showGamePct || j.gated) ? ` · game ${q}%` : '';
  const memNote = j.rec
    ? `<span class="ff-arv-mem${j.rec.lastWon ? '' : ' ff-arv-mem-lost'}">${escapeHtml(memoryText(j.rec))}${
        j.armourFromMemory !== null ? ` · armour ${fmt(j.armourFromMemory)} (card DEF ${fmt(c.card.defence)})` : ''
      }</span>`
    : '';
  const inner =
    (order !== null ? `<span class="ff-arv-order">${order}</span>` : '') +
    `<span class="ff-arv-verdict">${verdictWord(v, p)}</span>` +
    `<span class="ff-arv-detail">~${Math.round(p * 100)}% · ${verdictDetail(v, p)}${gameNote}</span>` +
    memNote;
  const sig = `${v.kind}|${inner}|${v.score}|${c.card.quotedPct}`;
  shownVerdicts.set(c.card.name, { verdict: j.raw, band: bandFor(c.card, j.raw) });
  const detail: FightDetail = { card: c.card, familyLabel: c.familyLabel, verdict: v, order, profile, record: trackRecord, winChance: p, bounty: c.bounty };
  const existing = c.el.querySelector<HTMLElement>(`.${BADGE_CLASS}`);
  if (existing?.dataset.sig === sig && existing.nextElementSibling === meta) {
    details.set(existing, detail);
    return;
  }
  existing?.remove();

  // Its own full-width strip just above the bounty/chance row, so it never
  // competes with the game's own tags for space.
  const strip = document.createElement('div');
  strip.className = `${BADGE_CLASS} ff-arv-${v.kind}${memNote ? ' ff-arv-has-mem' : ''}`;
  strip.dataset.sig = sig;
  strip.setAttribute('role', 'button');
  strip.tabIndex = 0;
  details.set(strip, detail);
  strip.innerHTML = inner;
  meta.parentElement?.insertBefore(strip, meta);
}

function clearBadges(root: ParentNode): void {
  root.querySelectorAll(`.${BADGE_CLASS}`).forEach((b) => b.remove());
}

function setBanner(anchor: HTMLElement, html: string | null): void {
  let banner = document.getElementById(BANNER_ID);
  if (html === null) {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = BANNER_ID;
  }
  if (banner.nextElementSibling !== anchor) anchor.parentElement?.insertBefore(banner, anchor);
  if (banner.dataset.sig !== html) {
    banner.dataset.sig = html;
    banner.innerHTML = html;
  }
}

/** The Refresh button, if it can be used right now: free (once per page,
 *  before any attack) or with its MG cost as the game labels it. */
function refreshOffer(): { free: boolean; cost: string } | null {
  const btn = document.querySelector<HTMLButtonElement>('.ar-actbtn[onclick*="av2_arenaRefresh"]');
  if (!btn || btn.disabled) return null;
  const cost = btn.querySelector('.ar-cost')?.textContent?.trim() ?? '';
  return { free: /free/i.test(cost), cost };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

/** Counts a fresh lineup towards the Refresh benchmark (once per lineup). */
function noteLineup(maxHp: number, key: string, points: number): void {
  const next = recordLineup(lineupRecord, { maxHp, key, points, at: Date.now() });
  if (next === lineupRecord) return;
  lineupRecord = next;
  storage.setArenaLineupPoints(next).catch((err) => console.error(LOG_PREFIX, 'arena lineup save failed', err));
}

/** Identifies a lineup across repaints and tabs. */
function lineupKey(cards: CardOnPage[]): string {
  return cards
    .map(({ card: c, bounty }) => [c.name, c.level, c.strength, c.defence, c.agility, c.dexterity, bounty].join('|'))
    .sort()
    .join('#');
}

function paint(): void {
  paintQueued = false;
  const root = document.querySelector<HTMLElement>('.ar-opps');
  if (!root) {
    setBanner(document.body, null);
    return;
  }

  if (!profile) {
    clearBadges(root);
    setBanner(
      root,
      '<div class="ff-arv-line"><span class="ff-arv-label">Fight Advisor</span><span class="ff-arv-text">Waiting for your season stats. Fight any one opponent on this computer (or lock in here) and the badges appear.</span></div>',
    );
    return;
  }

  const cards = [...root.querySelectorAll<HTMLElement>('.ar-opp')].map(readCard).filter((c): c is CardOnPage => c !== null);
  const regulars = cards.filter((c) => !c.card.isBoss);
  for (const c of regulars) if (c.card.quotedPct !== null) quotedSeen.set(c.card.name, c.card.quotedPct);
  const boss = cards.find((c) => c.card.isBoss) ?? null;

  const scored = regulars
    .filter((c) => c.live)
    .map((c): PotFight<{ c: CardOnPage; v: ArenaVerdict; j: Judged }> => {
      const j = judge(c, profile!);
      return { item: { c, v: j.v, j }, p: winChance(c.card, j.v, trackRecord?.bands), bounty: c.bounty ?? 0 };
    });
  // Riskiest first: lowest win chance, then lowest score. Not score alone:
  // a 0.95 quoted 50%+ (~73%) is safer than a 1.05 quoted under 50% (~55%).
  const ordered = [...scored].sort((a, b) => a.p - b.p || a.item.v.score - b.item.v.score);
  const live = ordered.map((f) => f.item);

  for (const c of cards.filter((x) => !x.live)) c.el.querySelector(`.${BADGE_CLASS}`)?.remove();
  live.forEach(({ c, j }, i) => paintBadge(c, j, i + 1));
  const bossJudged = boss?.live ? judge(boss, profile) : null;
  const bossVerdict = bossJudged?.v ?? null;
  if (boss && bossJudged) paintBadge(boss, bossJudged, null);

  // --- the plan line -------------------------------------------------------
  const pot = readPot();
  const lines: string[] = [];
  if (live.length > 0) {
    const order = live
      .map(
        ({ c, v }, i) =>
          `<span class="ff-arv-chip ff-arv-${v.kind}" data-ff-order="${i + 1}"><span class="ff-arv-order">${i + 1}</span><span class="ff-arv-name">${escapeHtml(c.card.name)}</span>${
            c.bounty !== null ? `<span class="ff-arv-bounty">${c.bounty}</span>` : ''
          }</span>`,
      )
      .join('<span class="ff-arv-arrow">→</span>');
    lines.push(`<div class="ff-arv-line"><span class="ff-arv-label">Attack order</span>${order}</div>`);

    const expected = expectedPot(ordered, pot);
    const best = ordered.reduce((s, f) => s + f.bounty, pot);
    lines.push(
      `<div class="ff-arv-line"><span class="ff-arv-label">Pot</span><span class="ff-arv-text">${
        pot > 0 ? `<b>${fmt(pot)}</b> in the pot now. ` : ''
      }Expect to bank <b>~${fmt(expected)}</b> from ${live.length === 1 ? 'this fight' : `these ${live.length} fights`} (${fmt(best)} if you win them all), before the boss.</span></div>`,
    );

    // "Arena Bank-or-Fight Hint": fighting beats banking only when the win
    // chance clears pot ÷ (pot + bounty). Uses the game's % (the most
    // reliable since the Oct 30 patch); the advisor's own chance only when
    // a card has none.
    if (options.bankOrFight && pot > 0) {
      const notWorth = live
        .map(({ c, v }) => {
          const bounty = c.bounty ?? 0;
          const fromGame = c.card.quotedPct !== null;
          const chance = fromGame ? c.card.quotedPct! / 100 : winChance(c.card, v, trackRecord?.bands);
          return { c, bounty, chance, fromGame };
        })
        .filter((x) => x.chance < pot / (pot + x.bounty));
      if (notWorth.length > 0) {
        const names = notWorth
          .map((x) => `<b>${escapeHtml(x.c.card.name)}</b> (${x.fromGame ? 'game' : '~'}${Math.round(x.chance * 100)}% for +${x.bounty})`)
          .join(', ');
        lines.push(
          `<div class="ff-arv-line"><span class="ff-arv-label ff-arv-warn">Bank first</span><span class="ff-arv-text">Your pot of <b>${fmt(pot)}</b> is worth more than the chance of winning ${names}. Bank before fighting ${
            notWorth.length === 1 ? 'them' : 'these'
          }, so a loss costs nothing.</span></div>`,
        );
      }
    }
  }

  // Fresh lineups (four regulars, none fought, every bounty readable) feed
  // the Refresh benchmark, but only with this loadout's measured numbers.
  const lockedHp = readLockedMaxHp();
  const stale = lockedHp !== null && lockedHp !== profile.maxHp;
  const noneFoughtYet = regulars.length > 0 && regulars.every((c) => c.live);
  const fresh = noneFoughtYet && scored.length === 4 && regulars.every((c) => c.bounty !== null);
  const freshKey = fresh ? lineupKey(regulars) : null;
  if (freshKey && profile.source === 'fights' && !stale) noteLineup(profile.maxHp, freshKey, expectedPot(ordered));
  const bench = lineupBenchmark(lineupRecord, profile.maxHp, freshKey);
  const benchNote = bench.measured
    ? `the average of the last ${bench.measured} fresh lineups you've seen with this gear`
    : 'a starting estimate, until a few more fresh lineups with this gear have been seen';

  let bossIsSkip = false;
  if (boss && bossVerdict) {
    const fam = boss.familyLabel ? `${escapeHtml(boss.familyLabel)}, ` : '';
    const p = winChance(boss.card, bossVerdict, trackRecord?.bands);
    const word = `<span class="ff-arv-word ff-arv-${bossVerdict.kind}">${verdictWord(bossVerdict, p)}</span>`;
    const bounty = boss.bounty ?? FALLBACK_BOSS_BOUNTY;
    const limit = bossPotLimit(p, bounty);
    // The biggest pot this page could reach before the boss.
    const maxPot = scored.reduce((s, f) => s + f.bounty, pot);
    const chance = `~${Math.round(p * 100)}% to win, +${bounty}`;
    let what: string;
    if (limit >= maxPot) {
      what = `${word} (${chance}) — fight it${boss.bossLocked ? ' once it unlocks' : ''}.`;
    } else if (live.length === 0) {
      what =
        pot <= limit
          ? `${word} (${chance}) — fight it: your pot of ${fmt(pot)} is small enough to risk.`
          : `${word} (${chance}) — <span class="ff-arv-warn">bank your ${fmt(pot)} and skip it</span>. A boss loss forfeits the whole pot.`;
      bossIsSkip = pot > limit;
    } else {
      what = `${word} (${chance}) — fight it only if your pot is under <b>~${fmt(limit)}</b> when you get there; above that, <span class="ff-arv-warn">bank and skip it</span>.`;
      bossIsSkip = limit < bench.points;
    }
    const need = masteryTag ? neededForMastery(mastery, boss.card.name) : null;
    const masteryNote = need
      ? ` <span class="ff-arv-mastery">Needed for Mastery: ${
          need.left === 1
            ? `the last ${MASTERY_TIER_LABEL[need.tier].replace(/s$/, '')} left for`
            : `1 of ${need.left} ${MASTERY_TIER_LABEL[need.tier]} left for`
        } +${need.bonus}% ${escapeHtml(need.family.stat)}, permanent.</span>`
      : '';
    lines.push(
      `<div class="ff-arv-line"><span class="ff-arv-label">Boss</span><span class="ff-arv-text">${escapeHtml(boss.card.name)} (${fam}STR ${fmt(boss.card.strength)}, your break-even ~${fmt(bossVerdict.maxStrength)}): ${what}${masteryNote}</span></div>`,
    );
  }

  // Refresh. The free one gets a verdict: worth it when this lineup's
  // expected pot is under what an average re-roll banks. A paid one only
  // gets the numbers, since whether points are worth the MG is the
  // player's call. Refresh only replaces the four regulars (never the boss)
  // and locks after the first attack.
  const refresh = noneFoughtYet && scored.length > 0 ? refreshOffer() : null;
  if (refresh) {
    const lineup = expectedPot(ordered);
    const costNote = refresh.free ? 'The free Refresh' : `Refresh (${escapeHtml(refresh.cost) || 'paid'})`;
    const bossNote = bossIsSkip ? ' The boss is a likely skip, so these four are most of the page.' : '';
    const diff = bench.points - lineup;
    const signed = `${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))}`;
    const outlook = rerollOutlook(lineupRecord, profile.maxHp, freshKey, lineup);
    let chase = '';
    if (outlook && outlook.beatShare === 0) {
      chase = ` None of the last ${outlook.seen} fresh lineups with this gear beat this one.`;
    } else if (outlook) {
      const tries = 1 / outlook.beatShare;
      const triesText = tries < 1.5 ? 'about 1 re-roll' : `about ${tries < 10 ? tries.toFixed(1) : fmt(tries)} re-rolls`;
      chase = ` Re-rolling until one beats it takes ${triesText}${refresh.free ? ' (the first is free)' : ''} and should end near <b>~${fmt(outlook.beatMean)}</b> (+${fmt(outlook.beatMean - lineup)}).`;
    }
    let text: string;
    if (!refresh.free) {
      text = `This lineup should bank <b>~${fmt(lineup)}</b>; one re-roll (${escapeHtml(refresh.cost) || 'paid'}) averages ~${fmt(bench.points)}, ${signed} (${benchNote}).${chase}${bossNote}`;
    } else if (lineup < bench.points) {
      text = `Worth it: this lineup should bank <b>~${fmt(lineup)}</b>; an average re-roll banks ~${fmt(bench.points)}, ${signed} (${benchNote}).${chase}${bossNote} ${costNote} re-rolls all four opponents (not the boss) and locks once you attack.`;
    } else {
      // There used to be a "X (140 bounty) is Beatable, and" reason here for
      // a winnable bounty of 100+. Under the bounty ladder no regular pays
      // more than 40, so it could never show; lineups differ only in how
      // winnable they are, which the expected pot already covers.
      text = `Keep this lineup: it should bank <b>~${fmt(lineup)}</b>, at least the ~${fmt(bench.points)} an average re-roll banks (${benchNote}).${chase}`;
    }
    lines.push(`<div class="ff-arv-line"><span class="ff-arv-label">Refresh?</span><span class="ff-arv-text">${text}</span></div>`);
  }

  const surprise = trackRecord?.surprise;
  if (surprise && Date.now() - surprise.at < SURPRISE_SHOW_MS) {
    lines.push(
      surprise.kind === 'beatable'
        ? `<div class="ff-arv-line"><span class="ff-arv-label ff-arv-warn">Heads-up</span><span class="ff-arv-text">You lost to ${escapeHtml(surprise.name)}, who was marked <b>Beatable</b> (score ${surprise.score > 3 ? '3+' : surprise.score.toFixed(2)}). One loss can be bad luck; if it happens again, the game’s numbers may have changed. Click a badge to see this season’s record.</span></div>`
        : `<div class="ff-arv-line"><span class="ff-arv-label">Note</span><span class="ff-arv-text">You beat ${escapeHtml(surprise.name)}, who was marked <b>Avoid</b> (score ${surprise.score > 3 ? '3+' : surprise.score.toFixed(2)}). About 1 in 20 Avoid fights has been a win.</span></div>`,
    );
  }

  const source =
    profile.source === 'fights'
      ? `measured from ${profile.fightCount} fight${profile.fightCount === 1 ? '' : 's'}`
      : 'estimated from your lock-in; updates after your first fight';
  lines.push(
    `<div class="ff-arv-note">Your numbers: ${fmt(profile.maxHp)} HP · ~${fmt(profile.baseDamage)} damage · ~${fmt(profile.reduction)} armour (${source}).${
      stale ? ' <span class="ff-arv-warn">These look like last season’s (locked HP is ' + fmt(lockedHp!) + '); they update after your first fight.</span>' : ''
    }</div>`,
  );

  setBanner(root, lines.join(''));
  document.getElementById(BANNER_ID)?.querySelectorAll<HTMLElement>('.ff-arv-chip[data-ff-order]').forEach((chip) => {
    const i = Number(chip.dataset.ffOrder) - 1;
    const x = live[i];
    const f = ordered[i];
    if (x && f) details.set(chip, { card: x.c.card, familyLabel: x.c.familyLabel, verdict: x.v, order: i + 1, profile: profile!, record: trackRecord, winChance: f.p, bounty: x.c.bounty });
  });
}

function schedulePaint(): void {
  if (!enabled || paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(paint);
}

function detailTarget(e: Event): HTMLElement | null {
  const t = (e.target as Element | null)?.closest?.(`.${BADGE_CLASS}, #${BANNER_ID} .ff-arv-chip`);
  return t instanceof HTMLElement && details.has(t) ? t : null;
}

function wireDetailEvents(): void {
  document.addEventListener('mouseover', (e) => {
    const t = detailTarget(e);
    if (t) showHover(t, details.get(t)!);
  });
  document.addEventListener('mouseout', (e) => {
    const t = detailTarget(e);
    if (t && !t.contains(e.relatedTarget as Node | null)) hideHover();
  });
  document.addEventListener('scroll', hideHover, true);
  // Capture phase, so the game's own card handlers never see the click.
  document.addEventListener(
    'click',
    (e) => {
      const t = detailTarget(e);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      openModal(details.get(t)!);
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = detailTarget(e);
    if (!t) return;
    e.preventDefault();
    openModal(details.get(t)!);
  });
}

export function initArenaFightAdvisor(withMasteryTag = false, opts: ArenaAdvisorOptions = NO_OPTIONS): void {
  enabled = true;
  options = opts;
  storage
    .getArenaOpponentMemory()
    .then((m) => {
      memory = m;
      schedulePaint();
    })
    .catch((err) => console.error(LOG_PREFIX, 'arena opponent memory read failed', err));
  storage
    .getArenaGateConfig()
    .then((g) => {
      gate = g;
      schedulePaint();
    })
    .catch((err) => console.error(LOG_PREFIX, 'arena gate config read failed', err));
  masteryTag = withMasteryTag;
  if (masteryTag) {
    storage
      .getArenaMastery()
      .then((m) => {
        mastery = m;
        schedulePaint();
      })
      .catch((err) => console.error(LOG_PREFIX, 'arena advisor mastery read failed', err));
  }
  injectStyleOnce(STYLE_ID, CSS);
  injectDetailStyles();
  wireDetailEvents();
  Promise.all([storage.getArenaMyProfile(), storage.getArenaTrackRecord(), storage.getArenaLineupPoints()])
    .then(([p, r, l]) => {
      profile = p;
      trackRecord = r;
      lineupRecord = l;
      schedulePaint();
    })
    .catch((err) => console.error(LOG_PREFIX, 'arena advisor storage read failed', err));

  const observer = new MutationObserver(() => schedulePaint());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });

  // Another tab (or this one's capture path) updating the profile.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (STORAGE_KEYS.ARENA_MY_PROFILE in changes) {
      profile = (changes[STORAGE_KEYS.ARENA_MY_PROFILE].newValue as ArenaMyProfile | undefined) ?? null;
      schedulePaint();
    }
    if (masteryTag && STORAGE_KEYS.ARENA_MASTERY in changes) {
      mastery = (changes[STORAGE_KEYS.ARENA_MASTERY].newValue as ArenaMasteryState | undefined) ?? null;
      schedulePaint();
    }
    if (STORAGE_KEYS.ARENA_LINEUP_POINTS in changes) {
      lineupRecord = (changes[STORAGE_KEYS.ARENA_LINEUP_POINTS].newValue as ArenaLineupPoints | undefined) ?? null;
      schedulePaint();
    }
    if (STORAGE_KEYS.ARENA_OPPONENT_MEMORY in changes) {
      memory = normaliseMemory(changes[STORAGE_KEYS.ARENA_OPPONENT_MEMORY].newValue as ArenaOpponentMemory | undefined);
      schedulePaint();
    }
    if (STORAGE_KEYS.ARENA_GATE_CONFIG in changes) {
      gate = { ...DEFAULT_ARENA_GATE_CONFIG, ...(changes[STORAGE_KEYS.ARENA_GATE_CONFIG].newValue as Partial<ArenaGateConfig> | undefined) };
      schedulePaint();
    }
    if (STORAGE_KEYS.ARENA_TRACK_RECORD in changes) {
      trackRecord = (changes[STORAGE_KEYS.ARENA_TRACK_RECORD].newValue as ArenaTrackRecord | undefined) ?? null;
      schedulePaint();
    }
  });
}
