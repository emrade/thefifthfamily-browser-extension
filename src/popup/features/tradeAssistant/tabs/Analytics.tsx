import { useEffect, useState } from 'preact/hooks';
import { db } from '@/shared/db';
import { MiniChart } from '../MiniChart';
import {
  buildDailyAvgBribeSeries,
  buildDailyCatchRateSeries,
  buildDailyProfitSeries,
  buildDailyRoiSeries,
  buildProfitByDistrictSeries,
  buildProfitByItemSeries,
  type ChartSeries,
} from '@/shared/analytics/timeSeries';

// Stable module-level reference (not an inline closure) so MiniChart's effect
// dependency array doesn't see a "new" function every render.
const profitColor = (value: number) => (value >= 0 ? '#34d399' : '#ef4444');

interface AnalyticsData {
  profit: ChartSeries;
  roi: ChartSeries;
  catchRate: ChartSeries;
  avgBribe: ChartSeries;
  byItem: ChartSeries;
  byDistrict: ChartSeries;
}

export function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    Promise.all([db.trades.toArray(), db.customsEvents.toArray()]).then(([trades, customsEvents]) => {
      setData({
        profit: buildDailyProfitSeries(trades),
        roi: buildDailyRoiSeries(trades),
        catchRate: buildDailyCatchRateSeries(customsEvents),
        avgBribe: buildDailyAvgBribeSeries(customsEvents),
        byItem: buildProfitByItemSeries(trades),
        byDistrict: buildProfitByDistrictSeries(trades),
      });
    });
  }, []);

  if (!data) return null;

  if (data.byItem.labels.length === 0 && data.byDistrict.labels.length === 0) {
    return (
      <div class="ff-empty">
        <strong>Nothing to chart yet</strong>
        Analytics build up as you complete trades and survive (or don't) customs stops.
      </div>
    );
  }

  return (
    <>
      <div class="ff-section-label">Profit / Day</div>
      <div class="ff-chart-card"><MiniChart type="bar" series={data.profit} color="#34d399" colorForValue={profitColor} /></div>

      <div class="ff-section-label">ROI / Day (%)</div>
      <div class="ff-chart-card"><MiniChart type="line" series={data.roi} color="#fbbf24" /></div>

      <div class="ff-section-label">Catch Rate / Day (%)</div>
      <div class="ff-chart-card"><MiniChart type="line" series={data.catchRate} color="#ef4444" /></div>

      <div class="ff-section-label">Average Bribe / Day</div>
      <div class="ff-chart-card"><MiniChart type="line" series={data.avgBribe} color="#a78bfa" /></div>

      <div class="ff-section-label">Profit by Contraband</div>
      <div class="ff-chart-card"><MiniChart type="bar" series={data.byItem} color="#60a5fa" colorForValue={profitColor} /></div>

      <div class="ff-section-label">Profit by District</div>
      <div class="ff-chart-card"><MiniChart type="bar" series={data.byDistrict} color="#c9a84c" colorForValue={profitColor} /></div>
    </>
  );
}
