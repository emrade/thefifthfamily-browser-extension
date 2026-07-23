import { MarketTimer } from '../MarketTimer';
import { Heatmap } from '../Heatmap';

export function Market() {
  return (
    <>
      <MarketTimer />

      <div class="ff-section-label">Price Heatmap</div>
      <Heatmap />
    </>
  );
}
