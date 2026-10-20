import { db } from './db';
import type { LaunchPet, PetRosterEntry } from './types';

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

/**
 * Folds the "Send Every Courier" block's couriers into the roster: a pet
 * already known gets its current name and carry, a new one (just unlocked in
 * the Menagerie) is added with what the block shows. The crew cards, the
 * roster's other source, only appear with no deliveries out, so without this
 * a capacity gain or a new pet could go unseen for days.
 */
export async function learnLaunchPets(pets: LaunchPet[], at = Date.now()): Promise<void> {
  if (pets.length === 0) return;
  const known = await db.petRoster.bulkGet(pets.map((p) => p.userPetId));
  const entries = pets.map((p, i): PetRosterEntry => {
    const prev = known[i];
    if (prev) return { ...prev, name: p.name, capacity: p.carry, draftBlockedReason: null, lastSeen: at };
    return {
      userPetId: p.userPetId,
      name: p.name,
      tier: '',
      capacity: p.carry,
      travelPenaltyPct: 0,
      milestoneCurrent: null,
      milestoneMax: null,
      pointsNeededForNextMilestone: null,
      nextMilestoneCapacity: null,
      nextMilestoneTravelPenaltyPct: null,
      draftBlockedReason: null,
      lastSeen: at,
    };
  });
  await db.petRoster.bulkPut(entries);
}
