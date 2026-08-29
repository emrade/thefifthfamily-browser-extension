import { ALARM_NAMES, COURIER_DEST_POLL_BUFFER_MS, COURIER_RETURN_BUFFER_MS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { notify } from '@/shared/notify';
import { storage } from '@/shared/storage';
import { getRoster } from '@/shared/petRoster';
import { SystemicActionError, fetchLiveStatus, postAction, sleep, statusReleaseAt } from '../../gameAction';
import { cancelShipment, fetchPanel, pickDestination, runCourierBatch, runOffloadBatch } from './petCourier';
import type { CourierRunSummary, FleetEntry, PendingCourierReturn, PetRosterEntry } from '@/shared/types';

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
 *   transition landed within ~36s of `:00`). Only probes (drafts one idle pet,
 *   reads the destination list, cancels the draft) when there's actually an
 *   idle pet to probe with and both destinations aren't already known open.
 * - `SMUGGLING_COURIER_RETURN`: fires exactly when the next in-flight pet is
 *   due back, so a pet that lands mid-open-window gets offloaded and
 *   redispatched within seconds rather than waiting out the next hourly tick
 *   (the player's own point: no reason to poll every 15 minutes when the
 *   destination pair only changes once an hour, but a returning pet shouldn't
 *   have to wait for that same clock).
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

export function scheduleHourlyDestCheck(): void {
  chrome.alarms.create(ALARM_NAMES.SMUGGLING_DEST_POLL, { when: nextHourBoundary() + COURIER_DEST_POLL_BUFFER_MS });
}

/** Arms/re-arms itself on every wake — cheap no-op after the first run, same
 *  "runs on every service-worker wake" shape as `ensureSweepAlarm`. No
 *  equivalent rehydration is needed for `SMUGGLING_COURIER_RETURN`: it's
 *  recomputed from live fleet state every time `recordFleetReturns` runs
 *  (the next hourly check, if nothing else), so there's no persisted "should
 *  exist" state to restore it from at startup. */
export async function init(): Promise<void> {
  const existing = await chrome.alarms.get(ALARM_NAMES.SMUGGLING_DEST_POLL);
  if (!existing) scheduleHourlyDestCheck();
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
    if (idlePets.length === 0) {
      // Nothing to probe with, and nothing to send even if it turned out
      // open — cheaper to just wait for a pet to come back (which re-checks
      // via the return alarm's own `destinationOpenUntil` read) or the next
      // hourly tick. Badge cleared regardless of destination state: with no
      // idle pets there's nothing actionable to show.
      await updateBadge(0);
      scheduleHourlyDestCheck();
      return;
    }

    const probe = await probeDestination(idlePets[0]);

    if (!probe.open) {
      await storage.setCourierWatchState({ destinationOpenUntil: null, lastCheckedAt: Date.now() });
      await updateBadge(0);
      scheduleHourlyDestCheck();
      return;
    }

    await storage.setCourierWatchState({ destinationOpenUntil: nextHourBoundary(), lastCheckedAt: Date.now() });

    const config = await storage.getCourierAutoConfig();
    if (config.autoDispatchEnabled) {
      const summary = await runCourierBatch();
      if (await handleBatchStop(summary, ALARM_NAMES.SMUGGLING_DEST_POLL)) return;
      if (summary.sent.length > 0) {
        await notify('courierAutoDispatched', {
          type: 'basic',
          iconUrl: 'icons/icon-128.png',
          title: 'Pet couriers auto-dispatched',
          message: `Sent ${summary.sent.length} pet${summary.sent.length === 1 ? '' : 's'} to ${probe.districtName ?? 'the open destination'}.`,
        });
      }
      await updateBadge(0);
      const fresh = await fetchPanel();
      if (fresh) await recordFleetReturns(fresh.fleet);
    } else {
      await notify('courierDestinationOpen', {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'Smuggling destination open',
        message: `${probe.districtName ?? 'A destination'} is open — ${idlePets.length} pet${idlePets.length === 1 ? '' : 's'} ready to send.`,
      });
      await updateBadge(idlePets.length);
    }

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

    const watchState = await storage.getCourierWatchState();
    const stillOpen = watchState.destinationOpenUntil !== null && watchState.destinationOpenUntil > Date.now();

    if (stillOpen) {
      const config = await storage.getCourierAutoConfig();
      if (config.autoDispatchEnabled) {
        const summary = await runCourierBatch();
        if (await handleBatchStop(summary, ALARM_NAMES.SMUGGLING_COURIER_RETURN)) return;
        if (summary.sent.length > 0) {
          await notify('courierAutoDispatched', {
            type: 'basic',
            iconUrl: 'icons/icon-128.png',
            title: 'Pet couriers auto-dispatched',
            message: `Sent ${summary.sent.length} pet${summary.sent.length === 1 ? '' : 's'} back out — destination still open.`,
          });
        }
        await updateBadge(0);
      } else {
        const afterOffload = await fetchPanel();
        const idleCount = afterOffload ? (await getIdlePets(afterOffload.fleet)).length : 0;
        if (idleCount > 0) {
          await notify('courierDestinationOpen', {
            type: 'basic',
            iconUrl: 'icons/icon-128.png',
            title: 'Pet back — destination still open',
            message: `${idleCount} pet${idleCount === 1 ? '' : 's'} ready to send.`,
          });
        }
        await updateBadge(idleCount);
      }
    } else {
      // Window closed since this pet departed — nothing actionable to show
      // even though it just came back idle.
      await updateBadge(0);
    }

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
