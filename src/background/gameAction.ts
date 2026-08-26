import { GAME_ORIGIN } from '@/shared/constants';
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
 */
export class SystemicActionError extends Error {
  constructor(
    message: string,
    public readonly kind: 'auth' | 'shape',
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

export async function postAction(path: string, params: Record<string, string | number>): Promise<any> {
  const csrf = await getCsrfToken();
  if (!csrf) throw new SystemicActionError('no CSRF token observed yet — open the game tab and view any panel first, then run again', 'auth');

  const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), _csrf: csrf });

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

    // Confirmed real ("Slow down!" on a v2_draft call) — retried in place with a
    // growing pause rather than surfaced as an ordinary failure, since the
    // rejection has nothing to do with this particular call's own content.
    if (json.ok === false && typeof json.error === 'string' && /slow down/i.test(json.error) && attempt < RATE_LIMIT_RETRY_DELAYS_MS.length) {
      await sleep(RATE_LIMIT_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    return json;
  }
}

export interface LiveStatus {
  energy: number;
  maxEnergy: number;
  stamina: number;
  maxStamina: number;
  cash: number;
  travelling: boolean;
  jailed: boolean;
  hospitalized: boolean;
}

/** Fresh, uncached read of the handful of `stats.php` fields a pre-flight check
 *  needs right before spending energy on something — deliberately not
 *  `storage.getLatestStats()`, which is only as fresh as the last time a content
 *  script happened to observe a `stats.php` call and could be minutes stale if
 *  the game tab isn't open. No CSRF needed; it's a GET. */
export async function fetchLiveStatus(): Promise<LiveStatus | null> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/stats.php`, { credentials: 'include' });
  let json: any;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  if (!json?.ok || !json.stats || !json.status) return null;

  return {
    energy: Number(json.stats.energy) || 0,
    maxEnergy: Number(json.stats.max_energy) || 0,
    stamina: Number(json.stats.stamina) || 0,
    maxStamina: Number(json.stats.max_stamina) || 0,
    cash: Number(json.stats.cash) || 0,
    travelling: Boolean(json.status.travelling),
    jailed: Boolean(json.status.jailed),
    hospitalized: Boolean(json.status.hospitalized),
  };
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
export async function depositCashOnHand(): Promise<any> {
  return postAction('/actions/bank.php', { action: 'deposit', amount: 'ALL' });
}
