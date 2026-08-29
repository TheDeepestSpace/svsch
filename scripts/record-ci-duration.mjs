import { computeRunDurationEntry, fetchRun, publishCiDurationHistory } from './ci-duration.mjs';

// Invoked by .github/workflows/ci-duration.yml on `workflow_run: [CI],
// types: [completed]` for pushes to master — decoupled from ci.yml itself
// (a separate workflow triggered by its completion) so tracking overall
// wall-clock duration never touches, or can regress, the main pipeline.
const { GITHUB_TOKEN, GITHUB_REPOSITORY, RUN_ID } = process.env;
if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !RUN_ID) {
  throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY, and RUN_ID must be set');
}

const [owner, repo] = GITHUB_REPOSITORY.split('/');

async function main() {
  const run = await fetchRun({ owner, repo, runId: RUN_ID, githubToken: GITHUB_TOKEN });
  const entry = computeRunDurationEntry(run);
  if (!entry) {
    // Shouldn't happen — the triggering event is itself `types: [completed]`
    // — but a malformed/partial API response shouldn't crash the workflow
    // over one missed data point.
    console.warn(`Run ${RUN_ID} has no usable timing yet (status: ${run?.status}); skipping.`);
    return;
  }

  await publishCiDurationHistory({
    freshEntries: [entry],
    githubToken: GITHUB_TOKEN,
    describeCommit: () => `record CI duration for ${entry.sha.slice(0, 7)} (${entry.durationSec}s)`,
  });
}

await main();
