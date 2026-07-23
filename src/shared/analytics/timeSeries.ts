import type { CustomsEvent, Trade } from '@/shared/types';

export interface ChartSeries {
  labels: string[];
  values: number[];
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Builds the last `days` calendar days (oldest first), zero-filled, so charts show
 * a consistent x-axis even for days with no activity rather than compressing to
 * whatever few days happen to have data. */
function lastNDays(days: number): { key: string; label: string; start: number; end: number }[] {
  const out: { key: string; label: string; start: number; end: number }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const start = d.getTime();
    const end = start + 24 * 3600_000;
    out.push({ key: dayKey(start), label: dayLabel(start), start, end });
  }
  return out;
}

export function buildDailyProfitSeries(trades: Trade[], days = 14): ChartSeries {
  const buckets = lastNDays(days);
  const closed = trades.filter((t) => t.status === 'closed' && t.profit !== null && t.sellTime !== null);

  const values = buckets.map((b) =>
    closed
      .filter((t) => (t.sellTime as number) >= b.start && (t.sellTime as number) < b.end)
      .reduce((sum, t) => sum + (t.profit ?? 0), 0),
  );

  return { labels: buckets.map((b) => b.label), values };
}

export function buildDailyRoiSeries(trades: Trade[], days = 14): ChartSeries {
  const buckets = lastNDays(days);
  const closed = trades.filter((t) => t.status === 'closed' && t.roi !== null && t.sellTime !== null);

  const values = buckets.map((b) => {
    const dayTrades = closed.filter((t) => (t.sellTime as number) >= b.start && (t.sellTime as number) < b.end);
    if (dayTrades.length === 0) return 0;
    return (dayTrades.reduce((sum, t) => sum + (t.roi ?? 0), 0) / dayTrades.length) * 100;
  });

  return { labels: buckets.map((b) => b.label), values };
}

export function buildDailyCatchRateSeries(customsEvents: CustomsEvent[], days = 14): ChartSeries {
  const buckets = lastNDays(days);

  const values = buckets.map((b) => {
    const dayEvents = customsEvents.filter((c) => c.timestamp >= b.start && c.timestamp < b.end);
    if (dayEvents.length === 0) return 0;
    return (dayEvents.filter((c) => c.caught).length / dayEvents.length) * 100;
  });

  return { labels: buckets.map((b) => b.label), values };
}

export function buildDailyAvgBribeSeries(customsEvents: CustomsEvent[], days = 14): ChartSeries {
  const buckets = lastNDays(days);

  const values = buckets.map((b) => {
    const dayBribes = customsEvents.filter(
      (c) => c.resolution === 'bribe' && c.timestamp >= b.start && c.timestamp < b.end,
    );
    if (dayBribes.length === 0) return 0;
    return dayBribes.reduce((sum, c) => sum + c.bribe, 0) / dayBribes.length;
  });

  return { labels: buckets.map((b) => b.label), values };
}

export function buildProfitByItemSeries(trades: Trade[]): ChartSeries {
  const closed = trades.filter((t) => t.status === 'closed' && t.profit !== null);
  const totals = new Map<string, number>();
  for (const t of closed) totals.set(t.item, (totals.get(t.item) ?? 0) + (t.profit ?? 0));

  const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  return { labels: sorted.map(([item]) => item), values: sorted.map(([, profit]) => profit) };
}

export function buildProfitByDistrictSeries(trades: Trade[]): ChartSeries {
  const closed = trades.filter((t) => t.status === 'closed' && t.profit !== null && t.sellDistrict);
  const totals = new Map<string, number>();
  for (const t of closed) totals.set(t.sellDistrict as string, (totals.get(t.sellDistrict as string) ?? 0) + (t.profit ?? 0));

  const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  return { labels: sorted.map(([district]) => district), values: sorted.map(([, profit]) => profit) };
}
