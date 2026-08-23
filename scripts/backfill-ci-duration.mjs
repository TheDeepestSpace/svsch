import {
  computeRunDurationEntry,
  fetchCompletedRuns,
  publishCiDurationHistory,
} from './ci-duration.mjs';

// One-off seed for dev/ci-duration/history.json (#282) — same shape as
// trim-benchmark-history.mjs's gh-pages push, but run manually once rather
// than on every CI run: paginates every completed push-to-master run of the
// CI workflow and reconstructs as much duration history as the Actions API
// still retains (typically a few months), instead of only starting to
// accumulate history from whenever record-ci-duration.mjs first runs.
//
//   GITHUB_TOKEN=... GITHUB_REPOSITORY=owner/repo node scripts/backfill-ci-duration.mjs
const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set');
}

const [owner, repo] = GITHUB_REPOSITORY.split('/');

async function main() {
  const runs = await fetchCompletedRuns({
    owner,
    repo,
    workflowFile: 'ci.yml',
    branch: 'master',
    event: 'push',
    githubToken: GITHUB_TOKEN,
  });
  console.log(`Fetched ${runs.length} completed push-to-master CI run(s).`);

  const entries = runs.map(computeRunDurationEntry).filter(Boolean);
  console.log(`${entries.length} of those have usable timing.`);

  await publishCiDurationHistory({
    freshEntries: entries,
    githubToken: GITHUB_TOKEN,
    describeCommit: (addedCount) =>
      `backfill ${addedCount} historical CI duration entr${addedCount === 1 ? 'y' : 'ies'}`,
  });
}

await main();
