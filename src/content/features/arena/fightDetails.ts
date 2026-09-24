import { injectStyleOnce } from '@/content/shared/injectStyle';
import { SCORE_AVOID, SCORE_BEATABLE, type ArenaOpponentCard, type ArenaVerdict } from '@/shared/arenaCombat';
import type { ArenaMyProfile } from '@/shared/types';

/**
 * The fight advisor's detail views: a small styled hover card on each
 * verdict strip, and a modal with the full breakdown on click. Replaces the
 * browser's own `title` tooltip, which can't be styled. Everything shown is
 * already computed by `verdictFor`; nothing here sends a request.
 */

export interface FightDetail {
  card: ArenaOpponentCard;
  familyLabel: string | null;
  verdict: ArenaVerdict;
  /** Attack-order position, or null (the boss). */
  order: number | null;
  profile: ArenaMyProfile;
}

const STYLE_ID = 'ff-arena-details-style';
const HOVER_ID = 'ff-arv-hover';
const MODAL_ID = 'ff-arv-modal';

/** Record behind each verdict, from docs/arena-combat-mechanics.md (184
 *  fights). Update together with that doc. */
const TRACK_RECORD = [
  { kind: 'beatable', label: 'Beatable', range: `${SCORE_BEATABLE}+`, record: '85 of 85 won' },
  { kind: 'coinflip', label: 'Coin-flip', range: `${SCORE_AVOID}–${SCORE_BEATABLE}`, record: '29 of 59 won' },
  { kind: 'avoid', label: 'Avoid', range: `under ${SCORE_AVOID}`, record: '2 of 40 won' },
] as const;

const CSS = `
#${HOVER_ID} {
  position: fixed; z-index: 2147483000; pointer-events: none;
  max-width: 280px; padding: 10px 12px; border-radius: 8px;
  background: linear-gradient(180deg, #1c1712, #120f0b);
  border: 1px solid rgba(212,175,55,0.35);
  box-shadow: 0 10px 28px rgba(0,0,0,0.6);
  font: 500 12px/1.45 Inter, system-ui, sans-serif; color: #e7dcc0;
  opacity: 0; transform: translateY(4px); transition: opacity 0.12s, transform 0.12s;
}
#${HOVER_ID}.ff-arv-show { opacity: 1; transform: translateY(0); }
#${HOVER_ID} .ff-arv-h-verdict { font-weight: 800; text-transform: uppercase; letter-spacing: 1.2px; font-size: 11px; }
#${HOVER_ID} .ff-arv-h-score { color: #a8a098; font-weight: 600; text-transform: none; letter-spacing: 0; }
#${HOVER_ID} .ff-arv-h-reason { margin-top: 6px; }
#${HOVER_ID} .ff-arv-h-hint { margin-top: 8px; padding-top: 7px; border-top: 1px solid rgba(212,175,55,0.15); color: #8b8578; font-size: 11px; }

#${MODAL_ID} {
  position: fixed; inset: 0; z-index: 2147483001;
  display: flex; align-items: center; justify-content: center; padding: 16px;
  background: rgba(0,0,0,0.65); backdrop-filter: blur(2px);
  font: 500 13px/1.5 Inter, system-ui, sans-serif; color: #e7dcc0;
}
#${MODAL_ID} .ff-arv-m {
  width: 100%; max-width: 480px; max-height: calc(100vh - 32px); overflow-y: auto;
  background: linear-gradient(180deg, #1d1813, #110e0a);
  border: 1px solid rgba(212,175,55,0.4); border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.7);
}
#${MODAL_ID} .ff-arv-m-head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 14px; border-bottom: 1px solid rgba(212,175,55,0.15); }
#${MODAL_ID} .ff-arv-m-title { flex: 1; min-width: 0; }
#${MODAL_ID} .ff-arv-m-name { font: 800 20px/1.2 Georgia, serif; color: #f4ecd6; }
#${MODAL_ID} .ff-arv-m-sub { margin-top: 3px; color: #a8a098; font-size: 11.5px; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 700; }
#${MODAL_ID} .ff-arv-m-close {
  flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px; cursor: pointer;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #a8a098; font-size: 16px; line-height: 1;
}
#${MODAL_ID} .ff-arv-m-close:hover { color: #fff; border-color: rgba(255,255,255,0.25); }
#${MODAL_ID} .ff-arv-m-verdict {
  display: flex; align-items: center; gap: 10px; margin: 14px 20px 0; padding: 10px 12px;
  border-radius: 8px; border: 1px solid; border-left-width: 3px;
}
#${MODAL_ID} .ff-arv-m-verdict-word { font-weight: 800; text-transform: uppercase; letter-spacing: 1.4px; font-size: 13px; }
#${MODAL_ID} .ff-arv-m-verdict-detail { margin-left: auto; color: #c9bfa6; font-size: 12px; }
#${MODAL_ID} .ff-arv-m-sec { padding: 14px 20px 4px; }
#${MODAL_ID} .ff-arv-m-h { font-size: 10.5px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase; color: #fbbf24; margin-bottom: 8px; }
#${MODAL_ID} table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
#${MODAL_ID} th { text-align: right; font-size: 10.5px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase; color: #8b8578; padding: 0 0 6px; }
#${MODAL_ID} th:first-child, #${MODAL_ID} td:first-child { text-align: left; color: #a8a098; }
#${MODAL_ID} td { text-align: right; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.05); color: #f1ede2; font-weight: 700; }
#${MODAL_ID} td small { display: block; font-size: 10.5px; font-weight: 500; color: #8b8578; }
#${MODAL_ID} .ff-arv-m-sum { margin-top: 8px; color: #c9bfa6; }
#${MODAL_ID} .ff-arv-m-gauge { position: relative; height: 8px; border-radius: 4px; background: rgba(255,255,255,0.07); margin: 12px 0 6px; }
#${MODAL_ID} .ff-arv-m-gauge i { position: absolute; inset: 0 auto 0 0; border-radius: 4px; }
#${MODAL_ID} .ff-arv-m-gauge u { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: #f4ecd6; border-radius: 1px; }
#${MODAL_ID} .ff-arv-m-gauge-labels { display: flex; justify-content: space-between; font-size: 11.5px; color: #a8a098; }
#${MODAL_ID} .ff-arv-m-gauge-labels b { color: #f1ede2; }
#${MODAL_ID} ul { margin: 0; padding-left: 18px; }
#${MODAL_ID} li { margin: 4px 0; }
#${MODAL_ID} .ff-arv-m-quoted { color: #c9bfa6; }
#${MODAL_ID} .ff-arv-m-legend { display: grid; grid-template-columns: auto auto 1fr; gap: 6px 12px; font-size: 12px; align-items: center; }
#${MODAL_ID} .ff-arv-m-legend .ff-arv-m-record { text-align: right; color: #c9bfa6; }
#${MODAL_ID} .ff-arv-m-legend .ff-arv-m-range { color: #8b8578; }
#${MODAL_ID} .ff-arv-m-legend .ff-arv-m-cur { outline: 1px solid currentColor; outline-offset: 2px; border-radius: 3px; }
#${MODAL_ID} .ff-arv-m-foot { padding: 14px 20px 18px; color: #6b6455; font-size: 11px; }
#${MODAL_ID} .ff-arv-beatable-t { color: #4ade80; }
#${MODAL_ID} .ff-arv-coinflip-t { color: #fbbf24; }
#${MODAL_ID} .ff-arv-avoid-t { color: #f87171; }
`;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

function word(v: ArenaVerdict): string {
  return v.kind === 'beatable' ? 'Beatable' : v.kind === 'avoid' ? 'Avoid' : 'Coin-flip';
}

function accentFor(v: ArenaVerdict): string {
  return v.kind === 'beatable' ? '#4ade80' : v.kind === 'avoid' ? '#f87171' : '#fbbf24';
}

function scoreText(v: ArenaVerdict): string {
  const score = v.score > 3 ? 'score 3+' : `score ${v.score.toFixed(2)}`;
  return v.kind === 'coinflip' ? `leans ${v.leansWin ? 'win' : 'loss'} · ${score}` : score;
}

/** The one reason that matters most, for the hover card. */
function keyReason(d: FightDetail): string {
  const { card, verdict: v } = d;
  if (v.theyBreakThrough) return `Their STR ${fmt(card.strength)} gets past your armour, so they hit hard.`;
  if (v.breaksThrough) return `Your hits get past their DEF ${fmt(card.defence)}, so they go down fast.`;
  return `STR ${fmt(card.strength)} against your limit of ~${fmt(v.maxStrength)} at level ${card.level}.`;
}

function notes(d: FightDetail): string[] {
  const { card, verdict: v } = d;
  const out: string[] = [];
  if (card.passive) out.push('<b>Passive:</b> they haven’t fought this season, so they fight on an older snapshot, weaker than the card shows.');
  if (v.breaksThrough) out.push(`<b>Your hits get past their DEF ${fmt(card.defence)}</b>, so you deal real damage, not just the minimum.`);
  if (v.theyBreakThrough) out.push(`<b>Their hits get past your armour</b> (~${fmt(d.profile.reduction)}), so they deal real damage, not just the minimum.`);
  if (card.isBoss) {
    if (card.family === 'iron_river') out.push('<b>Iron River boss:</b> built on STR, the stat that decides fights. Every boss loss so far was Iron River.');
    else if (d.familyLabel) out.push(`<b>${esc(d.familyLabel)} boss:</b> built around a stat that barely matters in a fight. Bosses like this have won every time so far.`);
    out.push('<b>A boss loss forfeits your unbanked pot.</b> Skipping means banking first.');
  }
  if (v.kind === 'coinflip') {
    out.push(
      v.leansWin
        ? 'Leans win: ' + (card.passive ? 'Passive opponents in this band have won most of the time.' : card.isBoss ? 'bosses scoring 1.0+ have all been won.' : 'a quoted 51%+ in this band has usually been a win.')
        : 'Leans loss: active opponents in this band have mostly beaten you.',
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hover card
// ---------------------------------------------------------------------------

function hoverEl(): HTMLElement {
  let el = document.getElementById(HOVER_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = HOVER_ID;
    document.body.appendChild(el);
  }
  return el;
}

export function showHover(anchor: HTMLElement, d: FightDetail): void {
  const el = hoverEl();
  el.innerHTML =
    `<div class="ff-arv-h-verdict"><span style="color:${accentFor(d.verdict)}">${word(d.verdict)}</span>` +
    ` <span class="ff-arv-h-score">· ${scoreText(d.verdict)}</span></div>` +
    `<div class="ff-arv-h-reason">${keyReason(d)}</div>` +
    `<div class="ff-arv-h-hint">Click for the full breakdown</div>`;

  const r = anchor.getBoundingClientRect();
  el.style.left = '0px';
  el.style.top = '0px';
  el.classList.add('ff-arv-show');
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  const below = r.bottom + 8;
  el.style.left = `${left}px`;
  el.style.top = `${below + h > window.innerHeight - 8 ? r.top - h - 8 : below}px`;
}

export function hideHover(): void {
  document.getElementById(HOVER_ID)?.classList.remove('ff-arv-show');
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function closeModal(): void {
  document.getElementById(MODAL_ID)?.remove();
  document.removeEventListener('keydown', onKey, true);
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeModal();
}

export function openModal(d: FightDetail): void {
  hideHover();
  closeModal();
  const { card, verdict: v, profile: me } = d;
  const kind = v.kind;
  const accent = accentFor(v);

  const sub = [
    `Level ${card.level}`,
    card.isBoss ? (d.familyLabel ? `${esc(d.familyLabel)} boss` : 'Boss') : null,
    card.passive ? 'Passive' : null,
    d.order !== null ? `Attack #${d.order}` : null,
  ].filter(Boolean).join(' · ');

  const hitNote = (breaks: boolean) => `<small>${breaks ? 'breaks armour' : 'minimum damage'}</small>`;
  const ratio = v.hitsToKillMe / v.hitsToKillThem;
  const summary =
    ratio >= 1
      ? `You need ~${fmt(v.hitsToKillThem)} hits to finish them; they need ~${fmt(v.hitsToKillMe)} to finish you. You outlast them ${ratio.toFixed(1)}×.`
      : `They need ~${fmt(v.hitsToKillMe)} hits to finish you; you need ~${fmt(v.hitsToKillThem)}. They outlast you ${(1 / ratio).toFixed(1)}×.`;

  // Their STR as a bar, your limit as a marker, on a shared scale.
  const scale = Math.max(card.strength, v.maxStrength) * 1.15;
  const fill = (card.strength / scale) * 100;
  const mark = (v.maxStrength / scale) * 100;
  const gap =
    card.strength <= v.maxStrength
      ? `${fmt(v.maxStrength - card.strength)} STR under your limit`
      : `${fmt(card.strength - v.maxStrength)} STR over your limit`;

  const noteItems = notes(d);
  const legend = TRACK_RECORD.map(
    (t) =>
      `<span class="ff-arv-${t.kind}-t${t.kind === kind ? ' ff-arv-m-cur' : ''}" style="font-weight:800;text-transform:uppercase;letter-spacing:1px;font-size:11px">${t.label}</span>` +
      `<span class="ff-arv-m-range">score ${t.range}</span>` +
      `<span class="ff-arv-m-record">${t.record}</span>`,
  ).join('');

  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.innerHTML = `
    <div class="ff-arv-m" role="dialog" aria-modal="true" aria-label="Fight breakdown: ${esc(card.name)}">
      <div class="ff-arv-m-head">
        <div class="ff-arv-m-title">
          <div class="ff-arv-m-name">${esc(card.name)}</div>
          <div class="ff-arv-m-sub">${sub}</div>
        </div>
        <button class="ff-arv-m-close" type="button" aria-label="Close">✕</button>
      </div>

      <div class="ff-arv-m-verdict" style="color:${accent};border-color:${accent}55;border-left-color:${accent};background:${accent}14">
        <span class="ff-arv-m-verdict-word">${word(v)}</span>
        <span class="ff-arv-m-verdict-detail">${scoreText(v)}</span>
      </div>

      <div class="ff-arv-m-sec">
        <div class="ff-arv-m-h">Who wins the race</div>
        <table>
          <tr><th></th><th>You</th><th>Them</th></tr>
          <tr><td>HP</td><td>${fmt(me.maxHp)}</td><td>~${fmt(v.opponentHp)}</td></tr>
          <tr><td>Damage per hit</td><td>~${fmt(v.myHit)}${hitNote(v.breaksThrough)}</td><td>~${fmt(v.theirHit)}${hitNote(v.theyBreakThrough)}</td></tr>
          <tr><td>Hits to finish</td><td>~${fmt(v.hitsToKillThem)}</td><td>~${fmt(v.hitsToKillMe)}</td></tr>
        </table>
        <div class="ff-arv-m-sum">${summary}</div>
      </div>

      <div class="ff-arv-m-sec">
        <div class="ff-arv-m-h">Strength check</div>
        <div class="ff-arv-m-gauge"><i style="width:${fill}%;background:${accent}"></i><u style="left:${mark}%"></u></div>
        <div class="ff-arv-m-gauge-labels"><span>Their STR <b>${fmt(card.strength)}</b></span><span>Your limit <b>~${fmt(v.maxStrength)}</b></span></div>
        <div class="ff-arv-m-sum" style="font-size:12px"><b>${gap}.</b> Your limit is the most STR you can out-last at level ${card.level} with their DEF ${fmt(card.defence)}.</div>
      </div>

      ${noteItems.length ? `<div class="ff-arv-m-sec"><div class="ff-arv-m-h">Notes</div><ul>${noteItems.map((n) => `<li>${n}</li>`).join('')}</ul></div>` : ''}

      <div class="ff-arv-m-sec">
        <div class="ff-arv-m-h">The game’s number</div>
        <div class="ff-arv-m-quoted">${
          card.quotedPct !== null ? `Quoted <b>${card.quotedPct}%</b>.` : 'Not seen for this boss (it only arrives when you open the page).'
        } It comes from Combat Power alone, so it can’t tell a STR build from a DEX or AGI build.</div>
      </div>

      <div class="ff-arv-m-sec">
        <div class="ff-arv-m-h">What the verdicts have meant</div>
        <div class="ff-arv-m-legend">${legend}</div>
      </div>

      <div class="ff-arv-m-foot">Your numbers: ${fmt(me.maxHp)} HP · ~${fmt(me.baseDamage)} damage · ~${fmt(me.reduction)} armour (${
        me.source === 'fights' ? `from ${me.fightCount} fight${me.fightCount === 1 ? '' : 's'}` : 'estimated from lock-in'
      }). About 1 fight in 10 is a genuine coin-flip whatever the numbers say.</div>
    </div>`;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay.querySelector('.ff-arv-m-close')?.addEventListener('click', closeModal);
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>('.ff-arv-m-close')?.focus();
}

export function injectDetailStyles(): void {
  injectStyleOnce(STYLE_ID, CSS);
}
