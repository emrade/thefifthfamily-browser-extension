#!/usr/bin/env node
/**
 * Adds complication verdicts to a built pack: per scenario, which choice to
 * Pick and which to Avoid, from the player's own record (PACK.tally.json,
 * written by build_pack.py) with the extension's own rule
 * (src/shared/streetIntelComplicationRule.ts). Only the verdicts go into the
 * pack, never the counts (docs/companion-tool-plan.md, "Data ownership").
 *
 * Stand Your Ground has too few results in the archive for a verdict, so the
 * seed rule only weighs Fight, Run and Talk, as the extension does; the family's
 * own logs give Stand Your Ground its verdict later.
 *
 * Run: node scripts/consigliere/add_verdicts.mjs PACK_JSON
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packPath = process.argv[2];
const tallyPath = packPath.replace(/\.json$/, '.tally.json');
const pack = JSON.parse(readFileSync(packPath, 'utf8'));
const tally = JSON.parse(readFileSync(tallyPath, 'utf8'));

const outfile = join(mkdtempSync(join(tmpdir(), 'consigliere-verdicts-')), 'rule.cjs');
await build({ entryPoints: [join(repo, 'src/shared/streetIntelComplicationRule.ts')], bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'silent' });
const { assessChoices, POOLED_WIN_RATE } = createRequire(import.meta.url)(outfile);

const SEED_CHOICES = ['fight', 'run', 'talk'];
const complications = {};
for (const [scenario, cells] of Object.entries(tally).sort(([a], [b]) => a.localeCompare(b))) {
  const attempts = SEED_CHOICES.reduce((n, c) => n + (cells[c]?.[1] ?? 0), 0);
  if (!attempts) continue;
  const { choices, best } = assessChoices(SEED_CHOICES, (c) => ({ wins: cells[c]?.[0] ?? 0, attempts: cells[c]?.[1] ?? 0 }), POOLED_WIN_RATE);
  complications[scenario] = { pick: best, avoid: choices.filter((c) => c.blocked).map((c) => c.choice) };
}
pack.complications = complications;
writeFileSync(packPath, JSON.stringify(pack));
const withAvoid = Object.values(complications).filter((v) => v.avoid.length).length;
console.log(`verdicts: ${Object.keys(complications).length} scenarios, ${withAvoid} with an Avoid`);
