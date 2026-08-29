import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { STOP_REASON_LABEL, describeItems, formatCourierMoney, formatRelativeTime } from '@/shared/courierDisplay';
import type { CourierAutoConfig, CourierStatus } from '@/shared/types';

/** Answers the same "even when it is active i have no idea what it is doing"
 *  gap the in-page panel's own watch status was built for, but reachable
 *  without being on the smuggling page — and, unlike the icon badge alone,
 *  visiting this page actually explains *why* it lit up rather than just
 *  clearing it silently. Reuses the same `courier-status-requested` message
 *  the in-page panel already answers with (see petCourier.ts/courierWatch.ts
 *  in background) rather than re-deriving the same assembly logic here. */
export function PetCouriersHome() {
  const [config, setConfig] = useState<CourierAutoConfig | null>(null);
  const [status, setStatus] = useState<CourierStatus | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loaded, setLoaded] = useState(false);

  async function refreshStatus() {
    try {
      const result = (await chrome.runtime.sendMessage({ type: 'courier-status-requested' })) as CourierStatus;
      setStatus(result);
    } catch (err) {
      console.error(LOG_PREFIX, 'pet couriers popup status refresh failed', err);
    }
  }

  useEffect(() => {
    storage.getCourierAutoConfig().then(setConfig);
    refreshStatus().then(() => setLoaded(true));

    // The one place opening this page actually *does* something rather than
    // just reading — the icon badge is exactly the count this page now
    // explains, so seeing this page is the acknowledgment. The background's
    // own next cycle will set it again on its own schedule if there's still
    // something worth flagging; this doesn't fight that; it just stops an
    // already-seen count from sitting there stale.
    chrome.action.setBadgeText({ text: '' }).catch(() => {});

    // Live-reflects a toggle changed from the in-page panel instead — the two
    // surfaces read the same storage key, so this is the same
    // `chrome.storage.onChanged` pattern Career Auto's own popup page uses.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (STORAGE_KEYS.COURIER_AUTO_CONFIG in changes) setConfig(changes[STORAGE_KEYS.COURIER_AUTO_CONFIG].newValue ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);

    // Background state (destination/return-alarm/roster) isn't one single
    // storage key to listen to — it's assembled from several plus a live
    // alarm read (see `getWatchSummary`) — so this re-asks the same way the
    // in-page panel's own 30s refresh does, just faster: a page opened
    // specifically to check status should feel current, not stale for half
    // a minute.
    const id = setInterval(() => {
      setNow(Date.now());
      refreshStatus();
    }, 5_000);

    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      clearInterval(id);
    };
  }, []);

  async function saveConfig(next: CourierAutoConfig) {
    setConfig(next);
    await storage.setCourierAutoConfig(next);
  }

  if (!loaded || !config || !status) return null;

  const { watch, lastRun } = status;
  const destOpen = watch.destinationOpenUntil !== null && watch.destinationOpenUntil > now;

  return (
    <>
      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Auto-Offload</div>
          <div class="ff-toggle-row__status">Collect a landed pet's cargo automatically.</div>
        </div>
        <input
          type="checkbox"
          class="ff-toggle"
          checked={config.autoOffloadEnabled}
          onChange={() => saveConfig({ ...config, autoOffloadEnabled: !config.autoOffloadEnabled })}
        />
      </label>

      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Auto-Dispatch</div>
          <div class="ff-toggle-row__status">Send idle pets automatically when a destination opens.</div>
        </div>
        <input
          type="checkbox"
          class="ff-toggle"
          checked={config.autoDispatchEnabled}
          onChange={() => saveConfig({ ...config, autoDispatchEnabled: !config.autoDispatchEnabled })}
        />
      </label>

      <div class="ff-section-label">Destination</div>

      {watch.lastCheckedAt === 0 && <div class="ff-empty">Not checked yet.</div>}

      {watch.lastCheckedAt !== 0 && watch.lastProbeResult === 'skipped-no-idle-pets' && (
        <div class="ff-auto-row">No idle pets to check with (last tried {new Date(watch.lastCheckedAt).toLocaleTimeString()}).</div>
      )}

      {watch.lastCheckedAt !== 0 && watch.lastProbeResult !== 'skipped-no-idle-pets' && destOpen && (
        <div class="ff-auto-row">
          Open, closes in {formatRelativeTime(watch.destinationOpenUntil!, now)} ({new Date(watch.destinationOpenUntil!).toLocaleTimeString()}).
        </div>
      )}

      {watch.lastCheckedAt !== 0 && watch.lastProbeResult !== 'skipped-no-idle-pets' && !destOpen && (
        <div class="ff-auto-row">Locked (checked {new Date(watch.lastCheckedAt).toLocaleTimeString()}).</div>
      )}

      {watch.nextDestCheckAt !== null && (
        <div class="ff-auto-row">
          Next check: {formatRelativeTime(watch.nextDestCheckAt, now)} ({new Date(watch.nextDestCheckAt).toLocaleTimeString()}).
        </div>
      )}

      <div class="ff-section-label">En Route</div>

      {watch.pendingReturns.length === 0 && <div class="ff-empty">No pets currently en route.</div>}

      {watch.pendingReturns.length > 0 &&
        watch.pendingReturns.map((p) => (
          <div class="ff-auto-row" key={p.petName}>
            {p.petName} — {p.arrivesAt <= now ? 'landed, offload pending' : `back in ${formatRelativeTime(p.arrivesAt, now)}`}
          </div>
        ))}

      <div class="ff-section-label">Last Run</div>

      {!lastRun && <div class="ff-empty">No runs yet.</div>}

      {lastRun && (
        <>
          <div class="ff-fc-captured">{new Date(lastRun.timestamp).toLocaleString()}</div>
          {lastRun.stoppedReason && <div class="ff-health-alert__hint">{STOP_REASON_LABEL[lastRun.stoppedReason]}</div>}
          {lastRun.offloaded.length > 0 && (
            <div class="ff-stat-grid">
              {lastRun.offloaded.map((o) => (
                <div class="ff-stat-tile" key={o.petName}>
                  <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>
                    {formatCourierMoney(o.profit)}
                  </div>
                  <div class="ff-stat-tile__label">{o.petName}</div>
                </div>
              ))}
            </div>
          )}
          {lastRun.sent.length > 0 &&
            lastRun.sent.map((s) => (
              <div class="ff-auto-row" key={s.petName}>
                {s.petName} — {describeItems(s.items)} → {s.destination}
              </div>
            ))}
        </>
      )}
    </>
  );
}
