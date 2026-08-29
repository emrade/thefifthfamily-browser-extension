import { postAction, SystemicActionError } from '../../gameAction';
import { ALARM_NAMES, STOCK_MARKET_LAUNCH_TS, STOCK_MARKET_POLL_INTERVAL_MS } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { db } from '@/shared/db';
import { notify } from '@/shared/notify';
import { storage } from '@/shared/storage';
import type { StockPricePoint, StockRumorRecord } from '@/shared/types';

/**
 * Background stock market poller — see docs/stock-market-tracker-plan.md for why
 * this exists. The game itself only retains ~5-9 rumors per stock (its own
 * rolling `whispers` window) and 30 days of price history, which is nowhere near
 * enough to ever tell whether a rumor's direction is a real, tradeable edge —
 * this is pure, passive data collection so that answer becomes available months
 * from now, without needing the player to have the tab open to catch it.
 *
 * Unlike the career/street-intel auto-runners, spending nothing (a `poll`/
 * `chart` action, never `buy`/`sell`) means there's no in-game resource at
 * risk from retrying blind — which is why an *ordinary* rejection (see
 * `blockedByPlayerState` below) just keeps retrying on schedule rather than
 * stopping the way those two do. But there's a different risk that has
 * nothing to do with resources: repeating something the game's own response
 * suggests it doesn't recognize, unattended, indefinitely, is exactly the
 * shape of behavior that gets an account flagged — so a genuinely
 * unrecognized response (not an ordinary `{ok:false,"error":"..."}` the game
 * sends through its normal channel, which any legitimate player could also
 * hit) does pause, the same as those two, and for the same underlying reason:
 * stop and let a human look, rather than keep doing the thing that produced
 * a response nobody's ever seen before. See `pause`/`resume` below.
 */

interface RawWhisper {
  rumor_code: string;
  displayed_direction: string;
  severity: string;
  quality: string;
  player_text: string;
  generated_hour: number;
  expires_hour: number;
  truth_flag: 'True' | 'False';
}

interface RawStockData {
  symbol: string;
  hour: number;
  prices: number[];
  rumor: Omit<RawWhisper, 'truth_flag'> | null;
  whispers: RawWhisper[];
}

function hourToTimestamp(hour: number): number {
  return STOCK_MARKET_LAUNCH_TS + hour * 3_600_000;
}

// The `prices` array is always the trailing window ending at `currentHour` —
// confirmed against a live `hour` field captured at the same moment a chart
// backfill was pulled, see docs/stock-market-tracker-plan.md.
function toPricePoints(symbol: string, currentHour: number, prices: number[]): StockPricePoint[] {
  const n = prices.length;
  return prices.map((price, i) => {
    const hour = currentHour - (n - 1 - i);
    return { id: `${symbol}:${hour}`, symbol, hour, price, timestamp: hourToTimestamp(hour) };
  });
}

async function upsertRumor(
  symbol: string,
  rumorCode: string,
  direction: string,
  severity: string,
  quality: string,
  playerText: string,
  generatedHour: number,
  expiresHour: number,
  truthFlag: 'True' | 'False' | null,
  now: number,
): Promise<void> {
  const existing = await db.stockRumors.get(rumorCode);
  const record: StockRumorRecord = {
    rumorCode,
    symbol,
    direction,
    severity,
    quality,
    playerText,
    generatedHour,
    expiresHour,
    truthFlag,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    // Once resolved, a rumor never un-resolves — preserve the first resolution
    // timestamp rather than sliding it forward on every later poll that still
    // happens to see it in the whispers list.
    resolvedAt: truthFlag !== null ? (existing?.resolvedAt ?? now) : null,
  };
  await db.stockRumors.put(record);
}

async function persistStock(symbol: string, stock: RawStockData, now: number): Promise<void> {
  await db.stockPrices.bulkPut(toPricePoints(symbol, stock.hour, stock.prices));

  if (stock.rumor) {
    const r = stock.rumor;
    await upsertRumor(symbol, r.rumor_code, r.displayed_direction, r.severity, r.quality, r.player_text, r.generated_hour, r.expires_hour, null, now);
  }
  for (const w of stock.whispers) {
    await upsertRumor(symbol, w.rumor_code, w.displayed_direction, w.severity, w.quality, w.player_text, w.generated_hour, w.expires_hour, w.truth_flag, now);
  }
}

/**
 * One-time backfill of each stock's last 30 days of hourly prices via the
 * `chart` action — run once, the first time a poll succeeds, so history that
 * would otherwise never be recoverable (the game's own retention is exactly
 * this 30 days) isn't lost to however long it takes this feature to have been
 * running on its own. A per-stock failure is logged and skipped rather than
 * aborting the rest; the flag is set regardless once every stock's been
 * attempted, since ordinary hourly polling will keep building fresh history
 * for any stock this missed.
 */
async function backfillIfNeeded(stocksById: Record<string, RawStockData>): Promise<void> {
  if (await storage.getStockMarketBackfillDone()) return;

  for (const [stockId, stock] of Object.entries(stocksById)) {
    try {
      const resp = await postAction('/actions/stocks_v2.php', { action: 'chart', stock_id: stockId, timeframe: '30d' });
      const prices: number[] = Array.isArray(resp?.prices) ? resp.prices : [];
      if (prices.length === 0) continue;

      const lastHour = Math.floor((Date.now() - STOCK_MARKET_LAUNCH_TS) / 3_600_000);
      await db.stockPrices.bulkPut(toPricePoints(stock.symbol, lastHour, prices));
    } catch (err) {
      console.error(LOG_PREFIX, `stock market backfill failed for stock_id=${stockId}`, err);
    }
  }

  await storage.setStockMarketBackfillDone(true);
}

/** Confirmed real (see docs/stock-market-tracker-plan.md): a background poll
 *  attempted while hospitalized came back `{ok:false,"error":"You can't do
 *  that while hospitalized!"}` — the game blocks `poll` itself, not just
 *  `buy`/`sell`. Same pre-flight check as `marketPoller.ts`'s
 *  `isSafeToPoll`, checked before spending a call on it. Unlike that one,
 *  this doesn't skip silently — a gate hit here is still recorded via
 *  `recordPollResult` (prefixed `'Skipped — '` so the overlay can tell it
 *  apart from a real failure), since silently doing nothing left no way to
 *  tell "paused for a normal reason" apart from "actually stuck". Travelling
 *  is deliberately not checked, unlike marketPoller.ts — there's no
 *  confirmed evidence it blocks stocks_v2.php the way it blocks a
 *  district-specific smuggling panel, and this project's own rule is to
 *  build against confirmed shapes, not extend a guess to a case that hasn't
 *  actually been observed. */
async function blockedByPlayerState(): Promise<string | null> {
  const stats = await storage.getLatestStats();
  if (stats?.hospitalized) return 'Skipped — hospitalized';
  if (stats?.jailed) return 'Skipped — jailed';
  return null;
}

export async function pollNow(): Promise<void> {
  const alreadyPaused = await storage.getStockMarketPollStatus();
  if (alreadyPaused.paused) {
    // Re-fires on every scheduled tick rather than only once, on purpose — a
    // single notification is easy to miss (dismissed, notifications off that
    // day, phone not near you); repeating it for as long as this stays
    // paused means the only way to stop seeing it is to actually look and
    // resume, not just miss the one moment it happened. No network call is
    // made — repeating the exact thing that triggered this is the one
    // behavior actually being guarded against.
    await notify('stockMarketTrackerPaused', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'Stock Market Tracker is still paused',
      message: alreadyPaused.lastError ?? 'An unrecognized response stopped data collection.',
    });
    return;
  }

  const blocked = await blockedByPlayerState();
  if (blocked) {
    await recordPollResult(blocked);
    return;
  }

  let resp: any;
  try {
    resp = await postAction('/actions/stocks_v2.php', { action: 'poll' });
  } catch (err) {
    if (err instanceof SystemicActionError && err.kind === 'shape') {
      await pause(err.message);
      return;
    }
    // 'auth' (no token yet, or a stale session/CSRF rejection) is an
    // ordinary, common failure mode of *any* authenticated client — not
    // evidence of anything unusual — so it just keeps retrying on schedule,
    // same as before.
    const message = err instanceof SystemicActionError ? err.message : String(err);
    console.error(LOG_PREFIX, 'stock market poll failed —', message);
    await recordPollResult(message);
    return;
  }

  // A well-formed business rejection (confirmed real: the hospitalized case
  // above) is not evidence of anything unusual — it's the game's normal
  // error-reporting channel, the same thing a legitimate player would see —
  // so it's surfaced and retried on schedule, not paused.
  if (resp?.ok === false && typeof resp.error === 'string') {
    console.error(LOG_PREFIX, 'stock market poll rejected —', resp.error);
    await recordPollResult(resp.error);
    return;
  }

  if (!resp?.ok || typeof resp.data !== 'object' || resp.data === null) {
    await pause('Poll returned a response shape never seen before.');
    return;
  }

  const stocksById = resp.data as Record<string, RawStockData>;
  const now = Date.now();

  await backfillIfNeeded(stocksById);

  for (const stock of Object.values(stocksById)) {
    await persistStock(stock.symbol, stock, now);
  }

  await recordPollResult(null);
}

/** Hard-stops the tracker after a response nobody's ever seen before — see
 *  this file's own top comment for why this exists at all despite the
 *  feature spending nothing. Deliberately doesn't touch the poll alarm (it
 *  stays scheduled): `pollNow` checks `paused` first and, if set, only
 *  re-fires the notification rather than repeating the actual call — so the
 *  reminder keeps coming on the normal cadence without the thing being
 *  guarded against ever happening again on its own. */
async function pause(message: string): Promise<void> {
  console.error(LOG_PREFIX, 'stock market tracker pausing —', message);
  await storage.setStockMarketPollStatus({ lastPollAt: (await storage.getStockMarketPollStatus()).lastPollAt, lastError: message, paused: true });
  await notify('stockMarketTrackerPaused', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'Stock Market Tracker paused itself',
    message: `An unrecognized response stopped data collection: ${message}`,
  });
}

/** Clears a pause set by the function above — the overlay's "Resume
 *  Tracking" button is the only caller. Polling itself resumes on its own
 *  next scheduled tick; nothing to re-arm here since the alarm was never
 *  touched. */
export async function resume(): Promise<void> {
  await storage.setStockMarketPollStatus({ lastPollAt: (await storage.getStockMarketPollStatus()).lastPollAt, lastError: null, paused: false });
}

/** Updates the status the in-page overlay reads (see getStatus below).
 *  `lastPollAt` only moves forward on a real success, so a failed attempt
 *  doesn't make a previously-working tracker look like it just ran. */
async function recordPollResult(error: string | null): Promise<void> {
  const prev = await storage.getStockMarketPollStatus();
  await storage.setStockMarketPollStatus({
    lastPollAt: error ? prev.lastPollAt : Date.now(),
    lastError: error,
    paused: false, // recordPollResult is never the pause path — see `pause` above
  });
}

export interface StockTrackerStatus {
  lastPollAt: number | null;
  lastError: string | null;
  paused: boolean;
  backfillDone: boolean;
  totalPricePoints: number;
  stocksTracked: number;
  totalRumors: number;
  resolvedRumors: number;
  trueCount: number;
  falseCount: number;
}

/** Everything the in-page overlay shows, gathered in one round trip since it
 *  can't reach `db`/`storage` directly (it runs on the game's own origin —
 *  see content/features/stockMarket/index.ts). */
export async function getStatus(): Promise<StockTrackerStatus> {
  const [pollStatus, backfillDone, totalPricePoints, symbols, rumors] = await Promise.all([
    storage.getStockMarketPollStatus(),
    storage.getStockMarketBackfillDone(),
    db.stockPrices.count(),
    db.stockPrices.orderBy('symbol').uniqueKeys(),
    db.stockRumors.toArray(),
  ]);

  const resolved = rumors.filter((r) => r.truthFlag !== null);
  const trueCount = resolved.filter((r) => r.truthFlag === 'True').length;

  return {
    ...pollStatus,
    backfillDone,
    totalPricePoints,
    stocksTracked: symbols.length,
    totalRumors: rumors.length,
    resolvedRumors: resolved.length,
    trueCount,
    falseCount: resolved.length - trueCount,
  };
}

/**
 * Arms or disarms the poll alarm to match the player's own Settings toggle —
 * called both on every service-worker wake and live, the instant that toggle
 * changes (see index.ts's storage.onChanged listener), so turning it off is a
 * real "stop fetching", not just "stop showing the overlay". This matters in
 * particular for anyone running this build only to test it (e.g. on a second
 * browser, primary account elsewhere): disabling it here needs to actually
 * mean disabled, not "still polling in the background with nothing to show
 * for it".
 */
export async function ensureScheduled(): Promise<void> {
  const prefs = await storage.getPageFeaturePreferences();
  if (!prefs.stockMarketStatus) {
    await chrome.alarms.clear(ALARM_NAMES.STOCK_MARKET_POLL);
    return;
  }

  const existing = await chrome.alarms.get(ALARM_NAMES.STOCK_MARKET_POLL);
  if (existing) return;
  chrome.alarms.create(ALARM_NAMES.STOCK_MARKET_POLL, {
    periodInMinutes: STOCK_MARKET_POLL_INTERVAL_MS / 60_000,
    delayInMinutes: 1,
  });
}

export async function handlePollAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.STOCK_MARKET_POLL) return;
  await pollNow();
}
