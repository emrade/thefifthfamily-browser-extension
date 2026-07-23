import { useEffect, useMemo, useState } from 'preact/hooks';
import { db } from '@/shared/db';
import type { Trade } from '@/shared/types';

function formatCash(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

// Trip duration — the plan's item 4 asked for it, but it's derivable from
// buyTime/sellTime (both already stored on every Trade), so there's no separate
// stored field — just computed for display.
function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function TradeHistory() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    db.trades
      .where('status')
      .equals('closed')
      .toArray()
      .then((rows) => {
        rows.sort((a, b) => (b.sellTime ?? 0) - (a.sellTime ?? 0));
        setTrades(rows);
      });
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return trades;
    const q = query.toLowerCase();
    return trades.filter(
      (t) =>
        t.item.toLowerCase().includes(q) ||
        t.buyDistrict.toLowerCase().includes(q) ||
        (t.sellDistrict ?? '').toLowerCase().includes(q),
    );
  }, [trades, query]);

  if (trades.length === 0) {
    return (
      <div class="ff-empty">
        <strong>No trades yet</strong>
        Buy and sell something in-game — completed trips show up here.
      </div>
    );
  }

  return (
    <>
      <input
        class="ff-search-input"
        type="text"
        placeholder="Search item or district…"
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />
      <div class="ff-trade-list">
        {filtered.length === 0 && <div class="ff-empty">No trades match "{query}".</div>}
        {filtered.map((t) => (
          <div class="ff-trade-row" key={t.id}>
            <div class="ff-trade-row__top">
              <span class="ff-trade-row__item">{t.item}</span>
              <span class="ff-trade-row__profit ff-mono" style={{ color: (t.profit ?? 0) >= 0 ? 'var(--ff-green)' : 'var(--ff-red)' }}>
                {formatCash(t.profit ?? 0)}
              </span>
            </div>
            <div class="ff-trade-row__bottom">
              <span>{t.buyDistrict} → {t.sellDistrict ?? '—'} · {formatDuration((t.sellTime ?? t.buyTime) - t.buyTime)}</span>
              <span>{formatDate(t.sellTime ?? t.buyTime)}</span>
            </div>
            {(t.caught || t.bribe > 0) && (
              <div class="ff-trade-row__flags">
                {t.caught && <span class="ff-pill ff-pill--red">Cargo Seized</span>}
                {t.bribe > 0 && (
                  <span class="ff-pill ff-pill--gold">
                    Bribed {formatCash(t.bribe)}{t.bribeCount > 1 ? ` (${t.bribeCount}×)` : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
