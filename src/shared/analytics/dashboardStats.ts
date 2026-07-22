import type { CustomsEvent, Trade } from '@/shared/types';

export interface DashboardStats {
  todayProfit: number;
  lifetimeProfit: number;
  avgRoi: number | null;
  trips: number;
  caughtPct: number | null;
  avgBribe: number | null;
}

/**
 * "Caught %" and "Average Bribe" are computed from CustomsEvent history, not from
 * Trade records — they're about customs risk generally (the PRD's "actual catch rate"
 * risk database), not tied to whether a given trip happened to survive. A bribed-through
 * trip still counts toward "average bribe" even though the trade itself closed normally.
 */
export function computeDashboardStats(trades: Trade[], customsEvents: CustomsEvent[]): DashboardStats {
  const closed = trades.filter((t) => t.status === 'closed' && t.profit !== null);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayProfit = closed
    .filter((t) => (t.sellTime ?? 0) >= startOfDay)
    .reduce((sum, t) => sum + (t.profit ?? 0), 0);

  const lifetimeProfit = closed.reduce((sum, t) => sum + (t.profit ?? 0), 0);

  const roiTrades = closed.filter((t): t is Trade & { roi: number } => t.roi !== null);
  const avgRoi = roiTrades.length > 0 ? roiTrades.reduce((sum, t) => sum + t.roi, 0) / roiTrades.length : null;

  const trips = closed.length;

  const caughtPct = customsEvents.length > 0
    ? (customsEvents.filter((c) => c.caught).length / customsEvents.length) * 100
    : null;

  const bribed = customsEvents.filter((c) => c.resolution === 'bribe');
  const avgBribe = bribed.length > 0 ? bribed.reduce((sum, c) => sum + c.bribe, 0) / bribed.length : null;

  return { todayProfit, lifetimeProfit, avgRoi, trips, caughtPct, avgBribe };
}
