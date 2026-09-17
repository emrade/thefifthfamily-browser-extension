import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { ALARM_NAMES, STORAGE_KEYS } from '@/shared/constants';
import type { ArenaAutoConfig, ArenaAutoStatus } from '@/shared/types';

/** Same format as CareerAutoHome/StreetIntelAutoHome's own "clock time first,
 *  ticking countdown after". */
function formatNextRun(nextRunAt: number, now: number): string {
  const clock = new Date(nextRunAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const remainingSeconds = Math.max(0, Math.round((nextRunAt - now) / 1000));
  if (remainingSeconds === 0) return `${clock} · due now`;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${clock} · in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function ArenaAutoHome() {
  const [config, setConfig] = useState<ArenaAutoConfig | null>(null);
  const [status, setStatus] = useState<ArenaAutoStatus | null>(null);
  const [now, setNow] = useState(Date.now());
  const [nextAlarmAt, setNextAlarmAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([storage.getArenaAutoConfig(), storage.getArenaAutoStatus()]).then(([c, s]) => {
      setConfig(c);
      setStatus(s);
      setLoaded(true);
    });

    // Background writes a fresh status on every cycle — reflected here
    // live, without polling, same as every other auto feature's own home.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (STORAGE_KEYS.ARENA_AUTO_STATUS in changes) setStatus(changes[STORAGE_KEYS.ARENA_AUTO_STATUS].newValue ?? null);
      if (STORAGE_KEYS.ARENA_AUTO_CONFIG in changes) setConfig(changes[STORAGE_KEYS.ARENA_AUTO_CONFIG].newValue ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // The shared alarm keeps running even with Auto-Attack off (the passive
  // watcher — see runner.ts's module doc), so this ticks unconditionally,
  // not just while `config.enabled`, unlike CareerAutoHome/StreetIntelAutoHome.
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      chrome.alarms.get(ALARM_NAMES.ARENA_AUTO).then((alarm) => setNextAlarmAt(alarm?.scheduledTime ?? null));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const nextRunAt = status?.nextUnlockAt ?? nextAlarmAt;

  async function saveConfig(next: ArenaAutoConfig) {
    setConfig(next);
    await storage.setArenaAutoConfig(next);
  }

  async function toggleEnabled() {
    if (!config) return;
    const enabling = !config.enabled;
    await saveConfig({ ...config, enabled: enabling });
    if (enabling && status?.pausedReason) {
      const next = { ...status, pausedReason: null, pausedMessage: null, pausedAt: null };
      setStatus(next);
      await storage.setArenaAutoStatus(next);
    }
  }

  function setBossWinPctThreshold(value: number) {
    if (!config || !Number.isFinite(value)) return;
    saveConfig({ ...config, bossWinPctThreshold: Math.min(100, Math.max(0, Math.round(value))) });
  }

  if (!loaded || !config) return null;

  return (
    <>
      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Auto-Attack</div>
          <div class="ff-toggle-row__status">
            {config.enabled
              ? `Running — attacks the riskiest opponent first, then the boss if it clears ${config.bossWinPctThreshold}%, then banks.`
              : 'Off — the page-ready reminder below still works without this.'}
          </div>
        </div>
        <input type="checkbox" class="ff-toggle" checked={config.enabled} onChange={toggleEnabled} />
      </label>

      {status?.pausedReason && (
        <div class="ff-health-alert">
          <strong>Arena Auto-Attack stopped</strong>
          <span class="ff-health-alert__hint">
            Stopped after an unexpected response from the game.
            {status.pausedMessage && (
              <>
                <br />"{status.pausedMessage}"
              </>
            )}
            <br />
            Check Arena in-game, then flip Auto-Attack back on above whenever you're ready.
          </span>
        </div>
      )}

      <div class="ff-section-label">Boss</div>

      <div class="ff-field">
        <div class="ff-field__label">Minimum boss win % to attack</div>
        <div class="ff-field__hint">
          The boss never shows its own win% in-game, but the server computes one anyway (confirmed real — see
          docs/game-mechanics.md's Arena section). Below this floor, the boss is skipped and the page is banked
          without it; at or above it, the boss gets attacked before banking, same as the four regular opponents.
        </div>
        <input
          class="ff-select ff-field__control"
          type="number"
          min={0}
          max={100}
          value={config.bossWinPctThreshold}
          onChange={(e) => setBossWinPctThreshold(Number((e.target as HTMLInputElement).value))}
        />
      </div>

      <div class="ff-section-label">Status</div>

      <div class="ff-auto-row">
        {nextRunAt ? (config.enabled ? `Next page: ${formatNextRun(nextRunAt, now)}` : `Next reminder check: ${formatNextRun(nextRunAt, now)}`) : 'Not scheduled yet.'}
      </div>

      {!status?.lastPage && <div class="ff-empty">No pages run yet.</div>}

      {status?.lastPage && (
        <>
          {!status.lastPage.complete && (
            <div class="ff-health-alert">
              <strong>Page {status.lastPage.pageNumber} is still in progress</strong>
              <span class="ff-health-alert__hint">
                Fights below happened for real — this just hasn't reached banking yet, whether it's still running or
                stopped partway through. Check the alert above if it's stopped.
              </span>
            </div>
          )}
          <div class="ff-stat-grid">
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">{status.lastPage.pageNumber}</div>
              <div class="ff-stat-tile__label">{status.lastPage.complete ? 'Last Page' : 'Current Page'}</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>
                +{status.lastPage.banked}
              </div>
              <div class="ff-stat-tile__label">Banked</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">{status.lastPage.seasonScore}</div>
              <div class="ff-stat-tile__label">Season Score</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">{status.pagesRun}</div>
              <div class="ff-stat-tile__label">Pages Run</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>
                {status.totalBanked}
              </div>
              <div class="ff-stat-tile__label">Total Banked</div>
            </div>
          </div>

          <div class="ff-section-label">Last Page Opponents</div>
          {status.lastPage.opponents.map((o, i) => (
            <div class="ff-auto-row" style={{ color: o.won ? 'var(--ff-green)' : undefined }} key={i}>
              {o.won ? '✓' : '✗'} {o.name} · {o.winPctAtAttack}% chance{o.won ? ` · +${o.bountyEarned}` : ''}
            </div>
          ))}

          {status.lastPage.boss && (
            <>
              <div class="ff-section-label">Last Page Boss</div>
              <div class="ff-auto-row" style={{ color: status.lastPage.boss.won ? 'var(--ff-green)' : undefined }}>
                {status.lastPage.boss.attacked
                  ? `${status.lastPage.boss.won ? '✓' : '✗'} ${status.lastPage.boss.name} · ${status.lastPage.boss.winPct}% chance`
                  : `Skipped — ${status.lastPage.boss.skippedReason}`}
              </div>
            </>
          )}

          <div class="ff-fc-captured">{new Date(status.lastPage.timestamp).toLocaleString()}</div>
        </>
      )}
    </>
  );
}
