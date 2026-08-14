import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { comparePngBuffers } from '../test/pngSnapshotComparison';
import { baselineThresholdFor, type SnapshotSuite } from '../test/snapshotPolicy';
import { findSnapshotBypass, loadSnapshotBypassEntries } from '../test/snapshotBypass';
import { parseChangedBaselines } from '../test/changedBaselines';

function usage(): never {
  throw new Error('Usage: check-snapshot-updates <base-commit> <visual|bdd|system> [head-commit]');
}

const [baseCommit, suiteArg, headCommit = 'HEAD', ...extraArgs] = process.argv.slice(2);
if (!baseCommit || !suiteArg || !headCommit || extraArgs.length > 0) usage();
if (suiteArg !== 'visual' && suiteArg !== 'bdd' && suiteArg !== 'system') usage();
const suite: SnapshotSuite = suiteArg;
const prNumber = Number(process.env.PR_NUMBER);
const bypassEntries = loadSnapshotBypassEntries();

// CI checks out GitHub's merge commit, which can include base-branch changes
// newer than the event payload. An explicit head keeps the gate scoped to the PR.
const nameStatusOutput = execFileSync(
  'git',
  ['diff', '--name-status', '-z', '-M', baseCommit, headCommit],
  { encoding: 'utf8' }
);
const { pairs: changedBaselines, ambiguous } = parseChangedBaselines(nameStatusOutput);

let checked = 0;
let rejected = 0;
let bypassed = 0;

for (const group of ambiguous) {
  const isRelevant = [...group.addedPaths, ...group.deletedPaths].some(
    (path) => baselineThresholdFor(path)?.suite === suite
  );
  if (!isRelevant) continue;

  checked += 1;
  rejected += 1;
  console.error(
    `::error::Ambiguous baseline rename for "${group.basename}": cannot determine which of `
    + `${group.deletedPaths.join(', ')} corresponds to which of ${group.addedPaths.join(', ')}. `
    + 'Rename the files so git can match them 1:1, or split the changes into separate commits.'
  );
}

for (const { oldPath, newPath } of changedBaselines) {
  const policy = baselineThresholdFor(newPath);
  if (!policy || policy.suite !== suite) continue;

  checked += 1;
  const expectedBuffer = execFileSync('git', ['show', `${baseCommit}:${oldPath}`]);
  const actualBuffer = headCommit === 'HEAD'
    ? fs.readFileSync(newPath)
    : execFileSync('git', ['show', `${headCommit}:${newPath}`]);
  const comparison = comparePngBuffers(
    expectedBuffer,
    actualBuffer,
    policy.maxDiffPixels,
    policy.pixelmatchThreshold
  );

  // A size change cannot pass the test's comparator, so it is a legitimate
  // baseline update for this gate. Pixel-identical metadata changes are not.
  if (comparison.numDiffPixels === undefined || !comparison.matches) continue;

  const bypass = findSnapshotBypass(bypassEntries, newPath, prNumber, comparison.numDiffPixels);
  if (bypass) {
    bypassed += 1;
    console.log(
      `::notice file=${newPath}::Sub-threshold update allowed via test/snapshot-bypass.yml `
      + `(PR #${bypass.pr}, diff ${comparison.numDiffPixels} px): ${bypass.reason}`
    );
    continue;
  }

  rejected += 1;
  console.error(
    `::error file=${newPath}::This screenshot update looks like sub-threshold noise `
    + `(diff was ${comparison.numDiffPixels} px, threshold is ${policy.maxDiffPixels} px) — `
    + 'the baseline was rejected, no update needed. If this is a real change, add an entry to '
    + 'test/snapshot-bypass.yml instead of forcing the update.'
  );
}

if (rejected > 0) {
  console.error(`Rejected ${rejected} of ${checked} changed ${suite} baseline image(s).`);
  process.exit(1);
}

const bypassSuffix = bypassed > 0 ? ` (${bypassed} allowed via test/snapshot-bypass.yml)` : '';
console.log(`Checked ${checked} changed ${suite} baseline image(s); no sub-threshold updates found${bypassSuffix}.`);
