import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { CapturedRequest } from '@/shared/messaging';
import { parseTicketExchange, stateFromExchange, stateWithWin } from '@/shared/arenaMastery';

/**
 * Keeps Arena Mastery progress (`@/shared/arenaMastery`) current from requests
 * the page already makes — nothing is ever fetched for it:
 *
 * - Opening the Ticket Exchange (`GET /api/panel.php?…av2_view=shop…type=arena`)
 *   replaces the record with the game's own (`data-unlocked` per boss).
 * - A won boss fight (`POST /actions/arena_v2.php` `action=attack`,
 *   `opponent_id=0`, `won: true`) marks that boss beaten until the next read.
 *
 * Writes are chained so a win landing while an Exchange read is still saving
 * can't be lost.
 */

let chain: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): void {
  chain = chain.then(task).catch((err) => console.error(LOG_PREFIX, 'arena mastery update failed', err));
}

export function handleCapturedRequest(req: CapturedRequest): void {
  if (req.method === 'GET' && req.url.includes('/api/panel.php')) {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return;
    }
    if (url.searchParams.get('type') !== 'arena' || url.searchParams.get('av2_view') !== 'shop') return;
    let html: string;
    try {
      html = JSON.parse(req.responseText)?.html ?? '';
    } catch {
      return;
    }
    const snapshot = parseTicketExchange(html);
    if (!snapshot) {
      console.error(LOG_PREFIX, 'arena mastery: the Ticket Exchange page did not parse — has its layout changed?');
      return;
    }
    enqueue(() => storage.setArenaMastery(stateFromExchange(snapshot, req.timestamp)));
    return;
  }

  if (req.method !== 'POST' || !req.url.includes('/actions/arena_v2.php')) return;
  const params = new URLSearchParams(req.requestBody ?? '');
  if (params.get('action') !== 'attack' || params.get('opponent_id') !== '0') return;
  let data: { ok?: boolean; won?: boolean; defender?: string };
  try {
    data = JSON.parse(req.responseText);
  } catch {
    return;
  }
  if (data?.ok !== true || data.won !== true || typeof data.defender !== 'string') return;
  const boss = data.defender;
  enqueue(async () => {
    const state = await storage.getArenaMastery();
    const next = stateWithWin(state, boss);
    if (next !== state) await storage.setArenaMastery(next);
  });
}
