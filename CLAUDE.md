# CLAUDE.md

Project-specific instructions for working on The Fifth Family Enhancements (see
`README.md` for what the extension does, `docs/` for feature designs and
mechanics write-ups).

## Reverse-engineering a request to imitate

Several features (Street Racing automation, Career Auto, Arena auto-attack,
Pet Courier, etc.) work by constructing a request that imitates what the real
game client sends, instead of the player tapping through the UI. When building
or modifying one of these:

1. **Enumerate every field the endpoint has ever sent, not just the one you're
   modeling.** Pull an archive Selection export for that endpoint (see
   `docs/http-archive.md`) and union the keys across every captured request
   body and relevant response fields — not only the field the current task
   cares about. A field with no obvious purpose is not evidence it's optional.
2. **Diff submitted vs. echoed values on real captured pairs.** If a response
   echoes back anything derived from what was submitted (e.g. an `accuracy`
   sent vs. an `accuracy`/`*_adj` field returned), check that they actually
   match on real examples before assuming the imitated request is complete.
3. **`ok:true` is not proof the request is fully formed.** A missing
   opaque/validation-only field (a session or run token, a nonce that ties two
   calls together) usually doesn't error — the server just silently
   substitutes a fallback and returns an otherwise normal-looking response.
   That kind of bug produces no visible symptom until it changes an actual
   outcome, which can be much later than when the code was written.
4. **A feature "working" in testing isn't enough** if every test case happens
   to make the missing field inert (e.g. modeling a bonus that only matters
   when the base outcome isn't already guaranteed). Prefer testing against a
   case where the field you're unsure about would visibly matter.

This came out of a real incident: the Street Racing automation sampled a
realistic `accuracy` value from historical request bodies, but never forwarded
`can_race`'s `run_token` on the following `attempt_race` call, because the
implementation only looked at the `accuracy` field across past examples. The
server silently fell back to a neutral accuracy on every automated race
instead of erroring, and it went unnoticed for 3 days because every race
attempted in that window had a 100% base win chance, so the missing bonus
never changed a result — see
[[feedback_imitate_full_request_shape]] in memory for the full account.

## Guarding background automation against concurrent triggers

Any background feature that spends an in-game resource (cash, a cooldown, an
attempt, a courier dispatch) and can be triggered from more than one place —
two separate alarms, or an alarm plus a manual "Run"/"Check Now" button, or a
config-toggle's own "check immediately" reschedule — needs a module-level
re-entrancy guard so only one cycle can ever be mid-flight at a time:

```ts
let cycleInFlight = false;
async function runGuarded(...): Promise<...> {
  if (cycleInFlight) return; // or return a "skipped" result if the caller needs one
  cycleInFlight = true;
  try {
    await actualCycle(...);
  } finally {
    cycleInFlight = false;
  }
}
```

Route **every** entry point for that feature (each alarm handler, any manual
trigger, any config-change-driven immediate check) through the same guarded
function — see `arena/runner.ts`'s `runGuarded`, `streetIntel/actionRunner.ts`
or `crimesAuto/runner.ts`'s `cycleInFlight`, or `smuggling/petCourier.ts`'s
`activeRun` (a `Promise`-based variant, for when a caller needs the actual
result rather than just a skip) for the exact shape already in the codebase.
Add this from the start on any new background automation or new trigger —
don't wait for it to actually race in production first.

Without it, two triggers landing within milliseconds of each other both read
the same live game state and both act on it — the *second* call gets a real,
legitimate rejection from the server (a cooldown the first call just
consumed, a pet the first call just dispatched, an opponent the first call
just fought) that's indistinguishable from a genuine unrecognized-response
shape problem, and can trip that feature's own auto-pause/auto-disable safety
net over something that was never actually broken. Confirmed real,
independently, in three separate features before this was recognized as a
class of bug: Arena Auto-Attack, Street Intel Auto, and Pet Courier (whose
incident also cascaded into `disableAutoWatch()` firing, plus exposed that
the in-page toggle UI had no `chrome.storage.onChanged` listener and kept
showing everything ON after the background silently turned it off) — see
[[feedback_guard_concurrent_background_triggers]] in memory for the full
account. Any UI surface showing a background feature's own toggle state
needs that same `onChanged` listener for the same reason: a
background-triggered change won't otherwise ever be reflected there.

## General

- Run `npm run build` after code changes, not just a type-check — see
  `feedback_always_build_after_changes` in memory.
- Every background-automation feature's kill switch defaults to **off**, no
  exceptions, including retrofits onto something that was previously
  always-on.
- Investigate/diagnose requests are not authorization to implement a fix —
  report findings and stop unless a fix is explicitly requested.
- Non-obvious UX/behavior tradeoffs get surfaced as a question before
  shipping, not decided unilaterally.
