import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { ALARM_NAMES, STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import type { CareerAutoConfig, CareerAutoStatus, CareerCatalogEntry } from '@/shared/types';

const PAUSE_REASON_LABEL: Record<NonNullable<CareerAutoStatus['pausedReason']>, string> = {
  fired: 'Stopped after getting fired from a fumbled shift.',
  error: 'Stopped after an unexpected response from the game.',
};

/** e.g. "4:15 PM · in 3:42" — the clock time first (what was actually asked
 *  for), the countdown after as a secondary, ticking detail. Once due, drops
 *  the countdown half entirely rather than showing "in 0:00". */
function formatNextRun(nextRunAt: number, now: number): string {
  const clock = new Date(nextRunAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const remainingSeconds = Math.max(0, Math.round((nextRunAt - now) / 1000));
  if (remainingSeconds === 0) return `${clock} · due now`;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${clock} · in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function CareerAutoHome() {
  const [config, setConfig] = useState<CareerAutoConfig | null>(null);
  const [status, setStatus] = useState<CareerAutoStatus | null>(null);
  const [catalog, setCatalog] = useState<CareerCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  // Read from the real `chrome.alarms` entry, not re-derived — this is what
  // covers the gap before any shift has ever run (config just enabled, still
  // waiting on the fallback-interval check, or waiting on energy/travel), where
  // `status.nextEligibleAt` doesn't exist yet because nothing has succeeded to
  // seed it. `alarms` is available to any extension context, not just the
  // background service worker that scheduled it.
  const [nextAlarmAt, setNextAlarmAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function loadCatalog() {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const entries = (await chrome.runtime.sendMessage({ type: 'career-catalog-requested' })) as CareerCatalogEntry[];
      setCatalog(entries);
    } catch (err) {
      console.error(LOG_PREFIX, 'career catalog fetch failed', err);
      setCatalogError('Could not read the careers page — open it in the game tab, then try again.');
    } finally {
      setCatalogLoading(false);
    }
  }

  useEffect(() => {
    Promise.all([storage.getCareerAutoConfig(), storage.getCareerAutoStatus()]).then(([c, s]) => {
      setConfig(c);
      setStatus(s);
      setLoaded(true);
    });
    loadCatalog();

    // Background writes a fresh status on every shift — reflected here live,
    // without polling, exactly like watching the in-page overlay while it runs.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (STORAGE_KEYS.CAREER_AUTO_STATUS in changes) setStatus(changes[STORAGE_KEYS.CAREER_AUTO_STATUS].newValue ?? null);
      if (STORAGE_KEYS.CAREER_AUTO_CONFIG in changes) setConfig(changes[STORAGE_KEYS.CAREER_AUTO_CONFIG].newValue ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // Only ticking while automation is actually on — no point in a per-second
  // re-render, or in polling the alarm, otherwise. The alarm itself isn't
  // observable via an event (unlike storage), so this re-reads it on each tick
  // rather than only once — cheap, and it's what picks up a reschedule (e.g.
  // the moment a shift completes and the next one gets scheduled) without
  // needing its own separate signal.
  useEffect(() => {
    if (!config?.enabled) {
      setNextAlarmAt(null);
      return;
    }
    const tick = () => {
      setNow(Date.now());
      chrome.alarms.get(ALARM_NAMES.CAREER_AUTO).then((alarm) => setNextAlarmAt(alarm?.scheduledTime ?? null));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [config?.enabled]);

  // The tracked cooldown is authoritative once it exists (it's exactly what the
  // server said); the raw scheduled alarm is the fallback for before that ever
  // happens, so there's still something to show on a freshly-enabled job.
  const nextRunAt = config?.enabled ? (status?.nextEligibleAt ?? nextAlarmAt) : null;

  async function saveConfig(next: CareerAutoConfig) {
    setConfig(next);
    await storage.setCareerAutoConfig(next);
  }

  async function toggleEnabled() {
    if (!config) return;
    const enabling = !config.enabled;
    await saveConfig({ ...config, enabled: enabling });
    // Re-enabling clears a stale "stopped" banner immediately, rather than
    // waiting for the next successful shift to overwrite it.
    if (enabling && status?.pausedReason) {
      const next = { ...status, pausedReason: null, pausedAt: null };
      setStatus(next);
      await storage.setCareerAutoStatus(next);
    }
  }

  function selectJob(careerId: number) {
    if (!config) return;
    const entry = catalog.find((c) => c.careerId === careerId);
    if (!entry) return;
    saveConfig({
      ...config,
      careerId: entry.careerId,
      careerName: entry.name,
      energyCost: entry.energyCost,
      otEnergyCost: entry.otEnergyCost,
      otAvailable: entry.otAvailable,
    });
  }

  if (!loaded || !config) return null;

  return (
    <>
      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Auto-Run</div>
          <div class="ff-toggle-row__status">
            {config.careerId == null
              ? 'Pick a job below to enable.'
              : config.enabled
                ? `Running ${config.careerName} whenever it's available.`
                : 'Off — nothing will run.'}
          </div>
        </div>
        <input
          type="checkbox"
          class="ff-toggle"
          checked={config.enabled}
          disabled={config.careerId == null}
          onChange={toggleEnabled}
        />
      </label>

      {status?.pausedReason && (
        <div class="ff-health-alert">
          <strong>Career auto-runner stopped</strong>
          <span class="ff-health-alert__hint">
            {PAUSE_REASON_LABEL[status.pausedReason]} Check the job in-game, then flip Auto-Run back on above whenever
            you're ready.
          </span>
        </div>
      )}

      <div class="ff-section-label">Job</div>

      <div class="ff-field">
        <div class="ff-field__label">Which career to run</div>
        <div class="ff-field__hint">
          Only jobs unlocked at your current level are listed. Overtime is used automatically once you have enough
          energy — that option only exists once a job reaches rank 2.
        </div>
        <select
          class="ff-select ff-field__control"
          value={config.careerId != null ? String(config.careerId) : ''}
          disabled={catalogLoading}
          onChange={(e) => selectJob(Number((e.target as HTMLSelectElement).value))}
        >
          <option value="" disabled>
            {catalogLoading ? 'Loading jobs…' : 'Select a job'}
          </option>
          {catalog.map((c) => (
            <option key={c.careerId} value={String(c.careerId)}>
              {c.name} ({c.energyCost}E{c.otAvailable ? ` / OT ${c.otEnergyCost}E` : ''})
            </option>
          ))}
        </select>
      </div>

      {catalogError && <div class="ff-health-alert__hint">{catalogError}</div>}

      <button class="ff-archive-secondary" disabled={catalogLoading} onClick={loadCatalog}>
        {catalogLoading ? 'Refreshing…' : 'Refresh Job List'}
      </button>

      <div class="ff-section-label">Status</div>

      {!status?.lastShift && !nextRunAt && <div class="ff-empty">No shifts run yet.</div>}

      {!status?.lastShift && nextRunAt && (
        <div class="ff-fc-captured">First eligibility check: {formatNextRun(nextRunAt, now)}</div>
      )}

      {status?.lastShift && (
        <>
          <div class="ff-stat-grid">
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">{status.lastShift.tierLabel || status.lastShift.tier}</div>
              <div class="ff-stat-tile__label">Last Result</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>${status.lastShift.cash.toLocaleString()}</div>
              <div class="ff-stat-tile__label">Cash</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-purple)' }}>{status.lastShift.xp}</div>
              <div class="ff-stat-tile__label">XP</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">{nextRunAt ? formatNextRun(nextRunAt, now) : '—'}</div>
              <div class="ff-stat-tile__label">Next Shift</div>
            </div>
          </div>
          <div class="ff-fc-captured">
            {status.lastShift.overtime ? 'Overtime' : 'Normal shift'} at {status.lastShift.accuracy}% accuracy ·{' '}
            {new Date(status.lastShift.timestamp).toLocaleString()}
          </div>
        </>
      )}
    </>
  );
}
