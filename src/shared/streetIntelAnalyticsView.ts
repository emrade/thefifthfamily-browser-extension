import { formatFloor } from './streetIntelAutoDisplay';
import type { SiDaySummary, SiExtremeSuggestion, SiSuggestion, SiValueGroup, StreetIntelAnalytics } from './streetIntelAnalytics';
import type { StreetIntelAutoConfig } from './types';

/**
 * The Analytics tab's markup, shared by the popup and the in-page Street
 * Intel panel so both show the same thing. Plain HTML + its own `ff-sia-`
 * CSS with literal colors (the in-page panel runs outside the popup's
 * :root tokens). The host wires the Apply buttons: `.ff-sia-apply` carries
 * a minimum card value in `data-value`; `.ff-sia-apply-extreme` an extreme
 * minimum, 0 meaning switch the rule off.
 */

export const ANALYTICS_CSS = `
.ff-sia { font-family: 'Inter', system-ui, sans-serif; color: #ccc; font-size: 10.5px; line-height: 1.45; }
.ff-sia-section { margin-bottom: 14px; }
.ff-sia-h { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #8b8578; margin: 0 0 5px; font-weight: 700; }
.ff-sia-suggest { padding: 10px 11px; margin-bottom: 14px; background: rgba(201,168,76,0.08); border: 1px solid rgba(201,168,76,0.35); border-radius: 9px; }
.ff-sia-big { font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 18px; font-weight: 700; color: #f1ede2; }
.ff-sia-current { font-size: 10px; color: #8b8578; margin-left: 6px; font-weight: 400; font-family: 'Inter', system-ui, sans-serif; }
.ff-sia-note { color: #a8a294; margin: 4px 0 8px; }
.ff-sia-basis { padding-top: 8px; margin-top: 8px; border-top: 1px solid rgba(201,168,76,0.25); }
.ff-sia-basis:first-of-type { border-top: none; margin-top: 2px; padding-top: 0; }
.ff-sia-basis-h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ff-sia-basis-label { font-size: 10px; font-weight: 700; color: #d6cfbd; }
.ff-sia-mid { font-family: 'Courier New', ui-monospace, Menlo, monospace; font-size: 15px; font-weight: 700; color: #f1ede2; }
.ff-sia-apply {
  box-sizing: border-box; display: block; width: 100%; padding: 6px 10px; border-radius: 7px; cursor: pointer;
  font-family: 'Inter', system-ui, sans-serif; font-size: 11px; font-weight: 700;
  background: rgba(201,168,76,0.16); border: 1px solid rgba(201,168,76,0.6); color: #f1d98a;
}
.ff-sia-apply:hover, .ff-sia-apply-extreme:hover { border-color: #c9a84c; }
.ff-sia-apply-extreme {
  box-sizing: border-box; display: block; width: 100%; padding: 6px 10px; border-radius: 7px; cursor: pointer; margin-top: 8px;
  font-family: 'Inter', system-ui, sans-serif; font-size: 11px; font-weight: 700;
  background: rgba(201,168,76,0.16); border: 1px solid rgba(201,168,76,0.6); color: #f1d98a;
}
.ff-sia-pick td { color: #f1d98a; font-weight: 700; }
.ff-sia-ok { color: #4ade80; }
.ff-sia-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
.ff-sia-table th { text-align: right; font-weight: 600; color: #6b6455; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 4px; }
.ff-sia-table th:first-child, .ff-sia-table td:first-child { text-align: left; padding-left: 0; }
.ff-sia-table td { text-align: right; padding: 3px 4px; border-top: 1px solid rgba(255,255,255,0.06); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ff-sia-table td:first-child { white-space: normal; }
.ff-sia-dim td { color: #6b6455; }
.ff-sia-good { color: #4ade80; }
.ff-sia-warn { color: #fbbf24; }
.ff-sia-hint { color: #8b8578; font-size: 9.5px; margin-top: 4px; }
.ff-sia-day { padding: 3px 0; border-top: 1px solid rgba(255,255,255,0.06); }
.ff-sia-day:first-of-type { border-top: none; }
.ff-sia-foot { color: #6b6455; font-size: 9px; }
`;

/** How long the tab waits for background before saying so. */
const ANALYTICS_REQUEST_TIMEOUT_MS = 15_000;

/** Asks background for the summary, giving up after a while rather than
 *  showing "Loading…" forever if it never answers. */
export function requestStreetIntelAnalytics(): Promise<StreetIntelAnalytics> {
  return Promise.race([
    chrome.runtime.sendMessage({ type: 'street-intel-analytics-requested' }).then((a: StreetIntelAnalytics | undefined) => {
      if (!a) throw new Error('no analytics in the reply');
      return a;
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ANALYTICS_REQUEST_TIMEOUT_MS)),
  ]);
}

export function money(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A card's midpoint without rounding it across a minimum: $849.85k, not $850k. */
function cardValue(amount: number): string {
  if (amount >= 1_000_000) return `$${Number((amount / 1_000_000).toFixed(4))}M`;
  return `$${Number((amount / 1_000).toFixed(2))}k`;
}

function whole(n: number): string {
  return Math.round(n).toLocaleString();
}

function dayLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function riskLabel(risk: string): string {
  return risk.charAt(0).toUpperCase() + risk.slice(1);
}

type CardRuleConfig = Pick<StreetIntelAutoConfig, 'minCardValue' | 'extremeMinEnabled' | 'extremeMinValue'>;

const BASIS_LABEL = { cash: 'Counting cash only', drops: 'Counting cash + drops' };

/** The value range a group covers, as card values. */
function range(g: { from: number; to: number }): string {
  return g.from === g.to ? cardValue(g.from) : `${cardValue(g.from)}–${cardValue(g.to)}`;
}

/** What a group of cards made per Stamina, on the suggestion's own basis. */
function groupPay(g: SiValueGroup, countsDrops: boolean): string {
  const total = g.cashPerStamina + (countsDrops ? g.dropsPerStamina : 0);
  const split = countsDrops ? `${money(g.cashPerStamina)} cash + ${money(g.dropsPerStamina)} drops = ` : '';
  return `${split}${money(total)} per Stamina (${g.attempts} attempts)`;
}

function suggestionNote(s: SiSuggestion, a: StreetIntelAnalytics, config: CardRuleConfig): string {
  const current = config.minCardValue > 0 ? formatFloor(config.minCardValue) : 'none';
  const window = `your last ${a.cellDays} days`;
  if (s.verdict === 'lower') {
    return s.value > 0
      ? `Over the last ${s.days} days, cards worth ${current}+ came to only about ${whole(s.currentSupply)} Stamina a day, against about ${whole(s.spent)} spent. At ${formatFloor(s.value)}+ they came to about ${whole(s.supply)}, enough to keep Stamina going on cards above the minimum.`
      : `Over the last ${s.days} days the board didn't have enough big cards to use your Stamina (about ${whole(s.spent)} a day) at any minimum.`;
  }
  if (s.verdict === 'raise' && s.compare) {
    return `It skips cards worth ${range(s.compare.cut)}; over ${window}, cards in that range made ${groupPay(s.compare.cut, s.countsDrops)}. Their Stamina would go to the cards just above (${range(s.compare.next)}), and cards in that range made ${groupPay(s.compare.next, s.countsDrops)}. Cards worth ${formatFloor(s.value)}+ still came to about ${whole(s.supply)} Stamina a day, against about ${whole(s.spent)} spent.`;
  }
  if (s.compare) {
    return `Raising it would skip cards worth ${range(s.compare.cut)}; over ${window}, cards in that range made ${groupPay(s.compare.cut, s.countsDrops)}. Cards in the range just above (${range(s.compare.next)}) made ${groupPay(s.compare.next, s.countsDrops)}, not clearly more (it needs 10% more, beyond what chance explains${
      s.countsDrops ? ' — one gold drop moves these numbers a lot, so a wide gap can still be luck' : ''
    }), so skipping them wouldn't be known to earn more.${
      s.blockedAt ? ` Higher still, from ${formatFloor(s.blockedAt.value)}, the board wouldn't have enough cards to use your Stamina.` : ''
    }`;
  }
  if (s.blockedAt !== null) {
    return `A higher minimum would leave too few cards: over the last ${s.days} days, cards worth ${formatFloor(s.blockedAt.value)}+ came to about ${whole(s.blockedAt.supply)} Stamina a day, against about ${whole(s.spent)} spent — not enough room for cards that expire or come during a cooldown.`;
  }
  return `Not enough attempts on cards above your minimum to compare yet — each side needs ${s.countsDrops ? 100 : 30} over ${window}.`;
}

function minimumAction(value: number, config: CardRuleConfig): string {
  return value === config.minCardValue
    ? '<div class="ff-sia-ok">Keep your minimum.</div>'
    : `<button class="ff-sia-apply" type="button" data-value="${value}">Apply ${value > 0 ? formatFloor(value) : 'no minimum'}</button>`;
}

/** Two suggestions, one on cash alone and one counting drops: drops are
 *  worth 2–3x the cash per Stamina, but only turn into cash when sold, and
 *  selling is held back near the vault limit — so the player picks. Shown as
 *  one when they agree. */
function renderSuggestion(a: StreetIntelAnalytics, config: CardRuleConfig): string {
  const parts = ['<div class="ff-sia-suggest"><div class="ff-sia-h">Suggested minimum card value</div>'];
  const cash = a.suggestion;
  const drops = a.suggestionWithDrops;
  if (!cash || !drops) {
    parts.push(`<div class="ff-sia-note">Not enough history yet. ${escapeHtml(a.suggestionNote ?? '')}</div></div>`);
    return parts.join('');
  }
  const current = config.minCardValue > 0 ? formatFloor(config.minCardValue) : 'none';
  const amount = (value: number) => (value > 0 ? formatFloor(value) : 'None');
  const shown = (s: SiSuggestion) => (s.value === config.minCardValue ? `Keep ${amount(s.value)}` : amount(s.value));
  const extreme = config.extremeMinEnabled ? ` With extreme cards needing ${formatFloor(config.extremeMinValue)}+, as you have it set.` : '';
  if (cash.value === drops.value) {
    parts.push(`<div class="ff-sia-big">${amount(drops.value)}<span class="ff-sia-current">yours: ${current}</span></div>`);
    const agree = drops.verdict === 'lower' ? '' : ' Counting cash only or cash + drops gives the same answer.';
    parts.push(`<div class="ff-sia-note">${suggestionNote(drops, a, config)}${extreme}${agree}</div>`);
    parts.push(minimumAction(drops.value, config));
  } else {
    parts.push(`<div class="ff-sia-note">Yours: ${current}. Counting drops or not gives different answers — drops pay only once sold.${extreme}</div>`);
    for (const s of [cash, drops]) {
      parts.push(`<div class="ff-sia-basis"><div class="ff-sia-basis-h"><span class="ff-sia-basis-label">${s.countsDrops ? BASIS_LABEL.drops : BASIS_LABEL.cash}</span><span class="ff-sia-mid">${shown(s)}</span></div>`);
      parts.push(`<div class="ff-sia-note">${suggestionNote(s, a, config)}</div>${minimumAction(s.value, config)}</div>`);
    }
  }
  parts.push('</div>');
  return parts.join('');
}

function renderExtremeSuggestion(a: StreetIntelAnalytics, config: CardRuleConfig): string {
  const parts = ['<div class="ff-sia-suggest"><div class="ff-sia-h">Suggested extreme card minimum</div>'];
  const cash = a.extremeSuggestion;
  const drops = a.extremeSuggestionWithDrops;
  if (!cash || !drops) {
    parts.push(`<div class="ff-sia-note">Not enough history yet. ${escapeHtml(a.extremeSuggestionNote ?? '')}</div></div>`);
    return parts.join('');
  }
  const label = (value: number) => (value > 0 ? `${formatFloor(value)}+` : 'Off');
  const current = config.extremeMinEnabled ? label(Math.max(config.minCardValue, config.extremeMinValue)) : 'Off';
  const matches = (value: number) =>
    value === 0 ? !config.extremeMinEnabled : config.extremeMinEnabled && Math.max(config.minCardValue, config.extremeMinValue) === value;
  const action = (value: number) =>
    matches(value)
      ? '<div class="ff-sia-ok">Your setting already matches.</div>'
      : `<button class="ff-sia-apply-extreme" type="button" data-value="${value}">${value > 0 ? `Apply: extreme cards need ${formatFloor(value)}+` : 'Apply: switch the extreme rule off'}</button>`;
  const verdict = (e: SiExtremeSuggestion) => {
    const what = e.countsDrops ? 'cash + drops' : 'cash';
    const daily = money(e.dailyCash + (e.countsDrops ? e.dailyDrops : 0));
    return e.value > 0
      ? `${label(e.value)} adds the most ${what}, more than 1% of your daily ${daily}.`
      : `No amount adds more than 1% of your daily ${what} (${daily}) — smaller differences are noise — so leave it off.`;
  };
  const intro = `Over the last ${cash.days} days, if the extreme cards under each amount (and at or above your minimum card value) had gone to high, medium or low cards of similar value instead.`;
  if (cash.value === drops.value) {
    parts.push(`<div class="ff-sia-big">${label(cash.value)}<span class="ff-sia-current">yours: ${current}</span></div>`);
    parts.push(`<div class="ff-sia-note">${intro} ${verdict(drops)} Counting cash only gives the same answer.</div>`);
  } else {
    parts.push(`<div class="ff-sia-note">Yours: ${current}. ${intro}</div>`);
    for (const e of [cash, drops]) {
      parts.push(
        `<div class="ff-sia-basis"><div class="ff-sia-basis-h"><span class="ff-sia-basis-label">${e.countsDrops ? BASIS_LABEL.drops : BASIS_LABEL.cash}</span><span class="ff-sia-mid">${label(e.value)}</span></div><div class="ff-sia-note">${verdict(e)}</div>${action(e.value)}</div>`,
      );
    }
  }
  const signed = (n: number, fmt: (v: number) => string) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : fmt(0));
  const picked = (value: number) => (value === cash.value || value === drops.value ? ' class="ff-sia-pick"' : '');
  parts.push('<table class="ff-sia-table"><tr><th>Extreme needs</th><th>Skips</th><th>Cash/day</th><th>Drops/day</th><th>Fails/day</th></tr>');
  for (const o of cash.options) {
    parts.push(
      `<tr${picked(o.value)}><td>${label(o.value)}</td><td>${o.skipped}</td><td>${signed(o.cashPerDay, money)}</td><td>${signed(o.dropsPerDay, money)}</td><td>${signed(o.failsPerDay, (v) => v.toFixed(1))}</td></tr>`,
    );
  }
  parts.push('</table>');
  if (cash.value === drops.value) parts.push(action(cash.value));
  else parts.push('<div class="ff-sia-hint">Highlighted: the two suggestions above. Drops/day is their estimated sale value; it swings far more than cash.</div>');
  parts.push('</div>');
  return parts.join('');
}

function renderComparison(a: StreetIntelAnalytics): string {
  const t = a.today;
  const avg = a.average;
  const perStamina = (d: SiDaySummary) => (d.stamina > 0 ? money(d.cash / d.stamina) : '—');
  const withDrops = (d: SiDaySummary) => (d.stamina > 0 ? money((d.cash + d.dropValue) / d.stamina) : '—');
  const failPct = (d: SiDaySummary) => (d.attempts > 0 ? `${Math.round((d.fails / d.attempts) * 100)}%` : '—');
  const rows: [string, string, string][] = [
    ['Cash', money(t.cash), avg ? money(avg.cash) : '—'],
    ['Drops (est.)', `${money(t.dropValue)} · ${t.drops}`, avg ? `${money(avg.dropValue)} · ${avg.drops.toFixed(1)}` : '—'],
    ['Attempts', String(t.attempts), avg ? avg.attempts.toFixed(1) : '—'],
    ['Fail rate', failPct(t), avg ? failPct(avg) : '—'],
    ['Stamina', whole(t.stamina), avg ? whole(avg.stamina) : '—'],
    ['Cash per Stamina', perStamina(t), avg ? perStamina(avg) : '—'],
    ['Cash + drops per Stamina', withDrops(t), avg ? withDrops(avg) : '—'],
  ];
  return `<div class="ff-sia-section"><div class="ff-sia-h">Today vs ${a.averageDays}-day average</div>
    <table class="ff-sia-table"><tr><th></th><th>Today</th><th>Average</th></tr>
    ${rows.map(([label, today, average]) => `<tr><td>${label}</td><td>${today}</td><td>${average}</td></tr>`).join('')}
    </table><div class="ff-sia-hint">Today runs from midnight your time (the game's daily reset). Fail rate counts failures and disasters.</div></div>`;
}

function renderSupply(a: StreetIntelAnalytics, config: CardRuleConfig): string {
  const s = a.supply;
  const minimum = config.minCardValue > 0 ? `${formatFloor(config.minCardValue)}+` : 'any value';
  const parts = [`<div class="ff-sia-section"><div class="ff-sia-h">Board vs your Stamina</div>`];
  parts.push(`<div>Cards at ${minimum}${config.extremeMinEnabled ? ` (extreme ${formatFloor(Math.max(config.minCardValue, config.extremeMinValue))}+)` : ''} that appeared today: <strong>${whole(s.todayStamina)}</strong> Stamina's worth. You've spent <strong>${whole(s.todaySpent)}</strong>.</div>`);
  if (s.avgStamina !== null && s.avgSpent !== null) {
    const ratio = s.avgSpent > 0 ? s.avgStamina / s.avgSpent : 0;
    const verdict =
      ratio >= 1.4
        ? '<span class="ff-sia-warn">Plenty on the board — a higher minimum would still use your Stamina.</span>'
        : ratio < 1
          ? '<span class="ff-sia-warn">Not enough on the board — Stamina builds to 90% and then goes on any card.</span>'
          : '<span class="ff-sia-good">About right for the Stamina you spend.</span>';
    parts.push(`<div>${s.days}-day average: ${whole(s.avgStamina)} on the board, ${whole(s.avgSpent)} spent. ${verdict}</div>`);
  }
  parts.push('<div class="ff-sia-hint">Counts each card once, when it first appeared while the board was being read.</div></div>');
  return parts.join('');
}

function renderCells(a: StreetIntelAnalytics, config: CardRuleConfig): string {
  if (a.cells.length === 0) return '';
  const bandFloor: Record<string, number> = { 'Under $250k': 0, '$250k–500k': 250_000, '$500k–1M': 500_000, '$1M–2M': 1_000_000, '$2M+': 2_000_000 };
  const rows = a.cells.map((c) => {
    const minimum = c.risk === 'extreme' && config.extremeMinEnabled ? Math.max(config.minCardValue, config.extremeMinValue) : config.minCardValue;
    const skipped = (bandFloor[c.band] ?? 0) < minimum;
    return `<tr${skipped ? ' class="ff-sia-dim"' : ''}><td>${riskLabel(c.risk)}, ${c.band}</td><td>${c.attempts}</td><td>${Math.round(c.failPct)}%</td><td>${money(c.cashPerStamina)}</td><td>${money(c.dropsPerStamina)}</td></tr>`;
  });
  return `<div class="ff-sia-section"><div class="ff-sia-h">Your results by card (last ${a.cellDays} days)</div>
    <table class="ff-sia-table"><tr><th>Card</th><th>Tries</th><th>Fail</th><th>Cash/S</th><th>Drops/S</th></tr>${rows.join('')}</table>
    <div class="ff-sia-hint">Best cash per Stamina first, after complication losses; scouting included. Drops/S is their estimated sale value — it swings far more than cash. Greyed rows are (at least partly) under your minimum. Card value is the middle of its pay range.</div></div>`;
}

function renderDrops(a: StreetIntelAnalytics): string {
  if (a.recentDays.length === 0) return '';
  const today = a.today.day;
  const rows = a.recentDays.map(
    (d) =>
      `<div class="ff-sia-day"><strong>${dayLabel(d.day, today)}</strong> · ${d.drops} drop${d.drops === 1 ? '' : 's'} · ${money(d.dropValue)}${
        d.topDrop ? ` · best: ${escapeHtml(d.topDrop.name)} (${money(d.topDrop.value)})` : ''
      }</div>`,
  );
  return `<div class="ff-sia-section"><div class="ff-sia-h">Drops by day (est. sale value)</div>${rows.join('')}
    <div class="ff-sia-hint">Valued at your last sell quote for that item, or a typical price for its quality. One gold item can swing a whole day.</div></div>`;
}

export function renderStreetIntelAnalytics(a: StreetIntelAnalytics, config: CardRuleConfig): string {
  const since = a.since ? new Date(a.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  return `<div class="ff-sia">
    ${renderSuggestion(a, config)}
    ${renderExtremeSuggestion(a, config)}
    ${renderComparison(a)}
    ${renderSupply(a, config)}
    ${renderCells(a, config)}
    ${renderDrops(a)}
    <div class="ff-sia-foot">Manual and automatic attempts${since ? `, since ${since}` : ''}. Recorded from the HTTP Archive's capture, so it pauses if archive capture is turned off.</div>
  </div>`;
}
