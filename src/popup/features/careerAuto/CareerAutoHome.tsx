import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { ALARM_NAMES, STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import type { CareerAutoConfig, CareerAutoStatus, CareerCatalogEntry, CareerEnergyStatus, CareerGoalsConfig, CareerGoalsStatus } from '@/shared/types';
import { NumberInput } from '../../views/NumberInput';
import { gameDay } from '@/shared/careerAdvisor';
import { CAREER_SHIFT_MODE_HINT, CAREER_SHIFT_MODE_OPTIONS, careerWaitingText } from '@/shared/careerAutoDisplay';

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

/** Same local calendar-day key `runner.ts` uses — kept in sync by convention,
 *  not a shared import (see its own comment on why). */
function localDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function CareerAutoHome() {
  const [config, setConfig] = useState<CareerAutoConfig | null>(null);
  const [status, setStatus] = useState<CareerAutoStatus | null>(null);
  const [catalog, setCatalog] = useState<CareerCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // Player's own ask: the game's own careers page groups 100 jobs across 5
  // families (`CareerCatalogEntry.family`, read from `cv2-fam-name` — see
  // `careersPanelParser.ts`), and the flat list here had no way to search or
  // filter by that, making a specific job hard to spot among all of them.
  const [jobQuery, setJobQuery] = useState('');
  const [now, setNow] = useState(Date.now());
  // Read from the real `chrome.alarms` entry, not re-derived — this is what
  // covers the gap before any shift has ever run (config just enabled, still
  // waiting on the fallback-interval check, or waiting on energy/travel), where
  // `status.nextEligibleAt` doesn't exist yet because nothing has succeeded to
  // seed it. `alarms` is available to any extension context, not just the
  // background service worker that scheduled it.
  const [nextAlarmAt, setNextAlarmAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Career Advisor goal mode, which may switch this page's job.
  const [goals, setGoals] = useState<CareerGoalsConfig | null>(null);
  const [goalStatus, setGoalStatus] = useState<CareerGoalsStatus | null>(null);
  const [energyStatus, setEnergyStatus] = useState<CareerEnergyStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

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
    storage.getCareerGoalsConfig().then(setGoals);
    storage.getCareerGoalsStatus().then(setGoalStatus);
    storage.getCareerEnergyStatus().then(setEnergyStatus);

    // Background writes a fresh status on every shift — reflected here live,
    // without polling, exactly like watching the in-page overlay while it runs.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (STORAGE_KEYS.CAREER_AUTO_STATUS in changes) setStatus(changes[STORAGE_KEYS.CAREER_AUTO_STATUS].newValue ?? null);
      if (STORAGE_KEYS.CAREER_AUTO_CONFIG in changes) setConfig(changes[STORAGE_KEYS.CAREER_AUTO_CONFIG].newValue ?? null);
      if (STORAGE_KEYS.CAREER_GOALS_CONFIG in changes) storage.getCareerGoalsConfig().then(setGoals);
      if (STORAGE_KEYS.CAREER_GOALS_STATUS in changes) storage.getCareerGoalsStatus().then(setGoalStatus);
      if (STORAGE_KEYS.CAREER_ENERGY_STATUS in changes) storage.getCareerEnergyStatus().then(setEnergyStatus);
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

  // The scheduled alarm is when the runner will actually check next, the same
  // thing Crime Alley's tile shows. The tracked cooldown only covers the gap
  // before the alarm is read; preferring it showed "due now" for as long as
  // jail, low energy or a manual shift kept it in the past.
  const nextRunAt = config?.enabled ? (nextAlarmAt ?? status?.nextEligibleAt ?? null) : null;
  const waitingLine = config?.enabled ? careerWaitingText(status?.waiting, now) : null;

  // Guarded against the stored date the same way `runner.ts` guards it before
  // incrementing — otherwise this would keep showing yesterday's count all the
  // way up until the next shift actually runs and overwrites it.
  const shiftsToday = status?.shiftsTodayDate === localDateKey() ? status.shiftsToday : 0;
  const cashToday = status?.shiftsTodayDate === localDateKey() ? (status.cashToday ?? 0) : 0;

  // Search + group by family instead of one 100-job flat list.
  const query = jobQuery.trim().toLowerCase();
  const filteredCatalog = query ? catalog.filter((c) => c.name.toLowerCase().includes(query)) : catalog;

  // Keeps the currently-selected job visible (and correctly shown as
  // selected) even when an in-progress search excludes it — otherwise typing
  // a query that hides the already-running job would make the <select> show
  // nothing selected, which reads as if the job had been cleared when it
  // hasn't.
  const selectedEntry = config?.careerId != null ? catalog.find((c) => c.careerId === config!.careerId) : undefined;
  const selectedHidden = !!selectedEntry && !filteredCatalog.some((c) => c.careerId === selectedEntry.careerId);

  const groupedByFamily = new Map<string, CareerCatalogEntry[]>();
  for (const c of filteredCatalog) {
    const group = groupedByFamily.get(c.family);
    if (group) group.push(c);
    else groupedByFamily.set(c.family, [c]);
  }
  const families = [...groupedByFamily.keys()].sort();

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
      const next = { ...status, pausedReason: null, pausedMessage: null, pausedAt: null };
      setStatus(next);
      await storage.setCareerAutoStatus(next);
    }
  }

  async function selectJob(careerId: number) {
    if (!config) return;
    const entry = catalog.find((c) => c.careerId === careerId);
    if (!entry) return;
    await saveConfig({
      ...config,
      careerId: entry.careerId,
      careerName: entry.name,
      energyCost: entry.energyCost,
      otEnergyCost: entry.otEnergyCost,
    });
    // The tracked cooldown belongs to whichever job was previously selected —
    // switching jobs is always allowed, including mid-countdown, since that's
    // exactly the "grind this one to max rank, then move to the next" use case
    // this feature is for. Without clearing it, the Next Shift tile would keep
    // showing the old job's leftover countdown until the new job's own first
    // shift completes and overwrites it, which reads as if the switch hadn't
    // actually taken effect yet even though it has.
    if (status?.nextEligibleAt) {
      const next = { ...status, nextEligibleAt: null };
      setStatus(next);
      await storage.setCareerAutoStatus(next);
    }
  }

  // One check right now, even with Auto-Run off — for a wait the runner
  // can't see end early (bailing out, a discharge, an energy refill).
  // Background also writes the status to storage; setting it from the
  // response too doesn't depend on that listener firing first.
  async function runNow() {
    setRunning(true);
    setRunError(null);
    try {
      const fresh = (await chrome.runtime.sendMessage({ type: 'career-auto-run-requested' })) as CareerAutoStatus | null;
      setStatus(fresh);
    } catch (err) {
      console.error(LOG_PREFIX, 'career run-now failed', err);
      setRunError('Could not reach the background service — try again in a moment.');
    } finally {
      setRunning(false);
    }
  }

  function setShiftMode(mode: CareerAutoConfig['shiftMode']) {
    if (!config) return;
    saveConfig({ ...config, shiftMode: mode });
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

      {goals?.enabled && goals.goals.length > 0 && (
        <div class="ff-field__hint">
          Goal mode is on: the Advisor's goals pick the job ({goals.goals.length} goal{goals.goals.length === 1 ? '' : 's'} left, next:{' '}
          {goals.goals[0].careerName} to R{goals.goals[0].targetRank}). A job picked below is switched back while goals remain.
        </div>
      )}
      {goals?.enabled && goals.goals.length === 0 && goalStatus?.queueFinishedAt != null && (
        <div class="ff-health-alert" style={{ borderColor: 'var(--ff-gold)' }}>
          <strong>All career goals done</strong>
          <span class="ff-health-alert__hint">
            Still running {config.careerName}. Add a goal in Dashboard → Career Auto → Advisor, or pick a job below.
          </span>
        </div>
      )}

      {status?.pausedReason && (
        <div class="ff-health-alert">
          <strong>Career auto-runner stopped</strong>
          <span class="ff-health-alert__hint">
            {PAUSE_REASON_LABEL[status.pausedReason]}
            {status.pausedMessage && (
              <>
                <br />"{status.pausedMessage}"
              </>
            )}
            <br />
            Check the job in-game, then flip Auto-Run back on above whenever you're ready.
          </span>
        </div>
      )}

      <button class="ff-archive-secondary" disabled={running || config.careerId == null} onClick={runNow}>
        {running ? 'Running…' : 'Run Now'}
      </button>
      <div class="ff-field__hint">
        Runs one check right now, even with Auto-Run off. Handy after bailing out early or refilling energy.
      </div>
      {runError && <div class="ff-health-alert__hint">{runError}</div>}

      <div class="ff-section-label">Job</div>

      <div class="ff-field">
        <div class="ff-field__label">Which career to run</div>
        <div class="ff-field__hint">
          Only jobs unlocked at your current level are listed.
        </div>
        <input
          class="ff-select ff-field__control"
          type="text"
          placeholder="Search jobs…"
          style={{ marginBottom: '8px' }}
          value={jobQuery}
          onInput={(e) => setJobQuery((e.target as HTMLInputElement).value)}
        />
        <select
          class="ff-select"
          value={config.careerId != null ? String(config.careerId) : ''}
          disabled={catalogLoading}
          onChange={(e) => selectJob(Number((e.target as HTMLSelectElement).value))}
        >
          <option value="" disabled>
            {catalogLoading ? 'Loading jobs…' : 'Select a job'}
          </option>
          {selectedHidden && selectedEntry && (
            <option value={String(selectedEntry.careerId)}>
              {selectedEntry.name} ({selectedEntry.energyCost}E
              {selectedEntry.otAvailable ? ` / OT ${selectedEntry.otEnergyCost}E` : ''}) — currently selected
            </option>
          )}
          {families.map((family) => (
            <optgroup label={family} key={family}>
              {groupedByFamily.get(family)!.map((c) => (
                <option key={c.careerId} value={String(c.careerId)}>
                  {c.name} ({c.energyCost}E{c.otAvailable ? ` / OT ${c.otEnergyCost}E` : ''})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {query && filteredCatalog.length === 0 && (
          <div class="ff-field__hint" style={{ marginTop: '6px' }}>
            No jobs match "{jobQuery}".
          </div>
        )}
      </div>

      {catalogError && <div class="ff-health-alert__hint">{catalogError}</div>}

      <button class="ff-archive-secondary" disabled={catalogLoading} onClick={loadCatalog}>
        {catalogLoading ? 'Refreshing…' : 'Refresh Job List'}
      </button>

      <div class="ff-field">
        <div class="ff-field__label">Shift mode</div>
        <div class="ff-field__hint">
          {CAREER_SHIFT_MODE_HINT[config.shiftMode]}
        </div>
        <select
          class="ff-select ff-field__control"
          value={config.shiftMode}
          onChange={(e) => setShiftMode((e.target as HTMLSelectElement).value as CareerAutoConfig['shiftMode'])}
        >
          {CAREER_SHIFT_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div class="ff-section-label">Energy top-ups</div>

      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Use energy items</div>
          <div class="ff-toggle-row__status">
            When a shift is ready but energy is short: Energy Drinks, Energy Boosters, Adrenaline Shots, just enough for
            that shift, smallest first, never past your max energy.
          </div>
        </div>
        <input
          type="checkbox"
          class="ff-toggle"
          checked={config.useEnergyItems}
          onChange={() => saveConfig({ ...config, useEnergyItems: !config.useEnergyItems })}
        />
      </label>

      <div class="ff-field">
        <div class="ff-field__label">Energy Drinks to keep</div>
        <div class="ff-field__hint">Never takes Energy Drinks below this. Boosters and Adrenaline Shots have no floor.</div>
        <NumberInput
          class="ff-select ff-field__control"
          min={0}
          value={config.energyDrinkKeep}
          onCommit={(v) => saveConfig({ ...config, energyDrinkKeep: Math.max(0, Math.floor(v)) })}
        />
      </div>

      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Use the free daily energy refill</div>
          <div class="ff-toggle-row__status">
            Used when a shift is ready and energy is below that shift's cost, so little of it is wasted. One a day; it
            comes back at the daily reset.
          </div>
        </div>
        <input
          type="checkbox"
          class="ff-toggle"
          checked={config.useFreeRefill}
          onChange={() => saveConfig({ ...config, useFreeRefill: !config.useFreeRefill })}
        />
      </label>

      {energyStatus && (energyStatus.itemDay === gameDay() || energyStatus.refillDoneDay === gameDay()) && (
        <div class="ff-field__hint">
          Today:{' '}
          {[
            ...(energyStatus.itemDay === gameDay()
              ? Object.entries(energyStatus.itemsUsed).map(([name, n]) => `${name} ×${n}`)
              : []),
            ...(energyStatus.itemDay === gameDay() && energyStatus.itemEnergy > 0 ? [`+${energyStatus.itemEnergy} energy from items`] : []),
            ...(energyStatus.refillDoneDay === gameDay() ? ['free refill already used today'] : []),
          ].join(' · ')}
        </div>
      )}

      <div class="ff-section-label">Status</div>

      {waitingLine && <div class="ff-auto-row">{waitingLine}</div>}

      {!status?.lastShift && !nextRunAt && <div class="ff-empty">No shifts run yet.</div>}

      {!status?.lastShift && nextRunAt && (
        <div class="ff-auto-row">First eligibility check: {formatNextRun(nextRunAt, now)}</div>
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
              <div class="ff-stat-tile__value ff-mono">{shiftsToday}</div>
              <div class="ff-stat-tile__label">Shifts Today</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>${cashToday.toLocaleString()}</div>
              <div class="ff-stat-tile__label">Earned Today</div>
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
