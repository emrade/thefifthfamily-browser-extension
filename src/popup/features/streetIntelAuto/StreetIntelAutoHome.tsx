import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { ALARM_NAMES, STORAGE_KEYS } from '@/shared/constants';
import type { ComplicationChoiceKey, StreetIntelAutoConfig, StreetIntelAutoStatus } from '@/shared/types';

const COMPLICATION_KEYS: ComplicationChoiceKey[] = ['fight', 'run', 'talk'];

/** e.g. "4:15 PM · in 3:42" — same format as CareerAutoHome's, clock time
 *  first, ticking countdown after. Drops the countdown once due. */
function formatNextRun(nextRunAt: number, now: number): string {
  const clock = new Date(nextRunAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const remainingSeconds = Math.max(0, Math.round((nextRunAt - now) / 1000));
  if (remainingSeconds === 0) return `${clock} · due now`;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${clock} · in ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function localDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function riskLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export function StreetIntelAutoHome() {
  const [config, setConfig] = useState<StreetIntelAutoConfig | null>(null);
  const [status, setStatus] = useState<StreetIntelAutoStatus | null>(null);
  const [now, setNow] = useState(Date.now());
  const [nextAlarmAt, setNextAlarmAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([storage.getStreetIntelAutoConfig(), storage.getStreetIntelAutoStatus()]).then(([c, s]) => {
      setConfig(c);
      setStatus(s);
      setLoaded(true);
    });

    // Background writes a fresh status on every attempt — reflected here
    // live, without polling, same as CareerAutoHome.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (STORAGE_KEYS.STREET_INTEL_AUTO_STATUS in changes) setStatus(changes[STORAGE_KEYS.STREET_INTEL_AUTO_STATUS].newValue ?? null);
      if (STORAGE_KEYS.STREET_INTEL_AUTO_CONFIG in changes) setConfig(changes[STORAGE_KEYS.STREET_INTEL_AUTO_CONFIG].newValue ?? null);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // Same "only tick while automation is on" reasoning as CareerAutoHome.
  useEffect(() => {
    if (!config?.enabled) {
      setNextAlarmAt(null);
      return;
    }
    const tick = () => {
      setNow(Date.now());
      chrome.alarms.get(ALARM_NAMES.STREET_INTEL_AUTO).then((alarm) => setNextAlarmAt(alarm?.scheduledTime ?? null));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [config?.enabled]);

  const nextRunAt = config?.enabled ? (status?.nextEligibleAt ?? nextAlarmAt) : null;
  const attemptsToday = status?.attemptsTodayDate === localDateKey() ? status.attemptsToday : 0;

  async function saveConfig(next: StreetIntelAutoConfig) {
    setConfig(next);
    await storage.setStreetIntelAutoConfig(next);
  }

  async function toggleEnabled() {
    if (!config) return;
    const enabling = !config.enabled;
    await saveConfig({ ...config, enabled: enabling });
    if (enabling && status?.pausedReason) {
      const next = { ...status, pausedReason: null, pausedMessage: null, pausedAt: null };
      setStatus(next);
      await storage.setStreetIntelAutoStatus(next);
    }
  }

  function setMinSuccessPct(value: number) {
    if (!config || !Number.isFinite(value)) return;
    saveConfig({ ...config, minSuccessPct: Math.min(100, Math.max(0, Math.round(value))) });
  }

  if (!loaded || !config) return null;

  return (
    <>
      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Auto-Attempt</div>
          <div class="ff-toggle-row__status">
            {config.enabled
              ? `Running whenever the best scouted approach clears ${config.minSuccessPct}%.`
              : 'Off — nothing will run.'}
          </div>
        </div>
        <input type="checkbox" class="ff-toggle" checked={config.enabled} onChange={toggleEnabled} />
      </label>

      {status?.pausedReason && (
        <div class="ff-health-alert">
          <strong>Street Intel auto-runner stopped</strong>
          <span class="ff-health-alert__hint">
            Stopped after an unexpected response from the game.
            {status.pausedMessage && (
              <>
                <br />"{status.pausedMessage}"
              </>
            )}
            <br />
            Check Street Intel in-game, then flip Auto-Attempt back on above whenever you're ready.
          </span>
        </div>
      )}

      <div class="ff-section-label">Risk</div>

      <div class="ff-field">
        <div class="ff-field__label">Minimum scouted success %</div>
        <div class="ff-field__hint">
          Every opportunity is scouted first — this skips one entirely (no attempt spent) if its best approach
          doesn't clear this floor, regardless of risk tier. All risk tiers are otherwise eligible.
        </div>
        <input
          class="ff-select ff-field__control"
          type="number"
          min={0}
          max={100}
          value={config.minSuccessPct}
          onChange={(e) => setMinSuccessPct(Number((e.target as HTMLInputElement).value))}
        />
      </div>

      <div class="ff-section-label">Status</div>

      {!status?.lastAttempt && !nextRunAt && <div class="ff-empty">No attempts run yet.</div>}

      {!status?.lastAttempt && nextRunAt && (
        <div class="ff-auto-row">First eligibility check: {formatNextRun(nextRunAt, now)}</div>
      )}

      {status?.lastAttempt && (
        <>
          <div class="ff-stat-grid">
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">{status.lastAttempt.outcomeBand || '—'}</div>
              <div class="ff-stat-tile__label">Last Result</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>${status.lastAttempt.reward.toLocaleString()}</div>
              <div class="ff-stat-tile__label">Reward</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">{attemptsToday}</div>
              <div class="ff-stat-tile__label">Attempts Today</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">{nextRunAt ? formatNextRun(nextRunAt, now) : '—'}</div>
              <div class="ff-stat-tile__label">Next Check</div>
            </div>
          </div>
          <div class="ff-fc-captured">
            {status.lastAttempt.opportunityTitle} ({riskLabel(status.lastAttempt.riskTier)}
            {status.lastAttempt.legendary ? ', Legendary' : ''}) — {status.lastAttempt.approach} at{' '}
            {status.lastAttempt.scoutedPct}% scouted · {new Date(status.lastAttempt.timestamp).toLocaleString()}
          </div>
          {status.lastAttempt.jailSeconds > 0 && (
            <div class="ff-auto-row">Landed {Math.round(status.lastAttempt.jailSeconds / 60)}m of jail time.</div>
          )}
          {status.lastAttempt.hadComplication && (
            <div class="ff-auto-row">
              Complication: chose {status.lastAttempt.complicationChoice}
              {status.lastAttempt.complicationSuccess === null
                ? ' (result unknown)'
                : status.lastAttempt.complicationSuccess
                  ? ' — succeeded'
                  : ' — failed'}
            </div>
          )}
        </>
      )}

      {status?.lastCycleScouted && status.lastCycleScouted.length > 0 && (
        <>
          <div class="ff-section-label">Last Cycle Scouted</div>
          <div class="ff-field__hint">
            Every opportunity the last cycle actually scouted, in the order tried — including ones passed over for
            coming in under {config.minSuccessPct}%. {status.lastCycleAt && `As of ${new Date(status.lastCycleAt).toLocaleTimeString()}.`}
          </div>
          {status.lastCycleScouted.map((c, i) => (
            <div class="ff-auto-row" style={{ color: c.chosen ? 'var(--ff-green)' : undefined }} key={i}>
              {c.chosen ? '✓' : '✗'} {c.title} ({riskLabel(c.riskTier)}
              {c.legendary ? ', Legendary' : ''}) · {c.staminaCost}S · value {Math.round(c.valueRatio).toLocaleString()}/S ·{' '}
              {c.estimatePct === null ? 'scout rejected' : `${c.approach} ${c.estimatePct}%`}
            </div>
          ))}
        </>
      )}

      {status?.complicationStats &&
        COMPLICATION_KEYS.some((k) => status.complicationStats[k].direct.attempts + status.complicationStats[k].fallback.attempts > 0) && (
          <>
            <div class="ff-section-label">Complication History</div>
            <div class="ff-field__hint">
              Win rate per choice across every complication resolved so far — there's no odds data for any of these
              from the game itself, so this is the only way to eventually know which one actually wins more.
              "Direct" means the choice matched the attempt's own winning approach; "fallback" means it came from the
              steel_yourself second-best substitute — a weaker bet by construction, worth reading separately. Treat
              either as noise until it has a real sample (~15–20+) — see docs/street-intel-complication-tracking.md.
            </div>
            {COMPLICATION_KEYS.map((key) => {
              const s = status.complicationStats[key];
              const directPct = s.direct.attempts > 0 ? Math.round((s.direct.successes / s.direct.attempts) * 100) : null;
              const fallbackPct = s.fallback.attempts > 0 ? Math.round((s.fallback.successes / s.fallback.attempts) * 100) : null;
              if (s.direct.attempts === 0 && s.fallback.attempts === 0) return null;
              return (
                <div class="ff-auto-row" key={key}>
                  {key}: direct {s.direct.successes}/{s.direct.attempts}
                  {directPct !== null ? ` (${directPct}%)` : ''} · fallback {s.fallback.successes}/{s.fallback.attempts}
                  {fallbackPct !== null ? ` (${fallbackPct}%)` : ''}
                </div>
              );
            })}
          </>
        )}
    </>
  );
}
