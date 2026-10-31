import { db } from '@/shared/db';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { decompressText } from '@/shared/requestLog/compress';
import type { RecordRequestInput } from '@/shared/requestLog/record';
import { buildStreetIntelAnalytics, gameDay, type SiAttemptRecord, type SiDrop, type StreetIntelAnalytics } from '@/shared/streetIntelAnalytics';
import type { StreetIntelAnalyticsSeedState } from '@/shared/types';
import { parseStreetIntelOpportunities } from '../streetIntelPanelRegexParser';
import { ANALYTICS_SEED_CARDS_FROM, ANALYTICS_SEED_CUTOFF, seedAttempts, seedCards, seedDays, seedPrices } from './seed';

/**
 * Street Intel Analytics: keeps every card the board shows, every attempt
 * (manual or automated) with its complication outcome and drops, and paid
 * scout Stamina per day, then summarizes them for the Analytics tab and the
 * suggested minimum card value.
 *
 * Fed from the request archive's own capture point (`enqueueRecord`), the
 * one place that sees both the page's traffic and the background runners',
 * so it records whatever the archive records — with archive capture turned
 * off in Settings, it stops too. The archive itself only keeps a couple of
 * days under its byte budget, which is why this keeps its own small tables.
 *
 * Starts from an archive-built seed (see ./seed.ts) and, once, replays the
 * extension's own archive between the seed's cutoff and the first start
 * after the update, so nothing between the export and the update is missing.
 *
 * The replay decompresses every archived Street Intel response, which can
 * outlast Firefox's ~30s idle limit for the background: 0.52.0 waited for
 * all of it before answering the Analytics tab and saved nothing until the
 * end, so a background suspended mid-replay restarted it from scratch on
 * every wake and the tab never loaded. Now the tab only waits for the seed
 * import, and the replay runs on its own chain, saving its progress after
 * every batch.
 *
 * Live writes go through one chain: an attempt and its complication arrive
 * moments apart. The replay covers an earlier window, so the two only meet
 * on a day's scout total, which is updated in a transaction.
 */

const DAY_MS = 86_400_000;
/** Attempts and day totals kept — the card value table looks back 30 days. */
const ATTEMPT_RETENTION_MS = 45 * DAY_MS;
/** Cards kept — only the last week of the board feeds supply and the suggestion. */
const CARD_RETENTION_MS = 14 * DAY_MS;
const PRUNE_INTERVAL_MS = 12 * 3_600_000;
const REPLAY_BATCH = 100;
const REPLAY_ENDPOINTS = ['GET /api/panel.php?type=street_intel', 'POST /actions/street_intel.php'];

const workerStartedAt = Date.now();
let lastPruneAt = 0;

/** Resolves once the seed is in (or failed to load), so the tab never waits
 *  on the archive replay. */
let seedReady: Promise<void> = Promise.resolve();
let chain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task).catch((err) => console.error(LOG_PREFIX, 'street intel analytics write failed', err));
  return chain;
}

type Observed = Pick<RecordRequestInput, 'method' | 'url' | 'requestBody' | 'responseText' | 'origin' | 'timestamp'>;

/** Every request the archive sees passes through here; only Street Intel's are kept. */
export function observeStreetIntelTraffic(input: Observed): void {
  if (!input.url.includes('street_intel') || input.timestamp <= ANALYTICS_SEED_CUTOFF) return;
  void enqueue(() => ingest(input));
}

async function ingest(input: Observed): Promise<void> {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return;
  }
  if (input.method === 'GET' && url.pathname.endsWith('/api/panel.php') && url.searchParams.get('type') === 'street_intel') {
    await ingestPanel(input.responseText, input.timestamp);
    return;
  }
  if (input.method !== 'POST' || !url.pathname.endsWith('/actions/street_intel.php') || !input.requestBody) return;
  // Cheap check before parsing: scouts, attempts and complications are all that's kept.
  if (!/action=(scout|attempt|complication)\b/.test(input.requestBody)) return;

  let resp: Record<string, unknown>;
  try {
    resp = JSON.parse(input.responseText);
  } catch {
    return;
  }
  if (resp?.ok !== true) return;
  const params = new URLSearchParams(input.requestBody);
  const action = params.get('action');
  const id = Number(params.get('opportunity_id'));
  if (!Number.isFinite(id) || id <= 0) return;

  if (action === 'scout') await ingestScout(resp, input.timestamp);
  else if (action === 'attempt') await ingestAttempt(id, resp, input.origin, input.timestamp);
  else if (action === 'complication') await ingestComplication(id, resp);
}

async function ingestPanel(responseText: string, at: number): Promise<void> {
  const opportunities = parseStreetIntelOpportunities(responseText)?.filter((o) => o.rewardMax > 0 && o.staminaCost > 0);
  if (!opportunities?.length) return;
  const existing = await db.siCards.bulkGet(opportunities.map((o) => o.id));
  await db.siCards.bulkPut(
    opportunities.map((o, i) => ({
      id: o.id,
      firstSeen: Math.min(existing[i]?.firstSeen ?? at, at),
      lastSeen: Math.max(existing[i]?.lastSeen ?? at, at),
      risk: o.riskTier,
      legendary: o.legendary,
      rewardMin: o.rewardMin,
      rewardMax: o.rewardMax,
      stamina: o.staminaCost,
      scoutCost: o.scoutCost,
    })),
  );
}

async function ingestScout(resp: Record<string, unknown>, at: number): Promise<void> {
  // A `cached` re-scout of a card already scouted is free.
  if (resp.cached === true) return;
  const day = gameDay(at);
  const cost = typeof resp.scout_cost === 'number' ? resp.scout_cost : 1;
  await db.transaction('rw', db.siDays, async () => {
    const existing = await db.siDays.get(day);
    await db.siDays.put({ day, scoutStamina: (existing?.scoutStamina ?? 0) + cost });
  });
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function dropsOf(resp: Record<string, unknown>): SiDrop[] {
  const drops: SiDrop[] = [];
  for (const key of ['loot_drop', 'hw26Drop']) {
    const d = resp[key] as Record<string, unknown> | null | undefined;
    if (!d || typeof d !== 'object') continue;
    drops.push({
      name: typeof d.name === 'string' ? d.name : '',
      quality: typeof d.quality === 'string' ? d.quality : null,
      type: typeof d.type === 'string' ? d.type : null,
      header: Boolean(d.header),
    });
  }
  return drops;
}

async function ingestAttempt(id: number, resp: Record<string, unknown>, origin: Observed['origin'], at: number): Promise<void> {
  if (await db.siAttempts.get(id)) return; // already recorded (archive replay overlap)
  const card = await db.siCards.get(id);
  const record: SiAttemptRecord = {
    id,
    at,
    origin,
    band: typeof resp.outcome_band === 'string' ? resp.outcome_band : '',
    reward: num(resp.reward_cash),
    jailSeconds: num(resp.jail_time),
    complication: resp.has_complication === true,
    complicationSuccess: null,
    cashLost: 0,
    drops: dropsOf(resp),
    card: card
      ? { risk: card.risk, legendary: card.legendary, rewardMin: card.rewardMin, rewardMax: card.rewardMax, stamina: card.stamina, scoutCost: card.scoutCost }
      : null,
  };
  await db.siAttempts.put(record);
}

async function ingestComplication(id: number, resp: Record<string, unknown>): Promise<void> {
  if (typeof resp.comp_success !== 'boolean') return;
  const attempt = await db.siAttempts.get(id);
  if (!attempt || attempt.complicationSuccess !== null) return;
  // Same split the complication tally reads: hand + bank, else the older single field.
  const cashLost = resp.comp_success ? 0 : num(resp.cash_lost_from_hand) + num(resp.cash_lost_from_bank) || num(resp.cash_lost);
  await db.siAttempts.put({ ...attempt, complicationSuccess: resp.comp_success, cashLost, drops: [...attempt.drops, ...dropsOf(resp)] });
}

/** Imports the seed once per install; returns where the archive replay
 *  stands (null once it's done, or if 0.52.0 already finished it). */
async function importSeed(): Promise<StreetIntelAnalyticsSeedState | null> {
  const state = await storage.getStreetIntelAnalyticsSeeded();
  if (typeof state === 'number') return null;
  if (state) return state.replayedThrough < state.replayUntil ? state : null;
  const startedAt = Date.now();
  await db.transaction('rw', [db.siAttempts, db.siCards, db.siDays], async () => {
    await db.siAttempts.bulkPut(seedAttempts());
    await db.siCards.bulkPut(seedCards());
    await db.siDays.bulkPut(seedDays());
  });
  const next = { cutoff: ANALYTICS_SEED_CUTOFF, replayUntil: workerStartedAt, replayedThrough: ANALYTICS_SEED_CUTOFF };
  await storage.setStreetIntelAnalyticsSeeded(next);
  console.info(LOG_PREFIX, `street intel analytics: seed imported in ${Date.now() - startedAt} ms`);
  return next;
}

/** Feeds archived Street Intel traffic after `replayedThrough` and before
 *  `replayUntil` through the same ingest as live traffic, oldest first,
 *  saving progress after every batch. */
async function replayArchive(state: StreetIntelAnalyticsSeedState): Promise<void> {
  const startedAt = Date.now();
  const keys: number[] = [];
  for (const endpoint of REPLAY_ENDPOINTS) {
    const ids = (await db.requestLog
      .where('[endpoint+timestamp]')
      .between([endpoint, state.replayedThrough], [endpoint, state.replayUntil], false, false)
      .primaryKeys()) as number[];
    keys.push(...ids);
  }
  // Ids are assigned in write order, which is time order.
  keys.sort((a, b) => a - b);
  let replayed = 0;
  let through = state.replayedThrough;
  for (let offset = 0; offset < keys.length; offset += REPLAY_BATCH) {
    const rows = await db.requestLog.bulkGet(keys.slice(offset, offset + REPLAY_BATCH));
    for (const row of rows) {
      if (!row) continue;
      try {
        const [responseText, requestBody] = await Promise.all([
          decompressText(row.responseBody, row.encoding),
          row.requestBody ? decompressText(row.requestBody, row.encoding) : Promise.resolve(null),
        ]);
        await ingest({ method: row.method, url: row.url, requestBody, responseText, origin: row.origin, timestamp: row.timestamp });
        replayed++;
      } catch {
        // One unreadable row shouldn't stop the replay.
      }
      through = Math.max(through, row.timestamp);
    }
    await storage.setStreetIntelAnalyticsSeeded({ ...state, replayedThrough: through });
  }
  await storage.setStreetIntelAnalyticsSeeded({ ...state, replayedThrough: state.replayUntil });
  console.info(LOG_PREFIX, `street intel analytics: replayed ${replayed} of ${keys.length} archived requests in ${Date.now() - startedAt} ms`);
}

async function prune(): Promise<void> {
  const now = Date.now();
  lastPruneAt = now;
  await db.siAttempts.where('at').below(now - ATTEMPT_RETENTION_MS).delete();
  await db.siCards.where('firstSeen').below(now - CARD_RETENTION_MS).delete();
  await db.siDays.where('day').below(gameDay(now - ATTEMPT_RETENTION_MS)).delete();
}

export function initStreetIntelAnalytics(): void {
  const imported = importSeed();
  seedReady = imported.then(
    () => undefined,
    (err) => console.error(LOG_PREFIX, 'street intel analytics seed import failed', err),
  );
  // Live traffic waits for the seed, so a live attempt can't be overwritten by it.
  chain = seedReady;
  void imported
    .then(async (state) => {
      if (state) await replayArchive(state);
      await prune();
    })
    .catch((err) => console.error(LOG_PREFIX, 'street intel analytics archive replay failed', err));
}

/** The Analytics tab's summary. Waits for the seed import and the live
 *  writes queued so far — never for the archive replay. */
export async function getStreetIntelAnalytics(): Promise<StreetIntelAnalytics> {
  if (Date.now() - lastPruneAt > PRUNE_INTERVAL_MS) void enqueue(prune);
  await seedReady;
  await chain;
  const now = Date.now();
  const [attempts, cards, days, config, book] = await Promise.all([
    db.siAttempts.where('at').above(now - 31 * DAY_MS).toArray(),
    // Every card kept, not a shorter window: the supply days can reach
    // further back than a week when days are missing.
    db.siCards.where('firstSeen').above(now - CARD_RETENTION_MS).toArray(),
    db.siDays.toArray(),
    storage.getStreetIntelAutoConfig(),
    storage.getQuickSellPriceBook(),
  ]);
  const prices = new Map(Object.entries(seedPrices()));
  for (const [name, quote] of Object.entries(book.quotesByName)) prices.set(name, quote.cash);
  const analytics = buildStreetIntelAnalytics(attempts, cards, days, prices, config, now, Math.max(now - CARD_RETENTION_MS, ANALYTICS_SEED_CARDS_FROM));
  const oldest = await db.siAttempts.orderBy('at').first();
  return { ...analytics, since: oldest?.at ?? null };
}
