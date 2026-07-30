import { notify } from '@/shared/notify';
import { LOG_PREFIX } from '@/shared/log';
import { ALARM_NAMES, GAME_ORIGIN, STREET_INTEL_POLL_INTERVAL_MS } from '@/shared/constants';
import type { ExtensionMessage } from '@/shared/messaging';
import { parseStreetIntelOpportunities, type StreetIntelOpportunity } from './streetIntelPanelRegexParser';

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
    const res = await fetch(`${GAME_ORIGIN}/api/panel.php?type=street_intel&_t=${Date.now()}`, { credentials: 'include' });
    responseText = await res.text();
  } catch (err) {
    console.error(LOG_PREFIX, 'background street intel poll fetch failed', err);
    scheduleNextPoll();
    return;
  }

  const opportunities = parseStreetIntelOpportunities(responseText);
  if (!opportunities) {
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
    iconUrl: 'icons/icon-128.png',
    title: opportunities.length > 1 ? 'Street Intel opportunities' : 'Street Intel opportunity',
    message,
  });
}
