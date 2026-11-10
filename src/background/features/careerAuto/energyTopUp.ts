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

/** Smallest item that covers the gap; else the biggest that fits. Never past
 *  max energy: the game drops the excess ("+28 Energy" at the cap). */
export function pickItem(items: EnergyItem[], need: number, room: number): EnergyItem | null {
  const fits = items.filter((i) => i.amount <= room);
  const covers = fits.filter((i) => i.amount >= need).sort((a, b) => a.amount - b.amount);
  if (covers.length) return covers[0];
  return fits.sort((a, b) => b.amount - a.amount)[0] ?? null;
}

async function useFreeRefill(status: CareerEnergyStatus): Promise<boolean> {
  const day = gameDay();
  if (status.refillDoneDay === day) return false;
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

/**
 * Called when Career Auto's shift is ready (off cooldown) but energy is short.
 * Free refill first when allowed (it fills to max and is lost at the reset),
 * then items. Returns the energy it thinks it added (refill counts as
 * filling to max); 0 = nothing used. Throws `EnergyTopUpError` (pause) on a
 * response it doesn't recognise; jail/hospital/travel throw postAction's own
 * status-blocked error.
 */
export async function topUpEnergy(config: CareerAutoConfig, live: LiveStatus, shiftCost: number): Promise<number> {
  if (!config.useFreeRefill && !config.useEnergyItems) return 0;
  if (live.energy >= shiftCost || shiftCost > live.maxEnergy) return 0;

  if (config.useFreeRefill && (await useFreeRefill(await storage.getCareerEnergyStatus()))) return live.maxEnergy - live.energy;
  if (!config.useEnergyItems) return 0;

  let energy = live.energy;
  let added = 0;
  for (let n = 0; n < CAREER_GOALS_MAX_ITEMS_PER_CHECK && energy < shiftCost; n++) {
    if (n > 0) await sleep(CAREER_GOALS_ITEM_GAP_MS[0] + Math.random() * (CAREER_GOALS_ITEM_GAP_MS[1] - CAREER_GOALS_ITEM_GAP_MS[0]));
    const item = pickItem(await listEnergyItems(Math.max(0, config.energyDrinkKeep)), shiftCost - energy, live.maxEnergy - energy);
    if (!item) break;
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
