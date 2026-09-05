import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { ALARM_NAMES, STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import type { CrimesAutoConfig, CrimesAutoStatus } from '@/shared/types';

function formatOutcome(outcome: NonNullable<CrimesAutoStatus['lastAttempt']>['outcome']): string {
  switch (outcome) {
    case 'success':
      return 'Success';
    case 'busted-clean':
      return 'Busted — slipped away';
    case 'busted-bailed':
      return 'Busted — bailed out';
  }
}

/** e.g. "4:15 PM · in 3:42" — same format as CareerAutoHome's/StreetIntelAutoHome's.
 *  Clock time first (what was actually asked for), ticking countdown after.
 *  Drops the countdown entirely once due rather than showing "in 0:00". */
function formatNextRun(nextRunAt: number, now: number): string {
  const clock = new Date(nextRunAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const remainingSeconds = Math.max(0, Math.round((nextRunAt - now) / 1000));
  if (remainingSeconds === 0) return `${clock} · due now`;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${clock} · in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function CrimesAutoHome() {
  const [config, setConfig] = useState<CrimesAutoConfig | null>(null);
  const [status, setStatus] = useState<CrimesAutoStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);
  const [checkNowError, setCheckNowError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  // There's no tracked "next eligible" time in `CrimesAutoStatus` the way
  // Career Auto has for its cooldown — every wait this runner computes
  // (Nerve regen, jail/hospital release, the plain fallback poll) only ever
  // exists as the live `chrome.alarms` entry, so that's read directly here
  // instead, same fallback source CareerAutoHome uses before its first shift.
  const [nextAlarmAt, setNextAlarmAt] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([storage.getCrimesAutoConfig(), storage.getCrimesAutoStatus()]).then(([c, s]) => {
      setConfig(c);
      setStatus(s);
      setLoaded(true);
    });

    // Background writes a fresh status on every attempt — reflected here
    // live, same pattern as CareerAutoHome.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (STORAGE_KEYS.CRIMES_AUTO_STATUS in changes) setStatus(changes[STORAGE_KEYS.CRIMES_AUTO_STATUS].newValue ?? null);
      if (STORAGE_KEYS.CRIMES_AUTO_CONFIG in changes) setConfig(changes[STORAGE_KEYS.CRIMES_AUTO_CONFIG].newValue ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // Only ticking while automation is actually on — no point in a per-second
  // re-render, or in polling the alarm, otherwise. The alarm isn't
  // observable via an event (unlike storage), so this re-reads it on every
  // tick rather than only once — cheap, and it's what picks up a
  // reschedule (e.g. a Nerve wait recalculated after an attempt) without
  // needing its own separate signal. Same pattern as CareerAutoHome.
  useEffect(() => {
    if (!config?.enabled) {
      setNextAlarmAt(null);
      return;
    }
    const tick = () => {
      setNow(Date.now());
      chrome.alarms.get(ALARM_NAMES.CRIMES_AUTO).then((alarm) => setNextAlarmAt(alarm?.scheduledTime ?? null));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [config?.enabled]);

  async function toggleEnabled() {
    if (!config) return;
    const enabling = !config.enabled;
    const nextConfig = { ...config, enabled: enabling };
    setConfig(nextConfig);
    await storage.setCrimesAutoConfig(nextConfig);

    // Re-enabling clears a stale "stopped"/"district mastered" banner
    // immediately, rather than waiting for the next attempt to overwrite it
    // — same reasoning as CareerAutoHome's own toggleEnabled.
    if (enabling && status && (status.pausedReason || status.districtMasteredAt)) {
      const nextStatus = { ...status, pausedReason: null, pausedMessage: null, pausedAt: null, districtMasteredAt: null };
      setStatus(nextStatus);
      await storage.setCrimesAutoStatus(nextStatus);
    }
  }

  // For a manually-used Nerve consumable making the account ready earlier
  // than a previously computed wait accounted for — see `runCheckNow`'s own
  // doc comment in background/features/crimesAuto/index.ts for the gap this
  // closes. Background writes the refreshed status to storage either way
  // (picked up by the `onChanged` listener above), but setting it directly
  // from the response too means this doesn't depend on that listener firing
  // first.
  async function checkNow() {
    setCheckingNow(true);
    setCheckNowError(null);
    try {
      const fresh = (await chrome.runtime.sendMessage({ type: 'crimes-check-requested' })) as CrimesAutoStatus | null;
      setStatus(fresh);
    } catch (err) {
      console.error(LOG_PREFIX, 'crimes check-now failed', err);
      setCheckNowError('Could not reach the background service — try again in a moment.');
    } finally {
      setCheckingNow(false);
    }
  }

  if (!loaded || !config) return null;

  const nextRunAt = config.enabled ? nextAlarmAt : null;

  return (
    <>
      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Auto-Run</div>
          <div class="ff-toggle-row__status">
            {config.enabled
              ? "Grinding your current district's crimes until every one is Mastered."
              : 'Off — nothing will run.'}
          </div>
        </div>
        <input type="checkbox" class="ff-toggle" checked={config.enabled} onChange={toggleEnabled} />
      </label>

      <div class="ff-field__hint">
        Always targets whichever crime in your current district isn't Mastered yet, one at a time, in the order
        they're listed on the page. Bails itself out of jail and bribes off heat caps automatically — both are cheap
        next to what a crime pays.
      </div>

      <button class="ff-archive-secondary" disabled={checkingNow} onClick={checkNow}>
        {checkingNow ? 'Checking…' : 'Check Now'}
      </button>
      <div class="ff-field__hint">
        Used a Nerve consumable in-game? The automation won't notice until its next scheduled check — this forces one
        immediately instead of waiting.
      </div>

      {checkNowError && <div class="ff-health-alert__hint">{checkNowError}</div>}

      {status?.pausedReason && (
        <div class="ff-health-alert">
          <strong>Crimes auto-runner stopped</strong>
          <span class="ff-health-alert__hint">
            {status.pausedMessage && <>"{status.pausedMessage}"</>}
            <br />
            Check Crime Alley in-game, then flip Auto-Run back on above whenever you're ready.
          </span>
        </div>
      )}

      {!status?.pausedReason && status?.districtMasteredAt && (
        <div class="ff-health-alert" style={{ borderColor: 'var(--ff-gold)' }}>
          <strong>District mastered!</strong>
          <span class="ff-health-alert__hint">
            Every crime here reached Mastered on {new Date(status.districtMasteredAt).toLocaleString()}. Go challenge
            the boss — once the next district's crimes appear, flip Auto-Run back on to keep going.
          </span>
        </div>
      )}

      <div class="ff-section-label">Status</div>

      {!status?.lastAttempt && !nextRunAt && <div class="ff-empty">No attempts yet.</div>}

      {!status?.lastAttempt && nextRunAt && (
        <div class="ff-auto-row">First eligibility check: {formatNextRun(nextRunAt, now)}</div>
      )}

      {status?.lastAttempt && (
        <>
          <div class="ff-stat-grid">
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">{nextRunAt ? formatNextRun(nextRunAt, now) : '—'}</div>
              <div class="ff-stat-tile__label">Next Check</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">{status.attempts}</div>
              <div class="ff-stat-tile__label">Attempts</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>{status.successes}</div>
              <div class="ff-stat-tile__label">Successes</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-red)' }}>{status.busts}</div>
              <div class="ff-stat-tile__label">Busts</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>${status.cashEarned.toLocaleString()}</div>
              <div class="ff-stat-tile__label">Cash Earned</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-purple)' }}>{status.xpEarned.toLocaleString()}</div>
              <div class="ff-stat-tile__label">XP Earned</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">
                {status.bailsPaid} · ${status.bailCashSpent.toLocaleString()}
              </div>
              <div class="ff-stat-tile__label">Bails Paid</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">
                {status.bribesPaid} · ${status.bribeCashSpent.toLocaleString()}
              </div>
              <div class="ff-stat-tile__label">Bribes Paid</div>
            </div>
          </div>
          <div class="ff-fc-captured">
            {status.lastAttempt.crimeName} — {formatOutcome(status.lastAttempt.outcome)}
            {status.lastAttempt.outcome === 'success' && (
              <>
                {' '}· ${status.lastAttempt.cashGained.toLocaleString()} · +{status.lastAttempt.xpGained} XP
              </>
            )}{' '}
            · {new Date(status.lastAttempt.timestamp).toLocaleString()}
          </div>
        </>
      )}
    </>
  );
}
