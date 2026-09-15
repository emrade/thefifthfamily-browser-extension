import type { FightClubRecon } from '@/shared/types';

/**
 * Parses `GET /actions/attack.php?type=recon&target_id=X` — see
 * `FightClubRecon`'s own doc in shared/types.ts for what this endpoint is and
 * why it's read directly rather than through gameAction.ts.
 *
 * `timestamp` isn't in the response — the caller's capture time is used
 * instead (or `Date.now()` for a scan-triggered fetch that isn't itself a
 * capture), since nothing here needs it to be more precise than "how stale is
 * this badge".
 */
export function parseRecon(responseText: string, timestamp: number): FightClubRecon | null {
  let json: any;
  try {
    json = JSON.parse(responseText);
  } catch {
    return null;
  }

  const r = json?.recon;
  if (json?.ok !== true || !r || typeof r.target_id !== 'number') return null;

  return {
    targetId: r.target_id,
    username: typeof r.username === 'string' ? r.username : '',
    level: Number(r.level) || 0,
    respect: Number(r.respect) || 0,
    combatRating: Number(r.combat_rating) || 0,
    family: typeof r.family === 'string' ? r.family : '',
    online: !!r.online,
    jailed: !!r.jailed,
    hospitalized: !!r.hospitalized,
    targetWeapon: typeof r.target_weapon === 'string' ? r.target_weapon : '',
    targetArmor: typeof r.target_armor === 'string' ? r.target_armor : '',
    myWeapon: typeof r.my_weapon === 'string' ? r.my_weapon : '',
    myArmor: typeof r.my_armor === 'string' ? r.my_armor : '',
    successChance: Number(r.success_chance) || 0,
    threatLevel: typeof r.threat_level === 'string' ? r.threat_level : '',
    stealEstimate: typeof r.steal_estimate === 'string' ? r.steal_estimate : '',
    dailyAttacks: Number(r.daily_attacks) || 0,
    dailyLimit: Number(r.daily_limit) || 0,
    staminaCost: Number(r.stamina_cost) || 0,
    myStamina: Number(r.my_stamina) || 0,
    timestamp,
  };
}
