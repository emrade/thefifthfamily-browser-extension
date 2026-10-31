import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { RecordRequestInput } from '@/shared/requestLog/record';
import { catalogCard, foldAttemptRank, foldScoutMods } from '@/shared/streetIntelPredict';
import { parseStreetIntelOpportunities } from './streetIntelPanelRegexParser';

/**
 * Keeps `PlayerIntelMods` (the player's own Street Intel modifiers, for
 * pre-scout odds) current from every scout and attempt — the page's and the
 * auto runner's alike, via the request archive's capture point, plus the
 * runner's own calls directly (so it still works with archive capture off).
 *
 * A scout response doesn't name its card, and mastery is per category, so the
 * latest board's id → title is kept in memory to look the category up. A
 * scout of a card not on a board this worker has seen still updates
 * everything but mastery.
 */

const titleById = new Map<number, string>();
let chain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((err) => console.error(LOG_PREFIX, 'street intel player mods update failed', err));
}

export function rememberBoard(opportunities: { id: number; title: string }[]): void {
  for (const o of opportunities) titleById.set(o.id, o.title);
  // A day of boards is a few hundred ids; drop the oldest past that.
  while (titleById.size > 2000) titleById.delete(titleById.keys().next().value!);
}

/** The first revealed estimate's modifiers — rank, prestige, collection,
 *  recon and mastery are the same on every approach of one card. */
function scoutModifiers(resp: Record<string, unknown>): Record<string, number> | null {
  const estimates = Array.isArray(resp.estimates) ? resp.estimates : [];
  for (const e of estimates as Record<string, unknown>[]) {
    const m = e?.modifiers;
    if (m && typeof m === 'object' && typeof e.estimate_pct === 'number') return m as Record<string, number>;
  }
  return null;
}

export function recordScout(opportunityId: number, resp: Record<string, unknown>, at: number): void {
  const modifiers = scoutModifiers(resp);
  if (!modifiers) return;
  const title = titleById.get(opportunityId);
  const category = title ? (catalogCard(title)?.category ?? null) : null;
  enqueue(async () => {
    const prev = await storage.getStreetIntelPlayerMods();
    if (prev && prev.updatedAt > at) return; // an older response arriving late
    await storage.setStreetIntelPlayerMods(foldScoutMods(prev, modifiers, category, at));
  });
}

export function recordAttempt(resp: Record<string, unknown>): void {
  if (typeof resp.rank !== 'number') return;
  const rank = resp.rank;
  enqueue(async () => {
    const prev = await storage.getStreetIntelPlayerMods();
    const next = foldAttemptRank(prev, rank);
    if (next && next !== prev) await storage.setStreetIntelPlayerMods(next);
  });
}

/** Archive observer — see background/index.ts. */
export function observeStreetIntelPlayerMods(input: RecordRequestInput): void {
  if (!input.url.includes('street_intel')) return;
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return;
  }
  if (input.method === 'GET' && url.searchParams.get('type') === 'street_intel') {
    const board = parseStreetIntelOpportunities(input.responseText);
    if (board) rememberBoard(board);
    return;
  }
  if (input.method !== 'POST' || !input.requestBody || !/action=(scout|attempt)\b/.test(input.requestBody)) return;
  let resp: Record<string, unknown>;
  try {
    resp = JSON.parse(input.responseText);
  } catch {
    return;
  }
  if (resp?.ok !== true) return;
  const params = new URLSearchParams(input.requestBody);
  const id = Number(params.get('opportunity_id'));
  if (params.get('action') === 'scout' && Number.isFinite(id)) recordScout(id, resp, input.timestamp);
  else if (params.get('action') === 'attempt') recordAttempt(resp);
}
