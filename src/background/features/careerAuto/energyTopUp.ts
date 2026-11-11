import { CAREER_GOALS_ITEM_GAP_MS, CAREER_GOALS_MAX_ITEMS_PER_CHECK } from '@/shared/constants';
import { storage } from '@/shared/storage';
import { gameDay } from '@/shared/careerAdvisor';
import type { CareerAutoConfig, CareerEnergyStatus } from '@/shared/types';
import { postAction, sleep, type LiveStatus } from '../../gameAction';

/**
 * Career Auto's energy top-ups (each its own toggle, off by default): when a
 * shift is ready but energy is short, the free daily refill and/or energy
 * items. Called from `runner.ts` inside its guarded cycle, so it needs no
 * re-entrancy guard of its own. See docs/career-advisor-plan.md.
 */

/** Thrown for a response this code doesn't recognise; the runner pauses. */
export class EnergyTopUpError extends Error {}

async function updateStatus(change: (s: CareerEnergyStatus) => Partial<CareerEnergyStatus>): Promise<void> {
  const status = await storage.getCareerEnergyStatus();
  await storage.setCareerEnergyStatus({ ...status, ...change(status) });
}


/** The energy items the player agreed may be used (2026-11-10), by the exact
 *  names `inventory.php quick_list&stat=energy` returns (archive, Aug–Nov
 *  2026: Energy Drink +10, Energy Booster +15, Adrenaline Shot +25, 2x Energy
 *  Drink +20; Energy Supplement is "2x Regen 1h" and isn't one). */
const ENERGY_ITEMS = new Set(['Energy Drink', '2x Energy Drink', 'Energy Booster', 'Adrenaline Shot']);
const KEPT_ITEM = 'Energy Drink';

interface EnergyItem {
  invId: number;
  name: string;
  qty: number;
  amount: number;
}

async function listEnergyItems(keep: number): Promise<EnergyItem[]> {
  const list = await postAction('/actions/inventory.php', { action: 'quick_list', stat: 'energy' });
  if (list?.ok !== true || !Array.isArray(list.items)) throw new EnergyTopUpError('Unexpected response listing energy items — the game may have changed something.');
  const items: EnergyItem[] = [];
  for (const it of list.items) {
    const amount = /^\+(\d+) Energy$/.exec(String(it?.short ?? ''));
    if (!ENERGY_ITEMS.has(it?.name) || !amount || typeof it.inv_id !== 'number' || typeof it.qty !== 'number') continue;
    const usable = it.name === KEPT_ITEM ? it.qty - keep : it.qty;
    if (usable > 0) items.push({ invId: it.inv_id, name: it.name, qty: usable, amount: Number(amount[1]) });
  }
  return items;
}

/**
 * The mix of items to use for a gap of `need`, never past `room` (max energy
 * minus current: the game drops the excess, "+28 Energy" at the cap), at
 * most `maxItems` in all. Picks the mix that leaves the least energy over
 * (2 Energy Drinks, 1 over, for a gap of 19 rather than an Adrenaline Shot,
 * 6 over); ties go to fewer items, then to the items you hold most of.
 * Empty when no mix covers the gap: then it waits for regen rather than
 * spending items that only shorten the wait.
 */
export function planItems(items: EnergyItem[], need: number, room: number, maxItems: number): EnergyItem[] {
  const usable = items.filter((i) => i.amount > 0 && i.amount <= room && i.qty > 0);
  let best: { counts: number[]; over: number; n: number; held: number } | null = null;
  const counts = usable.map(() => 0);
  const visit = (k: number, sum: number, n: number) => {
    if (sum > room) return;
    if (k === usable.length) {
      if (sum < need || n === 0) return;
      const over = sum - need;
      // Prefer items held in quantity: the sum of the qty of each one used.
      const held = counts.reduce((h, c, i) => h + (c > 0 ? usable[i].qty : 0), 0);
      if (!best || over < best.over || (over === best.over && (n < best.n || (n === best.n && held > best.held)))) {
        best = { counts: [...counts], over, n, held };
      }
      return;
    }
    for (let c = 0; c <= Math.min(usable[k].qty, maxItems - n); c++) {
      counts[k] = c;
      visit(k + 1, sum + c * usable[k].amount, n + c);
    }
    counts[k] = 0;
  };
  visit(0, 0, 0);
  const chosen = best as { counts: number[] } | null;
  if (!chosen) return [];
  // Biggest first: if one use fails part-way, the most energy is already in.
  return usable.flatMap((item, i) => Array<EnergyItem>(chosen.counts[i]).fill(item)).sort((x, y) => y.amount - x.amount);
}

/** Last game day the free energy refill was seen still unused (in memory: a
 *  restart costs one more `list`). */
let refillSeenUnusedDay: string | null = null;

/** Whether today's free energy refill is still unused. Asks the game at most
 *  once per game day while it is; a refill used by hand is noticed then, or
 *  by the next `refillAfterShift`. */
async function refillStillUnused(status: CareerEnergyStatus): Promise<boolean> {
  const day = gameDay();
  if (status.refillDoneDay === day) return false;
  if (refillSeenUnusedDay === day) return true;
  const list = await postAction('/actions/free_refill.php', { action: 'list' });
  if (list?.ok !== true || !Array.isArray(list.remaining)) throw new EnergyTopUpError('Unexpected response listing free refills — the game may have changed something.');
  if (list.remaining.includes('energy')) {
    refillSeenUnusedDay = day;
    return true;
  }
  await updateStatus(() => ({ refillDoneDay: day }));
  return false;
}

async function useFreeRefill(status: CareerEnergyStatus): Promise<boolean> {
  const day = gameDay();
  if (status.refillDoneDay === day) return false;
  refillSeenUnusedDay = null;
  const list = await postAction('/actions/free_refill.php', { action: 'list' });
  if (list?.ok !== true || !Array.isArray(list.remaining)) throw new EnergyTopUpError('Unexpected response listing free refills — the game may have changed something.');
  if (!list.remaining.includes('energy')) {
    await updateStatus(() => ({ refillDoneDay: day }));
    return false;
  }
  const resp = await postAction('/actions/free_refill.php', { action: 'refill', stat: 'energy' });
  if (resp?.ok !== true || !/energy restored/i.test(String(resp.message ?? ''))) {
    throw new EnergyTopUpError(`Unexpected response using the free energy refill${resp?.error ? `: ${resp.error}` : ''}.`);
  }
  await updateStatus(() => ({ refillDoneDay: day }));
  return true;
}

/** Next daily reset, 23:00 UTC (checked on 60 refill resets, Sep 1 – Nov 10
 *  2026: every one came back in a window containing 23:00 UTC). */
export function nextGameReset(now = Date.now()): number {
  const d = new Date(now);
  const reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23);
  return reset > now ? reset : reset + 86_400_000;
}

/**
 * The free refill fills energy to max, so whatever is on hand when it's used
 * is lost. It's used right after a shift (`refillAfterShift`), when energy is
 * at its lowest — usually 0. Before a shift only as a last resort: the
 * refill is still unused and regen won't reach the shift's cost before the
 * daily reset, which would lose the whole refill instead.
 */
function refillDeadlinePassed(live: LiveStatus, shiftCost: number, now = Date.now()): boolean {
  if (live.energyRegenSeconds <= 0) return false;
  const points = shiftCost - live.energy;
  const readyAt = now + (Math.max(0, live.energyTimerSeconds) + Math.max(0, points - 1) * live.energyRegenSeconds) * 1000;
  return readyAt >= nextGameReset(now);
}

/**
 * Called when Career Auto's shift is ready (off cooldown) but energy is short.
 * Energy items cover the gap with the least left over, but only once today's
 * free refill is used (or its switch is off). The free refill is not used here (it would
 * overwrite the energy on hand), except when it would otherwise expire at the
 * reset. Returns the energy it thinks it added (refill counts as filling to
 * max); 0 = nothing used, so the runner waits for regen. Throws
 * `EnergyTopUpError` (pause) on a response it doesn't recognise;
 * jail/hospital/travel throw postAction's own status-blocked error.
 */
export async function topUpEnergy(config: CareerAutoConfig, live: LiveStatus, shiftCost: number): Promise<number> {
  if (!config.useFreeRefill && !config.useEnergyItems) return 0;
  if (live.energy >= shiftCost || shiftCost > live.maxEnergy) return 0;

  if (config.useFreeRefill && refillDeadlinePassed(live, shiftCost) && (await useFreeRefill(await storage.getCareerEnergyStatus()))) {
    return live.maxEnergy - live.energy;
  }
  if (!config.useEnergyItems) return 0;
  // While today's refill is unused, items wait too: regen reaches the shift,
  // the shift leaves ~0, and the refill goes in after it. An item now would
  // leave energy over that the refill then overwrites (2026-11-11: Adrenaline
  // Shot at 10/29, 6 left after the shift, lost to the refill).
  if (config.useFreeRefill && (await refillStillUnused(await storage.getCareerEnergyStatus()))) return 0;

  const plan = planItems(await listEnergyItems(Math.max(0, config.energyDrinkKeep)), shiftCost - live.energy, live.maxEnergy - live.energy, CAREER_GOALS_MAX_ITEMS_PER_CHECK);
  let energy = live.energy;
  let added = 0;
  for (const [n, item] of plan.entries()) {
    if (energy >= shiftCost) break;
    if (n > 0) await sleep(CAREER_GOALS_ITEM_GAP_MS[0] + Math.random() * (CAREER_GOALS_ITEM_GAP_MS[1] - CAREER_GOALS_ITEM_GAP_MS[0]));
    const used = await postAction('/actions/inventory.php', { action: 'use', inv_id: item.invId });
    // "Item not found in inventory": the list was stale (seen 12 times in the
    // archive, all manual). Try again next check rather than pausing.
    if (used?.ok === false && /item not found/i.test(String(used.error ?? ''))) break;
    const restored = used?.ok === true ? /restored\s+(\d+)\s+energy/i.exec(String(used.message ?? '')) : null;
    if (!restored) throw new EnergyTopUpError(`Unexpected response using ${item.name}${used?.error ? `: ${used.error}` : ''} — the game may have changed something.`);
    const got = Number(restored[1]);
    energy += got;
    added += got;
    const day = gameDay();
    await updateStatus((s) => {
      const fresh = s.itemDay === day ? s : { ...s, itemsUsed: {}, itemEnergy: 0 };
      return { itemDay: day, itemsUsed: { ...fresh.itemsUsed, [item.name]: (fresh.itemsUsed[item.name] ?? 0) + 1 }, itemEnergy: fresh.itemEnergy + got };
    });
  }
  return added;
}

/**
 * Straight after a shift, with the energy the shift response reports: if
 * it's below the next shift's cost, this is the lowest energy will get
 * (usually 0), so the free refill loses nothing. Returns whether it was used.
 */
export async function refillAfterShift(config: CareerAutoConfig, energyAfter: number, nextShiftCost: number, maxEnergy: number): Promise<boolean> {
  if (!config.useFreeRefill) return false;
  if (!Number.isFinite(energyAfter) || energyAfter >= nextShiftCost || nextShiftCost > maxEnergy) return false;
  return useFreeRefill(await storage.getCareerEnergyStatus());
}
