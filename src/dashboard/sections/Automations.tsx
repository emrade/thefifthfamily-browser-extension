import { useEffect, useState } from 'preact/hooks';
import { STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { AUTOMATION_FEATURE_LABELS } from '@/shared/automationLabels';
import type { ExtensionMessage } from '@/shared/messaging';
import type { AutomationQueueLogEntry, AutomationScheduleItem, AutomationScheduleSnapshot } from '@/shared/types';

/**
 * Dashboard → Automations: what the background automations are doing and,
 * with the Automation Queue on, how it spaced them out. Read-only apart from
 * the queue's own switch. See docs/automation-queue.md.
 */

const SCHEDULE_REFRESH_MS = 2_000;
const RECENT_ROWS = 60;
const HOUR_MS = 3_600_000;

/** The game day starts 23:00 UTC (player midnight, WAT). */
function gameDayStart(now: number): number {
  const shifted = now + HOUR_MS;
  return shifted - (shifted % (24 * HOUR_MS)) - HOUR_MS;
}

function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function until(at: number, now: number): string {
  const ms = at - now;
  if (ms <= 0) return 'due now';
  return `in ${duration(ms)}`;
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const STATE_TEXT: Record<AutomationScheduleItem['state'], string> = {
  running: 'Running now',
  waiting: 'Waiting its turn',
  scheduled: 'Next check',
  off: 'Off',
};

const OUTCOME_TEXT: Record<AutomationQueueLogEntry['outcome'], string> = {
  ok: 'Ran',
  error: 'Stopped with an error',
  'forced-wait': 'Waited the maximum, went ahead',
  skipped: 'Skipped (queue busy)',
};

function useSchedule(): AutomationScheduleSnapshot | null {
  const [snap, setSnap] = useState<AutomationScheduleSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      const msg: ExtensionMessage = { type: 'automation-schedule-requested' };
      chrome.runtime
        .sendMessage(msg)
        .then((s: AutomationScheduleSnapshot) => alive && setSnap(s))
        .catch((err) => console.error(LOG_PREFIX, 'automation schedule read failed', err));
    };
    load();
    const timer = setInterval(load, SCHEDULE_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return snap;
}

function useQueueLog(): AutomationQueueLogEntry[] {
  const [log, setLog] = useState<AutomationQueueLogEntry[]>([]);
  useEffect(() => {
    storage.getAutomationQueueLog().then(setLog);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && STORAGE_KEYS.AUTOMATION_QUEUE_LOG in changes) {
        setLog((changes[STORAGE_KEYS.AUTOMATION_QUEUE_LOG].newValue as AutomationQueueLogEntry[] | undefined) ?? []);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  return log;
}

/** Ticks once a second so "in 2m 10s" counts down between refreshes. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function QueueSwitch({ enabled }: { enabled: boolean }) {
  return (
    <label class="db-switch">
      <div>
        <div class="db-switch__title">Automation Queue</div>
        <div class="db-switch__hint">
          {enabled
            ? 'On: automations take turns, one at a time, with a 3–8 s gap.'
            : 'Off: automations run exactly as before. Turn on to make them take turns.'}
        </div>
      </div>
      <input
        type="checkbox"
        class="db-toggle"
        checked={enabled}
        onChange={() => void storage.setAutomationQueueConfig({ enabled: !enabled })}
      />
    </label>
  );
}

function ComingUp({ snap, now }: { snap: AutomationScheduleSnapshot; now: number }) {
  return (
    <section class="db-card">
      <h2 class="db-h">Now and coming up</h2>
      <ul class="db-list">
        {snap.items.map((item) => (
          <li class={`db-row db-row--${item.state}`} key={item.feature}>
            <span class="db-dot" aria-hidden="true" />
            <span class="db-row__name">{AUTOMATION_FEATURE_LABELS[item.feature]}</span>
            <span class="db-row__state">
              {item.state === 'scheduled' && item.nextAt !== null
                ? `${STATE_TEXT.scheduled} ${until(item.nextAt, now)} · ${clock(item.nextAt)}`
                : item.state === 'scheduled'
                  ? 'On, no check scheduled yet'
                  : item.state === 'running' && snap.holder?.feature === item.feature
                    ? `${STATE_TEXT.running} · ${duration(now - snap.holder.startedAt)}`
                    : STATE_TEXT[item.state]}
            </span>
          </li>
        ))}
      </ul>
      <p class="db-note">A check can find nothing to do (e.g. no Street Intel card worth taking). Garage, Inventory, Street Racing and achievement claims only appear while they run.</p>
    </section>
  );
}

function TodayStats({ log, now }: { log: AutomationQueueLogEntry[]; now: number }) {
  const today = log.filter((e) => e.endedAt >= gameDayStart(now));
  const turns = today.filter((e) => e.outcome !== 'skipped');
  const waited = turns.filter((e) => e.waitedMs >= 1000);
  const totalWait = waited.reduce((s, e) => s + e.waitedMs, 0);
  const longest = waited.reduce((m, e) => Math.max(m, e.waitedMs), 0);
  const stats: [string, string][] = [
    ['Turns today', String(turns.length)],
    ['Had to wait', String(waited.length)],
    ['Total waiting', duration(totalWait)],
    ['Longest wait', waited.length ? duration(longest) : '—'],
    ['Price checks skipped', String(today.filter((e) => e.outcome === 'skipped').length)],
    ['Forced / errors', `${today.filter((e) => e.outcome === 'forced-wait' || e.tookOverStale).length} / ${today.filter((e) => e.outcome === 'error').length}`],
  ];
  return (
    <section class="db-card">
      <h2 class="db-h">Queue today</h2>
      <div class="db-stats">
        {stats.map(([label, value]) => (
          <div class="db-stat" key={label}>
            <div class="db-stat__value">{value}</div>
            <div class="db-stat__label">{label}</div>
          </div>
        ))}
      </div>
      <p class="db-note">Since the game's daily reset (23:00 UTC). Only counted while the queue is on.</p>
    </section>
  );
}

function Recent({ log }: { log: AutomationQueueLogEntry[] }) {
  const rows = log.slice(-RECENT_ROWS).reverse();
  return (
    <section class="db-card db-card--wide">
      <h2 class="db-h">Recent activity</h2>
      {rows.length === 0 ? (
        <p class="db-empty">Nothing yet. Each automation's turn shows up here once the Automation Queue is on.</p>
      ) : (
        <table class="db-table">
          <thead>
            <tr>
              <th>Finished</th>
              <th>Automation</th>
              <th>Waited</th>
              <th>Ran for</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={`${e.endedAt}-${i}`} class={e.outcome === 'ok' ? '' : `db-tr--${e.outcome}`}>
                <td class="db-mono">{clock(e.endedAt)}</td>
                <td>{AUTOMATION_FEATURE_LABELS[e.feature] ?? e.feature}</td>
                <td class="db-mono">{e.waitedMs >= 1000 ? duration(e.waitedMs) : '—'}</td>
                <td class="db-mono">{e.startedAt !== null ? duration(e.endedAt - e.startedAt) : '—'}</td>
                <td>
                  {OUTCOME_TEXT[e.outcome]}
                  {e.tookOverStale ? ` (took over from ${AUTOMATION_FEATURE_LABELS[e.tookOverStale]})` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function AutomationsSection() {
  const snap = useSchedule();
  const log = useQueueLog();
  const now = useNow();

  if (!snap) return <p class="db-empty">Loading…</p>;
  return (
    <>
      <QueueSwitch enabled={snap.queueEnabled} />
      <div class="db-grid">
        <ComingUp snap={snap} now={now} />
        <TodayStats log={log} now={now} />
        <Recent log={log} />
      </div>
    </>
  );
}
