import { useEffect, useState } from 'preact/hooks';
import { db } from '@/shared/db';
import { computeDashboardStats, type DashboardStats } from '@/shared/analytics/dashboardStats';

function formatCash(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    Promise.all([db.trades.toArray(), db.customsEvents.toArray()]).then(([trades, customsEvents]) => {
      setStats(computeDashboardStats(trades, customsEvents));
    });
  }, []);

  if (!stats) return null;

  const tiles: { label: string; value: string; color: string }[] = [
    { label: "Today's Profit", value: formatCash(stats.todayProfit), color: stats.todayProfit >= 0 ? 'var(--ff-green)' : 'var(--ff-red)' },
    { label: 'Lifetime Profit', value: formatCash(stats.lifetimeProfit), color: stats.lifetimeProfit >= 0 ? 'var(--ff-green)' : 'var(--ff-red)' },
    { label: 'Avg ROI', value: stats.avgRoi !== null ? `${(stats.avgRoi * 100).toFixed(0)}%` : '—', color: 'var(--ff-gold-bright)' },
    { label: 'Trips', value: String(stats.trips), color: 'var(--ff-blue)' },
    { label: 'Caught %', value: stats.caughtPct !== null ? `${stats.caughtPct.toFixed(0)}%` : '—', color: 'var(--ff-red)' },
    { label: 'Avg Bribe', value: stats.avgBribe !== null ? formatCash(stats.avgBribe) : '—', color: 'var(--ff-purple)' },
  ];

  return (
    <div class="ff-stat-grid">
      {tiles.map((t) => (
        <div class="ff-stat-tile" key={t.label}>
          <div class="ff-stat-tile__value ff-mono" style={{ color: t.color }}>{t.value}</div>
          <div class="ff-stat-tile__label">{t.label}</div>
        </div>
      ))}
    </div>
  );
}
