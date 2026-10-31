import { clockTime } from './careerAutoDisplay';
import type { StreetIntelAutoWaiting, StreetIntelScoutMode } from './types';

/** The Scouting choice, as the popup and the in-page panel both show it:
 *  name, a one-line summary, and what it actually does. */
export const SCOUT_MODE_OPTIONS: { value: StreetIntelScoutMode; label: string; summary: string; detail: string }[] = [
  {
    value: 'topPayout',
    label: 'Top 2 by payout',
    summary: 'Scouts the 2 highest-paying cards each cycle.',
    detail: 'The original method: scout the two highest-paying cards, then attempt whichever has the best odds × reward.',
  },
  {
    value: 'smart',
    label: 'Smart',
    summary: 'Only scouts cards that could still beat the best found.',
    detail:
      'Ranks cards by the best odds they could possibly have (the highest base ever seen for their risk tier, best possible conditions) and stops scouting once nothing left could beat the best card already scouted. The attempt itself is always chosen on the real scouted odds.',
  },
  {
    value: 'exact',
    label: 'Smart, exact odds',
    summary: 'Like Smart, but ranks cards by their real odds.',
    detail:
      'Same as Smart, but each card is ranked by its actual odds — the base from the game’s wiki, the card’s own conditions and your bonuses, matching the scout 99% of the time — and a card predicted under your minimum success % isn’t scouted at all.',
  },
  {
    value: 'blind',
    label: 'Go blind (test)',
    summary: 'Attempts without scouting when a card’s odds are known.',
    detail:
      'Skips the scout and attempts the best card whose worked-out odds clear your minimum success %, the way the game’s own Go Blind button does — saving the Scout Stamina (about 45 a day). If no card can be worked out or none clears, that cycle scouts as Smart, exact odds. A test of whether blind attempts land as often as scouted ones; the comparison is under Status.',
  },
];

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
