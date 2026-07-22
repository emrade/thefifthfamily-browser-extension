import { useEffect, useState } from 'preact/hooks';
import { db } from '@/shared/db';

interface Counts {
  trades: number;
  priceSnapshots: number;
  customsEvents: number;
}

export function TradeAssistantHome() {
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    Promise.all([db.trades.count(), db.priceSnapshots.count(), db.customsEvents.count()]).then(
      ([trades, priceSnapshots, customsEvents]) => setCounts({ trades, priceSnapshots, customsEvents }),
    );
  }, []);

  return (
    <div class="ff-feature-empty">
      <i>◆</i>
      <strong>Building your ledger</strong>
      <p>
        Every price you see, trade you make, and customs stop you survive is being
        recorded quietly in the background. The profit dashboard and Best Trade
        recommendations arrive once there's enough of your own history to trust.
      </p>

      {counts && (
        <div class="ff-ledger" style={{ marginTop: '18px', textAlign: 'left' }}>
          <span class="ff-ledger__label">Trades Recorded</span>
          <span class="ff-ledger__value">{counts.trades}</span>
          <span class="ff-ledger__label">Prices Observed</span>
          <span class="ff-ledger__value">{counts.priceSnapshots}</span>
          <span class="ff-ledger__label">Customs Encounters</span>
          <span class="ff-ledger__value">{counts.customsEvents}</span>
        </div>
      )}
    </div>
  );
}
