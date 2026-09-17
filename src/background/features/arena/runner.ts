import { ALARM_NAMES, ARENA_AUTO_BUFFER_MS, ARENA_AUTO_IMMEDIATE_CHECK_DELAY_MS, ARENA_WATCH_REPEAT_MS, GAME_ORIGIN } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { notify } from '@/shared/notify';
import { storage } from '@/shared/storage';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import { SystemicActionError, fetchLiveStatus, postAction, statusReleaseAt } from '../../gameAction';
import { parseArenaTimerEnd, parseBossEnginePageId, parseCurrentPageNumber, parseIsPotActive, parseOpenOpponents, unwrapArenaPanelHtml } from './arenaPanelParser';
import type { ArenaAutoConfig, ArenaAutoStatus, ArenaBossResult, ArenaOpponentResult, ArenaPageResult } from '@/shared/types';

const FEATURE_KEY = 'arena';

/**
 * Two independent jobs share one alarm (`ALARM_NAMES.ARENA_AUTO`), branching
 * on `ArenaAutoConfig.enabled` at fire time:
 *
 * - **Automation on**: `runAutomationCycle` — opens a page, fights it,
 *   banks it, schedules the next check for exactly when the *following*
 *   page unlocks (`unlocks_next_at`).
 * - **Automation off**: `runPassiveCheck` — a read-only GET, never posts
 *   anything. If the timer's still running, schedules the next check for
 *   exactly when it ends. If it's already run out, fires the
 *   'arenaPageUnlocked' notification and reschedules a repeat nag
 *   (`ARENA_WATCH_REPEAT_MS`) for as long as it keeps finding the same
 *   thing — the same "no notify-once dedup, the repeat is the point"
 *   posture `streetIntel/index.ts`'s `pollNow` uses for its own
 *   opportunity notification.
 *
 * This is deliberately unconditional — no separate "watch" toggle the way
 * `CourierAutoConfig.watchEnabled` gates its own passive probe. That probe
 * takes a real (if cheap) action, a draft-then-cancel; this one is a plain
 * page read with no game-state side effect, the same "no gameplay action,
 * no kill switch" posture `stockMarket`'s price poller already uses. It's
 * also exactly what the player asked for building this: the reminder needs
 * to keep working with Auto-Attack switched off, not only alongside it —
 * gating it behind the same flag `enabled` already controls would silence
 * it in exactly the case it exists for.
 */

async function fetchPanelHtml(): Promise<string | null> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?arena_tab=v2&av2_view=arena&type=arena&_t=${Date.now()}`, { credentials: 'include' });
  const text = await res.text();
  return unwrapArenaPanelHtml(text);
}

export function scheduleNextCheck(nextUnlockAt: number | null): void {
  const when = nextUnlockAt !== null ? nextUnlockAt + ARENA_AUTO_BUFFER_MS : Date.now() + ARENA_WATCH_REPEAT_MS;
  chrome.alarms.create(ALARM_NAMES.ARENA_AUTO, { when });
}

// `chrome.alarms` is confirmed to occasionally fire an alarm twice for a
// single scheduled time after the service worker's been dormant — a known
// MV3 platform quirk `streetIntel/actionRunner.ts` already hit and guards
// against for its own alarm. Real capture here (2026-09-17): two overlapping
// cycles independently read the live page, one attacked an opponent the
// other had *just* finished attacking, and the second copy of that attack
// came back `{"ok":false,"error":"That opponent is not on a page you can
// fight."}` — a genuine rejection, not a shape problem, but one that would
// never happen at all with only one cycle running at a time. This guard
// makes a second overlapping trigger (a duplicate alarm fire, or "Check Now"
// clicked while a real cycle is already mid-flight) a no-op instead of a
// race.
let cycleInFlight = false;

async function runGuarded(config: ArenaAutoConfig | null): Promise<void> {
  if (cycleInFlight) return;
  cycleInFlight = true;
  try {
    if (config) await runAutomationCycle(config);
    else await runPassiveCheck();
  } finally {
    cycleInFlight = false;
  }
}

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.ARENA_AUTO) return;
  const config = await storage.getArenaAutoConfig();
  await runGuarded(config.enabled ? config : null);
}

/** Same "don't wait out whatever cadence this last resolved to" reasoning as
 *  `careerAuto/runner.ts`'s `onConfigChanged` — reacts to either direction
 *  (turning Auto-Attack on, or off back to passive-only) the same way,
 *  since both just mean "the next fire should take the other branch soon,
 *  not whenever the last schedule happens to land." */
export function onConfigChanged(): void {
  chrome.alarms.create(ALARM_NAMES.ARENA_AUTO, { when: Date.now() + ARENA_AUTO_IMMEDIATE_CHECK_DELAY_MS });
}

async function updateStatus(patch: Partial<ArenaAutoStatus>): Promise<ArenaAutoStatus> {
  const current = await storage.getArenaAutoStatus();
  const next: ArenaAutoStatus = {
    lastPage: current?.lastPage ?? null,
    nextUnlockAt: current?.nextUnlockAt ?? null,
    pausedReason: current?.pausedReason ?? null,
    pausedMessage: current?.pausedMessage ?? null,
    pausedAt: current?.pausedAt ?? null,
    pagesRun: current?.pagesRun ?? 0,
    totalBanked: current?.totalBanked ?? 0,
    ...patch,
  };
  await storage.setArenaAutoStatus(next);
  return next;
}

async function pause(message: string): Promise<void> {
  const config = await storage.getArenaAutoConfig();
  await storage.setArenaAutoConfig({ ...config, enabled: false });
  await updateStatus({ pausedReason: 'error', pausedMessage: message, pausedAt: Date.now() });

  await notify('arenaAutoStopped', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'Arena Auto-Attack stopped',
    message,
  });

  // The same alarm now takes the passive branch on its next fire — Arena
  // auto stopping shouldn't also silence the plain "a page is ready"
  // reminder, which has nothing to do with whatever broke here.
  scheduleNextCheck(null);
}

// -------------------------------------------------------------------------
// Passive (automation off)
// -------------------------------------------------------------------------

async function runPassiveCheck(): Promise<void> {
  const html = await fetchPanelHtml();
  if (!html) {
    recordParseFailure(FEATURE_KEY);
    scheduleNextCheck(null);
    return;
  }
  recordParseSuccess(FEATURE_KEY);

  const timerEnd = parseArenaTimerEnd(html);
  await updateStatus({ nextUnlockAt: timerEnd });

  if (timerEnd !== null && timerEnd > Date.now()) {
    scheduleNextCheck(timerEnd);
    return;
  }

  // Timer's run out (or was never found at all, e.g. the very first
  // Arena page ever opened on this account) — a page is ready. Notify
  // (notify() itself gates this on the player's own preference) and keep
  // nagging on a fixed cadence until it isn't true anymore.
  await notify('arenaPageUnlocked', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'Arena page ready',
    message: 'A new Arena page is ready to open.',
  });
  scheduleNextCheck(Date.now() + ARENA_WATCH_REPEAT_MS - ARENA_AUTO_BUFFER_MS);
}

// -------------------------------------------------------------------------
// Automation (enabled)
// -------------------------------------------------------------------------

interface OpenPageState {
  pageNumber: number | null;
  opponentIds: { id: number; winPct: number }[];
  /** Only ever known right after this cycle's own `open_next_page` call —
   *  see `parseBossEnginePageId`'s doc for why a *resumed* page (one this
   *  cycle didn't open itself) can never recover it. `null` here means
   *  "unknown", not "boss doesn't exist". */
  bossWinPct: number | null;
}

/** Figures out what's actually on the current page right now, whether this
 *  cycle is the one that just opened it or it's resuming one already in
 *  progress (manual play before Auto-Attack was turned on, or a prior
 *  cycle that didn't finish before the service worker was killed). Always
 *  reads the *live* panel rather than trusting any cached state, since
 *  that's the only source that's still correct either way. */
async function resolveOpenPage(): Promise<{ state: OpenPageState; html: string } | null> {
  const html = await fetchPanelHtml();
  if (!html) return null;

  const opponentIds = parseOpenOpponents(html);
  const pageNumber = parseCurrentPageNumber(html);

  if (opponentIds.length > 0 || parseBossEnginePageId(html) !== null || parseIsPotActive(html)) {
    // Something's already open — resuming, not opening. The pot-active
    // check (see its own doc) is what catches a page fully fought,
    // including the boss, but never banked: the other two checks alone
    // would see no live opponents and no engageable boss and wrongly
    // conclude there's nothing left to do, when there's still a real,
    // unbanked pot sitting there. Boss win% is simply unrecoverable in
    // this path (see the field's own doc); a resumed page whose boss is
    // already unlocked skips the boss step entirely below rather than
    // guessing at a number.
    return { state: { pageNumber, opponentIds, bossWinPct: null }, html };
  }

  const timerEnd = parseArenaTimerEnd(html);
  if (timerEnd !== null && timerEnd > Date.now()) {
    // Nothing open, and not due yet — the caller schedules off this timer.
    return { state: { pageNumber: null, opponentIds: [], bossWinPct: null }, html };
  }

  // Genuinely ready — open it.
  const openResp = await postAction('/actions/arena_v2.php', { action: 'open_next_page' });
  if (openResp?.ok !== true || !openResp.new_page) {
    throw new SystemicActionError(
      `Unexpected response opening the next Arena page${openResp?.error ? `: ${openResp.error}` : ''} — the game may have changed something.`,
      'shape',
    );
  }

  const freshHtml = await fetchPanelHtml();
  if (!freshHtml) return null;

  return {
    html: freshHtml,
    state: {
      pageNumber: Number(openResp.new_page.page_number) || null,
      opponentIds: parseOpenOpponents(freshHtml),
      bossWinPct: typeof openResp.new_page.boss_data?.win_pct === 'number' ? openResp.new_page.boss_data.win_pct : null,
    },
  };
}

async function runAutomationCycle(config: ArenaAutoConfig): Promise<void> {
  try {
    const status = await fetchLiveStatus();
    if (status && (status.travelling || status.jailed || status.hospitalized)) {
      scheduleNextCheck(statusReleaseAt(status));
      return;
    }

    const resolved = await resolveOpenPage();
    if (!resolved) {
      recordParseFailure(FEATURE_KEY);
      scheduleNextCheck(null);
      return;
    }
    recordParseSuccess(FEATURE_KEY);

    const { state } = resolved;

    // Nothing open and not yet due — this is `resolveOpenPage`'s
    // "not due yet" branch. Re-read the timer from its own returned html
    // rather than re-deriving it, since it's the exact value that branch
    // already found.
    if (state.opponentIds.length === 0 && state.pageNumber === null) {
      const timerEnd = parseArenaTimerEnd(resolved.html);
      scheduleNextCheck(timerEnd);
      return;
    }

    // Riskiest first — a loss zeroes the running pot, but doesn't end the
    // page: a later win rebuilds it from zero. Fighting the riskiest
    // opponent first means any loss happens while there's still a full page
    // of fights left to rebuild the pot; fighting it last (an earlier,
    // wrong default here — see the real 2026-09-17 page 3 capture in
    // docs/arena-auto-plan.md's "Attack order" section, which shows the
    // player's own actual manual play doing exactly this) leaves a loss with
    // no recovery left at all.
    const attackOrder = [...state.opponentIds].sort((a, b) => a.winPct - b.winPct);
    const opponentResults: ArenaOpponentResult[] = [];

    // Written after every step that actually happens (an attack, the boss
    // fight) rather than only once at the very end — see
    // `ArenaPageResult.complete`'s own doc. A cycle that fails partway
    // through still leaves behind a true record of what it actually did,
    // instead of looking like nothing happened at all (the gap the player
    // flagged: "it just looks to me that it failed in whatever it was
    // trying to do").
    const logProgress = (partial: Partial<ArenaPageResult>) =>
      updateStatus({
        lastPage: {
          timestamp: Date.now(),
          pageNumber: state.pageNumber ?? 0,
          opponents: opponentResults,
          boss: null,
          banked: 0,
          seasonScore: 0,
          complete: false,
          ...partial,
        },
      });

    for (const opp of attackOrder) {
      const resp = await postAction('/actions/arena_v2.php', { action: 'attack', opponent_id: opp.id, page_id: 0 });
      if (resp?.ok !== true) {
        throw new SystemicActionError(
          `Unexpected response attacking an Arena opponent${resp?.error ? `: ${resp.error}` : ''} — the game may have changed something.`,
          'shape',
        );
      }
      opponentResults.push({
        name: String(resp.defender ?? ''),
        won: Boolean(resp.won),
        winPctAtAttack: opp.winPct,
        bountyEarned: resp.won ? Number(resp.points_earned) || 0 : 0,
      });
      await logProgress({ opponents: opponentResults });
    }

    // Re-read after finishing the regular four — the boss's own "ENGAGE
    // BOSS" button (and the page_id its onclick carries) only exists once
    // they're all done. See arenaPanelParser.ts's parseBossEnginePageId doc.
    const postFightHtml = attackOrder.length > 0 ? await fetchPanelHtml() : resolved.html;
    const bossPageId = postFightHtml ? parseBossEnginePageId(postFightHtml) : null;

    let boss: ArenaBossResult | null = null;
    if (bossPageId !== null) {
      const winPct = state.bossWinPct;
      if (winPct !== null && winPct >= config.bossWinPctThreshold) {
        const resp = await postAction('/actions/arena_v2.php', { action: 'attack', opponent_id: 0, page_id: bossPageId });
        if (resp?.ok !== true) {
          throw new SystemicActionError(
            `Unexpected response attacking the Arena boss${resp?.error ? `: ${resp.error}` : ''} — the game may have changed something.`,
            'shape',
          );
        }
        boss = { name: String(resp.defender ?? ''), attacked: true, won: Boolean(resp.won), winPct, skippedReason: null };
      } else {
        boss = {
          name: '',
          attacked: false,
          won: null,
          winPct: winPct ?? -1,
          skippedReason:
            winPct !== null
              ? `${winPct}% below the ${config.bossWinPctThreshold}% threshold`
              : "boss win% unknown — resumed a page this run didn't open, so the number was never seen",
        };
      }
      await logProgress({ boss });
    }

    const pageNumber = state.pageNumber ?? (postFightHtml ? parseCurrentPageNumber(postFightHtml) : null);
    if (pageNumber === null) {
      throw new SystemicActionError('Could not determine the current Arena page number to bank it — the game may have changed something.', 'shape');
    }

    const bankResp = await postAction('/actions/arena_v2.php', { action: 'bank', page_number: pageNumber });
    let banked = 0;
    let seasonScore = (await storage.getArenaAutoStatus())?.lastPage?.seasonScore ?? 0;
    if (bankResp?.ok === true) {
      banked = Number(bankResp.banked) || 0;
      seasonScore = Number(bankResp.season_score) || 0;
    } else if (typeof bankResp?.error === 'string' && /empty/i.test(bankResp.error)) {
      // Expected, not a bug: the page's own last fight was a genuine loss,
      // which zeroes the running pot immediately (see
      // docs/arena-auto-plan.md's "Attack order" section) — there is
      // legitimately nothing left to bank. The page still finished; this
      // just isn't a systemic failure worth pausing the feature over.
    } else {
      throw new SystemicActionError(
        `Unexpected response banking an Arena page${bankResp?.error ? `: ${bankResp.error}` : ''} — the game may have changed something.`,
        'shape',
      );
    }

    const pageResult: ArenaPageResult = {
      timestamp: Date.now(),
      pageNumber,
      opponents: opponentResults,
      boss,
      banked,
      seasonScore,
      complete: true,
    };

    // One more read for the freshly-opened next page's own unlock timer —
    // `bank` doesn't return one, and this is the ground truth regardless.
    const finalHtml = await fetchPanelHtml();
    const nextUnlockAt = finalHtml ? parseArenaTimerEnd(finalHtml) : null;

    const prevStatus = await storage.getArenaAutoStatus();
    await updateStatus({
      lastPage: pageResult,
      nextUnlockAt,
      pausedReason: null,
      pausedMessage: null,
      pausedAt: null,
      pagesRun: (prevStatus?.pagesRun ?? 0) + 1,
      totalBanked: (prevStatus?.totalBanked ?? 0) + pageResult.banked,
    });

    scheduleNextCheck(nextUnlockAt);
  } catch (err) {
    if (err instanceof SystemicActionError && err.kind === 'status-blocked') {
      const freshStatus = await fetchLiveStatus();
      scheduleNextCheck(freshStatus ? statusReleaseAt(freshStatus) : null);
      return;
    }
    if (err instanceof SystemicActionError) {
      recordParseFailure(FEATURE_KEY);
      await pause(err.message);
      return;
    }
    console.error(LOG_PREFIX, 'arena auto-runner cycle failed', err);
    scheduleNextCheck(null);
  }
}

/** Triggered by the overlay's own "Check Now" button — same escape hatch as
 *  `crimesAuto`'s `runCheckNow`, for a schedule that's otherwise purely
 *  timer-aligned. Runs whichever branch `enabled` currently calls for,
 *  exactly like a real alarm fire would. Routed through `runGuarded` too —
 *  without it, clicking "Check Now" while a real alarm-triggered cycle is
 *  already mid-flight is exactly the same race that caused the duplicate
 *  attack described on `cycleInFlight`'s own doc above, just triggered by a
 *  click instead of a double alarm fire. */
export async function runCheckNow(): Promise<void> {
  const config = await storage.getArenaAutoConfig();
  await runGuarded(config.enabled ? config : null);
}
