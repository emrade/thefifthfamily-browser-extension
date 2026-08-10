import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { db, clearRequestLog } from '@/shared/db';
import { LOG_PREFIX } from '@/shared/log';
import { DEFAULT_REQUEST_LOG_PREFERENCES, RETENTION_CHOICES, type RequestLogPreferences } from '@/shared/requestLog/preferences';
import { readStats, recomputeStats, resetStats, type RequestLogStats } from '@/shared/requestLog/stats';
import { buildArchiveBlob, buildShapeDigest, listEndpoints, type EndpointSummary } from '@/shared/requestLog/exportRequestLog';
import { rebuildProfiles } from '@/shared/requestLog/rebuild';
import { REQUEST_LOG_MAX_BYTES } from '@/shared/constants';

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
  /** Endpoints where a token that had appeared in every prior response stopped
   *  appearing. The actionable signal: this is what breaks an adapter. */
  brokenEndpoints: string[];
  /** Endpoints that emitted something never seen before, after being well
   *  sampled. Informational — often a new field, sometimes just a rare variant
   *  showing up for the first time. */
  newStructureEndpoints: string[];
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

export function RequestLogHome() {
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
    const [nextPrefs, nextStats, profiles, nextEndpoints] = await Promise.all([
      storage.getRequestLogPreferences(),
      readStats(),
      db.endpointProfiles.toArray(),
      listEndpoints(),
    ]);
    setEndpoints(nextEndpoints);

    setPrefs(nextPrefs);
    setStats(nextStats);
    setShapes({
      endpoints: profiles.length,
      // Driven by recorded events, not by how many distinct structures an endpoint
      // has produced. Counting structures was the original bug: one endpoint
      // legitimately returns several (listing vs raid screen), so that measure
      // flagged everything within an hour of first use.
      brokenEndpoints: profiles
        .filter((p) => p.events.some((e) => e.kind === 'removed-universal'))
        .map((p) => p.endpoint),
      newStructureEndpoints: profiles
        .filter((p) => p.events.some((e) => e.kind === 'new-tokens'))
        .map((p) => p.endpoint),
    });
    setLoaded(true);
  }

  useEffect(() => {
    refresh().catch((err) => console.error(LOG_PREFIX, 'failed to load the request log view', err));
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
      <div class="ff-archive-stats">
        <div class="ff-archive-stat">
          <div class="ff-archive-stat__value">{stats.rows.toLocaleString()}</div>
          <div class="ff-archive-stat__label">requests</div>
        </div>
        <div class="ff-archive-stat">
          <div class="ff-archive-stat__value">{formatBytes(stats.storedBytes)}</div>
          {/* Shown against the budget rather than alone. The budget is the thing that
              actually evicts data, so if real traffic drifts away from what it was
              sized for, that is visible here instead of having to be inferred from a
              coverage window quietly shrinking. */}
          <div class="ff-archive-stat__label">of {formatBytes(REQUEST_LOG_MAX_BYTES)}</div>
        </div>
        <div class="ff-archive-stat">
          <div class="ff-archive-stat__value">{shapes.endpoints}</div>
          <div class="ff-archive-stat__label">endpoints</div>
        </div>
      </div>

      <div class="ff-archive-window">
        {stats.rows > 0
          ? `Covering ${formatDate(stats.oldestTimestamp)} – ${formatDate(stats.newestTimestamp)}${savedPct > 0 ? ` · ${savedPct}% saved by compression` : ''}`
          : 'Nothing captured yet — open the game to start recording.'}
      </div>

      {shapes.brokenEndpoints.length > 0 && (
        <div class="ff-archive-alert">
          <strong>
            {shapes.brokenEndpoints.length} endpoint{shapes.brokenEndpoints.length === 1 ? '' : 's'} dropped a field
          </strong>
          <ul class="ff-archive-alert__list">
            {shapes.brokenEndpoints.slice(0, 5).map((endpoint) => (
              <li key={endpoint}>{endpoint}</li>
            ))}
          </ul>
          <span class="ff-archive-alert__hint">
            Something that used to appear in every response stopped. An adapter reading it may be broken — the shape
            digest names the exact tokens.
          </span>
        </div>
      )}

      {shapes.newStructureEndpoints.length > 0 && (
        <div class="ff-archive-note">
          {shapes.newStructureEndpoints.length} endpoint{shapes.newStructureEndpoints.length === 1 ? '' : 's'} returned
          something new. Often a new field, sometimes a rare variant seen for the first time.
        </div>
      )}

      <div class="ff-section-label">Capture</div>

      <label class="ff-toggle-row">
        <div class="ff-toggle-row__text">
          <div class="ff-toggle-row__title">Record Game Traffic</div>
          <div class="ff-toggle-row__status">
            Stores every request the game makes, compressed. Turning this off pauses capture; nothing is deleted.
          </div>
        </div>
        <input
          type="checkbox"
          class="ff-toggle"
          checked={prefs.enabled}
          onChange={() => savePrefs({ ...prefs, enabled: !prefs.enabled })}
        />
      </label>

      {/* Stacked rather than side-by-side like the toggle row above. A <select> has a
          wide intrinsic width, so as a flex sibling it starves the label column and
          forces it to wrap one word per line at popup width — the toggle row is built
          for a fixed 34px control, not a dropdown. */}
      <div class="ff-field">
        <div class="ff-field__label">Keep History For</div>
        <div class="ff-field__hint">Older requests are deleted automatically. Shape history is always kept.</div>
        <select
          class="ff-select ff-field__control"
          value={String(prefs.retentionDays)}
          onChange={(e) => savePrefs({ ...prefs, retentionDays: Number((e.target as HTMLSelectElement).value) })}
        >
          {RETENTION_CHOICES.map((days) => (
            <option key={days} value={String(days)}>{days} days</option>
          ))}
        </select>
      </div>

      <div class="ff-section-label">Export</div>

      {endpoints.length > 0 && (
        <div class="ff-archive-picker">
          <div class="ff-archive-picker__title">Select Endpoints</div>

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
            class="ff-select ff-field__control"
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

      <div class="ff-section-label">Maintenance</div>

      {/* Replays the stored archive through the current classifier. Useful after a
          change to how shapes are judged, and to skip the fresh warmup a live-built
          index would otherwise have to serve on every endpoint. */}
      <button
        class="ff-archive-secondary"
        disabled={busy !== null || stats.rows === 0}
        onClick={() => run('rebuild', async () => { await rebuildProfiles(); await refresh(); })}
      >
        {busy === 'rebuild' ? 'Replaying archive…' : 'Rebuild Shape Index from Archive'}
      </button>

      <button
        class="ff-archive-secondary"
        disabled={busy !== null}
        onClick={() => run('recount', async () => { await recomputeStats(); await refresh(); })}
      >
        {busy === 'recount' ? 'Recounting…' : 'Recount Archive Size'}
      </button>

      {/* The archive's own reset, kept out of Settings → Clear All Data. That button
          clears the player's game history; this clears a developer-facing recording
          with its own retention and exports, and conflating the two would mean wiping
          months of capture as a side effect of resetting a trade ledger. */}
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
                  // zeroed in the same breath or the view reports a full archive
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
