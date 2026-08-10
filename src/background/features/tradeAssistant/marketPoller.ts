import { storage } from '@/shared/storage';
import { notify } from '@/shared/notify';
import { ALARM_NAMES, GAME_ORIGIN, MARKET_POLL_BUFFER_MS, MARKET_POLL_FALLBACK_INTERVAL_MS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { parseSmugglingPanelRegex } from './smugglingHtmlRegexParser';
import { applySmugglingListing } from './applySmugglingListing';
import { checkSellOpportunity } from './sellOpportunity';
import * as riskEngine from './riskEngine';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';

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
  await pollNow();
}

/**
 * The actual poll — fetch, parse, apply, reschedule. Exported separately from the
 * alarm handler so travelNotifier.ts can trigger an immediate check the moment
 * arrival is confirmed, instead of waiting out whatever's left of the regular
 * schedule — which could be several minutes away, having been deferred for the
 * whole trip (isSafeToPoll refuses to fire while `travelling`).
 *
 * `skipTravellingCheck` exists for that exact call site: arrival was just confirmed
 * via its own fresh, direct stats.php fetch — more current than whatever's cached in
 * `storage.getLatestStats()` (which travelNotifier.ts's own arrival check doesn't
 * write back to) — so the normal travelling gate would otherwise read stale cached
 * state and incorrectly block the very poll meant to catch the moment of arrival.
 */
export async function pollNow(opts: { skipTravellingCheck?: boolean } = {}): Promise<void> {
  if (!(await isSafeToPoll(opts.skipTravellingCheck))) {
    // Conditions (travelling / jailed / hospitalized) may change by the next cycle —
    // keep trying rather than going dormant.
    scheduleNextPoll(null);
    return;
  }

  // Recorded here as well as in the content script: with the game tab closed the
  // poller is the only thing running, and without this the feature would look
  // stale simply because nobody had the page open.
  recordParseSuccess('tradeAssistant');

  let responseText: string;
  try {
    const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?type=smuggling&_t=${Date.now()}`, { credentials: 'include' });
    responseText = await res.text();
  } catch (err) {
    console.error(LOG_PREFIX, 'background market poll fetch failed', err);
    scheduleNextPoll(null);
    return;
  }

  const result = parseSmugglingPanelRegex(responseText);
  if (!result) {
    recordParseFailure('tradeAssistant');
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

async function isSafeToPoll(skipTravellingCheck = false): Promise<boolean> {
  const stats = await storage.getLatestStats();

  if (!skipTravellingCheck && stats?.travelling) return false; // mid-transit, not standing in any specific district
  if (stats?.jailed || stats?.hospitalized) return false; // panel likely inaccessible anyway

  return true;
}
