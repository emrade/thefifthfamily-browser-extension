import { useEffect, useState } from 'preact/hooks';
import { computeRiskDatabase, type RiskDatabaseRow } from '@/shared/analytics/riskDatabase';

const MIN_ENCOUNTERS_FOR_CONFIDENCE = 5;

function formatCash(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export function RiskDatabase() {
  const [rows, setRows] = useState<RiskDatabaseRow[] | null>(null);

  useEffect(() => {
    computeRiskDatabase().then(setRows);
  }, []);

  if (!rows) return null;

  if (rows.length === 0) {
    return (
      <div class="ff-empty">
        <strong>No customs encounters yet</strong>
        Every raid you bribe, run from, or surrender to builds this table — actual
        catch rate per item, measured against what the game's own risk gauge showed
        at the time.
      </div>
    );
  }

  return (
    <div class="ff-risk-db">
      {rows.map((row) => {
        const lowConfidence = row.encounters < MIN_ENCOUNTERS_FOR_CONFIDENCE;
        const deltaColor = row.deltaPct > 5 ? 'var(--ff-red)' : row.deltaPct < -5 ? 'var(--ff-green)' : 'var(--ff-ink-muted)';
        return (
          <div class="ff-risk-row" key={row.item}>
            <div class="ff-risk-row__top">
              <span class="ff-risk-row__item">{row.item}</span>
              <span class="ff-risk-row__encounters">{row.encounters} encounter{row.encounters === 1 ? '' : 's'}{lowConfidence ? ' · low sample' : ''}</span>
            </div>
            <div class="ff-risk-row__stats">
              <div>
                <span class="ff-risk-row__stat-label">Actual Catch</span>
                <span class="ff-risk-row__stat-value ff-mono" style={{ color: 'var(--ff-red)' }}>{row.actualCatchRatePct.toFixed(0)}%</span>
              </div>
              <div>
                <span class="ff-risk-row__stat-label">Displayed Avg</span>
                <span class="ff-risk-row__stat-value ff-mono">{row.avgDisplayedRiskPct.toFixed(0)}%</span>
              </div>
              <div>
                <span class="ff-risk-row__stat-label">Delta</span>
                <span class="ff-risk-row__stat-value ff-mono" style={{ color: deltaColor }}>
                  {row.deltaPct >= 0 ? '+' : ''}{row.deltaPct.toFixed(0)}pp
                </span>
              </div>
            </div>
            {row.avgBribe !== null && (
              <div class="ff-risk-row__bribe">Avg bribe when caught and paid: {formatCash(row.avgBribe)} ({row.bribedCount}×)</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
