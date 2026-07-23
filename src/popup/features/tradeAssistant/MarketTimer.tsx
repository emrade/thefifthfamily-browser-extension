import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MarketTimer() {
  const [marketShiftAt, setMarketShiftAt] = useState<number | null | undefined>(undefined);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    storage.getSmugglingContext().then((ctx) => setMarketShiftAt(ctx?.marketShiftAt ?? null));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (marketShiftAt === undefined) return null;

  if (marketShiftAt === null) {
    return (
      <div class="ff-market-timer ff-market-timer--empty">
        Open the smuggling market in-game once so we know when prices next shift.
      </div>
    );
  }

  const remaining = marketShiftAt - now;
  const label = remaining > 0 ? formatClock(remaining) : 'Updated';

  return (
    <div class="ff-market-timer">
      <span class="ff-market-timer__label">Next Market Refresh</span>
      <span class="ff-market-timer__value ff-mono">{label}</span>
    </div>
  );
}
