import fs from 'node:fs';
import path from 'node:path';
import { computeCoverageEntry, publishCoverageHistory } from './coverage-history.mjs';

// Invoked by .github/workflows/coverage-history.yml on `workflow_run: [CI],
// types: [completed]` for pushes to master — decoupled from ci.yml itself
// (a separate workflow triggered by its completion) so tracking the unit
// coverage master-push trend can never touch, or regress, the main
// pipeline. Mirrors record-ci-duration.mjs/record-mem-profile-history.mjs:
// that workflow already downloaded test_unit's unit-coverage artifact from
// the just-completed run into COVERAGE_DIR before invoking this script.
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, COVERAGE_DIR } = process.env;
if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_SHA || !COVERAGE_DIR) {
  throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, and COVERAGE_DIR must be set');
}

const summaryPath = path.join(COVERAGE_DIR, 'coverage-summary.json');

async function main() {
  if (!fs.existsSync(summaryPath)) {
    // test_unit can fail to produce a unit-coverage artifact at all (crashed
    // before vitest finished writing reports) — skip this master push's
    // entry rather than persisting a garbage one, matching
    // generate-coverage-stats.mjs's own tolerance for a missing summary.
    console.warn(`No coverage summary found at ${summaryPath}; skipping.`);
    return;
  }

  const { total } = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const entry = computeCoverageEntry({
    sha: GITHUB_SHA,
    date: new Date().toISOString(),
    summaryTotal: total,
  });
  if (!entry) {
    console.warn(`Coverage summary at ${summaryPath} has no usable metrics; skipping.`);
    return;
  }

  await publishCoverageHistory({
    freshEntries: [entry],
    githubToken: GITHUB_TOKEN,
    describeCommit: () =>
      `record coverage for ${entry.sha.slice(0, 7)} (${['statements', 'branches', 'functions', 'lines']
        .filter((key) => entry[`${key}Pct`] !== undefined)
        .map((key) => `${key}: ${entry[`${key}Pct`].toFixed(1)}%`)
        .join(', ')})`,
  });
}

await main();
