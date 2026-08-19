import { db } from './db';
import type { PetRosterEntry } from './types';

/**
 * Upserts whatever pets a `smug_tab=proto` capture happened to reveal — see
 * docs/smuggling-v2-plan.md: the full roster (with `user_pet_id`) is only visible
 * when the account has zero active shipments, so this is opportunistic, not called
 * on every panel view. Never removes a pet — a pet not present in this particular
 * snapshot just wasn't visible, not sold or lost.
 */
export async function upsertRoster(entries: PetRosterEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db.petRoster.bulkPut(entries);
}

export async function getRoster(): Promise<PetRosterEntry[]> {
  return db.petRoster.toArray();
}
