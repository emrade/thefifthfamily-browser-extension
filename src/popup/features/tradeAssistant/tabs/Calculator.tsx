import { useEffect, useState } from 'preact/hooks';
import { listKnownItems } from '@/shared/analytics/heatmap';
import { computeCustomsCalculator, type CustomsCalculatorResult } from '@/shared/analytics/customsCalculator';
import { storage } from '@/shared/storage';

function formatCash(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

export function Calculator() {
  const [items, setItems] = useState<string[]>([]);
  const [item, setItem] = useState('');
  const [maxQuantity, setMaxQuantity] = useState(20);
  const [quantity, setQuantity] = useState(20);
  const [result, setResult] = useState<CustomsCalculatorResult | null | undefined>(undefined);

  useEffect(() => {
    Promise.all([listKnownItems(), storage.getSmugglingContext()]).then(([list, ctx]) => {
      setItems(list);
      if (list.length > 0) setItem(list[0]);
      const capacity = ctx?.cargoCapacity && ctx.cargoCapacity > 0 ? ctx.cargoCapacity : 20;
      setMaxQuantity(capacity);
      setQuantity(capacity);
    });
  }, []);

  useEffect(() => {
    if (!item) return;
    computeCustomsCalculator(item, quantity).then(setResult);
  }, [item, quantity]);

  if (items.length === 0) {
    return (
      <div class="ff-empty">
        <strong>No prices seen yet</strong>
        The calculator needs at least one observed price to work with — open the
        smuggling market in-game first.
      </div>
    );
  }

  return (
    <div>
      <select class="ff-select" value={item} onChange={(e) => setItem((e.target as HTMLSelectElement).value)}>
        {items.map((i) => (
          <option value={i} key={i}>{i}</option>
        ))}
      </select>

      <div class="ff-slider-row">
        <span class="ff-slider-row__label">Items</span>
        <span class="ff-slider-row__value ff-mono">{quantity}</span>
      </div>
      <input
        class="ff-slider"
        type="range"
        min={1}
        max={maxQuantity}
        value={quantity}
        onInput={(e) => setQuantity(Number((e.target as HTMLInputElement).value))}
      />

      {result && (
        <div class="ff-best-trade__stats" style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--ff-border)' }}>
          <div>
            <span class="ff-best-trade__stat-label">Expected Risk</span>
            <span class="ff-best-trade__stat-value ff-mono" style={{ color: 'var(--ff-red)' }}>{result.riskPct.toFixed(0)}%</span>
          </div>
          <div>
            <span class="ff-best-trade__stat-label">Expected Profit</span>
            <span class="ff-best-trade__stat-value ff-mono" style={{ color: result.expectedProfit >= 0 ? 'var(--ff-green)' : 'var(--ff-red)' }}>{formatCash(result.expectedProfit)}</span>
          </div>
          <div>
            <span class="ff-best-trade__stat-label">Expected Bribe</span>
            <span class="ff-best-trade__stat-value ff-mono" style={{ color: 'var(--ff-purple)' }}>{formatCash(result.expectedBribe)}</span>
          </div>
        </div>
      )}

      {result && (
        <div class="ff-best-trade" style={{ marginTop: '10px', textAlign: 'center' }}>
          <span class="ff-best-trade__stat-label">Expected EV</span>
          <div class="ff-mono" style={{ fontSize: '18px', fontWeight: 700, color: 'var(--ff-gold-bright)', marginTop: '4px' }}>
            {formatCash(result.expectedEV)}
          </div>
        </div>
      )}

      {result && (
        <div class="ff-best-trade__note">
          Risk from {result.riskSource === 'observed-curve' ? 'your own fullness↔risk history' : result.riskSource === 'single-reading' ? 'your most recent panel reading — more history will refine this' : "a rough default — no readings yet"} · bribe ratio from {result.riskSource !== 'fallback' ? 'your own bribe history where available' : 'a rough default'}
        </div>
      )}
    </div>
  );
}
