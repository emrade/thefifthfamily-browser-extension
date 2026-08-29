import { notify } from '@/shared/notify';
import { LOG_PREFIX } from '@/shared/log';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { ALARM_NAMES, GAME_ORIGIN, STORAGE_KEYS, STREET_INTEL_POLL_INTERVAL_MS } from '@/shared/constants';
import type { ExtensionMessage } from '@/shared/messaging';
import { parseStreetIntelOpportunities, type StreetIntelOpportunity } from './streetIntelPanelRegexParser';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import { storage } from '@/shared/storage';
import type { StreetIntelAutoConfig } from '@/shared/types';
import { onConfigChanged, scheduleNextCheck } from './actionRunner';

export { handleAlarm as handleAutoAlarm } from './actionRunner';

/**
 * Re-arms the auto-attempt alarm on service-worker startup if enabled —
 * alarms don't survive a restart the way `chrome.storage` does, same problem
 * `careerAuto`'s own `ensureScheduled()` solves. Prefers the tracked cooldown
 * over an immediate check, so a restart mid-cooldown doesn't attempt early.
 */
export async function ensureAutoScheduled(): Promise<void> {
  const config = await storage.getStreetIntelAutoConfig();
  if (!config.enabled) return;

  const status = await storage.getStreetIntelAutoStatus();
  scheduleNextCheck(status?.nextEligibleAt ?? null);
}

/**
 * Reacts live to the popup flipping `enabled`/changing the success threshold —
 * same `chrome.storage.onChanged` pattern as `careerAuto/index.ts`'s
 * `watchConfigChanges`.
 */
export function watchAutoConfigChanges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEYS.STREET_INTEL_AUTO_CONFIG in changes)) return;
    const next = changes[STORAGE_KEYS.STREET_INTEL_AUTO_CONFIG].newValue as StreetIntelAutoConfig | undefined;
    if (!next) return;
    onConfigChanged(next);
  });
}

export function initAuto(): void {
  watchAutoConfigChanges();
  ensureAutoScheduled().catch((err) => console.error(LOG_PREFIX, 'streetIntel ensureAutoScheduled failed', err));
}

/**
 * Arms the recurring poll the first time the player is seen using Street Intel —
 * mirrors marketPoller.ts's own bootstrapping (nothing runs until a real capture
 * shows the feature is actually in use). Checked via chrome.alarms.get rather than
 * unconditionally recreating the alarm, since `create` would otherwise push the
 * next check back on every single panel view instead of leaving an already-running
 * cycle alone.
 */
export async function handleMessage(msg: ExtensionMessage) {
  if (msg.type !== 'street-intel-viewed') return;
  const existing = await chrome.alarms.get(ALARM_NAMES.STREET_INTEL_POLL);
  if (!existing) scheduleNextPoll();
}

export async function handlePollAlarm(alarm: chrome.alarms.Alarm) {
  if (alarm.name !== ALARM_NAMES.STREET_INTEL_POLL) return;
  await pollNow();
}

function scheduleNextPoll() {
  chrome.alarms.create(ALARM_NAMES.STREET_INTEL_POLL, { when: Date.now() + STREET_INTEL_POLL_INTERVAL_MS });
}

async function pollNow(): Promise<void> {
  let responseText: string;
  try {
    const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?type=street_intel&_t=${Date.now()}`, { credentials: 'include' });
    responseText = await res.text();
  } catch (err) {
    console.error(LOG_PREFIX, 'background street intel poll fetch failed', err);
    scheduleNextPoll();
    return;
  }

  // Recorded here as well as in the content script: with the game tab closed the
  // poller is the only thing running, and without this the feature would look
  // stale simply because nobody had the page open.
  recordParseSuccess('streetIntel');

  const opportunities = parseStreetIntelOpportunities(responseText);
  if (!opportunities) {
    recordParseFailure('streetIntel');
    console.error(LOG_PREFIX, 'background street intel poll captured a response but failed to parse it');
    scheduleNextPoll();
    return;
  }

  // Repeats every cycle for as long as a qualifying job is still listed — no
  // notify-once dedup — since a missed notification is exactly when a repeat
  // matters most. It stops on its own once the job expires or gets completed:
  // parseStreetIntelOpportunities drops a card entirely the moment it no longer
  // carries a live `siScout(id,...)` onclick, which is true for both cases.
  const qualifying = opportunities.filter((o) => o.riskTier !== 'low' || o.legendary);
  if (qualifying.length > 0) await notifyOpportunities(qualifying);

  scheduleNextPoll();
}

function formatOpportunity(o: StreetIntelOpportunity): string {
  const tier = o.legendary ? 'Legendary' : o.riskTier[0].toUpperCase() + o.riskTier.slice(1);
  return `${o.title} (${tier}, $${o.rewardMin.toLocaleString()}–$${o.rewardMax.toLocaleString()})`;
}

async function notifyOpportunities(opportunities: StreetIntelOpportunity[]): Promise<void> {
  const shown = opportunities.slice(0, 3).map(formatOpportunity);
  const extra = opportunities.length - shown.length;
  const message = shown.join('; ') + (extra > 0 ? `; +${extra} more` : '');

  await notify('streetIntelOpportunity', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: opportunities.length > 1 ? 'Street Intel opportunities' : 'Street Intel opportunity',
    message,
  });
}
