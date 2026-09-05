import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { STORAGE_KEYS } from '@/shared/constants';
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

export function CrimesAutoHome() {
  const [config, setConfig] = useState<CrimesAutoConfig | null>(null);
  const [status, setStatus] = useState<CrimesAutoStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);
  const [checkNowError, setCheckNowError] = useState<string | null>(null);

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

      {!status?.lastAttempt && <div class="ff-empty">No attempts yet.</div>}

      {status?.lastAttempt && (
        <>
          <div class="ff-stat-grid">
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
