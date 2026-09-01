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
import { SystemicActionError, depositCashOnHand, fetchLiveStatus, postAction, statusReleaseAt } from '../../gameAction';
import { parseSharedCooldownSeconds, parseStreetIntelOpportunities, type StreetIntelOpportunity } from './streetIntelPanelRegexParser';
import type { ComplicationChoiceKey, ComplicationTrackingBucket, ScoutedCandidateLog, StreetIntelAutoConfig, StreetIntelAutoStatus } from '@/shared/types';

const FEATURE_KEY = 'streetIntel';

const EMPTY_TRACKING_BUCKET: ComplicationTrackingBucket = {
  direct: { attempts: 0, successes: 0 },
  fallback: { attempts: 0, successes: 0 },
};

const EMPTY_COMPLICATION_STATS: Record<ComplicationChoiceKey, ComplicationTrackingBucket> = {
  fight: EMPTY_TRACKING_BUCKET,
  run: EMPTY_TRACKING_BUCKET,
  talk: EMPTY_TRACKING_BUCKET,
};

function isComplicationChoiceKey(value: string): value is ComplicationChoiceKey {
  return value === 'fight' || value === 'run' || value === 'talk';
}

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

/** Reads current status, merges in `patch`, writes the result back — every
 *  status write goes through this so a write that only cares about one or two
 *  fields (the "nothing cleared the bar this cycle" case, `pause()`) doesn't
 *  have to know or restate every other field to avoid clobbering it. */
async function updateStatus(patch: Partial<StreetIntelAutoStatus>): Promise<StreetIntelAutoStatus> {
  const current = await storage.getStreetIntelAutoStatus();
  const next: StreetIntelAutoStatus = {
    lastAttempt: current?.lastAttempt ?? null,
    nextEligibleAt: current?.nextEligibleAt ?? null,
    pausedReason: current?.pausedReason ?? null,
    pausedMessage: current?.pausedMessage ?? null,
    pausedAt: current?.pausedAt ?? null,
    attemptsToday: current?.attemptsToday ?? 0,
    attemptsTodayDate: current?.attemptsTodayDate ?? localDateKey(),
    cashToday: current?.cashToday ?? 0,
    lastCycleScouted: current?.lastCycleScouted ?? [],
    lastCycleAt: current?.lastCycleAt ?? null,
    complicationStats: current?.complicationStats ?? EMPTY_COMPLICATION_STATS,
    ...patch,
  };
  await storage.setStreetIntelAutoStatus(next);
  return next;
}

/** Folds one resolved complication into the running per-choice tally — only
 *  called when the complication call itself actually came back `ok:true`
 *  with a real `comp_success`; an unresolved/rejected complication call has
 *  no outcome to count either way. `wasFallback` routes the increment into
 *  the `direct` or `fallback` sub-bucket — see `ComplicationTrackingBucket`'s
 *  doc comment for why those are kept separate. */
function bumpComplicationStats(
  current: Record<ComplicationChoiceKey, ComplicationTrackingBucket> | undefined,
  choice: string,
  wasFallback: boolean,
  success: boolean,
): Record<ComplicationChoiceKey, ComplicationTrackingBucket> {
  const base = current ?? EMPTY_COMPLICATION_STATS;
  if (!isComplicationChoiceKey(choice)) return base; // defensive — every real choice this runner sends is one of the three
  const bucket = base[choice];
  const kind = wasFallback ? 'fallback' : 'direct';
  const prior = bucket[kind];
  return {
    ...base,
    [choice]: { ...bucket, [kind]: { attempts: prior.attempts + 1, successes: prior.successes + (success ? 1 : 0) } },
  };
}

async function pause(message: string): Promise<void> {
  const config = await storage.getStreetIntelAutoConfig();
  await storage.setStreetIntelAutoConfig({ ...config, enabled: false });

  await updateStatus({ pausedReason: 'error', pausedMessage: message, pausedAt: Date.now(), nextEligibleAt: null });

  chrome.alarms.clear(ALARM_NAMES.STREET_INTEL_AUTO);

  await notify('streetIntelAutoStopped', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
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
 * Selection strategy — three iterations, each corrected by real data:
 *
 * 1. **Shipped first**: reward÷Stamina order, first candidate whose best
 *    approach cleared `minSuccessPct` — optimize for the biggest payout,
 *    threshold as a safety floor only. Ran for real (2026-08-26) and landed
 *    2 disasters and a wipeout out of 5 attempts — "biggest card that clears
 *    50%" kept landing right at the edge of the floor (54%, 61%).
 * 2. **Corrected to odds-first**: compared against the account owner's own
 *    ~105 real manual attempts (pre-automation 100MB archive, 2026-08-25),
 *    specifically the 25 decision cycles where 2+ opportunities were scouted
 *    before one was attempted. "Highest scouted odds alone" matched 25/25 of
 *    those; reward÷Stamina matched 0/25; raw EV (odds×reward) matched 6/25.
 *    Shipped as "pick highest odds, reward only breaks a literal tie."
 * 3. **Corrected again, same day**: the very first live pick under rule 2
 *    took a 95%-odds card worth $5,000–$8,700 ("Easy Money") over a
 *    94%-odds card worth $25,000–$43,700 sitting right next to it ("Union
 *    Whisper") — a 1-point odds gap costing 5x the reward. Checking the full
 *    105-attempt history's *reward sizes* (not just which one was chosen)
 *    showed the account owner's real median pick was $61,750 — under 2% of
 *    their attempts were as small as Easy Money's range. Rule 2's "25/25"
 *    fit was real but couldn't distinguish "always chase max odds" from
 *    "clear a floor, then chase profit," because their history never
 *    actually contained two options this close on odds with this large a
 *    reward gap — so rule 2 was unfalsified by their data, not confirmed by
 *    it, for exactly the case that broke it. Directly asked, the account
 *    owner confirmed: "aside from odds, I was always looking for best
 *    profit."
 *
 * Retested against the same 25 cycles: filtering to candidates whose best
 * odds clears `minSuccessPct`, then picking the highest **EV (odds ×
 * reward)** among those, matches 24/25 (96%) — the one miss is a case where
 * an 84%-odds/$17k pick beat a 52%-odds/$51k one despite the latter's much
 * higher EV, so odds still matter even above the floor, just not as the sole
 * criterion. 24/25 against real history, plus directly matching what the
 * account owner described their own reasoning as, made this the better
 * model than rule 2's incidental 25/25 — and it fixes the Easy-Money case
 * cleanly: Union Whisper's EV (94% × $34,350 ≈ $32,289) beats Easy Money's
 * (95% × $6,850 ≈ $6,508) outright, no tolerance-band tuning required.
 *
 * So: this scouts every affordable, workable candidate (still walking the
 * list in reward÷Stamina order — an arbitrary-but-reasonable order to spend
 * scouting Stamina in, since the account owner's actual *scouting* order
 * isn't observable from the archive, only what they ended up comparing) and,
 * among whichever clear `minSuccessPct`, picks the one with the highest
 * EV (`estimatePct/100 × rewardMidpoint`). See docs/street-intel-plan.md's
 * Auto-Attempt section for the full writeup.
 *
 * `availableStamina` guards against a side effect of scouting every
 * candidate instead of stopping at the first hit: scouting several in one
 * cycle (each costing its own Scout Stamina) can eat into what's left for
 * the eventual attempt. Running total `staminaSpentScouting` tracks that,
 * and the final pick is restricted to candidates whose own `staminaCost`
 * still fits in what's left — otherwise a scout-heavy cycle could pick a
 * winner it can no longer actually afford to attempt, which would come back
 * as a genuine `ok:false` from the attempt call and (per the pause() call
 * site below) needlessly stop the whole automation over what's really just a
 * bookkeeping gap.
 *
 * Every candidate scouted — chosen or not — is recorded in the returned
 * `log`, so a cycle that scouts three opportunities and only one clears the
 * threshold (or none do) leaves a visible trail of what was considered and
 * why, not just the eventual winner.
 */
async function findScoutedCandidate(
  candidates: StreetIntelOpportunity[],
  minSuccessPct: number,
  availableStamina: number,
): Promise<{ choice: ScoutedChoice | null; log: ScoutedCandidateLog[] }> {
  const log: ScoutedCandidateLog[] = [];
  let staminaSpentScouting = 0;
  const cleared: { choice: ScoutedChoice; logIndex: number }[] = [];

  for (const candidate of candidates) {
    if (availableStamina - staminaSpentScouting < candidate.scoutCost) continue;

    const valueRatio = rewardMidpoint(candidate) / candidate.staminaCost;
    const resp = await postAction('/actions/street_intel.php', { action: 'scout', opportunity_id: candidate.id });
    staminaSpentScouting += candidate.scoutCost;

    // An ordinary business rejection (e.g. a stamina/cooldown race against our
    // own tracking) — not systemic, just means this one candidate is off the
    // table this cycle. `postAction` already throws for anything that looks
    // like an auth/session problem or a genuinely malformed response.
    if (resp?.ok !== true) {
      log.push({ title: candidate.title, riskTier: candidate.riskTier, legendary: candidate.legendary, staminaCost: candidate.staminaCost, valueRatio, approach: null, estimatePct: null, chosen: false });
      continue;
    }

    if (!Array.isArray(resp.estimates)) {
      // `ok:true` with no `estimates` array is a shape this action has never
      // been confirmed to produce — worth stopping for, not silently skipping
      // (which would otherwise look identical to "nothing meets the bar" and
      // hide a real break in this endpoint).
      throw new SystemicActionError('scout succeeded but returned no estimates — the game may have changed this action\'s format', 'shape');
    }

    const sorted = [...resp.estimates].sort((a: any, b: any) => (b.estimate_pct ?? 0) - (a.estimate_pct ?? 0));
    const top = sorted[0];
    const bestPct: number | null = top && typeof top.estimate_pct === 'number' ? top.estimate_pct : null;
    const bestKey: string | null = top ? String(top.key) : null;
    // Affordability is *not* checked here against the running scouting spend —
    // see the staminaLeftAfterScouting comment below for why that has to wait
    // until every candidate this cycle has been scouted.
    const passesBar = bestPct !== null && bestPct >= minSuccessPct;

    log.push({ title: candidate.title, riskTier: candidate.riskTier, legendary: candidate.legendary, staminaCost: candidate.staminaCost, valueRatio, approach: bestKey, estimatePct: bestPct, chosen: false });

    if (!passesBar) continue;

    cleared.push({
      choice: {
        opportunity: candidate,
        approach: bestKey!,
        estimatePct: bestPct!,
        secondBestApproach: sorted[1] ? String(sorted[1].key) : null,
      },
      logIndex: log.length - 1,
    });
  }

  // Stamina actually left once ALL of this cycle's scouting is done — not the
  // running total at the moment any one candidate cleared the bar above, which
  // goes stale the instant a *later* candidate in this same loop also gets
  // scouted (every scout call really spends stamina server-side). Real
  // capture, 2026-09-01: two candidates scouted (3 stamina each); the first
  // cleared the bar checking only its own scout cost against the cycle-start
  // total, but by the time its attempt actually fired, the second candidate's
  // scout had also been spent server-side — 3 stamina short, the attempt came
  // back `ok:false` ("Not enough stamina! Need 3"), and that unrecognized
  // response paused the whole automation over what was really just a stale
  // affordability check, not a real break. Checking against the final total
  // (which can only be smaller, since scouting only ever spends more) is
  // strictly safe: anything that fits here would have fit at any earlier
  // point in the loop too.
  const staminaLeftAfterScouting = availableStamina - staminaSpentScouting;

  // Highest EV (odds × reward) first — see the function's own doc comment for
  // why EV-among-floor-clearers beats both "biggest reward" and "highest odds
  // alone" against real history — falling through to the next-best EV
  // candidate whenever the top one no longer fits in what's actually left.
  const byEvDesc = [...cleared].sort((a, b) => {
    const evA = (a.choice.estimatePct / 100) * rewardMidpoint(a.choice.opportunity);
    const evB = (b.choice.estimatePct / 100) * rewardMidpoint(b.choice.opportunity);
    return evB - evA;
  });
  const winner = byEvDesc.find((c) => c.choice.opportunity.staminaCost <= staminaLeftAfterScouting) ?? null;
  if (winner) log[winner.logIndex].chosen = true;

  return { choice: winner?.choice ?? null, log };
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

// `chrome.alarms` is confirmed to occasionally fire an alarm twice for a
// single scheduled time after the service worker's been dormant (a known
// MV3 platform quirk, not something this codebase's own scheduling caused —
// there's exactly one `chrome.alarms.create`/`onAlarm` path for
// ALARM_NAMES.STREET_INTEL_AUTO). Real capture, 2026-08-26: two full
// scout+attempt cycles landed ~250ms apart, independently scouted the same
// three opportunities, and both attempted the same winner — the second
// attempt came back a legitimate `ok:false` ("Cooldown active. Wait
// 10m 0s.") since the first had already spent the shared cooldown a moment
// earlier. Without this guard that ok:false would reach the "unrecognized
// response shape" check further down and pause the whole automation over
// what was really just a duplicate firing, not a real problem worth
// stopping for.
let cycleInFlight = false;

export async function runIfEligible(): Promise<void> {
  if (cycleInFlight) return;
  cycleInFlight = true;
  try {
    await runIfEligibleOnce();
  } finally {
    cycleInFlight = false;
  }
}

async function runIfEligibleOnce(): Promise<void> {
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
    const { choice, log } = await findScoutedCandidate(candidates, config.minSuccessPct, status.stamina);
    if (!choice) {
      // Nothing affordable cleared the bar this cycle — the scouted log is
      // still worth keeping (it's the whole answer to "what did it consider
      // and why didn't it act"), even though no attempt happened.
      await updateStatus({ lastCycleScouted: log, lastCycleAt: Date.now() });
      scheduleNextCheck(null);
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

    // Same "protect whatever's sitting exposed" reasoning as petCourier.ts's
    // depositLeftoverCash, explicit player ask — but only when there's
    // actually something to sweep. A fresh live check here (not "did the
    // complication fail") is what's reliable: a failed complication doesn't
    // always take *everything* (only ever confirmed as a full wipe so far,
    // but nothing guarantees that), and cash-on-hand could be non-zero for
    // reasons unrelated to this cycle's own complication entirely. Checking
    // live cash directly covers all of those in one place, and skips the
    // call (and its now-confirmed-real "Invalid amount" rejection) whenever
    // there's genuinely nothing there.
    const postAttemptStatus = await fetchLiveStatus();
    if (postAttemptStatus && postAttemptStatus.cash > 0) {
      try {
        await depositCashOnHand();
      } catch (err) {
        console.error(LOG_PREFIX, 'street intel post-attempt deposit failed', err);
      }
    }

    const rewardCash = Number(attemptResp.reward_cash) || 0;
    const today = localDateKey();
    const previousStatus = await storage.getStreetIntelAutoStatus();
    const rolledOver = previousStatus?.attemptsTodayDate !== today;
    const attemptsToday = rolledOver ? 1 : previousStatus!.attemptsToday + 1;
    const cashToday = (rolledOver ? 0 : previousStatus!.cashToday ?? 0) + rewardCash;
    const nextEligibleAt = Date.now() + attemptResp.cooldown_seconds * 1000;

    // Whether this complication choice came from the steel_yourself fallback
    // (second-best scouted approach) rather than directly reusing the
    // attempt's own winning approach — see pickComplicationChoice's own
    // branch condition, mirrored here, and ComplicationTrackingBucket's doc
    // comment for why the two are tracked separately.
    const wasFallback = choice.approach === 'steel_yourself';

    // Only folds in a real, resolved outcome — a complication that came back
    // as anything other than `ok:true` leaves `complicationSuccess` null and
    // isn't counted (see docs/street-intel-complication-tracking.md).
    const complicationStats =
      complicationChoice !== null && complicationSuccess !== null
        ? bumpComplicationStats(previousStatus?.complicationStats, complicationChoice, wasFallback, complicationSuccess)
        : (previousStatus?.complicationStats ?? EMPTY_COMPLICATION_STATS);

    await updateStatus({
      lastAttempt: {
        timestamp: Date.now(),
        opportunityTitle: choice.opportunity.title,
        riskTier: choice.opportunity.riskTier,
        legendary: choice.opportunity.legendary,
        approach: choice.approach,
        scoutedPct: choice.estimatePct,
        outcomeBand: String(attemptResp.outcome_band ?? ''),
        reward: rewardCash,
        jailSeconds: Number(attemptResp.jail_time) || 0,
        hadComplication: Boolean(attemptResp.has_complication),
        complicationChoice,
        complicationWasFallback: attemptResp.has_complication ? wasFallback : null,
        complicationSuccess,
      },
      nextEligibleAt,
      pausedReason: null,
      pausedMessage: null,
      pausedAt: null,
      attemptsToday,
      attemptsTodayDate: today,
      cashToday,
      lastCycleScouted: log,
      lastCycleAt: Date.now(),
      complicationStats,
    });

    scheduleNextCheck(nextEligibleAt);
  } catch (err) {
    if (err instanceof SystemicActionError && err.kind === 'status-blocked') {
      // Confirmed real (2026-08-29): the account got hospitalized mid-cycle,
      // after the travelling/jailed/hospitalized gate above had already
      // passed — one of the scout calls inside findScoutedCandidate (or the
      // attempt/complication call) came back blocked instead. Not a sign
      // anything is broken, so this must not reach `pause()` the way it used
      // to (see gameAction.ts's SystemicActionError doc for the full story).
      // A fresh status read gives the exact release time when available;
      // falls back to the normal re-poll cadence otherwise.
      const freshStatus = await fetchLiveStatus();
      scheduleNextCheck(freshStatus ? statusReleaseAt(freshStatus) : null);
      return;
    }
    if (err instanceof SystemicActionError) {
      recordParseFailure(FEATURE_KEY);
      await pause(err.message);
      return;
    }
    console.error(LOG_PREFIX, 'street intel auto-runner cycle failed', err);
    scheduleNextCheck(null);
  }
}
