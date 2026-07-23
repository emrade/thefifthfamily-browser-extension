import { Dashboard } from '../Dashboard';
import { BestTrade } from '../BestTrade';
import { TradeHistory } from '../TradeHistory';

export function Overview() {
  return (
    <>
      <div class="ff-section-label">Performance</div>
      <Dashboard />

      <div class="ff-section-label">Best Trade</div>
      <BestTrade />

      <div class="ff-section-label">Trade History</div>
      <TradeHistory />
    </>
  );
}
