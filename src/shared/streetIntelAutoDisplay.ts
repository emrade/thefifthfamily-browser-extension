import { clockTime } from './careerAutoDisplay';
import type { StreetIntelAutoWaiting } from './types';

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
  if (waiting.until <= now) return null;
  const label = { cooldown: 'On cooldown', jail: 'In jail', hospital: 'In hospital', travel: 'Travelling' }[waiting.kind];
  return `${label} until ${clockTime(waiting.until)}`;
}
