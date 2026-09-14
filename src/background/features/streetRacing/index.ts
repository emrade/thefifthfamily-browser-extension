import {
  GAME_ORIGIN,
  STREET_RACING_ACCURACY_MAX,
  STREET_RACING_ACCURACY_MEAN,
  STREET_RACING_ACCURACY_MIN,
  STREET_RACING_ACCURACY_STDDEV,
  STREET_RACING_MINIGAME_DELAY_MAX_MS,
  STREET_RACING_MINIGAME_DELAY_MEAN_MS,
  STREET_RACING_MINIGAME_DELAY_MIN_MS,
  STREET_RACING_MINIGAME_DELAY_STDDEV_MS,
} from '@/shared/constants';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { storage } from '@/shared/storage';
import type { RaceAttemptResult, RaceCatalog, RaceCatalogEntry, StreetRacingStatus } from '@/shared/types';
import { postAction, sleep } from '../../gameAction';

const DEFAULT_STATUS: StreetRacingStatus = {
  lastAttempt: null,
  attempts: 0,
  wins: 0,
  losses: 0,
  cashEarned: 0,
  xpEarned: 0,
};

/**
 * Standard normal sample (Box-Muller) rescaled to `mean`/`stddev` and clamped
 * to `[min, max]` — see `STREET_RACING_ACCURACY_MEAN`/
 * `STREET_RACING_MINIGAME_DELAY_MEAN_MS`'s own docs for why a continuous
 * distribution around this account's real history fits here, unlike Career
 * Auto's discrete `pickAccuracy` weighted-set approach.
 */
function sampleClampedNormal(mean: number, stddev: number, min: number, max: number): number {
  const u1 = Math.random() || Number.EPSILON; // never exactly 0 — log(0) is -Infinity
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.min(max, Math.max(min, Math.round(mean + z * stddev)));
}

function mapRace(raw: any): RaceCatalogEntry {
  return {
    id: raw.id,
    name: raw.name,
    opponentName: raw.opponent_name,
    opponentTitle: raw.opponent_title,
    cityName: raw.city_name,
    cashReward: raw.cash_reward,
    xpReward: raw.xp_reward,
    staminaCost: raw.stamina_cost,
    dailyAttempts: raw.daily_attempts,
    attemptsToday: raw.attempts_today,
    unlocked: !!raw.unlocked,
    requiredBossId: raw.required_boss_id,
    bossCleared: !!raw.boss_cleared,
    grudgeLocked: !!raw.grudge_locked,
    wins: raw.wins,
    losses: raw.losses,
    currentStreak: raw.current_streak,
    bestStreak: raw.best_streak,
  };
}

/** Sent by the overlay on mount/refresh — a live, uncached read the same way
 *  `fetchCareerCatalog` is, since the whole point is showing the player's
 *  real current unlocked/attempts-today state before they tap anything. */
export async function fetchCatalog(): Promise<RaceCatalog> {
  const res = await loggedFetch(`${GAME_ORIGIN}/actions/races_v2.php?action=get_all&_t=${Date.now()}`, { credentials: 'include' });
  const json: any = await res.json();
  if (!json?.ok) throw new Error('races_v2.php get_all did not return ok:true');

  return {
    weather: json.weather,
    weatherPct: json.weather_pct,
    car: {
      name: json.car?.name ?? '',
      category: json.car?.category ?? '',
      vehicleClass: json.car?.vehicle_class ?? '',
      topSpeed: json.car?.derived?.top_speed ?? 0,
      handling: json.car?.derived?.handling ?? 0,
      acceleration: json.car?.derived?.acceleration ?? 0,
    },
    races: ((json.races ?? []) as any[]).map(mapRace),
  };
}

/**
 * Runs one race exactly the way a manual player would: checks `can_race`
 * (the same stamina gate the live panel checks before letting you start),
 * waits out a sampled minigame delay, then submits a sampled `accuracy` —
 * see the constants' own docs for where both distributions came from. Throws
 * (via `postAction`'s `SystemicActionError`, or a plain `Error` for an
 * ordinary rejection like insufficient stamina) rather than swallowing
 * anything — this is a single tap-triggered action, not an unattended loop,
 * so the overlay is expected to surface the failure directly rather than
 * this needing its own pause/retry state.
 *
 * `tabId` (the tab that asked, from the message `sender` — same as
 * `runCourierBatch`'s own parameter) is where the 'street-race-progress'
 * broadcast goes right as the delay starts, so the overlay's progress bar
 * can be driven by the real sampled duration instead of guessing one.
 * Best-effort: `undefined` (or the tab having navigated away) just means no
 * one's listening, which changes nothing about the race itself.
 */
export async function runRace(raceId: number, raceName: string, tabId?: number): Promise<RaceAttemptResult> {
  const canRace = await postAction('/actions/races_v2.php', { action: 'can_race', race_id: raceId });
  if (canRace.ok === false) throw new Error(canRace.error || canRace.msg || 'This race can’t be attempted right now.');
  if (canRace.can_race === false) {
    throw new Error(`Not enough stamina for this race (needs ${canRace.stamina_cost}, have ${canRace.stamina}).`);
  }

  const delayMs = sampleClampedNormal(
    STREET_RACING_MINIGAME_DELAY_MEAN_MS,
    STREET_RACING_MINIGAME_DELAY_STDDEV_MS,
    STREET_RACING_MINIGAME_DELAY_MIN_MS,
    STREET_RACING_MINIGAME_DELAY_MAX_MS,
  );
  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, { type: 'street-race-progress', raceId, startedAt: Date.now(), durationMs: delayMs }).catch(() => {});
  }
  await sleep(delayMs);

  const accuracy = sampleClampedNormal(STREET_RACING_ACCURACY_MEAN, STREET_RACING_ACCURACY_STDDEV, STREET_RACING_ACCURACY_MIN, STREET_RACING_ACCURACY_MAX);
  const resp = await postAction('/actions/races_v2.php', { action: 'attempt_race', race_id: raceId, accuracy });
  if (resp.ok === false) throw new Error(resp.error || resp.msg || 'attempt_race was rejected.');

  const result: RaceAttemptResult = {
    timestamp: Date.now(),
    raceId,
    raceName,
    opponentName: resp.opponent_name,
    won: !!resp.won,
    accuracySent: accuracy,
    cashAwarded: resp.cash_awarded ?? 0,
    xpAwarded: resp.xp_awarded ?? 0,
    wins: resp.wins,
    losses: resp.losses,
    attemptsToday: resp.attempts_today,
    dailyCap: resp.daily_cap,
    currentStreak: resp.current_streak,
  };

  const status = (await storage.getStreetRacingStatus()) ?? DEFAULT_STATUS;
  await storage.setStreetRacingStatus({
    lastAttempt: result,
    attempts: status.attempts + 1,
    wins: status.wins + (result.won ? 1 : 0),
    losses: status.losses + (result.won ? 0 : 1),
    cashEarned: status.cashEarned + result.cashAwarded,
    xpEarned: status.xpEarned + result.xpAwarded,
  });

  return result;
}
