import { ensureSeedData, handleMessage, handleTravelAlarm, handleMarketPollAlarm } from './features/tradeAssistant';
import type { ExtensionMessage } from '@/shared/messaging';

const LOG_PREFIX = '[FifthFamily]';

// Runs every time the service worker wakes up (install, browser start, or after being
// killed for idling) — cheap no-op after the first run since it just checks a count.
ensureSeedData().catch((err) => console.error(LOG_PREFIX, 'ensureSeedData failed', err));

chrome.runtime.onMessage.addListener((msg: ExtensionMessage) => {
  handleMessage(msg).catch((err) => console.error(LOG_PREFIX, 'handleMessage failed for', msg.type, err));
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  handleTravelAlarm(alarm).catch((err) => console.error(LOG_PREFIX, 'handleTravelAlarm failed', err));
  handleMarketPollAlarm(alarm).catch((err) => console.error(LOG_PREFIX, 'handleMarketPollAlarm failed', err));
});
