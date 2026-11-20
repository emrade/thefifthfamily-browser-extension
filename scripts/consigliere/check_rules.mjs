#!/usr/bin/env node
/**
 * Checks TFF Consigliere's odds against this extension's predictor before a
 * pack is uploaded. Expects 0 differences.
 *
 * 1. Every known card in the pack × every condition × several stat and bonus
 *    sets: the app's own `cardOdds` (src/lib/street-intel/odds.ts, using the
 *    generated rules) vs `predictCard` here (src/shared/streetIntelPredict.ts).
 *    Also catches a pack whose base odds or conditions differ from the
 *    extension's tables.
 * 3. Complication verdicts: the pack's Pick/Avoid for every scenario must be
 *    what the extension's own `describeComplicationChoices` says on the same
 *    results (PACK.tally.json, which stays local).
 * 2. Calibration: for a known shared bonus, the window the app works out from
 *    each approach's shown odds must contain it, and the odds it then shows
 *    must include the true ones.
 *
 * Run: node scripts/consigliere/check_rules.mjs PACK_JSON [APP_DIR]
 */
import { build } from 'esbuild';
import { readFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [packPath, appArg] = process.argv.slice(2);
const app = appArg ?? process.env.CONSIGLIERE_DIR ?? '/Users/emrade/Dev/Apps/nextjs/tff-consigliere';
const pack = JSON.parse(readFileSync(packPath, 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'consigliere-check-'));
const require = createRequire(import.meta.url);

async function bundle(entry, root, name) {
  const outfile = join(work, `${name}.cjs`);
  await build({ entryPoints: [entry], alias: { '@': join(root, 'src') }, bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'silent' });
  return require(outfile);
}
const appOdds = await bundle(join(app, 'src/lib/street-intel/odds.ts'), app, 'app');
const ext = await bundle(join(repo, 'src/shared/streetIntelPredict.ts'), repo, 'ext');
const extComp = await bundle(join(repo, 'src/shared/streetIntelComplications.ts'), repo, 'extcomp');

const BONUS = { '+25': 25, '+10': 10, '-10': -10, always_fails: 0 };
const STAT_SETS = [
  { strength: 0, defence: 0, agility: 0, dexterity: 0 },
  { strength: 37, defence: 250, agility: 1234, dexterity: 5 },
  { strength: 4810, defence: 3990, agility: 5120, dexterity: 4475 },
  { strength: 20000, defence: 9, agility: 777, dexterity: 15000 },
];
const MOD_SETS = [
  { rank: 0, prestige: 0, collection: 0, recon: 0, mastery: 0 },
  { rank: 14, prestige: 5, collection: 3, recon: 8, mastery: 6 },
  { rank: 40, prestige: 20, collection: 12, recon: 15, mastery: 25 },
];

let compared = 0;
const diffs = [];
const known = Object.values(pack.cards).filter((c) => c.approaches);
for (const card of known) {
  for (const [sentence, condition] of Object.entries(pack.conditions)) {
    for (const stats of STAT_SETS) {
      for (const m of MOD_SETS) {
        const shared = m.rank + m.prestige + m.collection + m.recon + m.mastery;
        const mine = appOdds.cardOdds(card, condition, stats, { lo: shared - 1e-6, hi: shared + 1e-6 });
        const theirs = ext.predictCard(
          {
            title: card.name,
            modifier: sentence === '' ? null : sentence,
            approaches: card.approaches.map((a) => ({ key: a.key, stat: a.stat, bonus: BONUS[a.role], autofail: a.role === 'always_fails' })),
          },
          { rank: m.rank, prestige: m.prestige, collection: m.collection, recon: m.recon, mastery: { [card.category]: m.mastery }, updatedAt: 0 },
          stats,
        );
        if (!theirs) {
          diffs.push(`${card.name} / "${sentence}": the extension can't predict it (unknown title or condition)`);
          continue;
        }
        for (const a of mine) {
          compared++;
          const t = theirs.approaches.find((x) => x.key === a.key)?.pct;
          if (t !== a.low) diffs.push(`${card.name} / "${sentence}" / ${a.key}: app ${a.low}, extension ${t}`);
        }
      }
    }
  }
}
console.log(`1. odds: ${compared} compared, ${diffs.length} different`);

let windows = 0;
const misses = [];
for (const card of known) {
  for (const condition of Object.values(pack.conditions)) {
    for (const stats of STAT_SETS.slice(1)) {
      for (const shared of [3.3, 27.9, 61.5, 118.2]) {
        const truth = appOdds.cardOdds(card, condition, stats, { lo: shared - 1e-6, hi: shared + 1e-6 });
        for (const a of card.approaches) {
          const shown = truth.find((x) => x.key === a.key).low;
          const r = appOdds.calibrationWindow(card, condition, a, stats, shown);
          if (!r.ok) continue;
          windows++;
          if (!(r.window.lo <= shared && shared < r.window.hi)) misses.push(`${card.name} ${a.key}: ${shared} outside [${r.window.lo}, ${r.window.hi})`);
          const shownOdds = appOdds.cardOdds(card, condition, stats, r.window);
          for (const x of shownOdds) {
            const t = truth.find((y) => y.key === x.key).low;
            if (t < x.low || t > x.high) misses.push(`${card.name} ${x.key}: true ${t} outside ${x.low}-${x.high}`);
          }
        }
      }
    }
  }
}
console.log(`2. calibration: ${windows} scouts replayed, ${misses.length} wrong`);

const verdictDiffs = [];
const tally = JSON.parse(readFileSync(packPath.replace(/\.json$/, '.tally.json'), 'utf8'));
for (const [scenario, cells] of Object.entries(tally)) {
  // A name the extension has no seed for, so only these results count.
  const fresh = `Check: ${scenario}`;
  const typeStats = { [fresh]: Object.fromEntries(['fight', 'run', 'talk'].map((c) => [c, { attempts: cells[c]?.[1] ?? 0, successes: cells[c]?.[0] ?? 0 }])) };
  const { choices, best } = extComp.describeComplicationChoices(fresh, typeStats);
  const want = { pick: best, avoid: choices.filter((c) => c.blocked).map((c) => c.choice) };
  const got = pack.complications?.[scenario];
  if (JSON.stringify(got) !== JSON.stringify(want)) verdictDiffs.push(`"${scenario}": pack ${JSON.stringify(got)}, extension ${JSON.stringify(want)}`);
}
console.log(`3. complication verdicts: ${Object.keys(tally).length} scenarios, ${verdictDiffs.length} different`);

const problems = [...diffs, ...misses, ...verdictDiffs];
if (problems.length) {
  console.error(problems.slice(0, 15).join('\n'));
  process.exit(1);
}
console.log('0 differences');
