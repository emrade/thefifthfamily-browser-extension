import {
  ALARM_NAMES,
  GAME_ORIGIN,
  STREET_INTEL_AUTO_BUFFER_MS,
  STREET_INTEL_AUTO_FALLBACK_INTERVAL_MS,
  STREET_INTEL_AUTO_IMMEDIATE_CHECK_DELAY_MS,
} from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { notify } from '@/shared/notify';
import { storage } from '@/shared/storage';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import { SystemicActionError, depositCashOnHand, fetchLiveStatus, postAction } from '../../gameAction';
import { parseSharedCooldownSeconds, parseStreetIntelOpportunities, type StreetIntelOpportunity } from './streetIntelPanelRegexParser';
import type { StreetIntelAutoConfig } from '@/shared/types';

const FEATURE_KEY = 'streetIntel';

/**
 * Schedules the next eligibility check. Given a known cooldown expiry, aligns
 * to it plus a small buffer — same pattern as `careerAuto/runner.ts`'s
 * `scheduleNextCheck`. Given `null` (off cooldown but nothing currently clears
 * the success threshold, or live status/panel couldn't be read), falls back
 * to the 60s re-poll — there's no server signal for "a new opportunity is
 * about to appear" the way there is for the cooldown's own known expiry.
 */
export function scheduleNextCheck(nextEligibleAt: number | null): void {
  const when = nextEligibleAt !== null ? nextEligibleAt + STREET_INTEL_AUTO_BUFFER_MS : Date.now() + STREET_INTEL_AUTO_FALLBACK_INTERVAL_MS;
  chrome.alarms.create(ALARM_NAMES.STREET_INTEL_AUTO, { when });
}

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.STREET_INTEL_AUTO) return;
  await runIfEligible();
}

/** Same "near-immediate, not the multi-minute/60s fallback" reasoning as
 *  `careerAuto/runner.ts`'s `onConfigChanged` — flipping the toggle on
 *  shouldn't sit silently for a full fallback cycle before doing anything. */
export function onConfigChanged(config: StreetIntelAutoConfig): void {
  if (!config.enabled) {
    chrome.alarms.clear(ALARM_NAMES.STREET_INTEL_AUTO);
    return;
  }
  chrome.alarms.create(ALARM_NAMES.STREET_INTEL_AUTO, { when: Date.now() + STREET_INTEL_AUTO_IMMEDIATE_CHECK_DELAY_MS });
}

function localDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

async function pause(message: string): Promise<void> {
  const config = await storage.getStreetIntelAutoConfig();
  await storage.setStreetIntelAutoConfig({ ...config, enabled: false });

  const status = await storage.getStreetIntelAutoStatus();
  await storage.setStreetIntelAutoStatus({
    lastAttempt: status?.lastAttempt ?? null,
    nextEligibleAt: null,
    pausedReason: 'error',
    pausedAt: Date.now(),
    attemptsToday: status?.attemptsToday ?? 0,
    attemptsTodayDate: status?.attemptsTodayDate ?? localDateKey(),
  });

  chrome.alarms.clear(ALARM_NAMES.STREET_INTEL_AUTO);

  await notify('streetIntelAutoStopped', {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'Street Intel auto-runner stopped',
    message,
  });
}

async function fetchPanel(): Promise<{ opportunities: StreetIntelOpportunity[]; cooldownSeconds: number | null } | null> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?type=street_intel&_t=${Date.now()}`, { credentials: 'include' });
  const text = await res.text();
  const opportunities = parseStreetIntelOpportunities(text);
  if (!opportunities) return null;
  return { opportunities, cooldownSeconds: parseSharedCooldownSeconds(text) };
}

function rewardMidpoint(o: StreetIntelOpportunity): number {
  return (o.rewardMin + o.rewardMax) / 2;
}

interface ScoutedChoice {
  opportunity: StreetIntelOpportunity;
  approach: string;
  estimatePct: number;
  /** The next-best scouted approach, for the one case with no direct
   *  complication equivalent — see the module doc below. */
  secondBestApproach: string | null;
}

/**
 * Walks live, affordable candidates in reward÷Stamina value order, scouting
 * each in turn (a real API call, costing that opportunity's own Scout cost)
 * until one's best approach clears `minSuccessPct`, or the list runs out.
 * Stops at the first that clears — spends a little extra Stamina on rejected
 * scouts along the way, but never risks a full attempt's worth of Stamina on
 * a bet below the configured floor.
 */
async function findScoutedCandidate(
  candidates: StreetIntelOpportunity[],
  minSuccessPct: number,
): Promise<ScoutedChoice | null> {
  for (const candidate of candidates) {
    const resp = await postAction('/actions/street_intel.php', { action: 'scout', opportunity_id: candidate.id });

    // An ordinary business rejection (e.g. a stamina/cooldown race against our
    // own tracking) — not systemic, just means this one candidate is off the
    // table this cycle. `postAction` already throws for anything that looks
    // like an auth/session problem or a genuinely malformed response.
    if (resp?.ok !== true) continue;

    if (!Array.isArray(resp.estimates)) {
      // `ok:true` with no `estimates` array is a shape this action has never
      // been confirmed to produce — worth stopping for, not silently skipping
      // (which would otherwise look identical to "nothing meets the bar" and
      // hide a real break in this endpoint).
      throw new SystemicActionError('scout succeeded but returned no estimates — the game may have changed this action\'s format', 'shape');
    }

    const sorted = [...resp.estimates].sort((a: any, b: any) => (b.estimate_pct ?? 0) - (a.estimate_pct ?? 0));
    const best = sorted[0];
    if (!best || typeof best.estimate_pct !== 'number' || best.estimate_pct < minSuccessPct) continue;

    return {
      opportunity: candidate,
      approach: String(best.key),
      estimatePct: best.estimate_pct,
      secondBestApproach: sorted[1] ? String(sorted[1].key) : null,
    };
  }
  return null;
}

/**
 * Complication choices are literally the same three keys (`fight`/`run`/
 * `talk`) an attempt's approach can be — reusing whichever one just won the
 * attempt is a direct 1:1 mapping for three of the four possible approaches.
 * The one exception is `steel_yourself` (defence), which has no complication
 * equivalent at all — confirmed against this account's own real play: it was
 * this account's single most-used approach (33 of 105 real attempts), so this
 * isn't a rare edge case. Falls back to whichever of the *other* scouted
 * approaches on this same card came in second-best — since a card only ever
 * offers 3 of the 4 possible approaches, if `steel_yourself` was the winner,
 * the two others on the card are necessarily drawn from fight/run/talk, so the
 * second-best is always already a valid complication choice.
 */
function pickComplicationChoice(choice: ScoutedChoice): string {
  if (choice.approach !== 'steel_yourself') return choice.approach;
  return choice.secondBestApproach ?? 'talk';
}

export async function runIfEligible(): Promise<void> {
  const config = await storage.getStreetIntelAutoConfig();
  if (!config.enabled) return;

  const status = await fetchLiveStatus();
  if (!status) {
    scheduleNextCheck(null);
    return;
  }

  // Same three gates every automation in this codebase uses — no direct
  // evidence either way of whether Street Intel specifically requires being
  // stationary (zero real attempts happened while travelling, but that could
  // just mean it was never tried), so this defaults to the conservative gate.
  if (status.travelling || status.jailed || status.hospitalized) {
    scheduleNextCheck(null);
    return;
  }

  let panel;
  try {
    panel = await fetchPanel();
  } catch (err) {
    console.error(LOG_PREFIX, 'street intel auto-runner panel fetch failed', err);
    recordParseFailure(FEATURE_KEY);
    scheduleNextCheck(null);
    return;
  }
  if (!panel) {
    recordParseFailure(FEATURE_KEY);
    scheduleNextCheck(null);
    return;
  }
  recordParseSuccess(FEATURE_KEY);

  // The panel's own live cooldown bar is ground truth over our tracked
  // `nextEligibleAt`, which can go stale if the same account plays manually
  // in-game too (same residual risk as Career's tracked cooldown).
  if (panel.cooldownSeconds !== null) {
    scheduleNextCheck(Date.now() + panel.cooldownSeconds * 1000);
    return;
  }

  const candidates = panel.opportunities
    .filter((o) => o.staminaCost > 0 && o.approaches.length > 0 && status.stamina >= o.scoutCost + o.staminaCost)
    .sort((a, b) => rewardMidpoint(b) / b.staminaCost - rewardMidpoint(a) / a.staminaCost);

  try {
    const choice = await findScoutedCandidate(candidates, config.minSuccessPct);
    if (!choice) {
      scheduleNextCheck(null); // nothing affordable clears the bar this cycle — try again on the fallback cadence
      return;
    }

    const attemptResp = await postAction('/actions/street_intel.php', {
      action: 'attempt',
      opportunity_id: choice.opportunity.id,
      approach: choice.approach,
      scouted: 1,
    });

    // Same conservative posture as everywhere else: anything other than a
    // clean `ok:true` with a real cooldown is unrecognized shape, not an
    // ordinary rejection to shrug off — a `disaster` outcome (real jail time)
    // is *not* this case, it's a normal `ok:true` result, handled purely by
    // the travelling/jailed/hospitalized gate above holding the next cycle
    // off until released.
    if (attemptResp?.ok !== true || typeof attemptResp.cooldown_seconds !== 'number') {
      recordParseFailure(FEATURE_KEY);
      await pause(`Unexpected response from a Street Intel attempt${attemptResp?.msg ? `: ${attemptResp.msg}` : ''} — the game may have changed something.`);
      return;
    }

    let complicationChoice: string | null = null;
    let complicationSuccess: boolean | null = null;
    if (attemptResp.has_complication) {
      complicationChoice = pickComplicationChoice(choice);
      const compResp = await postAction('/actions/street_intel.php', {
        action: 'complication',
        opportunity_id: choice.opportunity.id,
        choice: complicationChoice,
      });
      // An ordinary rejection here (or any shape) is logged but doesn't pause
      // the automation — the attempt itself already fully resolved and
      // banked its own cooldown; a failed complication response just means
      // this one follow-up result is unknown, not that anything is broken.
      if (compResp?.ok === true) complicationSuccess = Boolean(compResp.comp_success);
      else console.error(LOG_PREFIX, 'street intel complication response was not ok:true', compResp);
    }

    // Best-effort, unconditional — same "protect whatever's sitting exposed"
    // reasoning as petCourier.ts's depositLeftoverCash, explicit player ask.
    try {
      await depositCashOnHand();
    } catch (err) {
      console.error(LOG_PREFIX, 'street intel post-attempt deposit failed', err);
    }

    const today = localDateKey();
    const previousStatus = await storage.getStreetIntelAutoStatus();
    const attemptsToday = previousStatus?.attemptsTodayDate === today ? previousStatus.attemptsToday + 1 : 1;
    const nextEligibleAt = Date.now() + attemptResp.cooldown_seconds * 1000;

    await storage.setStreetIntelAutoStatus({
      lastAttempt: {
        timestamp: Date.now(),
        opportunityTitle: choice.opportunity.title,
        riskTier: choice.opportunity.riskTier,
        legendary: choice.opportunity.legendary,
        approach: choice.approach,
        scoutedPct: choice.estimatePct,
        outcomeBand: String(attemptResp.outcome_band ?? ''),
        reward: Number(attemptResp.reward_cash) || 0,
        jailSeconds: Number(attemptResp.jail_time) || 0,
        hadComplication: Boolean(attemptResp.has_complication),
        complicationChoice,
        complicationSuccess,
      },
      nextEligibleAt,
      pausedReason: null,
      pausedAt: null,
      attemptsToday,
      attemptsTodayDate: today,
    });

    scheduleNextCheck(nextEligibleAt);
  } catch (err) {
    if (err instanceof SystemicActionError) {
      recordParseFailure(FEATURE_KEY);
      await pause(err.message);
      return;
    }
    console.error(LOG_PREFIX, 'street intel auto-runner cycle failed', err);
    scheduleNextCheck(null);
  }
}
