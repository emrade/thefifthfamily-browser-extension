/**
 * Tags the commit a release was signed from, immediately after signing.
 *
 * Without this, the only record that a version shipped is the `.xpi` in
 * web-ext-artifacts/ and a commit message — neither of which survives history
 * being rewritten. That is not hypothetical: the commit recording the 0.10.1
 * release was dropped from main by a rebase run to tidy commit ordering, shortly
 * after 0.10.1 had already been signed and installed. It survived only in the
 * reflog, which garbage-collects.
 *
 * A tag fixes both halves of that. It records which source produced a given
 * signed artifact, and it makes the commit permanently reachable, so a later
 * rebase can move history around without the released state going missing.
 *
 * Runs after signing, so a failed upload never leaves a tag claiming otherwise.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tag = `v${version}`;

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const existing = git('tag', '--list', tag);
if (existing) {
  console.log(`tag-release: ${tag} already exists — leaving it alone`);
  process.exit(0);
}

// A dirty tree means the signed bundle does not correspond to any commit, so
// there is nothing honest to tag. Warn rather than fail: the upload has already
// happened by this point, and failing here would imply the release did not.
const dirty = git('status', '--porcelain');
if (dirty) {
  console.warn(
    `tag-release: working tree is dirty, so ${tag} was NOT tagged.\n` +
      `  The signed build does not match any commit. Commit, then tag by hand:\n` +
      `    git tag -a ${tag} -m "Signed and released $(date -u +%FT%TZ)"`,
  );
  process.exit(0);
}

git('tag', '-a', tag, '-m', `Signed and released to Mozilla ${new Date().toISOString()} (unlisted).`);
console.log(`tag-release: tagged ${tag} at ${git('rev-parse', '--short', 'HEAD')}`);
