import { storage } from '@/shared/storage';
import { notify } from '@/shared/notify';
import { ALARM_NAMES, GAME_ORIGIN, MARKET_POLL_BUFFER_MS, MARKET_POLL_FALLBACK_INTERVAL_MS } from '@/shared/constants';
import { parseSmugglingPanelRegex } from './smugglingHtmlRegexParser';
import { applySmugglingListing } from './applySmugglingListing';
import { checkSellOpportunity } from './sellOpportunity';
import * as riskEngine from './riskEngine';

const LOG_PREFIX = '[FifthFamily]';

/**
 * Background market-timeline polling — the plan doc's "fast-follow, not v1" item.
 * Snapshots the smuggling panel automatically, aligned to the game's own market-shift
 * countdown, so price history accumulates even when the player isn't actively looking
 * — not just whenever they happen to open the panel. Also the mechanism behind the
 * sell-opportunity alert (sellOpportunity.ts): the only way to know a price shift made
 * held cargo profitable is to actually check after each shift.
 *
 * Safety note: the customs raid screen is confirmed to come back from a *plain panel
 * reload*, not tied to any player action, so an automatic poll while cargo is held
 * carries the same raid odds as the player reloading it themselves manually — the
 * difference is nobody's there to respond immediately. This was deliberately left
 * gated in an earlier version; it's now allowed on the player's explicit call, since
 * an unresolved raid just sits waiting for a real response (confirmed: it persists
 * across reloads rather than timing out), so there's no cost to it surfacing early.
 * A raid found this way is still detected and notified (see below) so the player can
 * go resolve it in-game whenever they're free.
 */
export function scheduleNextPoll(marketShiftAt: number | null) {
  const when = marketShiftAt !== null ? marketShiftAt + MARKET_POLL_BUFFER_MS : Date.now() + MARKET_POLL_FALLBACK_INTERVAL_MS;
  chrome.alarms.create(ALARM_NAMES.MARKET_POLL, { when });
}

export async function handlePollAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.MARKET_POLL) return;

  if (!(await isSafeToPoll())) {
    // Conditions (travelling / jailed / hospitalized) may change by the next cycle —
    // keep trying rather than going dormant.
    scheduleNextPoll(null);
    return;
  }

  let responseText: string;
  try {
    const res = await fetch(`${GAME_ORIGIN}/api/panel.php?type=smuggling&_t=${Date.now()}`, { credentials: 'include' });
    responseText = await res.text();
  } catch (err) {
    console.error(LOG_PREFIX, 'background market poll fetch failed', err);
    scheduleNextPoll(null);
    return;
  }

  const result = parseSmugglingPanelRegex(responseText);
  if (!result) {
    console.error(LOG_PREFIX, 'background market poll captured a response but failed to parse it');
    scheduleNextPoll(null);
    return;
  }

  if (result.kind === 'raid') {
    // This is a real, persistent raid the player will eventually resolve in-game via
    // a real bribe/run/surrender action — detecting it now is no different from the
    // content script detecting it from a manually-opened panel, so it's recorded the
    // same way (and correctly matched up whenever that real action fires).
    await riskEngine.detectRaid(result.district, result.bribe, Date.now());
    await notifyRaidDetected(result.district);
    scheduleNextPoll(null);
    return;
  }

  const marketShiftAt = await applySmugglingListing(result, Date.now());
  await checkSellOpportunity(result, result.district);
  scheduleNextPoll(marketShiftAt);
}

async function notifyRaidDetected(district: string) {
  await notify('customsRaid', {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'Customs raid detected',
    message: `Border agents flagged your cargo in ${district}. Resolve it in-game whenever you're ready.`,
  });
}

async function isSafeToPoll(): Promise<boolean> {
  const stats = await storage.getLatestStats();

  if (stats?.travelling) return false; // mid-transit, not standing in any specific district
  if (stats?.jailed || stats?.hospitalized) return false; // panel likely inaccessible anyway

  return true;
}
