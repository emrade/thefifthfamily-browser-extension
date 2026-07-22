import { ensureSeedData, handleMessage, handleAlarm } from './features/tradeAssistant';
import type { ExtensionMessage } from '@/shared/messaging';

// Runs every time the service worker wakes up (install, browser start, or after being
// killed for idling) — cheap no-op after the first run since it just checks a count.
ensureSeedData();

chrome.runtime.onMessage.addListener((msg: ExtensionMessage) => {
  handleMessage(msg);
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  handleAlarm(alarm);
});
