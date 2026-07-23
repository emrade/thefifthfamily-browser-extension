import type { LastSmugglingContext, PendingCustoms, PendingTravel, PlayerStatsSnapshot } from './types';
import { STORAGE_KEYS } from './constants';

async function get<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T) ?? fallback;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

async function remove(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

export const storage = {
  getLatestStats: () => get<PlayerStatsSnapshot | null>(STORAGE_KEYS.LATEST_STATS, null),
  setLatestStats: (v: PlayerStatsSnapshot) => set(STORAGE_KEYS.LATEST_STATS, v),

  getPendingTravel: () => get<PendingTravel | null>(STORAGE_KEYS.PENDING_TRAVEL, null),
  setPendingTravel: (v: PendingTravel) => set(STORAGE_KEYS.PENDING_TRAVEL, v),
  clearPendingTravel: () => remove(STORAGE_KEYS.PENDING_TRAVEL),

  getSmugglingContext: () => get<LastSmugglingContext | null>(STORAGE_KEYS.LAST_SMUGGLING_CONTEXT, null),
  setSmugglingContext: (v: LastSmugglingContext) => set(STORAGE_KEYS.LAST_SMUGGLING_CONTEXT, v),

  getPendingCustoms: () => get<PendingCustoms | null>(STORAGE_KEYS.PENDING_CUSTOMS, null),
  setPendingCustoms: (v: PendingCustoms) => set(STORAGE_KEYS.PENDING_CUSTOMS, v),
  clearPendingCustoms: () => remove(STORAGE_KEYS.PENDING_CUSTOMS),

  clearAll: () => chrome.storage.local.remove(Object.values(STORAGE_KEYS)),
};
