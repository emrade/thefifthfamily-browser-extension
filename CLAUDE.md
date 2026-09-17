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
