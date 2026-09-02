import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchRun, renderCiDurationTrendChart } from './ci-duration.mjs';

// Renders this run's elapsed wall-clock time so far, plus the recent
// per-master-push trend recorded by record-ci-duration.mjs (see #282 and
// .github/workflows/ci-duration.yml), as a markdown section for
// report_pr_stats to fold into the combined PR stats comment — mirrors
// generate-benchmark-stats.mjs/generate-coverage-stats.mjs. "So far" rather
// than a final total: this job runs partway through the workflow graph,
// before several other jobs (package_extension, pack_npm, ...) have even
// started, so the true total isn't knowable yet from inside the run itself.
// First arg is the output markdown file.
const [, , outputFile] = process.argv;
if (!outputFile) {
  throw new Error('Usage: node scripts/generate-ci-duration-stats.mjs <output-file>');
}

const { GITHUB_REPOSITORY, GITHUB_TOKEN, PR_NUMBER, GITHUB_RUN_ID } = process.env;
if (!GITHUB_REPOSITORY || !GITHUB_TOKEN || !PR_NUMBER || !GITHUB_RUN_ID) {
  throw new Error('GITHUB_REPOSITORY, GITHUB_TOKEN, PR_NUMBER, and GITHUB_RUN_ID must be set');
}
const [owner, repo] = GITHUB_REPOSITORY.split('/');

// Bounds every git/GitHub API call below so a network stall (fetch/push
// against gh-pages, or the GitHub API) can't hang the CI job indefinitely.
const NETWORK_TIMEOUT_MS = 60_000;

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: NETWORK_TIMEOUT_MS, ...opts });
}

// Same auth-via-env-vars approach as generate-benchmark-stats.mjs and
// generate-coverage-stats.mjs — see their identical helpers for why.
const authHeader = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${GITHUB_TOKEN}`).toString('base64')}`;
function gitAuthed(args, opts = {}) {
  return git(args, {
    ...opts,
    env: {
      ...process.env,
      ...opts.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: authHeader,
    },
  });
}

// Publishes the trend chart SVG to gh-pages (dev/ci-duration-charts/pr-<N>/)
// via a throwaway worktree, so it's reachable at a raw.githubusercontent URL
// for the PR comment — GitHub markdown can't render inline <svg>, only
// <img>/link references to a hosted file. Same pattern as
// generate-benchmark-stats.mjs's publishFiles, duplicated rather than shared
// per that script's own note on why generate-coverage-stats.mjs does the
// same. Retries a few times since concurrent PR runs can race to push.
function publishFiles(contentByFilename) {
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-ci-duration-charts-'));
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      gitAuthed(['fetch', '--depth=1', 'origin', 'gh-pages']);
      if (attempt > 1) {
        git(['worktree', 'remove', '--force', worktreeDir]);
      }
      git(['worktree', 'add', '--detach', worktreeDir, 'origin/gh-pages']);

      const chartsDir = path.join(worktreeDir, 'dev', 'ci-duration-charts', `pr-${PR_NUMBER}`);
      fs.mkdirSync(chartsDir, { recursive: true });
      for (const [filename, content] of contentByFilename) {
        fs.writeFileSync(path.join(chartsDir, filename), content, 'utf8');
      }

      git(['add', '-A'], { cwd: worktreeDir });
      const status = git(['status', '--porcelain'], { cwd: worktreeDir }).trim();
      if (!status) {
        return git(['rev-parse', 'HEAD'], { cwd: worktreeDir }).trim();
      }

      git(
        [
          '-c',
          'user.name=github-actions[bot]',
          '-c',
          'user.email=github-actions[bot]@users.noreply.github.com',
          'commit',
          '-m',
          `Update CI duration chart for PR #${PR_NUMBER}`,
        ],
        { cwd: worktreeDir },
      );
      try {
        gitAuthed(['push', 'origin', 'HEAD:gh-pages'], { cwd: worktreeDir });
        return git(['rev-parse', 'HEAD'], { cwd: worktreeDir }).trim();
      } catch (err) {
        if (attempt === 3) throw err;
        // Someone else pushed to gh-pages first — refetch and retry.
      }
    }
    throw new Error('Failed to publish CI duration chart after 3 attempts');
  } finally {
    try {
      git(['worktree', 'remove', '--force', worktreeDir]);
    } catch {
      // Best-effort cleanup.
    }
  }
}

let body;
try {
  const persistedHistory = (() => {
    try {
      const json = git(['show', 'origin/gh-pages:dev/ci-duration/history.json']);
      return JSON.parse(json);
    } catch (err) {
      console.error('No CI duration history.json on gh-pages yet (or failed to read it):', err);
      return [];
    }
  })();

  const run = await fetchRun({ owner, repo, runId: GITHUB_RUN_ID, githubToken: GITHUB_TOKEN });
  const startedMs = new Date(run.run_started_at).getTime();
  if (Number.isNaN(startedMs)) {
    throw new Error(`run ${GITHUB_RUN_ID} has no run_started_at yet`);
  }
  const elapsedSec = Math.max(0, Math.round((Date.now() - startedMs) / 1000));

  const svg = renderCiDurationTrendChart({
    history: persistedHistory,
    currentPoint: { durationSec: elapsedSec },
    currentLabel: 'this run (so far)',
  });
  const chartCommitSha = publishFiles(new Map([['trend.svg', svg]]));
  const chartUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${chartCommitSha}/dev/ci-duration-charts/pr-${PR_NUMBER}/trend.svg`;

  body = [
    '## CI Duration',
    `**This run so far:** ${elapsedSec}s elapsed since the workflow started — not the final total, since other jobs (including this one) are still running.`,
    `![CI workflow duration trend](${chartUrl})`,
  ].join('\n\n');
} catch (err) {
  // A failure fetching this run's timing, reading the gh-pages baseline, or
  // publishing the chart shouldn't fail the whole PR stats comment — note it
  // in this section instead, same as generate-coverage-stats.mjs does for a
  // missing coverage summary.
  console.error('CI Duration section failed:', err);
  body = ['## CI Duration', `_Unavailable: ${err.message}_`].join('\n\n');
}

fs.writeFileSync(outputFile, `${body}\n`, 'utf8');
console.log(`Wrote CI duration stats to ${outputFile}`);
