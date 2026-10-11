import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import type { FuryCatcherConfig, FuryCatcherStatus } from '@/shared/types';

/** e.g. "4:15 PM · in 3:42" — same format as CrimesAutoHome's. */
function formatNextRun(nextRunAt: number, now: number): string {
  const clock = new Date(nextRunAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const remainingSeconds = Math.max(0, Math.round((nextRunAt - now) / 1000));
  if (remainingSeconds === 0) return `${clock} · due now`;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${clock} · in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function bossLine(boss: NonNullable<FuryCatcherStatus['boss']>, now: number): string {
  if (boss.status === 'dead') return boss.respawnAt ? `Boss #${boss.number} down — next rises ${formatNextRun(boss.respawnAt, now)}` : `Boss #${boss.number} down`;
  const pct = boss.maxHp > 0 ? Math.round((boss.hp / boss.maxHp) * 100) : 0;
  return `Boss #${boss.number} · wave ${boss.wave} · ${pct}% HP · ${boss.furyCount} Fury out`;
}

export function FuryCatcherHome() {
  const [config, setConfig] = useState<FuryCatcherConfig | null>(null);
  const [status, setStatus] = useState<FuryCatcherStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);
  const [checkNowError, setCheckNowError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    Promise.all([storage.getFuryCatcherConfig(), storage.getFuryCatcherStatus()]).then(([c, s]) => {
      setConfig(c);
      setStatus(s);
      setLoaded(true);
    });

    // Background writes status after every chase/drink and can turn the
    // switch off itself (pause) — both reflected here live.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (STORAGE_KEYS.FURY_CATCHER_STATUS in changes) setStatus(changes[STORAGE_KEYS.FURY_CATCHER_STATUS].newValue ?? null);
      if (STORAGE_KEYS.FURY_CATCHER_CONFIG in changes) setConfig(changes[STORAGE_KEYS.FURY_CATCHER_CONFIG].newValue ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function saveConfig(next: FuryCatcherConfig) {
    setConfig(next);
    await storage.setFuryCatcherConfig(next);
  }

  async function toggleEnabled() {
    if (!config) return;
    const enabling = !config.enabled;
    await saveConfig({ ...config, enabled: enabling });
    if (enabling && status?.pausedReason) {
      const next = { ...status, pausedReason: null, pausedMessage: null, pausedAt: null };
      setStatus(next);
      await storage.setFuryCatcherStatus(next);
    }
  }

  function setNumber(field: 'energyFloor' | 'dailyDrinkCap', value: number, max: number) {
    if (!config || !Number.isFinite(value)) return;
    saveConfig({ ...config, [field]: Math.min(max, Math.max(0, Math.round(value))) });
  }

  async function checkNow() {
    setCheckingNow(true);
    setCheckNowError(null);
    try {
      const fresh = (await chrome.runtime.sendMessage({ type: 'fury-catcher-check-requested' })) as FuryCatcherStatus | null;
      setStatus(fresh);
    } catch (err) {
      console.error(LOG_PREFIX, 'fury catcher check-now failed', err);
      setCheckNowError('Could not reach the background service — try again in a moment.');
    } finally {
      setCheckingNow(false);
    }
  }

  if (!loaded || !config) return null;

  const nextRunAt = config.enabled ? status?.nextCheckAt ?? null : null;

  return (
    <>
      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Auto-Catch Fury</div>
          <div class="ff-toggle-row__status">
            {config.enabled ? `Chasing every ready Fury, keeping ${config.energyFloor} Energy spare.` : 'Off — nothing will run.'}
          </div>
        </div>
        <input type="checkbox" class="ff-toggle" checked={config.enabled} onChange={toggleEnabled} />
      </label>

      <div class="ff-field__hint">
        Chases each Fury the moment its cooldown ends (5 Energy a try, about 2 in 5 caught) and banks what it catches —
        firing them at the boss stays up to you. Runs in the background while the boss is up; waits out the respawn when
        it's down.
      </div>

      <button class="ff-archive-secondary" disabled={checkingNow} onClick={checkNow}>
        {checkingNow ? 'Checking…' : 'Check Now'}
      </button>
      {checkNowError && <div class="ff-health-alert__hint">{checkNowError}</div>}

      {status?.pausedReason && (
        <div class="ff-health-alert">
          <strong>{status.pausedReason === 'event-over' ? 'Fury Catcher finished' : 'Fury Catcher stopped'}</strong>
          <span class="ff-health-alert__hint">
            {status.pausedMessage && <>"{status.pausedMessage}"</>}
            {status.pausedReason === 'error' && (
              <>
                <br />
                Check the Halloween boss in-game, then flip Auto-Catch back on whenever you're ready.
              </>
            )}
          </span>
        </div>
      )}

      <div class="ff-section-label">Energy</div>

      <div class="ff-field">
        <div class="ff-field__label">Energy floor</div>
        <div class="ff-field__hint">Energy the catcher never spends, so it's there for your other things.</div>
        <input
          class="ff-select ff-field__control"
          type="number"
          min={0}
          max={100}
          value={config.energyFloor}
          onChange={(e) => setNumber('energyFloor', Number((e.target as HTMLInputElement).value), 100)}
        />
      </div>

      <div class="ff-field">
        <div class="ff-field__label">Energy Drinks per day</div>
        <div class="ff-field__hint">
          When Energy runs short and a Fury is ready, it drinks one (+10, two chases). Resets at 23:00 UTC. 0 = never.
        </div>
        <input
          class="ff-select ff-field__control"
          type="number"
          min={0}
          max={200}
          value={config.dailyDrinkCap}
          onChange={(e) => setNumber('dailyDrinkCap', Number((e.target as HTMLInputElement).value), 200)}
        />
      </div>

      <div class="ff-section-label">Status</div>

      {status?.note && config.enabled && <div class="ff-auto-row">{status.note}</div>}
      {status?.boss && <div class="ff-auto-row">{bossLine(status.boss, now)}</div>}

      <div class="ff-stat-grid">
        <div class="ff-stat-tile">
          <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-gold)' }}>{status?.bank ?? '—'}</div>
          <div class="ff-stat-tile__label">Fury Banked</div>
        </div>
        <div class="ff-stat-tile">
          <div class="ff-stat-tile__value ff-mono">{nextRunAt ? formatNextRun(nextRunAt, now) : '—'}</div>
          <div class="ff-stat-tile__label">Next Check</div>
        </div>
        <div class="ff-stat-tile">
          <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>
            {status?.today.caught ?? 0} / {status?.today.chases ?? 0}
          </div>
          <div class="ff-stat-tile__label">Caught Today</div>
        </div>
        <div class="ff-stat-tile">
          <div class="ff-stat-tile__value ff-mono">
            {status?.today.drinksUsed ?? 0} / {config.dailyDrinkCap}
          </div>
          <div class="ff-stat-tile__label">Drinks Today</div>
        </div>
        <div class="ff-stat-tile">
          <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>
            {status?.lifetime.caught ?? 0} / {status?.lifetime.chases ?? 0}
          </div>
          <div class="ff-stat-tile__label">Caught All-Time</div>
        </div>
        <div class="ff-stat-tile">
          <div class="ff-stat-tile__value ff-mono">{status?.lifetime.drinksUsed ?? 0}</div>
          <div class="ff-stat-tile__label">Drinks All-Time</div>
        </div>
      </div>

      {status?.lastChase && (
        <div class="ff-fc-captured">
          Last chase: {status.lastChase.won ? 'caught' : 'got away'}
          {status.lastChase.treatName && <> · found {status.lastChase.treatName}</>} ·{' '}
          {new Date(status.lastChase.timestamp).toLocaleString()}
        </div>
      )}
    </>
  );
}
