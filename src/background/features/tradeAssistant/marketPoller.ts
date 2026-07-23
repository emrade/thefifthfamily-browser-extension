import { storage } from '@/shared/storage';
import { ALARM_NAMES, GAME_ORIGIN, MARKET_POLL_BUFFER_MS, MARKET_POLL_FALLBACK_INTERVAL_MS } from '@/shared/constants';
import { parseSmugglingPanelRegex } from './smugglingHtmlRegexParser';
import { applySmugglingListing } from './applySmugglingListing';

const LOG_PREFIX = '[FifthFamily]';

/**
 * Background market-timeline polling — the plan doc's "fast-follow, not v1" item.
 * Snapshots the smuggling panel automatically, aligned to the game's own market-shift
 * countdown, so price history accumulates even when the player isn't actively looking
 * — not just whenever they happen to open the panel.
 *
 * Safety note (this matters — read before changing the guard conditions below):
 * the customs raid screen is confirmed to come back from a *plain panel reload*, not
 * tied to any player action. An automatic background poll is exactly that: a plain
 * reload the player didn't ask for. If it fired while cargo was actually held, it
 * could trigger a real raid check against the player's live account with no chance
 * to respond. `isSafeToPoll` exists specifically to make that impossible — we only
 * ever poll when there is nothing at stake.
 */
export function scheduleNextPoll(marketShiftAt: number | null) {
  const when = marketShiftAt !== null ? marketShiftAt + MARKET_POLL_BUFFER_MS : Date.now() + MARKET_POLL_FALLBACK_INTERVAL_MS;
  chrome.alarms.create(ALARM_NAMES.MARKET_POLL, { when });
}

export async function handlePollAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.MARKET_POLL) return;

  if (!(await isSafeToPoll())) {
    // Conditions (cargo held / travelling / jailed / hospitalized) may change by the
    // next cycle — keep trying rather than going dormant.
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
    // isSafeToPoll should make this exceedingly rare (it already refuses to poll
    // while cargo is held, which is the only scenario a raid actually costs anything).
    // We deliberately do NOT call riskEngine.detectRaid here: there's no resolution
    // mechanism for a poll-triggered raid (no auto-bribe/run/surrender), and creating
    // a PendingCustoms record that never gets resolved by a real player action would
    // risk corrupting the *next real* customs resolution's matching logic.
    console.error(LOG_PREFIX, 'background poll unexpectedly hit a customs raid screen — skipping without resolving');
    scheduleNextPoll(null);
    return;
  }

  const marketShiftAt = await applySmugglingListing(result, Date.now());
  scheduleNextPoll(marketShiftAt);
}

async function isSafeToPoll(): Promise<boolean> {
  const [stats, smugglingContext] = await Promise.all([storage.getLatestStats(), storage.getSmugglingContext()]);

  if (smugglingContext && smugglingContext.heldQuantity > 0) return false; // carrying cargo — a raid here would cost something real
  if (stats?.travelling) return false; // mid-transit, not standing in any specific district
  if (stats?.jailed || stats?.hospitalized) return false; // panel likely inaccessible anyway

  return true;
}
