import type { CareerAutoConfig, CareerAutoWaiting } from './types';

/**
 * Wording shared by the popup's Career Auto tab and the in-page Careers panel,
 * so the two surfaces describe the same setting the same way.
 */

export const CAREER_SHIFT_MODE_OPTIONS: { value: CareerAutoConfig['shiftMode']; label: string }[] = [
  { value: 'normal', label: 'Normal shifts (rank up faster, default)' },
  { value: 'hybrid', label: 'Hybrid (Overtime when energy allows, else normal)' },
  { value: 'overtime', label: 'Overtime only (more cash and XP)' },
];

export const CAREER_SHIFT_MODE_HINT: Record<CareerAutoConfig['shiftMode'], string> = {
  normal: 'Normal shifts only. Rank goes by shift count, so this unlocks Rank Rewards twice as fast per energy as Overtime.',
  hybrid:
    'Overtime when you have the energy for it, otherwise a normal shift. Energy reaches the normal cost long before the Overtime one, so this ends up mostly normal shifts, with Overtime only when energy has built up.',
  overtime:
    'Waits until you have the energy for Overtime (2× energy, 3× cash and XP) and never runs a normal shift instead. Overtime only unlocks at rank 2, so a rank-1 job runs normal shifts until then. Each Overtime counts as one shift toward rank, so it ranks up half as fast per energy.',
};

/** "4:15 PM" in the viewer's locale. */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** What the runner is waiting on, for the line under Next Shift. Countdown
 *  waits drop out once their time has passed: the next check is moments away
 *  and will replace them. */
export function careerWaitingText(waiting: CareerAutoWaiting | null | undefined, now: number): string | null {
  if (!waiting) return null;
  if (waiting.kind === 'energy') {
    const by = waiting.readyAt ? `, enough by ~${clockTime(waiting.readyAt)}` : '';
    return `Waiting for ${waiting.need}E (have ${waiting.have}E${by})`;
  }
  if (waiting.until <= now) return null;
  const label = { cooldown: 'Job on cooldown', jail: 'In jail', hospital: 'In hospital', travel: 'Travelling' }[waiting.kind];
  return `${label} until ${clockTime(waiting.until)}`;
}
