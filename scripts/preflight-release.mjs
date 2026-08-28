/**
 * Refuses to sign a version that has already been signed.
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
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = join(root, 'web-ext-artifacts');
const changelogPath = join(root, 'CHANGELOG.md');

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/**
 * A reminder, never a gate — printed right before a successful preflight,
 * never before the "refusing to sign" failure below (no point nagging about
 * a release that isn't happening). Deliberately non-blocking: a bare rebuild
 * or a recovery re-release genuinely has nothing worth logging, and turning
 * this into a hard failure would just train skipping it with --no-verify
 * energy rather than respecting it.
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

if (!existsSync(artifactsDir)) {
  console.log(`preflight: no previous artifacts, releasing ${version}`);
  reminderIfChangelogMissingEntry();
  process.exit(0);
}

// Signed filenames look like `<amo-id>-<version>.xpi`.
const signed = readdirSync(artifactsDir)
  .filter((name) => name.endsWith('.xpi'))
  .map((name) => name.replace(/^.*?-(\d[\d.]*)\.xpi$/, '$1'));

if (!signed.includes(version)) {
  console.log(`preflight: ${version} has not been signed before — proceeding`);
  reminderIfChangelogMissingEntry();
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

  Bump "version" in package.json AND manifest.json, then run again.
`);
process.exit(1);
