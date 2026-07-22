import { useEffect, useState } from 'preact/hooks';
import { computeBestTrade, type BestTradeRecommendation } from '@/shared/analytics/bestTrade';

function formatCash(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

export function BestTrade() {
  const [rec, setRec] = useState<BestTradeRecommendation | null | undefined>(undefined);

  useEffect(() => {
    computeBestTrade().then(setRec);
  }, []);

  if (rec === undefined) return null;

  if (rec === null) {
    return (
      <div class="ff-empty">
        <strong>Not enough intel yet</strong>
        Visit a couple of districts' markets so there's something to compare — a
        recommendation shows up here once we've seen both a buy and a sell price for
        the same item.
      </div>
    );
  }

  return (
    <div class="ff-best-trade">
      <div class="ff-best-trade__route">
        <div class="ff-best-trade__leg">
          <span class="ff-best-trade__leg-label">Buy</span>
          <span class="ff-best-trade__leg-item">{rec.item}</span>
          <span class="ff-best-trade__leg-district">{rec.buyDistrict} · {formatCash(rec.buyPrice)}/ea</span>
        </div>
        <div class="ff-best-trade__arrow">→</div>
        <div class="ff-best-trade__leg">
          <span class="ff-best-trade__leg-label">Sell</span>
          <span class="ff-best-trade__leg-item">{rec.sellDistrict}</span>
          <span class="ff-best-trade__leg-district">{formatCash(rec.sellPrice)}/ea · ×{rec.quantity}</span>
        </div>
      </div>

      <div class="ff-best-trade__stats">
        <div>
          <span class="ff-best-trade__stat-label">Expected Profit</span>
          <span class="ff-best-trade__stat-value ff-mono" style={{ color: 'var(--ff-green)' }}>{formatCash(rec.expectedProfit)}</span>
        </div>
        <div>
          <span class="ff-best-trade__stat-label">Expected Risk</span>
          <span class="ff-best-trade__stat-value ff-mono" style={{ color: 'var(--ff-red)' }}>{rec.expectedRiskPct.toFixed(0)}%</span>
        </div>
        <div>
          <span class="ff-best-trade__stat-label">Expected EV</span>
          <span class="ff-best-trade__stat-value ff-mono" style={{ color: 'var(--ff-gold-bright)' }}>{formatCash(rec.expectedEV)}</span>
        </div>
      </div>

      <div class="ff-best-trade__note">
        Risk from {rec.riskSource === 'observed' ? 'your own customs history' : "the game's displayed gauge — not enough of your own history yet"} · assumes bribing through any stop
      </div>
    </div>
  );
}
