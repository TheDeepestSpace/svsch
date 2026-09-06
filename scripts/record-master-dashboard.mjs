import { publishMasterDashboard } from './generate-master-dashboard.mjs';

// Invoked by .github/workflows/master-dashboard.yml on `workflow_run: [CI],
// types: [completed]` for pushes to master — decoupled from ci.yml itself,
// and independent of the other 5 metrics' own history jobs, the same way
// ci-duration.yml/mem-profile-history.yml/coverage-history.yml/
// backend-coverage-history.yml are. Unlike those, it needs no artifact
// download: it only ever re-reads whatever's currently on gh-pages (see
// generate-master-dashboard.mjs for why that's the self-healing choice).
const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set');
}

await publishMasterDashboard({
  githubToken: GITHUB_TOKEN,
  describeCommit: (metrics) => `regenerate master dashboard (${metrics.join(', ')})`,
});
