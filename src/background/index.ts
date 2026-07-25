import { ensureSeedData, handleMessage, handleTravelAlarm, handleMarketPollAlarm } from './features/tradeAssistant';
import type { ExtensionMessage } from '@/shared/messaging';

const LOG_PREFIX = '[FifthFamily]';

// Runs every time the service worker wakes up (install, browser start, or after being
// killed for idling) — cheap no-op after the first run since it just checks a count.
ensureSeedData().catch((err) => console.error(LOG_PREFIX, 'ensureSeedData failed', err));

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

chrome.runtime.onMessage.addListener((msg: ExtensionMessage) => {
  messageQueue = messageQueue.then(() =>
    handleMessage(msg).catch((err) => console.error(LOG_PREFIX, 'handleMessage failed for', msg.type, err)),
  );
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  handleTravelAlarm(alarm).catch((err) => console.error(LOG_PREFIX, 'handleTravelAlarm failed', err));
  handleMarketPollAlarm(alarm).catch((err) => console.error(LOG_PREFIX, 'handleMarketPollAlarm failed', err));
});
