import { GAME_ORIGIN } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { getCsrfToken } from './csrfToken';

/**
 * Shared by every background feature that POSTs a game action (pet courier,
 * career auto-runner, Street Intel auto-attempt) — CSRF attachment,
 * response-shape validation, and the auth/shape split all live here once
 * rather than being redefined per feature. Originally lived only in
 * petCourier.ts; extracted once a second caller needed the exact same
 * defensive behavior rather than a reimplementation of it.
 */

/**
 * Thrown for a failure that isn't specific to one call — the caller can't tell
 * "this one thing failed, try the next" from "nothing from here on will work
 * either" without this. `kind` picks the remedy:
 * - `auth`: no cached CSRF token, or a non-JSON response (the game returns clean
 *   `{ok:true/false,...}` for anything it actually processed — a stale/rejected
 *   token or expired session is the likely cause of anything else). Fix: reload
 *   the game tab, view any panel once, run again.
 * - `shape`: a response parsed as JSON but doesn't look like a real one (`ok`
 *   missing/non-boolean). Fix: none available yet — this specifically means the
 *   game changed something this feature doesn't understand, so it needs to stop
 *   rather than guess.
 * - `status-blocked`: a normal-shaped `ok:false` rejection whose message says the
 *   account is jailed/hospitalized/travelling right now (confirmed real: "You
 *   can't do that while hospitalized!", caught mid-cycle in Street Intel's
 *   auto-runner on 2026-08-29 after its one-time pre-flight status gate had
 *   already passed — an unrelated in-game event hospitalized the account between
 *   that gate and this call). Recoverable and expected, never a sign anything is
 *   broken — the caller should reschedule for later, not treat it like `shape`
 *   and stop the automation.
 * - `repeated-rejection`: the exact same request (same path and params) has
 *   come back with the exact same well-formed `ok:false` rejection
 *   `REPEATED_REJECTION_LIMIT` times within `REPEATED_REJECTION_WINDOW_MS` —
 *   the automation is stuck retrying something the server keeps refusing,
 *   whatever the specific reason. Nothing about the response is unrecognized,
 *   so this is not a parse failure, but it is unexpected: every background
 *   caller pauses its feature on it until the player checks and resumes,
 *   including callers that treat a single ordinary rejection as best-effort
 *   (the end-of-run deposits). See `recordRejection` below for the confirmed
 *   real incidents this exists for.
 */
export class SystemicActionError extends Error {
  constructor(
    message: string,
    public readonly kind: 'auth' | 'shape' | 'status-blocked' | 'repeated-rejection',
  ) {
    super(message);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Baseline gap enforced before every action call — a batch that fires several
 *  actions back-to-back with no pause is exactly the shape of traffic a "Slow
 *  down!" rejection (confirmed real, seen on a `v2_draft` call) suggests the
 *  server is rate-limiting. No confirmed threshold exists to pace against, so
 *  this is a heuristic gap, not a tuned one — worth revisiting if "Slow down!"
 *  still shows up with it in place. */
export const ACTION_PACING_MS = 600;

/** Backoff schedule for a rejection that's confirmed rate-limiting, not an
 *  ordinary business rejection — waiting and retrying the *same* call makes
 *  sense here in a way it wouldn't for e.g. "insufficient funds", since nothing
 *  about the request itself was wrong. Gives up after these three attempts and
 *  lets the caller treat it as an ordinary rejection (push an error, move on)
 *  rather than retrying forever against a limit that might not be lifting soon. */
export const RATE_LIMIT_RETRY_DELAYS_MS = [2000, 4000, 8000];

/** Identical rejections of an identical request within `REPEATED_REJECTION_WINDOW_MS`
 *  before `postAction` throws `'repeated-rejection'` instead of returning the
 *  rejection. Sized against every background request in the archives from
 *  2026-08-26 to 2026-09-22: in normal operation, no request was rejected the
 *  same way more than 4 times in any 10-minute window (`v2_draft` "You already
 *  have a delivery being loaded"). The two real stuck loops in that span ran
 *  at 202 (`v2_offload_all` "Daily profit cap reached", 2026-09-22) and 15
 *  (`deposit` "Bank is full!", 2026-09-03) per 10 minutes. */
export const REPEATED_REJECTION_LIMIT = 6;
export const REPEATED_REJECTION_WINDOW_MS = 10 * 60_000;

/** Per-request streak of identical consecutive rejections, keyed by scope +
 *  path + params (CSRF excluded). Kept in `chrome.storage.session`, not module
 *  memory: the background is a service worker / event page that the browser
 *  suspends after ~30s idle, which would wipe an in-memory count between any
 *  two calls further apart than that — the 2026-09-03 "Bank is full!" loop ran
 *  about once every 40s, slow enough to never reach the limit. Session storage
 *  survives suspension and clears on browser close, same as `csrfToken.ts`. */
const STREAK_STORAGE_PREFIX = 'rejectionStreak:';

interface RejectionStreak {
  error: string;
  at: number[];
}

/**
 * Tracks a normal-shaped `ok:false` rejection and throws once the same request
 * has been refused the same way `REPEATED_REJECTION_LIMIT` times within the
 * window. A single business rejection ("insufficient funds", "cargo hold is
 * full") is still returned to the caller as before — this only catches the
 * pattern no single call can see.
 *
 * Confirmed real, twice: Pet Courier's return alarm re-armed itself 2s out
 * for cargo it could never collect, sending `v2_offload_all` into "Daily
 * profit cap reached" 2,897 times over 3.5 hours (2026-09-22), sweeping the
 * player's manual withdrawals back into the bank each time via the batch's
 * end-of-run deposit; and `deposit` hit "Bank is full!" 46 times in a row
 * (2026-09-03). Neither tripped any safety net, because both rejections were
 * well-formed and each feature correctly treated one of them as ordinary.
 */
async function recordRejection(key: string, path: string, error: string): Promise<void> {
  const storageKey = STREAK_STORAGE_PREFIX + key;
  const now = Date.now();
  const stored = (await chrome.storage.session.get(storageKey))[storageKey] as RejectionStreak | undefined;
  const recent = stored ? stored.at.filter((t) => now - t < REPEATED_REJECTION_WINDOW_MS) : [];
  const streak: RejectionStreak = stored && stored.error === error && recent.length > 0 ? { error, at: [...recent, now] } : { error, at: [now] };
  await chrome.storage.session.set({ [storageKey]: streak });

  if (streak.at.length >= REPEATED_REJECTION_LIMIT) {
    throw new SystemicActionError(
      `"${error}" from ${path} — the same request was rejected the same way ${streak.at.length} times in ${REPEATED_REJECTION_WINDOW_MS / 60_000} minutes; paused so it isn't retried again`,
      'repeated-rejection',
    );
  }
}

async function clearRejections(key: string): Promise<void> {
  await chrome.storage.session.remove(STREAK_STORAGE_PREFIX + key);
}

export interface PostActionOptions {
  /** Which feature is making the call, for requests more than one feature
   *  sends identically (the bank's `deposit`/`withdraw`) — each feature's
   *  repeated-rejection count stays its own, so one feature's failures can't
   *  pause another that never repeated anything. Unneeded for a feature's
   *  own endpoints; their params already make the key unique. */
  rejectionScope?: string;
}

export async function postAction(path: string, params: Record<string, string | number>, options: PostActionOptions = {}): Promise<any> {
  const csrf = await getCsrfToken();
  if (!csrf) throw new SystemicActionError('no CSRF token observed yet — open the game tab and view any panel first, then run again', 'auth');

  const paramEntries = Object.entries(params).map(([k, v]) => [k, String(v)]);
  // Requests are never refused locally on the strength of this streak: every
  // background caller pauses on the throw anyway, and a manual retry after the
  // player fixed the cause (emptied a full bank, waited out a cap) has to
  // actually reach the server to succeed and clear it.
  const streakKey = `${options.rejectionScope ?? ''}|${path}?${new URLSearchParams(paramEntries).toString()}`;

  const body = new URLSearchParams({ ...Object.fromEntries(paramEntries), _csrf: csrf });

  for (let attempt = 0; ; attempt++) {
    await sleep(ACTION_PACING_MS);
    const res = await loggedFetch(`${GAME_ORIGIN}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    let json: any;
    try {
      json = await res.json();
    } catch {
      // A request the game actually processed always comes back as clean JSON,
      // `{ok:true|false, ...}` — this is the CSRF token being rejected (or the
      // session having expired) far more often than it's anything specific to this
      // one action, so it's treated as systemic rather than retried per pet.
      throw new SystemicActionError(`non-JSON response from ${path} (status ${res.status}) — likely a stale session or CSRF token`, 'auth');
    }

    // `ok` missing or non-boolean means this isn't the response shape every real
    // action response has confirmed so far — a genuine business rejection is always
    // an explicit `ok:false`, never an absent field. Distinguishing this from that
    // is the whole point: an actual game-shape change should stop the run with one
    // clear message, not get retried once per remaining item as if each were its own
    // unrelated failure.
    if (typeof json?.ok !== 'boolean') {
      throw new SystemicActionError(`unexpected response shape from ${path} — the game may have changed this action's format`, 'shape');
    }

    // A normal-shaped `{ok:false,"error":"..."}` rejection is otherwise
    // indistinguishable from an ordinary business rejection (insufficient funds,
    // wrong district, etc.) — no real CSRF rejection has ever actually been
    // captured to confirm its exact wording, so this is a heuristic, not a
    // certainty. But letting a stale-token rejection through unrecognised means the
    // caller just repeats the identical failure, which is exactly the problem the
    // shape/auth split above exists to avoid — so a plausible-looking one gets
    // treated the same way rather than not at all.
    if (json.ok === false && typeof json.error === 'string' && /csrf|token|session|unauthori[sz]ed|forbidden|not logged in/i.test(json.error)) {
      throw new SystemicActionError(`"${json.error}" from ${path} — looks like a stale session or CSRF token, not an ordinary rejection`, 'auth');
    }

    // Same heuristic as above, against `msg` instead of `error` — confirmed real
    // rejections from `street_intel.php` use `{ok:false,"msg":"..."}`, not
    // `error`, unlike smuggling.php/career.php. Only ever adds a recognized-as-
    // auth-failure case; never removes one already caught by the `error` check.
    if (json.ok === false && typeof json.msg === 'string' && /csrf|token|session|unauthori[sz]ed|forbidden|not logged in/i.test(json.msg)) {
      throw new SystemicActionError(`"${json.msg}" from ${path} — looks like a stale session or CSRF token, not an ordinary rejection`, 'auth');
    }

    // Confirmed real for hospitalized ("You can't do that while hospitalized!",
    // a real Street Intel `scout`/`attempt` rejection caught 2026-08-29) —
    // travelling is assumed to follow the same "You can't do that while X!"
    // phrasing but has no confirmed capture yet, same unconfirmed-but-plausible
    // footing as the CSRF-phrase guesses above. Jailed is *not* a guess: the
    // crimes auto-runner's own real captures (2026-09-05) confirmed
    // `crimes.php` actually says "You can't do that while in jail!" — not
    // "...while jailed" — so both phrasings are matched here rather than
    // trusting the assumed one alone. Checked against both `error` and `msg`
    // for the same reason as the auth checks: different endpoints use
    // different field names for the same kind of rejection.
    if (json.ok === false && typeof json.error === 'string' && /can't do (?:that|this) while (?:jailed|in jail|hospitalized|travell?ing)/i.test(json.error)) {
      throw new SystemicActionError(`"${json.error}" from ${path} — account is jailed/hospitalized/travelling, not an unrecognized response`, 'status-blocked');
    }
    if (json.ok === false && typeof json.msg === 'string' && /can't do (?:that|this) while (?:jailed|in jail|hospitalized|travell?ing)/i.test(json.msg)) {
      throw new SystemicActionError(`"${json.msg}" from ${path} — account is jailed/hospitalized/travelling, not an unrecognized response`, 'status-blocked');
    }

    // Confirmed real ("Slow down!" on a v2_draft call) — retried in place with a
    // growing pause rather than surfaced as an ordinary failure, since the
    // rejection has nothing to do with this particular call's own content.
    if (json.ok === false && typeof json.error === 'string' && /slow down/i.test(json.error) && attempt < RATE_LIMIT_RETRY_DELAYS_MS.length) {
      await sleep(RATE_LIMIT_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    if (json.ok === false) {
      const error = typeof json.error === 'string' ? json.error : typeof json.msg === 'string' ? json.msg : 'unknown error';
      await recordRejection(streakKey, path, error);
    } else {
      await clearRejections(streakKey);
    }

    return json;
  }
}

export interface LiveStatus {
  energy: number;
  maxEnergy: number;
  stamina: number;
  maxStamina: number;
  /** Added for the crimes auto-runner's own pre-flight nerve check — same
   *  "read the real balance before spending it" gate `careerAuto/runner.ts`
   *  already does for `energy`. */
  nerve: number;
  maxNerve: number;
  cash: number;
  travelling: boolean;
  jailed: boolean;
  hospitalized: boolean;
  /** Seconds remaining, straight from `stats.php`'s own `status.*_seconds` —
   *  lets a caller schedule an exact "resume at" alarm instead of a blind
   *  fallback-interval retry when one of the booleans above is true. */
  travelSeconds: number;
  jailSeconds: number;
  hospitalSeconds: number;
  /** Seconds until the *next* single Nerve point regenerates, and the
   *  regen interval per point thereafter — straight from `stats.php`'s
   *  own `timers.nerve`/`regen_rates.nerve`. Lets a caller compute exactly
   *  when it'll have N Nerve instead of blind-polling for it, the same way
   *  `travelSeconds`/`jailSeconds`/`hospitalSeconds` already let one align to
   *  an exact status-clear instead of guessing. */
  nerveTimerSeconds: number;
  nerveRegenSeconds: number;
}

/** Fresh, uncached read of the handful of `stats.php` fields a pre-flight check
 *  needs right before spending energy on something — deliberately not
 *  `storage.getLatestStats()`, which is only as fresh as the last time a content
 *  script happened to observe a `stats.php` call and could be minutes stale if
 *  the game tab isn't open. No CSRF needed; it's a GET. */
export async function fetchLiveStatus(): Promise<LiveStatus | null> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/stats.php`, { credentials: 'include' });
  // Cloned *before* any read — `Response.clone()` throws once the body has
  // already been consumed, so the fallback text check below needs its own
  // untouched copy taken up front, not grabbed after `.json()` has already
  // failed partway through reading it.
  const textFallback = res.clone();
  let json: any;
  try {
    json = await res.json();
  } catch {
    // Confirmed real (2026-08-29): `stats.php` came back as a Cloudflare page
    // (HTML carrying `#cf-browser-status`/`#cf-error-details`/etc, caught by
    // the structural-change detector) instead of JSON — that specific instance
    // was a real Cloudflare 526 ("Invalid SSL certificate", origin failing
    // Cloudflare's own health check), but Cloudflare fronts this failure mode
    // for plenty of unrelated causes too (rate limiting, an interstitial
    // challenge, other origin errors) — this check only identifies "the page
    // wasn't real JSON, it was some Cloudflare-branded page," not which one.
    // Every caller of this function silently no-ops at its very first gate
    // for as long as whatever's actually wrong lasts, with nothing pointing at
    // Cloudflare as the reason — worth a specific console note instead of
    // folding invisibly into the same silent `null` as any other parse
    // failure, so this doesn't have to be rediscovered the hard way again.
    const text = await textFallback.text().catch(() => '');
    if (/cf-browser-status|cf-error-details|cf-wrapper|Cloudflare/i.test(text)) {
      console.warn(`${LOG_PREFIX} stats.php returned a Cloudflare page instead of JSON (interstitial, rate limit, or an origin error like an SSL failure) — check https://www.thefifthfamily.com directly in a tab`);
    }
    return null;
  }
  if (!json?.ok || !json.stats || !json.status) return null;

  return {
    energy: Number(json.stats.energy) || 0,
    maxEnergy: Number(json.stats.max_energy) || 0,
    stamina: Number(json.stats.stamina) || 0,
    maxStamina: Number(json.stats.max_stamina) || 0,
    nerve: Number(json.stats.nerve) || 0,
    maxNerve: Number(json.stats.max_nerve) || 0,
    cash: Number(json.stats.cash) || 0,
    travelling: Boolean(json.status.travelling),
    jailed: Boolean(json.status.jailed),
    hospitalized: Boolean(json.status.hospitalized),
    travelSeconds: Number(json.status.travel_seconds) || 0,
    jailSeconds: Number(json.status.jail_seconds) || 0,
    hospitalSeconds: Number(json.status.hospital_seconds) || 0,
    nerveTimerSeconds: Number(json.timers?.nerve) || 0,
    nerveRegenSeconds: Number(json.regen_rates?.nerve) || 0,
  };
}

/** Earliest moment `status` is expected to clear, for whichever of
 *  jailed/hospitalized/travelling is actually true — the max of the relevant
 *  countdowns (a status-blocked rejection doesn't say which one it was blocked
 *  by, so a caller reacting to one from mid-cycle rather than this function's
 *  own live `status` fields should just take the longest of the three it has).
 *  Adds a 2s buffer since these are the account's own countdowns, not a
 *  guaranteed-precise server clock. */
export function statusReleaseAt(status: Pick<LiveStatus, 'jailSeconds' | 'hospitalSeconds' | 'travelSeconds'>): number {
  const seconds = Math.max(status.jailSeconds, status.hospitalSeconds, status.travelSeconds);
  return Date.now() + (seconds + 2) * 1000;
}

/**
 * Sweeps whatever cash is currently on hand into the bank — the mechanical
 * request only, extracted from petCourier.ts's `depositLeftoverCash` once a
 * second caller (the Street Intel auto-runner) needed the identical call
 * rather than a reimplementation of it. Callers own the "is it worth
 * depositing"/summary/progress-broadcast decisions themselves; this is just
 * the POST.
 *
 * `amount=ALL` — corrected from an earlier, never-actually-confirmed guess
 * that sent a specific comma-formatted figure (`amount=1,000,000`, inferred
 * from `withdraw`'s shape, which really does take a figure). Checking the
 * archive while building this shared version turned up 279 real deposit
 * calls, every single one using the literal string `ALL`, never a number —
 * the response even confirms it directly (`{"ok":true,"message":"Deposited
 * $X","cash":0,"bank":N}`). No amount to look up beforehand, and no race
 * between "how much cash did we see" and "how much is actually there by the
 * time this fires."
 */
export async function depositCashOnHand(feature: string): Promise<any> {
  return postAction('/actions/bank.php', { action: 'deposit', amount: 'ALL' }, { rejectionScope: feature });
}
