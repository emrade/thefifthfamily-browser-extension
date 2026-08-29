/**
 * Refuses to sign a version that has already been signed, and refuses to
 * build at all if package.json/manifest.json disagree on the version.
 *
 * Mozilla rejects a re-upload at an existing version, but it does so after the
 * build has run and the bundle has been uploaded, and the error is not especially
 * clear about the cause. More to the point, the failure mode this exists to catch
 * is quieter than that: work gets committed against a version number that was
 * already released, so the fix silently never reaches the signed build, and the
 * bug it fixed appears to still be present.
 *
 * `web-ext-artifacts/` is the source of truth for what has actually been signed —
 * more reliable than the version in package.json, which says what is *intended*,
 * or than git history, which says nothing about uploads.
 *
 * **The version lives in two files, not one** — package.json's `version` and
 * manifest.json's own separate `version` field, and nothing syncs them
 * automatically. Confirmed real (2026-08-29): package.json got bumped to
 * 0.14.0, manifest.json was left at 0.13.8, and the build+upload ran to
 * completion (the whole point of catching this *before* that, not after)
 * before Mozilla rejected it with an unhelpful "Version 0.13.8 already
 * exists" — because the *packaged* manifest, not package.json, is what
 * actually ships. This is checked first, and is a hard failure, not a
 * reminder: there's no legitimate reason for these to ever disagree.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = join(root, 'web-ext-artifacts');
const changelogPath = join(root, 'CHANGELOG.md');

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { version: manifestVersion } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

if (version !== manifestVersion) {
  console.error(`
preflight: refusing to build — version mismatch between package.json and manifest.json.

  package.json:  ${version}
  manifest.json: ${manifestVersion}

  manifest.json is what actually ships (it's what gets built into dist/ and
  uploaded), so a mismatch here means the build silently ships the *wrong*
  version regardless of what package.json says — Mozilla only rejects it if
  that wrong version happens to already be signed, and otherwise says nothing
  at all.

  Bump BOTH files to the same version, then run again:
    - package.json  ("version" field)
    - manifest.json  ("version" field)
`);
  process.exit(1);
}

/**
 * A reminder, never a gate — printed right before a successful preflight,
 * never before a failure above (no point nagging about a release that isn't
 * happening). Deliberately non-blocking: a bare rebuild or a recovery
 * re-release genuinely has nothing worth logging, and turning this into a
 * hard failure would just train skipping it with --no-verify energy rather
 * than respecting it.
 *
 * Checks for the literal heading CHANGELOG.md's own entries use
 * (`## [x.y.z]`, see the file itself) rather than diffing git history —
 * simpler, and answers the actual question ("does this version have an
 * entry") directly instead of inferring it from what changed since some
 * other commit.
 */
function reminderIfChangelogMissingEntry() {
  if (!existsSync(changelogPath)) return; // no changelog being kept at all — nothing to remind about
  const changelog = readFileSync(changelogPath, 'utf8');
  if (changelog.includes(`## [${version}]`)) return;
  console.log(`
preflight: CHANGELOG.md has no entry for ${version} yet.

  Not a blocker — add one now if this release has anything worth logging,
  or ignore this if it's a plain rebuild/recovery release.
`);
}

/**
 * Also just a reminder, same non-blocking reasoning as the CHANGELOG one
 * above — this can't be enforced mechanically (nothing here can tell "new
 * feature" from "bug fix" apart from reading the actual change), only
 * prompted for. The convention itself: bump the *minor* version for a new
 * feature or user-visible capability, the *patch* version for a fix or
 * internal-only change with no new capability — same shape SemVer already
 * uses, applied deliberately rather than defaulting to an always-patch habit.
 */
function reminderVersioningConvention() {
  console.log(`
preflight: versioning convention — new feature/capability -> bump the minor
  version (x.Y.0); fix or internal-only change -> bump the patch version
  (x.y.Z). Pick whichever this release actually is before proceeding.
`);
}

if (!existsSync(artifactsDir)) {
  console.log(`preflight: no previous artifacts, releasing ${version}`);
  reminderIfChangelogMissingEntry();
  reminderVersioningConvention();
  process.exit(0);
}

// Signed filenames look like `<amo-id>-<version>.xpi`.
const signed = readdirSync(artifactsDir)
  .filter((name) => name.endsWith('.xpi'))
  .map((name) => name.replace(/^.*?-(\d[\d.]*)\.xpi$/, '$1'));

if (!signed.includes(version)) {
  console.log(`preflight: ${version} has not been signed before — proceeding`);
  reminderIfChangelogMissingEntry();
  reminderVersioningConvention();
  process.exit(0);
}

const compare = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
};

const highest = [...signed].sort(compare).pop();
const parts = highest.split('.').map(Number);
const suggestion = [parts[0], parts[1], (parts[2] ?? 0) + 1].join('.');

console.error(`
preflight: refusing to sign — version ${version} is already signed.

  web-ext-artifacts/ already contains an .xpi for ${version}, so Mozilla will
  reject this upload, and anything committed since that release would not have
  reached users.

  Highest signed version: ${highest}
  Next free patch:        ${suggestion}

  Bump "version" in BOTH package.json and manifest.json, then run again.
`);
process.exit(1);
