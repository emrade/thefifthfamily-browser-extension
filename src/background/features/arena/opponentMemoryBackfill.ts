import { STORAGE_KEYS } from '@/shared/constants';
import { db } from '@/shared/db';
import { LOG_PREFIX } from '@/shared/log';
import { decompressText } from '@/shared/requestLog/compress';
import { mergeMemory, rememberFight, type ArenaOpponentMemory } from '@/shared/arenaOpponentMemory';
import { storage } from '@/shared/storage';

/**
 * Seeds the Arena opponent memory (shared/arenaOpponentMemory.ts) once, from
 * the regular fights in the extension's own request archive, so opponents
 * already fought are remembered from the start rather than only after the
 * next fight. Runs once per profile (a flag in storage); the live capture in
 * the Fight Advisor keeps it current afterwards.
 */

const ATTACK_ENDPOINT = 'POST /actions/arena_v2.php';
/** Upper bound only. The request archive is capped at ~100 MB, which in
 *  practice holds 1.4–2 days (export headers, Oct 30 – Nov 3), so this
 *  seeds from whatever is left of that. */
const BACKFILL_DAYS = 14;

export async function backfillOpponentMemory(): Promise<void> {
  const flag = await chrome.storage.local.get(STORAGE_KEYS.ARENA_OPPONENT_MEMORY_SEEDED);
  if (flag[STORAGE_KEYS.ARENA_OPPONENT_MEMORY_SEEDED]) return;

  const since = Date.now() - BACKFILL_DAYS * 86_400_000;
  const rows = await db.requestLog.where('[endpoint+timestamp]').between([ATTACK_ENDPOINT, since], [ATTACK_ENDPOINT, Infinity]).toArray();
  let seeded: ArenaOpponentMemory = {};
  for (const row of rows.sort((a, b) => a.timestamp - b.timestamp)) {
    if (!row.requestBody) continue;
    try {
      const body = new URLSearchParams(await decompressText(row.requestBody, row.encoding));
      if (body.get('action') !== 'attack' || body.get('opponent_id') === '0') continue;
      seeded = rememberFight(seeded, JSON.parse(await decompressText(row.responseBody, row.encoding)), row.timestamp);
    } catch {
      // A truncated or unreadable row is skipped; the rest still count.
    }
  }

  // Joined with anything already stored (live captures, an import): fights
  // are keyed by capture time, so nothing counts twice.
  const merged = mergeMemory(await storage.getArenaOpponentMemory(), seeded);
  await storage.setArenaOpponentMemory(merged);
  await chrome.storage.local.set({ [STORAGE_KEYS.ARENA_OPPONENT_MEMORY_SEEDED]: true });
  console.info(LOG_PREFIX, `arena opponent memory seeded: ${Object.keys(seeded).length} opponents from ${rows.length} archived arena actions`);
}
