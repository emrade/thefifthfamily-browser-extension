import { CAREER_GOALS_REMINDER_MS } from '@/shared/constants';
import { notify } from '@/shared/notify';
import { storage } from '@/shared/storage';
import { goalState, perkTextAt } from '@/shared/careerAdvisor';
import type { CareersSnapshot } from '@/shared/statAdvisorSources';
import type { CareerAutoConfig, CareerGoal, CareerGoalsConfig, CareerGoalsStatus } from '@/shared/types';

/**
 * Career Advisor goal mode, called from `runner.ts` inside its guarded cycle
 * (one cycle at a time, through the automation queue), so nothing here needs
 * its own re-entrancy guard. See docs/career-advisor-plan.md.
 */

const ICON = () => chrome.runtime.getURL('icons/icon-128.png');
const REMINDER_NOTIFICATION_ID = 'ff-career-goals-finished';

async function updateStatus(change: (s: CareerGoalsStatus) => Partial<CareerGoalsStatus>): Promise<void> {
  const status = await storage.getCareerGoalsStatus();
  await storage.setCareerGoalsStatus({ ...status, ...change(status) });
}

/** Removes finished goals with a fresh read, so a goal the player added in
 *  the meantime isn't lost. */
async function removeGoals(done: CareerGoal[]): Promise<CareerGoalsConfig> {
  const config = await storage.getCareerGoalsConfig();
  const goals = config.goals.filter((g) => !done.some((d) => d.careerId === g.careerId && d.targetRank === g.targetRank));
  const next = { ...config, goals };
  await storage.setCareerGoalsConfig(next);
  return next;
}

async function reportDone(goal: CareerGoal, snapshot: CareersSnapshot | null): Promise<void> {
  const job = snapshot?.jobs.find((j) => j.id === goal.careerId);
  const perk = perkTextAt(job, goal.targetRank);
  await updateStatus((s) => ({ completed: [{ careerName: goal.careerName, targetRank: goal.targetRank, perk, at: Date.now() }, ...s.completed].slice(0, 10) }));
  await notify('careerGoalReached', {
    type: 'basic',
    iconUrl: ICON(),
    title: `Career goal reached: ${perk}`,
    message: `${goal.careerName} reached R${goal.targetRank}.`,
  });
}

export type GoalDecision =
  /** Goal mode off, or nothing to steer: run Career Auto as configured. */
  | { kind: 'none' }
  /** Working a goal's job. `normalOnly`: ranks count shifts, so Overtime
   *  (one shift for twice the energy) is never worth it for a goal. */
  | { kind: 'goal'; goal: CareerGoal }
  /** Career Auto was on another job: switched; check again shortly. */
  | { kind: 'switched'; goal: CareerGoal };

/**
 * Called at the start of each cycle with the Careers page just read. Drops
 * goals already reached (by Career Auto or by hand), reports level-locked
 * ones once, and makes sure Career Auto is on the first open goal's job.
 */
export async function steerToGoal(
  autoConfig: CareerAutoConfig,
  snapshot: CareersSnapshot | null,
  level: number | null,
): Promise<GoalDecision> {
  let config = await storage.getCareerGoalsConfig();
  if (!config.enabled || !snapshot) return { kind: 'none' };

  const done = config.goals.filter((g) => goalState(g, snapshot, level).kind === 'done');
  if (done.length) {
    for (const g of done) await reportDone(g, snapshot);
    config = await removeGoals(done);
    if (config.goals.length === 0) await markQueueFinished(autoConfig);
  }

  const status = await storage.getCareerGoalsStatus();
  let open: { goal: CareerGoal; energy: number; otEnergy: number | null } | null = null;
  for (const goal of config.goals) {
    const state = goalState(goal, snapshot, level);
    if (state.kind === 'locked') {
      if (!status.lockedNotified.includes(goal.careerId)) {
        await updateStatus((s) => ({ lockedNotified: [...s.lockedNotified, goal.careerId] }));
        await notify('careerGoalReached', {
          type: 'basic',
          iconUrl: ICON(),
          title: `Career goal waiting: ${goal.careerName}`,
          message: `Needs level ${state.level}. Skipped until then; working the next goal.`,
        });
      }
      continue;
    }
    if (state.kind === 'open' && state.job.energy !== undefined) {
      open = { goal, energy: state.job.energy, otEnergy: state.job.otEnergy ?? null };
      break;
    }
  }
  if (!open) return { kind: 'none' };

  if (autoConfig.careerId !== open.goal.careerId) {
    // Same fields the job picker writes. The config change itself schedules
    // the next check (runner `onConfigChanged`).
    await storage.setCareerAutoConfig({
      ...autoConfig,
      careerId: open.goal.careerId,
      careerName: open.goal.careerName,
      energyCost: open.energy,
      otEnergyCost: open.otEnergy,
    });
    return { kind: 'switched', goal: open.goal };
  }
  return { kind: 'goal', goal: open.goal };
}

/** After a shift on a goal's job: the response's own `rank` says whether the
 *  target was reached. */
export async function afterGoalShift(goal: CareerGoal, rank: number, snapshot: CareersSnapshot | null, autoConfig: CareerAutoConfig): Promise<void> {
  if (rank < goal.targetRank) return;
  await reportDone(goal, snapshot);
  const config = await removeGoals([goal]);
  if (config.enabled && config.goals.length === 0) await markQueueFinished(autoConfig);
}

async function markQueueFinished(autoConfig: CareerAutoConfig): Promise<void> {
  const now = Date.now();
  await updateStatus(() => ({ queueFinishedAt: now, queueFinishedCareerId: autoConfig.careerId, lastReminderAt: now }));
  await sendReminder(autoConfig.careerName);
}

async function sendReminder(careerName: string): Promise<void> {
  await notify(
    'careerGoalsFinished',
    {
      type: 'basic',
      iconUrl: ICON(),
      title: 'Career goals all done',
      message: `Career Auto keeps running ${careerName}. Add a goal or pick a job in Career Auto's Advisor tab, or press Keep running there to stop these reminders.`,
    },
    REMINDER_NOTIFICATION_ID,
  );
}

/** Every 4 h while the goal list stays finished. Stops when the player adds
 *  a goal, turns goal mode off, picks another job, or presses Keep running. */
export async function remindIfQueueFinished(autoConfig: CareerAutoConfig): Promise<void> {
  const status = await storage.getCareerGoalsStatus();
  if (status.queueFinishedAt === null) return;
  const config = await storage.getCareerGoalsConfig();
  if (!config.enabled || config.goals.length > 0 || autoConfig.careerId !== status.queueFinishedCareerId) {
    await clearQueueFinished();
    return;
  }
  if (Date.now() - (status.lastReminderAt ?? 0) < CAREER_GOALS_REMINDER_MS) return;
  await updateStatus(() => ({ lastReminderAt: Date.now() }));
  await sendReminder(autoConfig.careerName);
}

export async function clearQueueFinished(): Promise<void> {
  await updateStatus(() => ({ queueFinishedAt: null, queueFinishedCareerId: null, lastReminderAt: null }));
  chrome.notifications.clear(REMINDER_NOTIFICATION_ID);
}

/** Goals or goal mode changed in the Dashboard: a new goal ends the
 *  "all done" state; a goal that's no longer listed can be reported again. */
export async function onGoalsConfigChanged(config: CareerGoalsConfig): Promise<void> {
  const status = await storage.getCareerGoalsStatus();
  if (status.queueFinishedAt !== null && (!config.enabled || config.goals.length > 0)) await clearQueueFinished();
  const listed = new Set(config.goals.map((g) => g.careerId));
  if (status.lockedNotified.some((id) => !listed.has(id))) await updateStatus((s) => ({ lockedNotified: s.lockedNotified.filter((id) => listed.has(id)) }));
}
