import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { LOG_PREFIX } from '@/shared/log';
import type { CourierRunSummary } from '@/shared/types';

const STOP_REASON_LABEL: Record<NonNullable<CourierRunSummary['stoppedReason']>, string> = {
  'daily-cap-reached': "Today's profit cap is reached — resumes after the midnight reset.",
  'insufficient-funds': 'Not enough cash + bank to load even one pet.',
  'no-idle-pets': 'No idle pets right now — everything is already out or in transit.',
  'session-error': 'Stopped early — the game rejected a request (stale session or token). Reload the game tab, view Smuggling once, then run again.',
};

function formatMoney(n: number): string {
  return `$${n.toLocaleString()}`;
}

export function Courier() {
  const [lastRun, setLastRun] = useState<CourierRunSummary | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    storage.getLastCourierRun().then(setLastRun).catch((err) => console.error(LOG_PREFIX, 'failed to load last courier run', err));
  }, []);

  async function handleRun() {
    setRunning(true);
    try {
      const summary = (await chrome.runtime.sendMessage({ type: 'courier-run-requested' })) as CourierRunSummary;
      setLastRun(summary);
    } catch (err) {
      console.error(LOG_PREFIX, 'courier run failed', err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div class="ff-section-label">Pet Couriers</div>
      <div class="ff-archive-note">
        Offloads anything that's arrived, then loads and sends every idle pet — the priciest item you can afford in
        your current district, to whichever open destination isn't level-locked. Withdraws cash automatically if
        your on-hand cash falls short.
      </div>

      <button class="ff-export-trigger" disabled={running} onClick={handleRun}>
        {running ? 'Running…' : 'Run'}
      </button>

      {lastRun && (
        <div class="ff-courier-summary">
          <div class="ff-section-label">Last run</div>
          <div class="ff-courier-summary__timestamp">{new Date(lastRun.timestamp).toLocaleString()}</div>

          {lastRun.stoppedReason && <div class="ff-archive-alert">{STOP_REASON_LABEL[lastRun.stoppedReason]}</div>}

          {lastRun.offloaded.length > 0 && (
            <>
              <div class="ff-courier-summary__row-head">Offloaded</div>
              {lastRun.offloaded.map((o) => (
                <div key={o.petName} class="ff-courier-summary__row">
                  {o.petName} — {formatMoney(o.profit)} profit
                </div>
              ))}
            </>
          )}

          {lastRun.sent.length > 0 && (
            <>
              <div class="ff-courier-summary__row-head">Sent</div>
              {lastRun.sent.map((s) => (
                <div key={s.petName} class="ff-courier-summary__row">
                  {s.petName} — {s.qty}× {s.item} → {s.destination}
                </div>
              ))}
            </>
          )}

          {lastRun.cashWithdrawn > 0 && (
            <div class="ff-courier-summary__row">Withdrew {formatMoney(lastRun.cashWithdrawn)} from the bank.</div>
          )}

          {lastRun.skipped.length > 0 && (
            <>
              <div class="ff-courier-summary__row-head">Skipped</div>
              {lastRun.skipped.map((s) => (
                <div key={s.petName} class="ff-courier-summary__row">
                  {s.petName} — {s.reason}
                </div>
              ))}
            </>
          )}

          {lastRun.errors.length > 0 && (
            <>
              <div class="ff-courier-summary__row-head">Errors</div>
              {lastRun.errors.map((e, i) => (
                <div key={i} class="ff-courier-summary__row ff-courier-summary__row--error">
                  {e}
                </div>
              ))}
            </>
          )}

          {lastRun.offloaded.length === 0 && lastRun.sent.length === 0 && !lastRun.stoppedReason && lastRun.errors.length === 0 && (
            <div class="ff-courier-summary__row">Nothing to do — no arrivals to collect and no idle pets to send.</div>
          )}
        </div>
      )}
    </div>
  );
}
