import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { NumberInput } from '@/popup/views/NumberInput';
import { REAL_ESTATE_AUTO_MAX_INTERVAL_HOURS, REAL_ESTATE_AUTO_MIN_INTERVAL_HOURS, STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import type { RealEstateAutoConfig, RealEstateAutoStatus, RealEstateVaultState } from '@/shared/types';

function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

function clock(at: number): string {
  return new Date(at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function hoursAgo(at: number, now: number): string {
  const h = (now - at) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m ago` : `${h.toFixed(1)}h ago`;
}

/** A property earning less than this share of income (the Dive Bar, 0.1%)
 *  filling early doesn't matter; the first one above it does. */
const MEANINGFUL_SHARE = 0.02;

/** The first vault worth caring about to fill after a collection, and when:
 *  the interval should sit under it. `null` until the Properties page has
 *  been seen. */
function firstBigFill(state: RealEstateVaultState | null): { hours: number; name: string } | null {
  const vaults = state?.vaults.filter((v) => v.hourly > 0) ?? [];
  const total = vaults.reduce((s, v) => s + v.hourly, 0);
  const big = vaults.filter((v) => v.hourly >= total * MEANINGFUL_SHARE).sort((a, b) => a.cap / a.hourly - b.cap / b.hourly)[0];
  return big ? { hours: big.cap / big.hourly, name: big.name } : null;
}

export function RealEstateAutoHome() {
  const [config, setConfig] = useState<RealEstateAutoConfig | null>(null);
  const [status, setStatus] = useState<RealEstateAutoStatus | null>(null);
  const [vaults, setVaults] = useState<RealEstateVaultState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);
  const [checkNowError, setCheckNowError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    Promise.all([storage.getRealEstateAutoConfig(), storage.getRealEstateAutoStatus(), storage.getRealEstateVaults()]).then(([c, s, v]) => {
      setConfig(c);
      setStatus(s);
      setVaults(v);
      setLoaded(true);
    });

    // The background writes status after every check and turns the switch
    // off itself when it pauses — both shown here live.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (STORAGE_KEYS.REAL_ESTATE_AUTO_STATUS in changes) setStatus(changes[STORAGE_KEYS.REAL_ESTATE_AUTO_STATUS].newValue ?? null);
      if (STORAGE_KEYS.REAL_ESTATE_AUTO_CONFIG in changes) setConfig(changes[STORAGE_KEYS.REAL_ESTATE_AUTO_CONFIG].newValue ?? null);
      if (STORAGE_KEYS.REAL_ESTATE_VAULTS in changes) setVaults(changes[STORAGE_KEYS.REAL_ESTATE_VAULTS].newValue ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  async function saveConfig(next: RealEstateAutoConfig) {
    setConfig(next);
    await storage.setRealEstateAutoConfig(next);
  }

  async function toggleEnabled() {
    if (!config) return;
    const enabling = !config.enabled;
    await saveConfig({ ...config, enabled: enabling });
    if (enabling && status?.pausedMessage) {
      const next = { ...status, pausedMessage: null, pausedAt: null };
      setStatus(next);
      await storage.setRealEstateAutoStatus(next);
    }
  }

  function setInterval_(value: number) {
    if (!config || !Number.isFinite(value)) return;
    const hours = Math.min(REAL_ESTATE_AUTO_MAX_INTERVAL_HOURS, Math.max(REAL_ESTATE_AUTO_MIN_INTERVAL_HOURS, Math.round(value)));
    saveConfig({ ...config, intervalHours: hours });
  }

  async function checkNow() {
    setCheckingNow(true);
    setCheckNowError(null);
    try {
      const fresh = (await chrome.runtime.sendMessage({ type: 'real-estate-auto-check-requested' })) as RealEstateAutoStatus | null;
      setStatus(fresh);
    } catch (err) {
      console.error(LOG_PREFIX, 'real estate auto check-now failed', err);
      setCheckNowError('Could not reach the background service. Try again in a moment.');
    } finally {
      setCheckingNow(false);
    }
  }

  if (!loaded || !config) return null;

  const fill = firstBigFill(vaults);
  const tooLong = fill !== null && config.intervalHours >= fill.hours;
  const nextAt = config.enabled ? status?.nextCheckAt ?? null : null;
  const last = status?.history[0] ?? null;

  return (
    <>
      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Auto-Collect Real Estate</div>
          <div class="ff-toggle-row__status">
            {config.enabled
              ? `Collects and banks once ${config.intervalHours}h pass without a collection.`
              : 'Off. Nothing will run.'}
          </div>
        </div>
        <input type="checkbox" class="ff-toggle" checked={config.enabled} onChange={toggleEnabled} />
      </label>

      <div class="ff-field__hint">
        A safety net for the days you don't get to the Properties page. Each time you collect, its countdown starts over,
        so while you keep checking in it never runs. If nobody has collected for the interval below, it presses Collect
        All and banks all your cash on hand. You only hear from it if it stops.
      </div>

      <button class="ff-archive-secondary" disabled={checkingNow} onClick={checkNow}>
        {checkingNow ? 'Checking…' : 'Check Now'}
      </button>
      {checkNowError && <div class="ff-health-alert__hint">{checkNowError}</div>}

      {status?.pausedMessage && (
        <div class="ff-health-alert">
          <strong>Auto-Collect stopped</strong>
          <span class="ff-health-alert__hint">
            "{status.pausedMessage}"
            <br />
            Check the Properties page in-game, then turn Auto-Collect back on whenever you're ready.
          </span>
        </div>
      )}

      <div class="ff-section-label">Timing</div>

      <div class="ff-field">
        <div class="ff-field__label">Collect after (hours)</div>
        <div class="ff-field__hint">
          {fill
            ? `Hours since the last collection before it steps in. Your ${fill.name} fills about ${fill.hours.toFixed(1)}h after a collection, so keep this below that.`
            : 'Hours since the last collection before it steps in. Open the Properties page once so it can tell you when your first big vault fills.'}
        </div>
        <NumberInput
          class="ff-select ff-field__control"
          min={REAL_ESTATE_AUTO_MIN_INTERVAL_HOURS}
          max={REAL_ESTATE_AUTO_MAX_INTERVAL_HOURS}
          value={config.intervalHours}
          onCommit={setInterval_}
        />
        {tooLong && <div class="ff-health-alert__hint">At {config.intervalHours}h your {fill.name} will already be full and losing money.</div>}
      </div>

      <div class="ff-section-label">Status</div>

      {status?.note && config.enabled && <div class="ff-auto-row">{status.note}</div>}

      <div class="ff-stat-grid">
        <div class="ff-stat-tile">
          <div class="ff-stat-tile__value ff-mono">{status?.lastCollectionAt ? hoursAgo(status.lastCollectionAt, now) : '—'}</div>
          <div class="ff-stat-tile__label">Last Collection</div>
        </div>
        <div class="ff-stat-tile">
          <div class="ff-stat-tile__value ff-mono">{nextAt ? clock(nextAt) : '—'}</div>
          <div class="ff-stat-tile__label">Next Check</div>
        </div>
        <div class="ff-stat-tile">
          <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>{money(status?.today.collected ?? 0)}</div>
          <div class="ff-stat-tile__label">Collected Today</div>
        </div>
        <div class="ff-stat-tile">
          <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-gold)' }}>{money(status?.today.banked ?? 0)}</div>
          <div class="ff-stat-tile__label">Banked Today</div>
        </div>
        <div class="ff-stat-tile">
          <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>{money(status?.lifetime.collected ?? 0)}</div>
          <div class="ff-stat-tile__label">Collected All-Time</div>
        </div>
        <div class="ff-stat-tile">
          <div class="ff-stat-tile__value ff-mono">{status?.lifetime.runs ?? 0}</div>
          <div class="ff-stat-tile__label">Times Stepped In</div>
        </div>
      </div>

      {last && (
        <div class="ff-fc-captured">
          Last auto-collect: {money(last.collected)} · {clock(last.at)}
        </div>
      )}

      {status && status.history.length > 0 && (
        <>
          <div class="ff-section-label">Auto-collects</div>
          {status.history.map((run) => (
            <div class="ff-auto-row" key={run.at}>
              {clock(run.at)} · {run.afterHours.toFixed(1)}h since the last collection · collected {money(run.collected)} from{' '}
              {run.properties} properties{run.devotion > 0 && <> ({money(run.devotion)} to Devotion)</>} ·{' '}
              {run.banked !== null ? `banked ${money(run.banked)}` : 'not banked'}
            </div>
          ))}
        </>
      )}
    </>
  );
}
