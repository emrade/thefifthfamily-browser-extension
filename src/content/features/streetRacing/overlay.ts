import { injectStyleOnce } from '@/content/shared/injectStyle';
import { BRAND_BADGE_CSS, brandBadgeHtml } from '@/content/shared/brandBadge';
import { LOG_PREFIX } from '@/shared/log';
import { STREET_RACING_MINIGAME_DELAY_MEAN_MS } from '@/shared/constants';
import type { ExtensionMessage } from '@/shared/messaging';
import type { RaceAttemptResult, RaceCatalog, RaceCatalogEntry } from '@/shared/types';

/**
 * A floating panel on the live Street Racing page — collapsed to a small
 * badge, expanding into the full race list with a Run button per race, plus
 * a "Race All Unlocked" batch action. Same "badge + expand" shape as
 * courierPanel.ts/statusPanel.ts, but unlike those two (config/status
 * surfaces for a background auto-runner) this one drives the whole action
 * itself: there is no automation to toggle, just a manual per-race trigger
 * that skips the timing mini-game while still submitting a realistic
 * `accuracy` and waiting out a realistic delay — see
 * `background/features/streetRacing`'s own doc for both.
 *
 * Only one race runs at a time (`runningRaceId`/`batchState` together gate
 * every row's button, not just its own) — the account itself can't be
 * racing two things at once, and `postAction`'s pacing/rate-limit handling
 * assumes calls arrive one at a time regardless.
 */

const CONTAINER_ID = 'ff-race-panel';
const STYLE_ID = 'ff-race-panel-style';
const RACING_MARKER = '#rv2-root';

const PANEL_CSS = `
#${CONTAINER_ID} {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
  font-family: 'Inter', system-ui, sans-serif;
  display: none;
}
#${CONTAINER_ID}.ff-rp-visible { display: block; }

.ff-rp-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: linear-gradient(180deg, rgba(20,20,28,0.96), rgba(10,10,15,0.96));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 999px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;
}
.ff-rp-badge:hover { border-color: rgba(201,168,76,0.8); transform: translateY(-1px); }
.ff-rp-badge-label { font-size: 10.5px; color: #d9c48a; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }

.ff-rp-panel {
  display: none;
  width: 330px;
  max-height: 74vh;
  overflow-y: auto;
  padding: 16px;
  background: linear-gradient(180deg, rgba(16,16,22,0.98), rgba(8,8,12,0.98));
  border: 1px solid rgba(201,168,76,0.45);
  border-radius: 14px;
  box-shadow: 0 10px 34px rgba(0,0,0,0.6);
  color: #ccc;
}
#${CONTAINER_ID}.ff-rp-expanded .ff-rp-panel { display: block; }
#${CONTAINER_ID}.ff-rp-expanded .ff-rp-badge { display: none; }

.ff-rp-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
.ff-rp-close {
  background: none; border: none; color: #8b8f9e; font-size: 16px; line-height: 1;
  cursor: pointer; padding: 2px 6px;
}
.ff-rp-close:hover { color: #fff; }

.ff-rp-car { font-size: 9.5px; color: #6b6455; margin-bottom: 10px; line-height: 1.5; }
.ff-rp-car strong { color: #d9c48a; }

.ff-rp-empty { font-size: 10.5px; color: #6b6455; padding: 4px 0; }
.ff-rp-error {
  padding: 8px 10px; margin-bottom: 10px; font-size: 10px; line-height: 1.5;
  background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.3);
  border-radius: 7px; color: #fca5a5;
}

.ff-rp-batch {
  padding: 9px 10px; margin-bottom: 12px;
  background: rgba(212,175,55,0.06); border: 1px solid rgba(212,175,55,0.28);
  border-radius: 9px;
}
.ff-rp-batch-text { font-size: 10px; color: #d9c48a; line-height: 1.5; }
.ff-rp-batch-actions { display: flex; gap: 8px; margin-top: 8px; }
.ff-rp-batch-actions button {
  flex: 1; padding: 6px 10px; border-radius: 7px; font-size: 10px; font-weight: 800;
  letter-spacing: 0.03em; cursor: pointer;
}
.ff-rp-batch-confirm { background: rgba(212,175,55,0.32); border: 1px solid rgba(212,175,55,0.6); color: #fbbf24; }
.ff-rp-batch-cancel, .ff-rp-batch-stop {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.14); color: #ccc;
}
.ff-rp-batch-start {
  display: block; width: 100%; margin-bottom: 12px; padding: 9px 10px;
  background: linear-gradient(135deg, rgba(212,175,55,0.28) 0%, rgba(212,175,55,0.12) 100%);
  border: 1px solid rgba(212,175,55,0.5); border-radius: 9px;
  color: #fbbf24; font-size: 10.5px; font-weight: 800; letter-spacing: 0.03em; cursor: pointer;
}
.ff-rp-batch-start:disabled { opacity: 0.4; cursor: default; }
.ff-rp-batch-summary {
  padding: 8px 10px; margin-bottom: 12px; font-size: 10px; line-height: 1.5;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 7px; color: #ccc;
}
.ff-rp-batch-summary-close { float: right; background: none; border: none; color: #6b6455; cursor: pointer; font-size: 12px; }

.ff-rp-race {
  padding: 9px 10px; margin-bottom: 8px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 9px;
}
.ff-rp-race[data-locked="true"] { opacity: 0.55; }
.ff-rp-race-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.ff-rp-race-name { font-size: 11.5px; font-weight: 700; color: #f1ede2; }
.ff-rp-race-opp { font-size: 9px; color: #6b6455; margin-top: 1px; }
.ff-rp-race-meta { font-size: 9.5px; color: #9ca3af; margin-top: 5px; display: flex; gap: 10px; flex-wrap: wrap; }
.ff-rp-race-meta span { white-space: nowrap; }
.ff-rp-race-result { font-size: 9.5px; margin-top: 5px; }
.ff-rp-race-result.ff-rp-win { color: #4ade80; }
.ff-rp-race-result.ff-rp-loss { color: #f87171; }

.ff-rp-run {
  flex-shrink: 0;
  padding: 6px 14px;
  background: linear-gradient(135deg, rgba(212,175,55,0.32) 0%, rgba(212,175,55,0.16) 100%);
  border: 1px solid rgba(212,175,55,0.5);
  border-radius: 8px;
  color: #fbbf24;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.03em;
  cursor: pointer;
  white-space: nowrap;
}
.ff-rp-run:hover:not(:disabled) { border-color: rgba(212,175,55,0.9); }
.ff-rp-run:disabled { opacity: 0.4; cursor: default; }

.ff-rp-race-actions { display: flex; flex-direction: column; align-items: stretch; gap: 4px; flex-shrink: 0; }
.ff-rp-run-all {
  padding: 4px 10px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 7px;
  color: #9ca3af;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  white-space: nowrap;
}
.ff-rp-run-all:hover:not(:disabled) { border-color: rgba(255,255,255,0.32); color: #ccc; }
.ff-rp-run-all:disabled { opacity: 0.4; cursor: default; }

/* Progress bar + car icon shown only on the row currently racing — the fill
 * width and car position are driven by direct style writes with an explicit
 * transition duration matching the real sampled delay (see
 * 'street-race-progress' in messaging.ts), not by CSS keyframes, so the
 * animation always matches how long the wait actually is. */
.ff-rp-progress { margin-top: 8px; }
.ff-rp-progress-track { position: relative; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); margin-bottom: 4px; }
.ff-rp-progress-fill {
  position: absolute; top: 0; left: 0; height: 100%; width: 0%; border-radius: 3px;
  background: linear-gradient(90deg, rgba(212,175,55,0.5), rgba(251,191,36,0.95));
}
.ff-rp-progress-car {
  position: absolute; top: 50%; left: 0%; transform: translate(-50%, -50%);
  font-size: 12px; line-height: 1;
}
.ff-rp-progress-text { font-size: 9px; color: #9ca3af; }
`;

interface BatchSummary {
  won: number;
  lost: number;
  cash: number;
  errors: string[];
  stopped: boolean;
  /** Name of the single race this run was scoped to, or `null` for a
   *  "Race All Unlocked" run — captured at the start of `runBatch` since
   *  `batchScopeRaceId` itself is reset back to `null` once the run ends. */
  scopedRaceName: string | null;
}

let panelEl: HTMLDivElement | null = null;
let expanded = false;
let catalog: RaceCatalog | null = null;
let loadError: string | null = null;
let runningRaceId: number | null = null;
// Keyed by race id — only the row that just ran shows a result line, cleared
// the moment that race starts running again.
const lastRowResults = new Map<number, { won: boolean; cashAwarded: number }>();
const rowErrors = new Map<number, string>();

let batchState: 'idle' | 'confirming' | 'running' = 'idle';
let batchCancelRequested = false;
let batchProgressText = '';
let batchSummary: BatchSummary | null = null;
// `null` scopes a run to every eligible race ("Race All Unlocked"); a race
// id scopes it to just that one race's own remaining attempts ("Run All"
// on its row) — both go through the same confirm/run/stop machinery below,
// just with the queue restricted differently.
let batchScopeRaceId: number | null = null;

// Drives the countdown text under the active progress bar — cleared whenever
// a race finishes or a new one starts, since only one can ever be animating.
let progressCountdownInterval: ReturnType<typeof setInterval> | null = null;

/**
 * The currently in-flight race's real timing window, from the background's
 * 'street-race-progress' broadcast — kept around (not just handed straight
 * to a one-shot animation) so the progress bar can be *resynced* rather than
 * restarted from 0% whenever this row gets redrawn from scratch: the panel
 * collapses when the player leaves the Racing page mid-race (see
 * `updateVisibility`), which doesn't touch the actual race — that's running
 * in the background regardless of what page is on screen — but does throw
 * away the live DOM node the transition was playing on. Re-deriving "how
 * far through the real wait are we right now" from `startedAt`/`durationMs`
 * on the next redraw is what makes reopening the panel show the countdown
 * resumed at the correct spot instead of frozen at 0% or snapping straight
 * to the end.
 */
let activeProgress: { raceId: number; startedAt: number; durationMs: number } | null = null;

function money(n: number): string {
  return `$${n.toLocaleString()}`;
}

function lockLabel(race: RaceCatalogEntry): string | null {
  if (!race.unlocked) return race.requiredBossId != null && !race.bossCleared ? 'Boss locked' : 'Locked';
  if (race.grudgeLocked) return 'Grudge locked';
  // A Family Challenge (race_type "family") is only ever runnable against
  // the one family the player picked this week — `unlocked`/`bossCleared`
  // say nothing about this at all (confirmed real: every family race comes
  // back `unlocked: true` regardless of allegiance). Mirrors the live
  // panel's own client JS, which forces its Run button's `spent` flag (and
  // so its disabled state) true for exactly this case — see
  // `RaceCatalogEntry.familySlug`'s own doc for the mapping this checks.
  if (race.familySlug != null) {
    if (!catalog?.allegiance) return 'Pick a family';
    if (catalog.allegiance !== race.familySlug) return 'Not your family';
  }
  return null;
}

/** A race is only ever included in "Race All Unlocked" — and only ever
 *  counted toward its total — if it's actually startable right now, so a
 *  race already run to its cap today (whether from this panel, the game's
 *  own mini-game, or an earlier session) never gets queued again. */
function isEligible(race: RaceCatalogEntry): boolean {
  return lockLabel(race) == null && race.attemptsToday < race.dailyAttempts;
}

function renderRace(race: RaceCatalogEntry): string {
  const locked = lockLabel(race);
  const remaining = race.dailyAttempts - race.attemptsToday;
  const atCap = remaining <= 0;
  const running = runningRaceId === race.id;
  const disabled = locked != null || atCap || runningRaceId != null || batchState !== 'idle';

  const btnLabel = running ? 'Racing…' : locked ? locked : atCap ? 'Done today' : `Race Now (${remaining} left)`;

  // Only worth offering when there's actually more than one attempt to
  // chain — at `remaining === 1` it would be identical to the Race Now
  // button above it.
  const runAllBtn =
    locked == null && !atCap && remaining > 1
      ? `<button class="ff-rp-run-all" type="button" data-race-id="${race.id}" ${disabled ? 'disabled' : ''}>Run All (${remaining})</button>`
      : '';

  const result = lastRowResults.get(race.id);
  const rowError = rowErrors.get(race.id);
  let resultHtml = '';
  if (rowError) {
    resultHtml = `<div class="ff-rp-race-result ff-rp-loss">${rowError}</div>`;
  } else if (result) {
    resultHtml = result.won
      ? `<div class="ff-rp-race-result ff-rp-win">Won — ${money(result.cashAwarded)}</div>`
      : `<div class="ff-rp-race-result ff-rp-loss">Lost</div>`;
  }

  const progressHtml = running
    ? `
      <div class="ff-rp-progress">
        <div class="ff-rp-progress-track">
          <div class="ff-rp-progress-fill"></div>
          <div class="ff-rp-progress-car">🏎️</div>
        </div>
        <div class="ff-rp-progress-text">Racing…</div>
      </div>
    `
    : '';

  return `
    <div class="ff-rp-race" data-race-id="${race.id}" data-locked="${locked != null}">
      <div class="ff-rp-race-top">
        <div>
          <div class="ff-rp-race-name">${race.name}</div>
          <div class="ff-rp-race-opp">${race.opponentName} · ${race.cityName}</div>
        </div>
        <div class="ff-rp-race-actions">
          <button class="ff-rp-run" type="button" data-race-id="${race.id}" data-race-name="${race.name}" ${disabled ? 'disabled' : ''}>${btnLabel}</button>
          ${runAllBtn}
        </div>
      </div>
      <div class="ff-rp-race-meta">
        <span>${race.attemptsToday}/${race.dailyAttempts} today</span>
        <span>${money(race.cashReward)}</span>
        <span>${race.staminaCost} stamina</span>
        <span>${race.wins}W-${race.losses}L</span>
      </div>
      ${progressHtml}
      ${resultHtml}
    </div>
  `;
}

function renderBatchSummary(): string {
  if (!batchSummary) return '';
  const parts = [`${batchSummary.won} won`, `${batchSummary.lost} lost`, `${money(batchSummary.cash)} earned`];
  const subject = batchSummary.scopedRaceName ? batchSummary.scopedRaceName : 'Race All';
  let html = `<div class="ff-rp-batch-summary"><button class="ff-rp-batch-summary-close" type="button" title="Dismiss">✕</button>${subject} ${
    batchSummary.stopped ? 'stopped' : 'finished'
  } — ${parts.join(', ')}.`;
  if (batchSummary.errors.length) html += `<br>${batchSummary.errors.join('<br>')}`;
  html += '</div>';
  return html;
}

/** Total remaining *attempts*, not the number of distinct races — a race
 *  with `dailyAttempts=3`/`attemptsToday=0` still has 3 runnable attempts
 *  left today, and both "Race All Unlocked" and a single row's "Run All"
 *  are meant to burn through all of them, not stop after one pass.
 *  `scopeRaceId` narrows this to one race's own remaining attempts — same
 *  restriction `runBatch`'s own `eligibleForThisRun` applies when actually
 *  running. */
function totalEligibleAttempts(scopeRaceId: number | null = null): number {
  if (!catalog) return 0;
  return catalog.races
    .filter((r) => isEligible(r) && (scopeRaceId == null || r.id === scopeRaceId))
    .reduce((sum, r) => sum + (r.dailyAttempts - r.attemptsToday), 0);
}

function renderBatchControls(): string {
  if (!catalog) return '';

  if (batchState === 'running') {
    return `
      <div class="ff-rp-batch">
        <div class="ff-rp-batch-text">${batchProgressText}</div>
        <div class="ff-rp-batch-actions">
          <button class="ff-rp-batch-stop" type="button" ${batchCancelRequested ? 'disabled' : ''}>${batchCancelRequested ? 'Stopping…' : 'Stop after this race'}</button>
        </div>
      </div>
    `;
  }

  if (batchState === 'confirming') {
    const totalAttempts = totalEligibleAttempts(batchScopeRaceId);
    const scopedRace = batchScopeRaceId != null ? catalog.races.find((r) => r.id === batchScopeRaceId) : null;
    const estimateSeconds = Math.round((totalAttempts * STREET_RACING_MINIGAME_DELAY_MEAN_MS) / 1000);
    const subjectText = scopedRace ? `on ${scopedRace.name}` : 'across your unlocked races';
    return `
      <div class="ff-rp-batch">
        <div class="ff-rp-batch-text">Race all ${totalAttempts} remaining attempt${totalAttempts === 1 ? '' : 's'} ${subjectText}? Takes ~${estimateSeconds}s total.</div>
        <div class="ff-rp-batch-actions">
          <button class="ff-rp-batch-confirm" type="button">Confirm</button>
          <button class="ff-rp-batch-cancel" type="button">Cancel</button>
        </div>
      </div>
    `;
  }

  // Idle state only ever shows the global start button — a per-race "Run
  // All" lives inline on that race's own row instead (see `renderRace`).
  const totalAttempts = totalEligibleAttempts(null);
  if (!totalAttempts) return '';
  return `<button class="ff-rp-batch-start" type="button">Race All Unlocked (${totalAttempts} left)</button>`;
}

/** Only shown when the catalog actually has Family Challenges in it — makes
 *  the "Not your family"/"Pick a family" lock labels self-explanatory
 *  instead of leaving the player to guess why those five rows are disabled. */
function renderAllegianceLine(): string {
  if (!catalog || !catalog.races.some((r) => r.familySlug != null)) return '';
  if (!catalog.allegiance) {
    return '<div class="ff-rp-car">Family Challenges: no family picked this week — pick one in-game to unlock them.</div>';
  }
  const label = catalog.allegiance.replace(/_/g, ' ');
  return `<div class="ff-rp-car">Riding for <strong>${label}</strong> this week · ${catalog.allegianceFavor.toFixed(2)} / ${catalog.allegianceCap.toFixed(2)} Favor earned</div>`;
}

function renderBody(): string {
  if (loadError) return `<div class="ff-rp-error">${loadError}</div>`;
  if (!catalog) return '<div class="ff-rp-empty">Loading races…</div>';
  if (!catalog.races.length) return '<div class="ff-rp-empty">No races found.</div>';

  const car = catalog.car;
  const carLine = `<div class="ff-rp-car"><strong>${car.name}</strong> · ${car.topSpeed} top speed / ${car.handling} handling / ${car.acceleration} accel · ${catalog.weather}</div>`;

  return carLine + renderAllegianceLine() + renderBatchSummary() + renderBatchControls() + catalog.races.map(renderRace).join('');
}

function renderAll(): void {
  if (!panelEl) return;
  const bodyEl = panelEl.querySelector('.ff-rp-body');
  if (bodyEl) bodyEl.innerHTML = renderBody();
  const labelEl = panelEl.querySelector('.ff-rp-badge-label');
  labelEl && (labelEl.textContent = runningRaceId != null ? 'Racing…' : 'Street Racing');

  panelEl.querySelectorAll<HTMLButtonElement>('.ff-rp-run').forEach((btn) => {
    btn.addEventListener('click', () => {
      const raceId = Number(btn.dataset.raceId);
      const raceName = btn.dataset.raceName ?? '';
      void handleRun(raceId, raceName);
    });
  });
  panelEl.querySelectorAll<HTMLButtonElement>('.ff-rp-run-all').forEach((btn) => {
    btn.addEventListener('click', () => {
      batchScopeRaceId = Number(btn.dataset.raceId);
      batchState = 'confirming';
      renderAll();
    });
  });
  panelEl.querySelector('.ff-rp-batch-start')?.addEventListener('click', () => {
    batchScopeRaceId = null;
    batchState = 'confirming';
    renderAll();
  });
  panelEl.querySelector('.ff-rp-batch-cancel')?.addEventListener('click', () => {
    batchState = 'idle';
    batchScopeRaceId = null;
    renderAll();
  });
  panelEl.querySelector('.ff-rp-batch-confirm')?.addEventListener('click', () => void runBatch());
  panelEl.querySelector('.ff-rp-batch-stop')?.addEventListener('click', () => {
    batchCancelRequested = true;
    renderAll();
  });
  panelEl.querySelector('.ff-rp-batch-summary-close')?.addEventListener('click', () => {
    batchSummary = null;
    renderAll();
  });
}

async function refresh(): Promise<void> {
  try {
    catalog = (await chrome.runtime.sendMessage({ type: 'street-race-catalog-requested' })) as RaceCatalog;
    loadError = null;
  } catch (err) {
    loadError = 'Could not load races — open the panel in-game once, then try again.';
    console.error(LOG_PREFIX, 'street race catalog refresh failed', err);
  }
  renderAll();

  // Resyncs the progress bar to its real current position — covers reopening
  // the panel (or coming back to the Racing page) while a race started
  // earlier is still running in the background. See `activeProgress`'s own
  // doc for why this can't just resume from where the DOM last left off.
  if (runningRaceId != null && activeProgress?.raceId === runningRaceId) {
    startProgressAnimation(activeProgress.raceId, activeProgress.startedAt, activeProgress.durationMs);
  }
}

/**
 * Wires (or resyncs) the live progress bar/countdown for whichever race is
 * currently running. Always recomputes "how far through the real wait are
 * we right now" from `startedAt`/`durationMs` rather than assuming it's
 * being called at the start — the very first call (from the
 * 'street-race-progress' listener) has elapsed≈0, but a later call from
 * `refresh()` after the panel was hidden/reshown mid-race can have elapsed
 * anywhere up to `durationMs`, and needs to jump the bar straight to that
 * point (no transition) before transitioning only the *remainder* — a plain
 * "transition width to 100% over durationMs" would otherwise replay the
 * whole animation from 0% instead of resuming it.
 */
function startProgressAnimation(raceId: number, startedAt: number, durationMs: number): void {
  if (progressCountdownInterval != null) {
    clearInterval(progressCountdownInterval);
    progressCountdownInterval = null;
  }
  const row = panelEl?.querySelector(`.ff-rp-race[data-race-id="${raceId}"]`);
  const fillEl = row?.querySelector<HTMLDivElement>('.ff-rp-progress-fill');
  const carEl = row?.querySelector<HTMLDivElement>('.ff-rp-progress-car');
  const textEl = row?.querySelector<HTMLDivElement>('.ff-rp-progress-text');
  if (!fillEl || !carEl || !textEl) return;

  const elapsedMs = Math.min(durationMs, Math.max(0, Date.now() - startedAt));
  const remainingMs = durationMs - elapsedMs;
  const startPct = (elapsedMs / durationMs) * 100;

  // Jump to the real current position with no transition first...
  fillEl.style.transition = 'none';
  fillEl.style.width = `${startPct}%`;
  carEl.style.transition = 'none';
  carEl.style.left = `calc(${startPct}% - 8px)`;
  // ...then force a reflow so the transition change below isn't coalesced
  // with the jump above into one paint (which would skip the animation).
  void fillEl.offsetWidth;
  fillEl.style.transition = `width ${remainingMs}ms linear`;
  carEl.style.transition = `left ${remainingMs}ms linear`;
  fillEl.style.width = '100%';
  carEl.style.left = 'calc(100% - 8px)';

  const tick = () => {
    const remaining = Math.max(0, startedAt + durationMs - Date.now());
    textEl.textContent = remaining > 0 ? `Racing… ~${Math.ceil(remaining / 1000)}s` : 'Finishing…';
    if (remaining <= 0 && progressCountdownInterval != null) {
      clearInterval(progressCountdownInterval);
      progressCountdownInterval = null;
    }
  };
  tick();
  progressCountdownInterval = setInterval(tick, 250);
}

async function handleRun(raceId: number, raceName: string): Promise<void> {
  if (runningRaceId != null) return;
  runningRaceId = raceId;
  rowErrors.delete(raceId);
  lastRowResults.delete(raceId);
  renderAll();

  try {
    const result = (await chrome.runtime.sendMessage({ type: 'street-race-run-requested', raceId, raceName })) as RaceAttemptResult;
    lastRowResults.set(raceId, { won: result.won, cashAwarded: result.cashAwarded });

    const race = catalog?.races.find((r) => r.id === raceId);
    if (race) {
      race.attemptsToday = result.attemptsToday;
      race.dailyAttempts = result.dailyCap;
      race.wins = result.wins;
      race.losses = result.losses;
      race.currentStreak = result.currentStreak;
    }
  } catch (err) {
    rowErrors.set(raceId, err instanceof Error ? err.message : 'Race failed.');
    console.error(LOG_PREFIX, 'street race run failed', err);
  } finally {
    if (progressCountdownInterval != null) {
      clearInterval(progressCountdownInterval);
      progressCountdownInterval = null;
    }
    activeProgress = null;
    runningRaceId = null;
    renderAll();
  }
}

/** Systemic rejections (account jailed/hospitalized/travelling, or a stale
 *  session) block every action, not just this one race — the same
 *  distinction `SystemicActionError.kind` draws in gameAction.ts — so unlike
 *  an ordinary "not enough stamina for this specific race" miss, one of
 *  these stops the whole batch instead of moving on to the next race. */
function looksSystemic(message: string): boolean {
  return /jail|hospitali[sz]ed|travel|csrf|token|session|unauthori[sz]ed|forbidden/i.test(message);
}

async function runBatch(): Promise<void> {
  batchState = 'running';
  batchCancelRequested = false;
  batchSummary = null;
  const scopeId = batchScopeRaceId;

  // A race that fails an attempt (most commonly: not enough stamina) doesn't
  // advance its own `attemptsToday` — the failure happens at `can_race`,
  // before the server would ever bump that counter — so it would otherwise
  // still look "eligible" afterward and get picked again next iteration,
  // fail the same way, forever. Once a race has errored once in this run,
  // it's dropped from consideration for the rest of it (but stays fully
  // eligible again next time "Race All"/"Run All" is started fresh).
  const abandoned = new Set<number>();
  const eligibleForThisRun = (r: RaceCatalogEntry) => isEligible(r) && !abandoned.has(r.id) && (scopeId == null || r.id === scopeId);

  // Refreshed right before starting, not reused from whatever was last
  // loaded — the player may have raced a few by hand (in this panel or the
  // real mini-game) since this panel was last opened, and this is what
  // keeps "Race All"/"Run All" from re-queuing anything already spent for
  // the day.
  batchProgressText = 'Checking today’s attempts…';
  renderAll();
  await refresh();

  const tally: BatchSummary = {
    won: 0,
    lost: 0,
    cash: 0,
    errors: [],
    stopped: false,
    scopedRaceName: scopeId != null ? (catalog?.races.find((r) => r.id === scopeId)?.name ?? null) : null,
  };

  // Picks whichever eligible race sorts first, runs one attempt on it, then
  // re-picks — not a fixed queue built once up front. `attemptsToday` only
  // ever increases as attempts run, so this always terminates: a race that
  // still has attempts left after running keeps getting picked (using up
  // all `dailyAttempts` for it, e.g. 3, before moving on to the next race),
  // and one that's now at cap (or just got abandoned) drops out of
  // `eligibleForThisRun` for good.
  while (!batchCancelRequested) {
    const race = catalog?.races.find(eligibleForThisRun);
    if (!race) break;

    const attemptNumber = race.attemptsToday + 1;
    const remaining = (catalog?.races ?? []).filter(eligibleForThisRun).reduce((sum, r) => sum + (r.dailyAttempts - r.attemptsToday), 0);
    batchProgressText = `Racing ${race.name} — attempt ${attemptNumber} of ${race.dailyAttempts} (${remaining} left)…`;
    renderAll();
    await handleRun(race.id, race.name);

    const err = rowErrors.get(race.id);
    if (err) {
      tally.errors.push(`${race.name}: ${err}`);
      abandoned.add(race.id);
      if (looksSystemic(err)) {
        tally.stopped = true;
        break;
      }
      continue;
    }
    const result = lastRowResults.get(race.id);
    if (result) {
      if (result.won) {
        tally.won++;
        tally.cash += result.cashAwarded;
      } else {
        tally.lost++;
      }
    }
  }
  if (batchCancelRequested) tally.stopped = true;

  batchState = 'idle';
  batchScopeRaceId = null;
  batchSummary = tally;
  renderAll();
}

function setExpanded(next: boolean): void {
  expanded = next;
  panelEl?.classList.toggle('ff-rp-expanded', expanded);
  if (expanded) void refresh();
}

function buildPanel(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.innerHTML = `
    <button class="ff-rp-badge" type="button">
      ${brandBadgeHtml('Street Racing')}
      <span class="ff-rp-badge-label">Street Racing</span>
    </button>
    <div class="ff-rp-panel">
      <div class="ff-rp-head">
        ${brandBadgeHtml('Street Racing')}
        <button class="ff-rp-close" type="button" title="Collapse">✕</button>
      </div>
      <div class="ff-rp-body"><div class="ff-rp-empty">Loading races…</div></div>
    </div>
  `;

  el.querySelector('.ff-rp-badge')?.addEventListener('click', () => setExpanded(true));
  el.querySelector('.ff-rp-close')?.addEventListener('click', () => setExpanded(false));

  return el;
}

function updateVisibility(): void {
  if (!panelEl) return;
  const visible = document.querySelector(RACING_MARKER) != null;
  panelEl.classList.toggle('ff-rp-visible', visible);
  if (!visible && expanded) setExpanded(false);
}

export function initStreetRacingOverlay(): void {
  injectStyleOnce(STYLE_ID, BRAND_BADGE_CSS + PANEL_CSS);

  panelEl = buildPanel();
  (document.body ?? document.documentElement).appendChild(panelEl);
  updateVisibility();

  // Same "page swaps panel content via innerHTML, no navigation" reasoning
  // as courierPanel.ts/statusPanel.ts's own visibility watch.
  const observer = new MutationObserver(() => updateVisibility());
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });

  // Real progress signal from background — see 'street-race-progress' in
  // messaging.ts for why this can't just be guessed/animated locally.
  chrome.runtime.onMessage.addListener((msg: ExtensionMessage) => {
    if (msg.type !== 'street-race-progress') return;
    activeProgress = { raceId: msg.raceId, startedAt: msg.startedAt, durationMs: msg.durationMs };
    startProgressAnimation(msg.raceId, msg.startedAt, msg.durationMs);
  });
}
