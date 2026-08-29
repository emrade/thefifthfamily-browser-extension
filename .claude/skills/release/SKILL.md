---
name: release
description: Use when the user asks to release, ship, publish, cut a new version, or "do a release" of this browser extension (The Fifth Family Enhancements). Bumps the version in both package.json and manifest.json, updates CHANGELOG.md, commits, then runs the full build/sign/tag pipeline to Mozilla AMO. Only ever run when explicitly invoked as /release — never trigger this proactively from other work, even after finishing a feature or fix the user might want released.
user-invocable: true
argument-hint: "[patch|minor]"
---

# Releasing this extension

This performs a real, hard-to-reverse action: signing and submitting a build
to Mozilla's AMO service, and creating a permanent git tag. **Only do this
when the user has just typed `/release` (or explicitly asks you to run this
skill) — never infer permission to release from anything else** (finishing a
feature, a prior release earlier in the conversation, "do it before any next
release" style sequencing statements, etc.). If you're not sure this
invocation is the explicit ask, stop and confirm before touching anything
below. This exact mistake — treating "do the popup page before any release"
as authorization for the release itself — actually happened once; don't
repeat it.

## 1. Check the working tree

Run `git status --short`. If there's uncommitted work:
- If it's clearly the feature/fix work this release is meant to ship, tell
  the user what you see and confirm it should be committed as part of this
  release before proceeding.
- Don't silently fold arbitrary uncommitted diffs into the version-bump
  commit without saying so first.

## 2. Determine the version bump

This project's convention (see `CHANGELOG.md`'s own header and
`scripts/preflight-release.mjs`'s reminder): **new feature or user-visible
capability → bump the minor version (x.Y.0). Fix or internal-only change →
bump the patch version (x.y.Z).** There is no auto-patch-always precedent to
fall back on for anything shipped from now on — pick deliberately.

- If invoked as `/release patch` or `/release minor`, use that.
- Otherwise, look at what's actually shipping since the last version tag
  (`git log <last-tag>..HEAD --oneline` and the diff) and use your own
  judgment — but if it's genuinely ambiguous (a mix of both, or unclear
  scope), ask the user rather than guess.

Read the current version from `package.json`, compute the new one.

## 3. Bump the version in BOTH files

**This has bitten a real release before**: `manifest.json` carries its own
separate `version` field that does not sync from `package.json` — a mismatch
here builds fine locally but gets rejected by Mozilla with a confusing
"version already exists" error, after wasting a full build+upload cycle.
`scripts/preflight-release.mjs` now hard-fails on this mismatch before
building, but don't rely on the safety net — set both correctly the first
time:

- `package.json` → `"version"` field
- `manifest.json` → `"version"` field

## 4. Add a CHANGELOG.md entry

Add a new `## [x.y.z] - YYYY-MM-DD` section at the top (today's date), above
the previous entry. Use `### Added` / `### Fixed` / `### Changed` sections as
appropriate, matching the style of existing entries — specific about what
changed and why, not just restating commit titles. Draft it yourself from
what actually shipped this session/since the last release, then show it to
the user if there's any doubt about accuracy — don't skip this step even for
a "just a small fix" release; skipping it silently is worse than a short
entry.

## 5. Verify before committing

Run `npm run type-check` and `npm run build`. Both must be clean. Fix
anything broken before proceeding — never commit a version bump on top of a
failing build.

## 6. Commit

Commit `package.json`, `manifest.json`, and `CHANGELOG.md` together as one
`chore(release): bump version to x.y.z` commit (separate from any
feature/fix commits already made in step 1 — don't squash them together).
Follow the repo's normal commit conventions (see the top-level git
instructions: Co-Authored-By trailer, no `--no-verify`, etc.).

## 7. Confirm AMO credentials are present

Check `AMO_API_KEY` and `AMO_API_SECRET` are set (don't print their values)
before running the pipeline — failing fast here beats failing after a full
build.

## 8. Run the release pipeline

Run `npm run release` (this chains `preflight` → `build` → `web-ext sign`
→ `tag-release`). This talks to Mozilla and can take a couple of minutes
(validation, then approval) — run it with a background-capable approach
(e.g. `run_in_background`) rather than blocking, and report back once it
completes rather than polling repeatedly.

Report the actual outcome plainly: the signed `.xpi` path from
`web-ext-artifacts/`, whether the git tag was created (it silently isn't if
the tree was dirty at sign time — say so if that happens), and print any
real failure verbatim rather than summarizing it away.

## What NOT to do

- Don't re-run `npm run release` to "fix" a failed attempt without
  understanding why it failed first — a version that's already signed can
  never be re-signed; you'll need a new bump.
- Don't skip the CHANGELOG entry because the change feels small.
- Don't guess the version bump size when it's genuinely ambiguous — ask.
- Don't treat this skill's own invocation as blanket permission for a
  *second* release later in the same conversation — each `/release` is its
  own explicit ask.
