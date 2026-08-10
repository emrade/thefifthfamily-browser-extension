import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { db, clearRequestLog } from '@/shared/db';
import { LOG_PREFIX } from '@/shared/log';
import { DEFAULT_REQUEST_LOG_PREFERENCES, RETENTION_CHOICES, type RequestLogPreferences } from '@/shared/requestLog/preferences';
import { readStats, recomputeStats, resetStats, type RequestLogStats } from '@/shared/requestLog/stats';
import { buildArchiveBlob, buildShapeDigest, listEndpoints, type EndpointSummary } from '@/shared/requestLog/exportRequestLog';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Windows offered for a filtered export. 0 means no lower bound. */
const WINDOWS: { label: string; ms: number }[] = [
  { label: 'Last 24 hours', ms: DAY_MS },
  { label: 'Last 3 days', ms: 3 * DAY_MS },
  { label: 'Last 7 days', ms: 7 * DAY_MS },
  { label: 'Last 30 days', ms: 30 * DAY_MS },
  { label: 'All time', ms: 0 },
];

/** Summary of the shape index, kept separate from the byte stats because it
 *  answers a different question — not "how big" but "has anything changed". */
interface ShapeSummary {
  endpoints: number;
  changedEndpoints: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function formatDate(ms: number | null): string {
  return ms == null ? '—' : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Deferred rather than revoked immediately: Firefox aborts the download if the
  // object URL is released before it has actually started reading from it, which
  // an archive blob large enough to matter reliably hits.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function RequestLogSettings() {
  const [prefs, setPrefs] = useState<RequestLogPreferences>(DEFAULT_REQUEST_LOG_PREFERENCES);
  const [stats, setStats] = useState<RequestLogStats | null>(null);
  const [shapes, setShapes] = useState<ShapeSummary | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [windowMs, setWindowMs] = useState<number>(3 * DAY_MS);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const [nextPrefs, nextStats, allShapes, nextEndpoints] = await Promise.all([
      storage.getRequestLogPreferences(),
      readStats(),
      db.endpointShapes.toArray(),
      listEndpoints(),
    ]);
    setEndpoints(nextEndpoints);

    const byEndpoint = new Map<string, number>();
    for (const shape of allShapes) {
      byEndpoint.set(shape.endpoint, (byEndpoint.get(shape.endpoint) ?? 0) + 1);
    }

    setPrefs(nextPrefs);
    setStats(nextStats);
    setShapes({
      endpoints: byEndpoint.size,
      // More than one recorded shape means the endpoint's response structure has
      // changed at least once since capture began — the signal this whole index
      // exists to surface.
      changedEndpoints: [...byEndpoint.entries()].filter(([, count]) => count > 1).map(([endpoint]) => endpoint),
    });
    setLoaded(true);
  }

  useEffect(() => {
    refresh().catch((err) => console.error(LOG_PREFIX, 'failed to load request log settings', err));
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    try {
      await action();
    } catch (err) {
      console.error(LOG_PREFIX, `${label} failed`, err);
    } finally {
      setBusy(null);
    }
  }

  async function savePrefs(next: RequestLogPreferences) {
    setPrefs(next);
    await storage.setRequestLogPreferences(next);
  }

  /**
   * Approximate size of the current selection, for the button label.
   *
   * Deliberately an estimate rather than a real measurement: knowing the exact
   * figure would mean running the same indexed range scan the export itself does,
   * on every checkbox click. The average is derived from the archive's own stored
   * bytes, so it tracks the real compression ratio rather than a hardcoded guess,
   * and the label is prefixed with "~" because per-endpoint sizes do vary.
   */
  function estimateSelectionBytes(): number {
    if (!stats || stats.rows === 0) return 0;
    const avgPerRow = stats.storedBytes / stats.rows;

    const selectedRows = endpoints
      .filter((summary) => selected.has(summary.endpoint))
      .reduce((sum, summary) => sum + summary.rows, 0);

    // Rows are assumed evenly spread across the archive's span, which is close
    // enough for a size hint — the pollers fire on fixed schedules.
    const span =
      stats.oldestTimestamp != null && stats.newestTimestamp != null
        ? stats.newestTimestamp - stats.oldestTimestamp
        : 0;
    const fraction = windowMs === 0 || span === 0 ? 1 : Math.min(1, windowMs / span);

    return Math.round(selectedRows * fraction * avgPerRow);
  }

  if (!loaded || !stats || !shapes) return null;

  const savedPct = stats.rawBytes > 0 ? Math.round((1 - stats.storedBytes / stats.rawBytes) * 100) : 0;

  return (
    <>
      <div class="ff-section-label">HTTP Archive</div>

      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Record Game Traffic</div>
          <div class="ff-toggle-row__status">
            Stores every request the game makes, compressed, so mechanics can be re-derived and changes spotted.
          </div>
        </div>
        <input
          type="checkbox"
          class="ff-toggle"
          checked={prefs.enabled}
          onChange={() => savePrefs({ ...prefs, enabled: !prefs.enabled })}
        />
      </label>

      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Keep History For</div>
          <div class="ff-toggle-row__status">Older requests are deleted automatically. Shape history is always kept.</div>
        </div>
        <select
          class="ff-select"
          value={String(prefs.retentionDays)}
          onChange={(e) => savePrefs({ ...prefs, retentionDays: Number((e.target as HTMLSelectElement).value) })}
        >
          {RETENTION_CHOICES.map((days) => (
            <option key={days} value={String(days)}>{days} days</option>
          ))}
        </select>
      </label>

      <div class="ff-archive-stats">
        <div class="ff-archive-stat">
          <div class="ff-archive-stat__value">{stats.rows.toLocaleString()}</div>
          <div class="ff-archive-stat__label">requests</div>
        </div>
        <div class="ff-archive-stat">
          <div class="ff-archive-stat__value">{formatBytes(stats.storedBytes)}</div>
          <div class="ff-archive-stat__label">on disk{savedPct > 0 ? ` · ${savedPct}% saved` : ''}</div>
        </div>
        <div class="ff-archive-stat">
          <div class="ff-archive-stat__value">{shapes.endpoints}</div>
          <div class="ff-archive-stat__label">endpoints</div>
        </div>
      </div>

      <div class="ff-archive-window">
        {stats.rows > 0 ? `Covering ${formatDate(stats.oldestTimestamp)} – ${formatDate(stats.newestTimestamp)}` : 'Nothing captured yet — open the game to start recording.'}
      </div>

      {shapes.changedEndpoints.length > 0 && (
        <div class="ff-archive-alert">
          <strong>{shapes.changedEndpoints.length} endpoint{shapes.changedEndpoints.length === 1 ? '' : 's'} changed shape</strong>
          <ul class="ff-archive-alert__list">
            {shapes.changedEndpoints.slice(0, 5).map((endpoint) => (
              <li key={endpoint}>{endpoint}</li>
            ))}
          </ul>
          <span class="ff-archive-alert__hint">Download the shape digest for the exact token diff.</span>
        </div>
      )}

      <button
        class="ff-export-trigger"
        disabled={busy !== null}
        onClick={() =>
          run('shape digest', async () => {
            const json = await buildShapeDigest();
            download(new Blob([json], { type: 'application/json' }), `fifth-family-shapes-${timestamp()}.json`);
          })
        }
      >
        {busy === 'shape digest' ? 'Preparing…' : 'Download Shape Digest (small)'}
      </button>

      {endpoints.length > 0 && (
        <div class="ff-archive-picker">
          <div class="ff-archive-picker__title">Export Selected Endpoints</div>

          {endpoints.map((summary) => (
            <label class="ff-archive-endpoint" key={summary.endpoint}>
              <input
                type="checkbox"
                checked={selected.has(summary.endpoint)}
                onChange={() => {
                  const next = new Set(selected);
                  if (next.has(summary.endpoint)) next.delete(summary.endpoint);
                  else next.add(summary.endpoint);
                  setSelected(next);
                }}
              />
              <span class="ff-archive-endpoint__name">{summary.endpoint}</span>
              <span class="ff-archive-endpoint__rows">{summary.rows.toLocaleString()}</span>
            </label>
          ))}

          <select
            class="ff-select ff-archive-picker__window"
            value={String(windowMs)}
            onChange={(e) => setWindowMs(Number((e.target as HTMLSelectElement).value))}
          >
            {WINDOWS.map((w) => (
              <option key={w.label} value={String(w.ms)}>{w.label}</option>
            ))}
          </select>

          <button
            class="ff-export-trigger"
            disabled={busy !== null || selected.size === 0}
            onClick={() =>
              run('selection', async () => {
                const blob = await buildArchiveBlob({
                  endpoints: [...selected],
                  sinceMs: windowMs === 0 ? 0 : Date.now() - windowMs,
                });
                download(blob, `fifth-family-selection-${timestamp()}.ndjson.gz`);
              })
            }
          >
            {busy === 'selection'
              ? 'Compressing…'
              : selected.size === 0
                ? 'Select an endpoint above'
                : `Download Selection (~${formatBytes(estimateSelectionBytes())})`}
          </button>
        </div>
      )}

      <button
        class="ff-export-trigger"
        disabled={busy !== null || stats.rows === 0}
        onClick={() =>
          run('archive', async () => {
            const blob = await buildArchiveBlob();
            download(blob, `fifth-family-archive-${timestamp()}.ndjson.gz`);
          })
        }
      >
        {busy === 'archive' ? 'Compressing…' : `Download Full Archive (${formatBytes(stats.storedBytes)})`}
      </button>

      <button
        class="ff-archive-secondary"
        disabled={busy !== null}
        onClick={() => run('recount', async () => { await recomputeStats(); await refresh(); })}
      >
        {busy === 'recount' ? 'Recounting…' : 'Recount Archive Size'}
      </button>

      {/* The archive's own reset, kept here rather than folded into "Clear All Data".
          That button clears the player's game history; this clears a developer-facing
          recording with its own retention and exports, and conflating the two would
          mean wiping months of capture as a side effect of resetting a trade ledger. */}
      {confirmingClear ? (
        <div class="ff-reset-confirm">
          <span>
            Delete {stats.rows.toLocaleString()} recorded request{stats.rows === 1 ? '' : 's'} ({formatBytes(stats.storedBytes)})
            and the shape-change history for {shapes.endpoints} endpoint{shapes.endpoints === 1 ? '' : 's'}? Your trades,
            prices, and customs records are not affected. This can't be undone.
          </span>
          <div class="ff-reset-confirm__actions">
            <button class="ff-reset-confirm__cancel" onClick={() => setConfirmingClear(false)}>Cancel</button>
            <button
              class="ff-reset-confirm__go"
              onClick={() =>
                run('clear', async () => {
                  await clearRequestLog();
                  // Counters describe the tables just emptied, so they have to be
                  // zeroed in the same breath or the popup reports a full archive
                  // against nothing.
                  await resetStats();
                  setConfirmingClear(false);
                  setSelected(new Set());
                  await refresh();
                })
              }
            >
              Yes, clear the archive
            </button>
          </div>
        </div>
      ) : (
        <button
          class="ff-reset-trigger"
          disabled={busy !== null || stats.rows === 0}
          onClick={() => setConfirmingClear(true)}
        >
          {busy === 'clear' ? 'Clearing…' : 'Clear HTTP Archive'}
        </button>
      )}
    </>
  );
}
