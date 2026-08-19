import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { db } from '@/shared/db';
import { LOG_PREFIX } from '@/shared/log';
import { STOP_REASON_LABEL, describeItems, describeProgressEvent, describeRoster, formatCourierMoney } from '@/shared/courierDisplay';
import type { ExtensionMessage } from '@/shared/messaging';
import type { CourierRunSummary, PetRosterEntry } from '@/shared/types';

export function Courier() {
  const [lastRun, setLastRun] = useState<CourierRunSummary | null>(null);
  const [running, setRunning] = useState(false);
  // Which action is in flight — the offload-only path shares `running`/`liveLines`
  // display with a full run (same shape of summary, same live-progress broadcast),
  // but the button labels need to know which one they themselves triggered.
  const [offloading, setOffloading] = useState(false);
  const [roster, setRoster] = useState<PetRosterEntry[] | null>(null);
  // Cleared at the start of each run, appended to live as `courier-run-progress`
  // events arrive — see petCourier.ts's `emitProgress`. Purely a "what's
  // happening right now" display; `lastRun` (the resolved Promise, below) stays
  // the authoritative record once the run finishes.
  const [liveLines, setLiveLines] = useState<string[]>([]);

  function refreshRoster() {
    db.petRoster
      .toArray()
      .then(setRoster)
      .catch((err) => console.error(LOG_PREFIX, 'failed to load pet roster', err));
  }

  useEffect(() => {
    storage.getLastCourierRun().then(setLastRun).catch((err) => console.error(LOG_PREFIX, 'failed to load last courier run', err));
    refreshRoster();

    function onMessage(msg: ExtensionMessage) {
      if (msg.type !== 'courier-run-progress') return;
      const line = describeProgressEvent(msg.event);
      if (line) setLiveLines((prev) => [...prev, line]);
    }
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  async function handleAction(kind: 'courier-run-requested' | 'courier-offload-requested') {
    const setBusy = kind === 'courier-run-requested' ? setRunning : setOffloading;
    setBusy(true);
    setLiveLines([]);
    try {
      const summary = (await chrome.runtime.sendMessage({ type: kind })) as CourierRunSummary;
      setLastRun(summary);
      refreshRoster(); // either action can learn new pets too, same as any other panel view
    } catch (err) {
      console.error(LOG_PREFIX, `courier ${kind} failed`, err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div class="ff-section-label">Pet Couriers</div>
      <div class="ff-archive-note">
        Offloads anything that's arrived, then loads and sends every idle pet — the priciest item you can afford in
        your current district, to whichever open destination isn't level-locked. Withdraws cash automatically if
        your on-hand cash falls short, and banks whatever's left over afterward so it's not sitting exposed.
      </div>

      <div class="ff-courier-summary__row">{describeRoster(roster)}</div>

      <button class="ff-export-trigger" disabled={running || offloading} onClick={() => handleAction('courier-run-requested')}>
        {running ? 'Running…' : 'Run'}
      </button>
      <button
        class="ff-export-trigger"
        disabled={running || offloading}
        onClick={() => handleAction('courier-offload-requested')}
      >
        {offloading ? 'Offloading…' : 'Offload All'}
      </button>

      {(running || offloading) && (
        <div class="ff-courier-summary">
          <div class="ff-section-label">{running ? 'Running' : 'Offloading'}</div>
          {liveLines.length === 0 ? (
            <div class="ff-courier-summary__row">Starting…</div>
          ) : (
            liveLines.map((line, i) => (
              <div key={i} class="ff-courier-summary__row">
                {line}
              </div>
            ))
          )}
        </div>
      )}

      {!running && !offloading && lastRun && (
        <div class="ff-courier-summary">
          <div class="ff-section-label">Last run</div>
          <div class="ff-courier-summary__timestamp">{new Date(lastRun.timestamp).toLocaleString()}</div>

          {lastRun.stoppedReason && <div class="ff-archive-alert">{STOP_REASON_LABEL[lastRun.stoppedReason]}</div>}

          {lastRun.offloaded.length > 0 && (
            <>
              <div class="ff-courier-summary__row-head">Offloaded</div>
              {lastRun.offloaded.map((o) => (
                <div key={o.petName} class="ff-courier-summary__row">
                  {o.petName} — {formatCourierMoney(o.profit)} profit
                </div>
              ))}
            </>
          )}

          {lastRun.sent.length > 0 && (
            <>
              <div class="ff-courier-summary__row-head">Sent</div>
              {lastRun.sent.map((s) => (
                <div key={s.petName} class="ff-courier-summary__row">
                  {s.petName} — {describeItems(s.items)} → {s.destination}
                </div>
              ))}
            </>
          )}

          {lastRun.cashWithdrawn > 0 && (
            <div class="ff-courier-summary__row">Withdrew {formatCourierMoney(lastRun.cashWithdrawn)} from the bank.</div>
          )}

          {lastRun.cashDeposited > 0 && (
            <div class="ff-courier-summary__row">Deposited {formatCourierMoney(lastRun.cashDeposited)} to the bank.</div>
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

          {lastRun.offloaded.length === 0 &&
            lastRun.sent.length === 0 &&
            lastRun.cashDeposited === 0 &&
            !lastRun.stoppedReason &&
            lastRun.errors.length === 0 && (
              <div class="ff-courier-summary__row">Nothing to do — no arrivals to collect and no idle pets to send.</div>
            )}
        </div>
      )}
    </div>
  );
}
