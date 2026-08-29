import { ALARM_NAMES, COURIER_AUTO_IMMEDIATE_CHECK_DELAY_MS, COURIER_DEST_POLL_BUFFER_MS, COURIER_RETURN_BUFFER_MS, STORAGE_KEYS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { notify } from '@/shared/notify';
import { storage } from '@/shared/storage';
import { getRoster } from '@/shared/petRoster';
import { SystemicActionError, fetchLiveStatus, postAction, sleep, statusReleaseAt } from '../../gameAction';
import { cancelShipment, fetchPanel, pickDestination, runCourierBatch, runOffloadBatch } from './petCourier';
import type { CourierAutoConfig, CourierRunSummary, CourierWatchState, CourierWatchSummary, FleetEntry, PendingCourierReturn, PetRosterEntry } from '@/shared/types';

/**
 * Watches for the hourly smuggling destination rotation and reacts to it in the
 * background, without the player needing the smuggling page open — see
 * docs/smuggling-v2-plan.md / the player's own ask: "I do not know the time
 * when my pets have an open destination to fly to."
 *
 * Two independent alarms, both event-driven (absolute `when`, not a fixed
 * poll interval) — same pattern as `travelNotifier.ts`'s `TRAVEL_ARRIVAL`:
 *
 * - `SMUGGLING_DEST_POLL`: fires once per hour, ~60s after the confirmed
 *   top-of-hour rotation (real capture evidence: every observed destination
 *   transition landed within ~36s of `:00`).
 * - `SMUGGLING_COURIER_RETURN`: fires exactly when the next in-flight pet is
 *   due back, so a pet that lands mid-open-window gets offloaded and
 *   redispatched within seconds rather than waiting out the next hourly tick.
 *
 * Both funnel into the same `evaluateDestination` below, which only probes
 * (drafts one idle pet, reads the destination list, cancels the draft — the
 * only way to see it at all) when there's both an idle pet to probe with
 * *and* no already-known verdict for the current rotation hour yet. That
 * second condition is what makes a pet's return useful on its own: if every
 * pet was out when the hourly check last fired, it had nothing to probe with
 * and had to skip — the *first* pet back is what finally has something to
 * check with, and shouldn't have to wait for the next hourly tick to do it.
 *
 * `CourierAutoConfig.autoDispatchEnabled` only gates the "send" side —
 * detection and notification always run regardless, so turning auto-dispatch
 * off falls back to "notify + badge, let the player decide."
 *
 * Every entry point below gates on `fetchLiveStatus()` first, and separately
 * catches a `SystemicActionError` with kind `'status-blocked'` from any of the
 * actual game calls it makes — the same defense-in-depth fix applied to
 * `careerAuto`/`streetIntel` after a real incident (see gameAction.ts's
 * `SystemicActionError` doc) showed a single point-in-time gate isn't enough
 * for a multi-call cycle. Neither ever disables the automation; only a
 * genuine `'shape'` error does (via `disableAutoWatch`).
 */

function nextHourBoundary(): number {
  return (Math.floor(Date.now() / 3_600_000) + 1) * 3_600_000;
}

function currentHourStart(): number {
  return Math.floor(Date.now() / 3_600_000) * 3_600_000;
}

export function scheduleHourlyDestCheck(): void {
  chrome.alarms.create(ALARM_NAMES.SMUGGLING_DEST_POLL, { when: nextHourBoundary() + COURIER_DEST_POLL_BUFFER_MS });
}

/** Reacts live to the panel's checkbox writing a new config — same
 *  "chrome.storage.onChanged, registered once at module load" pattern as
 *  `careerAuto/index.ts`'s `watchConfigChanges`. Only the off→on transition
 *  does anything: flipping auto-dispatch on shouldn't wait out however much
 *  of the current hourly cycle is left before it first acts, the same
 *  reasoning as `CAREER_AUTO_IMMEDIATE_CHECK_DELAY_MS`. Turning it off needs
 *  no special reaction — detection keeps running on its own schedule either
 *  way (see the module doc above), so there's nothing to reschedule. */
function watchConfigChanges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEYS.COURIER_AUTO_CONFIG in changes)) return;
    const next = changes[STORAGE_KEYS.COURIER_AUTO_CONFIG].newValue as CourierAutoConfig | undefined;
    const prev = changes[STORAGE_KEYS.COURIER_AUTO_CONFIG].oldValue as CourierAutoConfig | undefined;
    if (next?.autoDispatchEnabled && !prev?.autoDispatchEnabled) {
      chrome.alarms.create(ALARM_NAMES.SMUGGLING_DEST_POLL, { when: Date.now() + COURIER_AUTO_IMMEDIATE_CHECK_DELAY_MS });
    }
  });
}

/** Arms/re-arms the hourly check on every wake — cheap no-op after the first
 *  run, same "runs on every service-worker wake" shape as `ensureSweepAlarm`.
 *  No equivalent rehydration is needed for `SMUGGLING_COURIER_RETURN`: it's
 *  recomputed from live fleet state every time `recordFleetReturns` runs
 *  (the next hourly check, if nothing else), so there's no persisted "should
 *  exist" state to restore it from at startup. */
export async function init(): Promise<void> {
  watchConfigChanges();
  const existing = await chrome.alarms.get(ALARM_NAMES.SMUGGLING_DEST_POLL);
  if (!existing) scheduleHourlyDestCheck();
}

/** Assembled fresh from live alarm state + storage for the in-page panel —
 *  see `CourierWatchSummary`'s own doc for why this exists at all. Read-only;
 *  never mutates anything, so it's safe to call as often as the panel wants
 *  (on expand, and on its own 30s refresh timer while open). */
export async function getWatchSummary(): Promise<CourierWatchSummary> {
  const [config, watchState, pendingReturns, destAlarm] = await Promise.all([
    storage.getCourierAutoConfig(),
    storage.getCourierWatchState(),
    storage.getPendingCourierReturns(),
    chrome.alarms.get(ALARM_NAMES.SMUGGLING_DEST_POLL),
  ]);

  return {
    autoDispatchEnabled: config.autoDispatchEnabled,
    destinationOpenUntil: watchState.destinationOpenUntil,
    lastCheckedAt: watchState.lastCheckedAt,
    lastProbeResult: watchState.lastProbeResult,
    nextDestCheckAt: destAlarm?.scheduledTime ?? null,
    pendingReturns: [...pendingReturns].sort((a, b) => a.arrivesAt - b.arrivesAt).map((p) => ({ petName: p.petName, arrivesAt: p.arrivesAt })),
  };
}

async function getIdlePets(fleet: FleetEntry[]): Promise<PetRosterEntry[]> {
  const roster = await getRoster();
  const activeNames = new Set(fleet.map((f) => f.petName));
  return roster.filter((p) => !activeNames.has(p.name));
}

async function updateBadge(idleCount: number): Promise<void> {
  if (idleCount <= 0) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  await chrome.action.setBadgeText({ text: String(idleCount) });
  await chrome.action.setBadgeBackgroundColor({ color: '#2f9e44' });
}

/** Disables auto-dispatch, clears both alarms, and tells the player — reserved
 *  for a genuine `'shape'` error (an unrecognized response format), never for
 *  `'status-blocked'` (see the module doc above). Mirrors
 *  `careerAuto/runner.ts`'s and `streetIntel/actionRunner.ts`'s `pause()`. */
async function disableAutoWatch(message: string): Promise<void> {
  const config = await storage.getCourierAutoConfig();
  await storage.setCourierAutoConfig({ ...config, autoDispatchEnabled: false });
  chrome.alarms.clear(ALARM_NAMES.SMUGGLING_DEST_POLL);
  chrome.alarms.clear(ALARM_NAMES.SMUGGLING_COURIER_RETURN);
  await notify('courierAutoStopped', {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'Pet courier auto-watch stopped',
    message,
  });
}

/**
 * `runCourierBatch`/`runOffloadBatch` never throw a `SystemicActionError` of
 * their own — every `postAction` call inside `executeCourierBatch`/
 * `executeOffloadBatch` is already wrapped in a local try/catch that folds it
 * into the returned summary's `stoppedReason` instead (so the summary is
 * still there to persist/display even when a run dies partway through). That
 * means this module's own try/catch below never sees an error from *those*
 * calls — only from its own direct probe/cancel calls — so this is where the
 * status-blocked/shape handling actually has to hook into the auto-dispatch
 * path itself. Returns `true` if the reason was handled here (reschedule or
 * disable) and the caller should stop this cycle without doing anything more
 * with the summary.
 */
async function handleBatchStop(summary: CourierRunSummary, alarmName: string): Promise<boolean> {
  if (summary.stoppedReason === 'status-blocked') {
    const freshStatus = await fetchLiveStatus();
    chrome.alarms.create(alarmName, { when: freshStatus ? statusReleaseAt(freshStatus) : Date.now() + 60_000 });
    return true;
  }
  if (summary.stoppedReason === 'shape-changed' || summary.stoppedReason === 'session-error') {
    const detail = summary.errors[summary.errors.length - 1];
    await disableAutoWatch(detail ?? `Auto-dispatch stopped after a courier run reported "${summary.stoppedReason}" — check the Pet Couriers panel for details.`);
    return true;
  }
  return false;
}

/**
 * Computes each in-flight pet's absolute arrival time from its live
 * `etaSeconds` countdown (confirmed real against the account's own request
 * archive: it tracks wall-clock elapsed time exactly) and (re)arms the return
 * alarm for whichever is soonest — same "persist the app-level context,
 * overwrite the one alarm" pattern as `travelNotifier.ts`'s `PendingTravel`.
 * Called after every `fetchPanel()` this module makes, so the return alarm
 * always reflects the latest known fleet state.
 */
export async function recordFleetReturns(fleet: FleetEntry[]): Promise<void> {
  const now = Date.now();
  const pending: PendingCourierReturn[] = fleet
    .filter((f) => f.status === 'moving' && f.etaSeconds != null)
    .map((f) => ({ shipmentId: f.shipmentId, petName: f.petName, arrivesAt: now + f.etaSeconds! * 1000 }));

  await storage.setPendingCourierReturns(pending);

  if (pending.length === 0) {
    chrome.alarms.clear(ALARM_NAMES.SMUGGLING_COURIER_RETURN);
    return;
  }
  const earliest = Math.min(...pending.map((p) => p.arrivesAt));
  chrome.alarms.create(ALARM_NAMES.SMUGGLING_COURIER_RETURN, { when: earliest + COURIER_RETURN_BUFFER_MS });
}

/** Drafts with one idle pet purely to read the destination list (the only way
 *  to see it — see docs/smuggling-v2-plan.md's "only non-empty once a draft
 *  exists" note), then cancels that draft regardless of the outcome. Same
 *  one-retry-with-a-pause pattern as `petCourier.ts`'s own destination
 *  resolution, and opportunistically records fleet returns off the same fetch. */
async function probeDestination(idlePet: PetRosterEntry): Promise<{ open: boolean; districtName: string | null }> {
  const draft = await postAction('/actions/smuggling.php', { action: 'v2_draft', user_pet_id: idlePet.userPetId });
  if (!draft?.ok) {
    console.error(LOG_PREFIX, `courier watch probe draft failed for ${idlePet.name}: ${draft?.error ?? 'unknown error'}`);
    return { open: false, districtName: null };
  }
  const shipmentId = Number(draft.shipment_id);

  let districtName: string | null = null;
  for (let attempt = 0; attempt < 2 && !districtName; attempt++) {
    if (attempt > 0) await sleep(1500);
    const afterDraft = await fetchPanel();
    if (!afterDraft) continue;
    await recordFleetReturns(afterDraft.fleet);
    districtName = pickDestination(afterDraft.destinations)?.district ?? null;
  }

  await cancelShipment(shipmentId, idlePet.name, (msg) => console.error(LOG_PREFIX, msg));
  return { open: districtName !== null, districtName };
}

/** Sends idle pets (or notifies) once a destination is confirmed open — either
 *  just-probed, or already known-open from earlier this same rotation hour.
 *  Returns `true` if a `SystemicActionError` from the actual dispatch was
 *  already handled (reschedule or disable) and the caller should stop. */
async function actOnOpenDestination(idleCount: number, districtName: string | null, alarmName: string): Promise<boolean> {
  const config = await storage.getCourierAutoConfig();
  if (config.autoDispatchEnabled) {
    const summary = await runCourierBatch();
    if (await handleBatchStop(summary, alarmName)) return true;
    if (summary.sent.length > 0) {
      await notify('courierAutoDispatched', {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'Pet couriers auto-dispatched',
        message: `Sent ${summary.sent.length} pet${summary.sent.length === 1 ? '' : 's'} to ${districtName ?? 'the open destination'}.`,
      });
    }
    await updateBadge(0);
  } else {
    await notify('courierDestinationOpen', {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'Smuggling destination open',
      message: `${districtName ?? 'A destination'} is open — ${idleCount} pet${idleCount === 1 ? '' : 's'} ready to send.`,
    });
    await updateBadge(idleCount);
  }
  return false;
}

/**
 * The core probe-and-react cycle, shared by the hourly alarm and a pet's
 * return. Probes for real only when there's no already-known verdict for the
 * *current* rotation hour yet — a same-hour "locked" or "open" verdict is
 * reacted to (or just left alone) without spending another draft/cancel
 * round-trip, while a hand-off from a cycle that had zero idle pets to probe
 * with (`lastProbeResult: 'skipped-no-idle-pets'`) — or simply never having
 * checked this hour at all — means the very next idle pet, however it became
 * idle, gets to run the check that couldn't happen before it. Returns `true`
 * if the caller should stop immediately (a dispatch's own error was already
 * handled).
 */
async function evaluateDestination(idlePets: PetRosterEntry[], alarmName: string): Promise<boolean> {
  const watchState = await storage.getCourierWatchState();
  const haveThisHoursAnswer =
    watchState.lastProbeResult !== null && watchState.lastProbeResult !== 'skipped-no-idle-pets' && watchState.lastCheckedAt >= currentHourStart();

  if (idlePets.length === 0) {
    if (!haveThisHoursAnswer) {
      const next: CourierWatchState = { ...watchState, lastCheckedAt: Date.now(), lastProbeResult: 'skipped-no-idle-pets' };
      await storage.setCourierWatchState(next);
    }
    await updateBadge(0);
    return false;
  }

  if (haveThisHoursAnswer) {
    const stillOpen = watchState.destinationOpenUntil !== null && watchState.destinationOpenUntil > Date.now();
    if (!stillOpen) {
      await updateBadge(0);
      return false;
    }
    // No stored district name for an already-known verdict — `actOnOpenDestination`
    // falls back to generic phrasing for it.
    return actOnOpenDestination(idlePets.length, null, alarmName);
  }

  const probe = await probeDestination(idlePets[0]);

  if (!probe.open) {
    await storage.setCourierWatchState({ destinationOpenUntil: null, lastCheckedAt: Date.now(), lastProbeResult: 'locked' });
    await updateBadge(0);
    return false;
  }

  await storage.setCourierWatchState({ destinationOpenUntil: nextHourBoundary(), lastCheckedAt: Date.now(), lastProbeResult: 'open' });
  return actOnOpenDestination(idlePets.length, probe.districtName, alarmName);
}

export async function handleDestPollAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.SMUGGLING_DEST_POLL) return;

  const status = await fetchLiveStatus();
  if (!status) {
    scheduleHourlyDestCheck();
    return;
  }
  if (status.travelling || status.jailed || status.hospitalized) {
    chrome.alarms.create(ALARM_NAMES.SMUGGLING_DEST_POLL, { when: statusReleaseAt(status) });
    return;
  }

  try {
    const snapshot = await fetchPanel();
    if (!snapshot) {
      scheduleHourlyDestCheck();
      return;
    }
    await recordFleetReturns(snapshot.fleet);
    const idlePets = await getIdlePets(snapshot.fleet);

    const stopped = await evaluateDestination(idlePets, ALARM_NAMES.SMUGGLING_DEST_POLL);
    if (stopped) return;

    // A dispatch (if one happened) creates new shipments — re-read so the
    // return alarm reflects them immediately rather than waiting for
    // whichever fetch happens to come next.
    const fresh = await fetchPanel();
    if (fresh) await recordFleetReturns(fresh.fleet);

    scheduleHourlyDestCheck();
  } catch (err) {
    if (err instanceof SystemicActionError && err.kind === 'status-blocked') {
      const freshStatus = await fetchLiveStatus();
      chrome.alarms.create(ALARM_NAMES.SMUGGLING_DEST_POLL, { when: freshStatus ? statusReleaseAt(freshStatus) : Date.now() + 60_000 });
      return;
    }
    if (err instanceof SystemicActionError) {
      await disableAutoWatch(err.message);
      return;
    }
    console.error(LOG_PREFIX, 'courier watch dest-poll cycle failed', err);
    scheduleHourlyDestCheck();
  }
}

export async function handleCourierReturnAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.SMUGGLING_COURIER_RETURN) return;

  const status = await fetchLiveStatus();
  if (!status) {
    chrome.alarms.create(ALARM_NAMES.SMUGGLING_COURIER_RETURN, { when: Date.now() + 60_000 });
    return;
  }
  if (status.travelling || status.jailed || status.hospitalized) {
    chrome.alarms.create(ALARM_NAMES.SMUGGLING_COURIER_RETURN, { when: statusReleaseAt(status) });
    return;
  }

  try {
    const offloadSummary = await runOffloadBatch();
    if (await handleBatchStop(offloadSummary, ALARM_NAMES.SMUGGLING_COURIER_RETURN)) return;

    const afterOffload = await fetchPanel();
    if (!afterOffload) return; // nothing more learnable this cycle — next return/hourly alarm tries again

    const idlePets = await getIdlePets(afterOffload.fleet);
    const stopped = await evaluateDestination(idlePets, ALARM_NAMES.SMUGGLING_COURIER_RETURN);
    if (stopped) return;

    const fresh = await fetchPanel();
    if (fresh) await recordFleetReturns(fresh.fleet);
  } catch (err) {
    if (err instanceof SystemicActionError && err.kind === 'status-blocked') {
      const freshStatus = await fetchLiveStatus();
      chrome.alarms.create(ALARM_NAMES.SMUGGLING_COURIER_RETURN, { when: freshStatus ? statusReleaseAt(freshStatus) : Date.now() + 60_000 });
      return;
    }
    if (err instanceof SystemicActionError) {
      await disableAutoWatch(err.message);
      return;
    }
    console.error(LOG_PREFIX, 'courier watch return cycle failed', err);
  }
}
