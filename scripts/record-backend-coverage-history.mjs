import { execFileSync } from 'node:child_process';
import { computeBackendCoverageEntry, publishBackendCoverageHistory } from './backend-coverage-history.mjs';

// Invoked by .github/workflows/backend-coverage-history.yml on
// `workflow_run: [CI], types: [completed]` for pushes to master — decoupled
// from ci.yml itself (a separate workflow triggered by its completion) so
// tracking the backend coverage master-push trend can never touch, or
// regress, the main pipeline. Mirrors
// record-ci-duration.mjs/record-mem-profile-history.mjs: that workflow
// already downloaded collect_backend_coverage's backend-coverage-final
// artifact from the just-completed run into LCOV_INFO_PATH's directory
// before invoking this script.
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, LCOV_INFO_PATH } = process.env;
if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_SHA || !LCOV_INFO_PATH) {
  throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, and LCOV_INFO_PATH must be set');
}

async function main() {
  let summaryText;
  try {
    summaryText = execFileSync('lcov', ['--summary', LCOV_INFO_PATH], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // collect_backend_coverage can produce a missing/empty lcov.info (every
    // producer job failed before uploading its share) — skip this master
    // push's entry rather than persisting a garbage one, matching
    // generate-backend-coverage-stats.mjs's own tolerance.
    console.warn(`Failed to read backend coverage summary from ${LCOV_INFO_PATH}:`, err.message);
    return;
  }

  const entry = computeBackendCoverageEntry({
    sha: GITHUB_SHA,
    date: new Date().toISOString(),
    summaryText,
  });
  if (!entry) {
    console.warn('Backend coverage summary has no usable metrics; skipping.');
    return;
  }

  await publishBackendCoverageHistory({
    freshEntries: [entry],
    githubToken: GITHUB_TOKEN,
    describeCommit: () =>
      `record backend coverage for ${entry.sha.slice(0, 7)} (${['lines', 'functions', 'branches']
        .filter((key) => entry[`${key}Pct`] !== undefined)
        .map((key) => `${key}: ${entry[`${key}Pct`].toFixed(1)}%`)
        .join(', ')})`,
  });
}

await main();
