import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { comparePngBuffers } from '../test/pngSnapshotComparison';
import { baselineThresholdFor, type SnapshotSuite } from '../test/snapshotPolicy';

function usage(): never {
  throw new Error('Usage: check-snapshot-updates <base-commit> <visual|bdd|system>');
}

const [baseCommit, suiteArg, ...extraArgs] = process.argv.slice(2);
if (!baseCommit || !suiteArg || extraArgs.length > 0) usage();
if (suiteArg !== 'visual' && suiteArg !== 'bdd' && suiteArg !== 'system') usage();
const suite: SnapshotSuite = suiteArg;

const changedFiles = execFileSync(
  'git',
  ['diff', '--name-only', '--diff-filter=M', '-z', baseCommit, 'HEAD'],
  { encoding: 'utf8' }
).split('\0').filter(Boolean);

let checked = 0;
let rejected = 0;

for (const filePath of changedFiles) {
  const policy = baselineThresholdFor(filePath);
  if (!policy || policy.suite !== suite) continue;

  checked += 1;
  const expectedBuffer = execFileSync('git', ['show', `${baseCommit}:${filePath}`]);
  const actualBuffer = fs.readFileSync(filePath);
  const comparison = comparePngBuffers(
    expectedBuffer,
    actualBuffer,
    policy.maxDiffPixels,
    policy.pixelmatchThreshold
  );

  // A size change cannot pass the test's comparator, so it is a legitimate
  // baseline update for this gate. Pixel-identical metadata changes are not.
  if (comparison.numDiffPixels === undefined || !comparison.matches) continue;

  rejected += 1;
  console.error(
    `::error file=${filePath}::This screenshot update looks like sub-threshold noise `
    + `(diff was ${comparison.numDiffPixels} px, threshold is ${policy.maxDiffPixels} px) — `
    + 'the baseline was rejected, no update needed.'
  );
}

if (rejected > 0) {
  console.error(`Rejected ${rejected} of ${checked} changed ${suite} baseline image(s).`);
  process.exit(1);
}

console.log(`Checked ${checked} changed ${suite} baseline image(s); no sub-threshold updates found.`);
