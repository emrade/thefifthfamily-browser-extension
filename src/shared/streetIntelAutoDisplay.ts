import { clockTime } from './careerAutoDisplay';
import type { StreetIntelAutoWaiting } from './types';

/** "$750k", "$1.2M" — a minimum card value, as the cards show it. */
export function formatFloor(amount: number): string {
  if (amount >= 1_000_000) return `$${Number((amount / 1_000_000).toFixed(2))}M`;
  return `$${Math.round(amount / 1_000)}k`;
}

/**
 * What Street Intel Auto-Attempt is waiting on, for the line under its Next
 * Check — shared by the popup tab and the in-page panel, same as
 * `careerWaitingText`. Countdown waits drop out once their time has passed:
 * the next check is moments away and will replace them.
 */
export function streetIntelWaitingText(waiting: StreetIntelAutoWaiting | null | undefined, minSuccessPct: number, now: number): string | null {
  if (!waiting) return null;
  if (waiting.kind === 'stamina') return `Waiting for ${waiting.need} Stamina (have ${waiting.have})`;
  if (waiting.kind === 'no-pick') return `Nothing on the board clears ${minSuccessPct}% yet`;
  if (waiting.kind === 'saving') {
    const target = waiting.floor > 0 ? `cards paying ${formatFloor(waiting.floor)}+` : 'cards that meet the extreme minimum';
    return `Saving Stamina for ${target} (${waiting.have}/${waiting.releaseAt} before it takes any card)`;
  }
  if (waiting.until <= now) return null;
  const label = { cooldown: 'On cooldown', jail: 'In jail', hospital: 'In hospital', travel: 'Travelling' }[waiting.kind];
  return `${label} until ${clockTime(waiting.until)}`;
}
