import { ensureSeedData, handleMessage as handleTradeAssistant, handleTravelAlarm, handleMarketPollAlarm } from './features/tradeAssistant';
import { runCourierBatch, runOffloadBatch } from './features/tradeAssistant/petCourier';
import { handleMessage as handlePlayerStats } from './features/playerStats';
import { handleMessage as handleFightClub } from './features/fightClub';
import { handleMessage as handleStreetIntel, handlePollAlarm as handleStreetIntelPollAlarm } from './features/streetIntel';
import { fetchCareerCatalog, handleAlarm as handleCareerAutoAlarm, init as initCareerAuto } from './features/careerAuto';
import type { ExtensionMessage } from '@/shared/messaging';
import { LOG_PREFIX } from '@/shared/log';
import { enqueueRecord } from '@/shared/requestLog/queue';
import { ensureSweepAlarm, handleSweepAlarm } from '@/shared/requestLog/retention';
import { setCsrfToken } from './csrfToken';
import { upsertRoster, getRoster } from '@/shared/petRoster';
import { storage } from '@/shared/storage';
import type { CourierStatus } from '@/shared/types';

// Each feature reacts to whichever message types it cares about and no-ops on the
// rest, so every message is simply offered to all of them in turn — see
// content/index.ts for the matching dispatch on the capture side.
const messageHandlers = [handlePlayerStats, handleTradeAssistant, handleFightClub, handleStreetIntel];

async function handleMessage(msg: ExtensionMessage) {
  for (const handle of messageHandlers) await handle(msg);
}

// Runs every time the service worker wakes up (install, browser start, or after being
// killed for idling) — cheap no-op after the first run since it just checks a count.
ensureSeedData().catch((err) => console.error(LOG_PREFIX, 'ensureSeedData failed', err));

// Same "runs on every wake, cheap no-op after the first" shape as ensureSeedData —
// it only creates the alarm if one isn't already registered.
ensureSweepAlarm().catch((err) => console.error(LOG_PREFIX, 'ensureSweepAlarm failed', err));

// Re-arms the career auto-runner's alarm (if enabled) and starts watching for
// config changes from the popup — see careerAuto/index.ts.
initCareerAuto();

// Processed one at a time, strictly in arrival order — not fire-and-forget. Several
// handlers do a read-then-write on shared storage/Dexie state (check "is there a
// pending raid", then later clear it; check "is there an open trade", then later
// close it); if two messages for the same event ever arrive close together, letting
// them run concurrently means both can read the "not yet handled" state before
// either finishes writing it, and both proceed. That exact race — not the duplicate
// messages alone — is what let the original bribe-duplication bug slip past a guard
// that looked correct in isolation. Chaining onto one queue makes that impossible:
// the next message's handler can't start until the previous one's has fully settled.
let messageQueue: Promise<void> = Promise.resolve();

chrome.runtime.onMessage.addListener((msg: ExtensionMessage, sender) => {
  // Cheap, high-frequency, and needed immediately by whatever background call comes
  // next — handled outside both queues rather than adding queue latency to every
  // captured request for something that's just a cache write.
  if (msg.type === 'csrf-observed') {
    setCsrfToken(msg.token).catch((err) => console.error(LOG_PREFIX, 'setCsrfToken failed', err));
    return false;
  }

  if (msg.type === 'pet-roster-observed') {
    upsertRoster(msg.entries).catch((err) => console.error(LOG_PREFIX, 'upsertRoster failed', err));
    return false;
  }

  // Sent by the in-page floating panel — the listener returns a Promise here
  // (rather than `false`) so the panel can `await chrome.runtime.sendMessage(...)`
  // and get the run summary directly. `sender.tab?.id` is threaded through so
  // `runCourierBatch` knows which tab's panel to send live progress updates to
  // (see `emitProgress` in petCourier.ts) — `chrome.runtime.sendMessage` alone
  // never reaches a content script, only `chrome.tabs.sendMessage(tabId, ...)` does.
  if (msg.type === 'courier-run-requested') {
    return runCourierBatch(sender.tab?.id);
  }

  // Same request/response shape as 'courier-run-requested' above — a lighter
  // action for a visit where the player just wants arrived shipments collected
  // and cash banked, without committing to a full buy/load/depart cycle.
  if (msg.type === 'courier-offload-requested') {
    return runOffloadBatch(sender.tab?.id);
  }

  // Read-only counterpart, for a UI surface (the in-page floating panel) that
  // can't reach `db`/`storage` directly the way the popup does, since it runs on
  // the game's own origin.
  if (msg.type === 'courier-status-requested') {
    return Promise.all([getRoster(), storage.getLastCourierRun()]).then(
      ([roster, lastRun]): CourierStatus => ({ roster, lastRun }),
    );
  }

  // Sent by the popup's Career Auto job picker — a live network fetch+parse
  // only background can do, so unlike the rest of that tab's config (which the
  // popup reads/writes directly via storage.ts) this one has to be message-based.
  if (msg.type === 'career-catalog-requested') {
    return fetchCareerCatalog();
  }

  // Archive writes are split off onto their own queue rather than joining the
  // ordered feature queue above. They need serializing among themselves (the shape
  // index does a read-then-write), but they must not sit in front of feature work:
  // one arrives for *every* request the game makes, and each costs a gzip plus two
  // IndexedDB round-trips. Chaining them here would add that latency to every
  // price snapshot and trade. The archive is observational and can lag; the
  // features driving the popup cannot.
  if (msg.type === 'request-log') {
    enqueueRecord({
      method: msg.method,
      url: msg.url,
      requestBody: msg.requestBody,
      responseText: msg.responseText,
      truncatedUpstream: msg.truncated,
      status: msg.status,
      durationMs: msg.durationMs,
      origin: 'page',
      timestamp: msg.timestamp,
    });
    return false;
  }

  messageQueue = messageQueue.then(() =>
    handleMessage(msg).catch((err) => console.error(LOG_PREFIX, 'handleMessage failed for', msg.type, err)),
  );
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  handleTravelAlarm(alarm).catch((err) => console.error(LOG_PREFIX, 'handleTravelAlarm failed', err));
  handleMarketPollAlarm(alarm).catch((err) => console.error(LOG_PREFIX, 'handleMarketPollAlarm failed', err));
  handleStreetIntelPollAlarm(alarm).catch((err) => console.error(LOG_PREFIX, 'handleStreetIntelPollAlarm failed', err));
  handleSweepAlarm(alarm).catch((err) => console.error(LOG_PREFIX, 'handleSweepAlarm failed', err));
  handleCareerAutoAlarm(alarm).catch((err) => console.error(LOG_PREFIX, 'handleCareerAutoAlarm failed', err));
});
