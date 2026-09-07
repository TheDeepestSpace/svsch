import { CATEGORIES, computeWorstPeak, loadShardsByCategory, publishMemProfileHistory } from './mem-profile.mjs';

// Invoked by .github/workflows/mem-profile-history.yml on `workflow_run:
// [CI], types: [completed]` for pushes to master — decoupled from ci.yml
// itself (a separate workflow triggered by its completion) so recording the
// master-push memory profiling trend can never touch, or regress, the main
// pipeline. Mirrors record-ci-duration.mjs: that workflow already downloaded
// every shard's/leg's mem-profile-*-raw-* artifact from the just-completed
// run into rawDir before invoking this script.
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, RAW_DIR } = process.env;
if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_SHA || !RAW_DIR) {
  throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, and RAW_DIR must be set');
}

async function main() {
  const filesByCategory = loadShardsByCategory(RAW_DIR);
  const worstByCategory = CATEGORIES.map((category) => ({
    category,
    worst: computeWorstPeak(
      filesByCategory.get(category.key).map((s) => ({ label: s.label, peakBytes: s.peakBytes })),
    ),
  }));

  const missing = worstByCategory.filter(({ worst }) => !worst);
  if (missing.length > 0) {
    // Shouldn't happen — every category runs on every push to master — but a
    // missing category (e.g. an artifact upload failure) shouldn't crash the
    // whole recording over the categories that did report in.
    console.warn(
      `No mem-profile data for: ${missing.map(({ category }) => category.key).join(', ')}; recording the rest.`,
    );
  }
  const present = worstByCategory.filter(({ worst }) => worst);
  if (present.length === 0) {
    console.warn('No mem-profile data for any category; skipping.');
    return;
  }

  const entry = {
    sha: GITHUB_SHA,
    date: new Date().toISOString(),
    ...Object.fromEntries(present.map(({ category, worst }) => [`${category.key}PeakBytes`, worst.peakBytes])),
  };

  await publishMemProfileHistory({
    freshEntries: [entry],
    githubToken: GITHUB_TOKEN,
    describeCommit: () =>
      `record mem profile for ${entry.sha.slice(0, 7)} (${present
        .map(({ category, worst }) => `${category.key}: ${Math.round(worst.peakBytes / (1024 * 1024))}MB`)
        .join(', ')})`,
  });
}

await main();
