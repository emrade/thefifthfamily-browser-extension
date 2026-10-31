import { formatFloor } from './streetIntelAutoDisplay';
import type { SiDaySummary, StreetIntelAnalytics } from './streetIntelAnalytics';
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

function renderSuggestion(a: StreetIntelAnalytics, config: CardRuleConfig): string {
  const parts = ['<div class="ff-sia-suggest"><div class="ff-sia-h">Suggested minimum card value</div>'];
  if (!a.suggestion) {
    parts.push(`<div class="ff-sia-note">Not enough history yet. ${escapeHtml(a.suggestionNote ?? '')}</div></div>`);
    return parts.join('');
  }
  const s = a.suggestion;
  const current = config.minCardValue > 0 ? formatFloor(config.minCardValue) : 'none';
  parts.push(`<div class="ff-sia-big">${s.value > 0 ? formatFloor(s.value) : 'None'}<span class="ff-sia-current">yours: ${current}</span></div>`);
  const extreme = config.extremeMinEnabled ? ` With extreme cards needing ${formatFloor(config.extremeMinValue)}+, as you have it set.` : '';
  parts.push(
    s.value > 0
      ? `<div class="ff-sia-note">Over the last ${s.days} days, cards worth ${formatFloor(s.value)}+ came to about ${whole(s.supply)} Stamina a day, and you spent about ${whole(s.spent)}. Set it higher and Stamina sits waiting for big cards that don't come often enough; lower and it goes on cards that pay less per Stamina.${extreme}</div>`
      : `<div class="ff-sia-note">Over the last ${s.days} days the board didn't have enough big cards to use your Stamina (about ${whole(s.spent)} a day) at any minimum.${extreme}</div>`,
  );
  parts.push(
    s.value === config.minCardValue
      ? '<div class="ff-sia-ok">Your minimum already matches.</div>'
      : `<button class="ff-sia-apply" type="button" data-value="${s.value}">Apply ${s.value > 0 ? formatFloor(s.value) : 'no minimum'}</button>`,
  );
  parts.push('</div>');
  return parts.join('');
}

function renderExtremeSuggestion(a: StreetIntelAnalytics, config: CardRuleConfig): string {
  const parts = ['<div class="ff-sia-suggest"><div class="ff-sia-h">Suggested extreme card minimum</div>'];
  const e = a.extremeSuggestion;
  if (!e) {
    parts.push(`<div class="ff-sia-note">Not enough history yet. ${escapeHtml(a.extremeSuggestionNote ?? '')}</div></div>`);
    return parts.join('');
  }
  const label = (value: number) => (value > 0 ? `${formatFloor(value)}+` : 'Off');
  const current = config.extremeMinEnabled ? label(Math.max(config.minCardValue, config.extremeMinValue)) : 'Off';
  parts.push(`<div class="ff-sia-big">${label(e.value)}<span class="ff-sia-current">yours: ${current}</span></div>`);
  parts.push(
    `<div class="ff-sia-note">Over the last ${e.days} days, if the extreme cards under each amount (and at or above your minimum card value) had gone to high, medium or low cards of similar value instead. ${
      e.value > 0
        ? `${label(e.value)} adds the most cash, more than 1% of your daily ${money(e.dailyCash)}.`
        : `No amount adds more than 1% of your daily cash (${money(e.dailyCash)}) — smaller differences are noise — so leave it off.`
    }</div>`,
  );
  const signed = (n: number, fmt: (v: number) => string) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : fmt(0));
  parts.push('<table class="ff-sia-table"><tr><th>Extreme needs</th><th>Skips</th><th>Cash/day</th><th>Fails/day</th></tr>');
  for (const o of e.options) {
    parts.push(
      `<tr${o.value === e.value ? ' class="ff-sia-pick"' : ''}><td>${label(o.value)}</td><td>${o.skipped}</td><td>${signed(o.cashPerDay, money)}</td><td>${signed(o.failsPerDay, (v) => v.toFixed(1))}</td></tr>`,
    );
  }
  parts.push('</table>');
  const matches = e.value === 0 ? !config.extremeMinEnabled : config.extremeMinEnabled && Math.max(config.minCardValue, config.extremeMinValue) === e.value;
  parts.push(
    matches
      ? '<div class="ff-sia-ok">Your setting already matches.</div>'
      : `<button class="ff-sia-apply-extreme" type="button" data-value="${e.value}">${e.value > 0 ? `Apply: extreme cards need ${formatFloor(e.value)}+` : 'Apply: switch the extreme rule off'}</button>`,
  );
  parts.push('</div>');
  return parts.join('');
}

function renderComparison(a: StreetIntelAnalytics): string {
  const t = a.today;
  const avg = a.average;
  const perStamina = (d: SiDaySummary) => (d.stamina > 0 ? money(d.cash / d.stamina) : '—');
  const failPct = (d: SiDaySummary) => (d.attempts > 0 ? `${Math.round((d.fails / d.attempts) * 100)}%` : '—');
  const rows: [string, string, string][] = [
    ['Cash', money(t.cash), avg ? money(avg.cash) : '—'],
    ['Drops (est.)', `${money(t.dropValue)} · ${t.drops}`, avg ? `${money(avg.dropValue)} · ${avg.drops.toFixed(1)}` : '—'],
    ['Attempts', String(t.attempts), avg ? avg.attempts.toFixed(1) : '—'],
    ['Fail rate', failPct(t), avg ? failPct(avg) : '—'],
    ['Stamina', whole(t.stamina), avg ? whole(avg.stamina) : '—'],
    ['Cash per Stamina', perStamina(t), avg ? perStamina(avg) : '—'],
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
    return `<tr${skipped ? ' class="ff-sia-dim"' : ''}><td>${riskLabel(c.risk)}, ${c.band}</td><td>${c.attempts}</td><td>${Math.round(c.failPct)}%</td><td>${money(c.cashPerStamina)}</td></tr>`;
  });
  return `<div class="ff-sia-section"><div class="ff-sia-h">Your results by card (last ${a.cellDays} days)</div>
    <table class="ff-sia-table"><tr><th>Card</th><th>Tries</th><th>Fail</th><th>Cash/S</th></tr>${rows.join('')}</table>
    <div class="ff-sia-hint">Best cash per Stamina first, after complication losses; scouting included. Greyed rows are (at least partly) under your minimum. Card value is the middle of its pay range.</div></div>`;
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
