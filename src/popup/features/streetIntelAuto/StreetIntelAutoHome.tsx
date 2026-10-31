import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { NumberInput } from '@/popup/views/NumberInput';
import { MoneyInput } from '@/popup/views/MoneyInput';
import { ALARM_NAMES, STORAGE_KEYS, STREET_INTEL_AUTO_MIN_CARD_STAMINA_RELEASE } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { formatFloor, streetIntelWaitingText } from '@/shared/streetIntelAutoDisplay';
import type { ComplicationChoiceKey, StreetIntelAutoConfig, StreetIntelAutoStatus } from '@/shared/types';
import { StreetIntelAnalyticsSection } from './StreetIntelAnalyticsSection';

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

const SCOUT_MODE_LABEL: Record<string, string> = { topPayout: 'Top 2 by payout', smart: 'Smart scouting' };
const COMPLICATION_MODE_LABEL: Record<string, string> = { reuse: 'reuse approach', avoidBlocked: 'avoid losing choices' };

function modeTallyLabel(key: string): string {
  const [scout, complication, big] = key.split('+');
  return `${SCOUT_MODE_LABEL[scout] ?? scout} · ${COMPLICATION_MODE_LABEL[complication] ?? complication}${big ? ' · card minimum' : ''}`;
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
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

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
      // Re-read rather than taking `newValue`: the getter migrates a config
      // saved before the minimum card value existed.
      if (STORAGE_KEYS.STREET_INTEL_AUTO_CONFIG in changes) void storage.getStreetIntelAutoConfig().then(setConfig);
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

  // The scheduled alarm is when the runner will actually check next. The
  // tracked cooldown is only a fallback for before the alarm is read:
  // preferring it showed "due now" for as long as jail, hospital or a
  // board with nothing worth attempting kept it in the past.
  const nextRunAt = config?.enabled ? (nextAlarmAt ?? status?.nextEligibleAt ?? null) : null;
  const waitingLine = config?.enabled ? streetIntelWaitingText(status?.waiting, config.minSuccessPct, now) : null;
  const attemptsToday = status?.attemptsTodayDate === localDateKey() ? status.attemptsToday : 0;
  const cashToday = status?.attemptsTodayDate === localDateKey() ? (status.cashToday ?? 0) : 0;

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

  // One check right now, even with Auto-Attempt off — for a wait the runner
  // can't see end early (bailing out, a discharge, a Stamina refill).
  // Background also writes the status to storage; setting it from the
  // response too doesn't depend on that listener firing first.
  async function runNow() {
    setRunning(true);
    setRunError(null);
    try {
      const fresh = (await chrome.runtime.sendMessage({ type: 'street-intel-auto-run-requested' })) as StreetIntelAutoStatus | null;
      setStatus(fresh);
    } catch (err) {
      console.error(LOG_PREFIX, 'street intel run-now failed', err);
      setRunError('Could not reach the background service — try again in a moment.');
    } finally {
      setRunning(false);
    }
  }

  function setMinSuccessPct(value: number) {
    if (!config || !Number.isFinite(value)) return;
    saveConfig({ ...config, minSuccessPct: Math.min(100, Math.max(0, Math.round(value))) });
  }

  function setOddsMode(mode: StreetIntelAutoConfig['oddsMode']) {
    if (!config) return;
    saveConfig({ ...config, oddsMode: mode });
  }

  function setScoutMode(smart: boolean) {
    if (!config) return;
    saveConfig({ ...config, scoutMode: smart ? 'smart' : 'topPayout' });
  }

  function setMinCardValue(value: number) {
    if (!config) return;
    saveConfig({ ...config, minCardValue: value });
  }

  function setExtremeMinEnabled(on: boolean) {
    if (!config) return;
    saveConfig({ ...config, extremeMinEnabled: on });
  }

  function setExtremeMinValue(value: number) {
    if (!config) return;
    saveConfig({ ...config, extremeMinValue: value });
  }

  function applySuggestedMinimum(value: number) {
    if (!config) return;
    saveConfig({ ...config, minCardValue: value });
  }

  function applySuggestedExtreme(value: number) {
    if (!config) return;
    saveConfig(value > 0 ? { ...config, extremeMinEnabled: true, extremeMinValue: value } : { ...config, extremeMinEnabled: false });
  }

  function setComplicationMode(avoidBlocked: boolean) {
    if (!config) return;
    saveConfig({ ...config, complicationMode: avoidBlocked ? 'avoidBlocked' : 'reuse' });
  }

  if (!loaded || !config) return null;

  const modeTallies = Object.entries(status?.modeTallies ?? {}).filter(([, t]) => t.cycles > 0);

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

      <button class="ff-archive-secondary" disabled={running} onClick={runNow}>
        {running ? 'Running…' : 'Run Now'}
      </button>
      <div class="ff-field__hint">
        Runs one check right now, even with Auto-Attempt off. Handy after bailing out early or refilling Stamina.
      </div>
      {runError && <div class="ff-health-alert__hint">{runError}</div>}

      <div class="ff-section-label">Risk</div>

      <div class="ff-field">
        <div class="ff-field__label">Minimum scouted success %</div>
        <div class="ff-field__hint">
          Opportunities are scouted before attempting — this skips one entirely (no attempt spent) if its best approach
          doesn't clear this floor, regardless of risk tier. All risk tiers are otherwise eligible.
        </div>
        <NumberInput
          class="ff-select ff-field__control"
          min={0}
          max={100}
          value={config.minSuccessPct}
          onCommit={setMinSuccessPct}
        />
      </div>

      <div class="ff-field">
        <div class="ff-field__label">Odds source</div>
        <div class="ff-field__hint">
          "Revealed only" ranks and attempts strictly the approach(es) the scout gave real numbers for — a card whose
          only revealed approach misses the floor above just gets skipped, even if a hidden approach might have been
          great. "Computed" also scores every other (hidden) approach on the same card using the exact formula from
          that same scout's real base odds — worst case ~3 points off, and it can win the ranking and get attempted
          directly.
        </div>
        <select
          class="ff-select ff-field__control"
          value={config.oddsMode}
          onChange={(e) => setOddsMode((e.target as HTMLSelectElement).value as StreetIntelAutoConfig['oddsMode'])}
        >
          <option value="revealed">Revealed only (safe, default)</option>
          <option value="computed">Computed (includes hidden approaches)</option>
        </select>
      </div>

      <div class="ff-section-label">Strategy</div>

      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Smart scouting</div>
          <div class="ff-toggle-row__status">
            {config.scoutMode === 'smart'
              ? 'Only scouts cards that could still beat the best one found so far.'
              : 'Off — scouts the 2 highest-paying cards each cycle.'}
          </div>
        </div>
        <input type="checkbox" class="ff-toggle" checked={config.scoutMode === 'smart'} onChange={(e) => setScoutMode((e.target as HTMLInputElement).checked)} />
      </label>

      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Smart complication choices</div>
          <div class="ff-toggle-row__status">
            {config.complicationMode === 'avoidBlocked'
              ? "Avoids a choice that has never won in that complication's scenario."
              : 'Off — reuses the attempt approach (steel_yourself falls back by win rate).'}
          </div>
        </div>
        <input
          type="checkbox"
          class="ff-toggle"
          checked={config.complicationMode === 'avoidBlocked'}
          onChange={(e) => setComplicationMode((e.target as HTMLInputElement).checked)}
        />
      </label>

      <div class="ff-field">
        <div class="ff-field__label">Minimum card value ($)</div>
        <div class="ff-field__hint">
          Cards worth less are skipped and not scouted, so Stamina is saved for bigger ones — they pay far more per
          Stamina. Compared with the middle of a card's pay range: at 750,000, "$600k – $1M" counts and "$500k – $900k"
          doesn't. Once Stamina is {Math.round(STREET_INTEL_AUTO_MIN_CARD_STAMINA_RELEASE * 100)}% full it takes any card, so regen isn't wasted. 0 means no
          minimum. See the suggested value under Analytics below.
        </div>
        <MoneyInput class="ff-select ff-field__control" value={config.minCardValue} onCommit={setMinCardValue} />
      </div>

      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Extreme cards need more</div>
          <div class="ff-toggle-row__status">
            {config.extremeMinEnabled
              ? `Extreme cards need ${formatFloor(Math.max(config.minCardValue, config.extremeMinValue))}+.`
              : 'Off — extreme cards use the same minimum as the rest.'}
          </div>
        </div>
        <input
          type="checkbox"
          class="ff-toggle"
          checked={config.extremeMinEnabled}
          onChange={(e) => setExtremeMinEnabled((e.target as HTMLInputElement).checked)}
        />
      </label>

      <div class="ff-field">
        <div class="ff-field__label">Extreme card minimum ($)</div>
        <div class="ff-field__hint">
          Extreme cards fail about 40% of the time at every size, but under $1M they paid no more per Stamina than
          high-risk cards that fail half as often (Aug 10 – Oct 30, 142 attempts). Used while the switch above is on.
        </div>
        <MoneyInput class="ff-select ff-field__control" value={config.extremeMinValue} onCommit={setExtremeMinValue} />
      </div>

      {modeTallies.length > 0 && (
        <>
          <div class="ff-field__hint">
            Live results per strategy combination, since it was first used. Net per Stamina (after complication losses,
            scouting included) is the number to compare — Street Intel is limited by Stamina, not cooldown.
          </div>
          {modeTallies.map(([key, t]) => {
            const stamina = t.scoutStamina + t.attemptStamina;
            const netPerStamina = stamina > 0 ? Math.round((t.gross - t.cashLost) / stamina) : null;
            return (
              <div class="ff-auto-row" key={key}>
                {modeTallyLabel(key)}: {t.attempts} attempts · net ${(t.gross - t.cashLost).toLocaleString()}
                {netPerStamina !== null ? ` · $${netPerStamina.toLocaleString()}/S` : ''} · scouting{' '}
                {stamina > 0 ? Math.round((t.scoutStamina / stamina) * 100) : 0}% of Stamina
                {t.complications > 0 ? ` · complications ${t.complicationWins}/${t.complications}` : ''}
              </div>
            );
          })}
        </>
      )}

      <div class="ff-section-label">Analytics</div>
      <StreetIntelAnalyticsSection config={config} status={status} onApplyMinimum={applySuggestedMinimum} onApplyExtreme={applySuggestedExtreme} />

      <div class="ff-section-label">Status</div>

      {waitingLine && <div class="ff-auto-row">{waitingLine}</div>}

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
              <div class="ff-stat-tile__value ff-mono" style={{ color: 'var(--ff-green)' }}>${cashToday.toLocaleString()}</div>
              <div class="ff-stat-tile__label">Earned Today</div>
            </div>
            <div class="ff-stat-tile">
              <div class="ff-stat-tile__value ff-mono">{nextRunAt ? formatNextRun(nextRunAt, now) : '—'}</div>
              <div class="ff-stat-tile__label">Next Check</div>
            </div>
          </div>
          <div class="ff-fc-captured">
            {status.lastAttempt.opportunityTitle} ({riskLabel(status.lastAttempt.riskTier)}
            {status.lastAttempt.legendary ? ', Legendary' : ''}) — {status.lastAttempt.approach} at{' '}
            {status.lastAttempt.scoutedPct}%{status.lastAttempt.pctSource === 'computed' ? ' (computed)' : ' scouted'} ·{' '}
            {new Date(status.lastAttempt.timestamp).toLocaleString()}
          </div>
          {status.lastAttempt.jailSeconds > 0 && (
            <div class="ff-auto-row">Landed {Math.round(status.lastAttempt.jailSeconds / 60)}m of jail time.</div>
          )}
          {status.lastAttempt.hadComplication && (
            <div class="ff-auto-row">
              Complication: chose {status.lastAttempt.complicationChoice}
              {status.lastAttempt.complicationAvoided ? ` (avoided ${status.lastAttempt.complicationAvoided})` : ''}
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
            {config.oddsMode === 'computed' && ' "≈" marks a computed (not scout-revealed) estimate; "→" marks the pick.'}
            {(status.lastCycleSkipped ?? 0) > 0 &&
              ` ${status.lastCycleSkipped} more affordable card${status.lastCycleSkipped === 1 ? '' : 's'} left unscouted${config.scoutMode === 'smart' ? ' — none could beat the pick' : ' (outside the top 2 by payout)'}.`}
          </div>
          {status.lastCycleScouted.map((c, i) => {
            // `approaches` is new (2026-09-06) — a `lastCycleScouted` entry
            // written by an older build before this field existed is still
            // sitting in storage as-is until the next cycle overwrites it
            // (unlike `StreetIntelAutoConfig`, `StreetIntelAutoStatus` isn't
            // merged with defaults on read), so this can't assume it exists.
            const approaches = c.approaches ?? [];
            return (
              <div class="ff-auto-row" style={{ color: c.chosen ? 'var(--ff-green)' : undefined }} key={i}>
                {c.chosen ? '✓' : '✗'} {c.title} ({riskLabel(c.riskTier)}
                {c.legendary ? ', Legendary' : ''}) · {c.staminaCost}S · value {Math.round(c.valueRatio).toLocaleString()}/S ·{' '}
                {approaches.length > 0
                  ? approaches
                      .map((a) => `${a.key === c.approach ? '→' : ''}${a.key} ${a.estimatePct}%${a.source === 'computed' ? '≈' : ''}`)
                      .join(' · ')
                  : c.estimatePct === null
                    ? 'scout rejected'
                    : `${c.approach} ${c.estimatePct}%`}
              </div>
            );
          })}
        </>
      )}

      {status?.complicationStats &&
        COMPLICATION_KEYS.some((k) => status.complicationStats[k].direct.attempts + status.complicationStats[k].fallback.attempts > 0) && (
          <>
            <div class="ff-section-label">Complication History</div>
            <div class="ff-field__hint">
              Win rate per choice across every complication resolved so far — there's no odds data for any of these
              from the game itself, so this is the only way to eventually know which one actually wins more.
              "Direct" means the choice matched the attempt's own winning approach; "fallback" means steel_yourself won
              instead (it has no complication equivalent of its own) and this choice was substituted in — a weaker bet
              by construction, worth reading separately. Treat either as noise until it has a real sample (~15–20+) —
              see docs/street-intel-complication-tracking.md.
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
