import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Renders vitest's coverage-summary.json (see vitest.config.ts's
// coverage.reporter) as a markdown table for report_pr_stats to fold into
// the combined PR stats comment, and publishes the full annotated HTML
// report (same reporter config also writes one, alongside the summary) to
// gh-pages — GitHub Pages is enabled for this repo, and unlike a workflow
// artifact it's directly browsable without downloading a zip. Same
// gh-pages-as-static-host approach generate-benchmark-stats.mjs uses for
// chart SVGs, duplicated here rather than shared since the two publish
// different shapes of content (a handful of named files vs. a whole
// directory tree) and that script was itself the template this one was
// pulled from, not a dependency to share.
const [, , coverageDirArg, outputPathArg] = process.argv;
const coverageDir = coverageDirArg ?? 'coverage';
const outputPath = outputPathArg ?? 'coverage-stats.md';
const summaryPath = path.join(coverageDir, 'coverage-summary.json');
const reportIndexPath = path.join(coverageDir, 'index.html');

const { GITHUB_REPOSITORY, GITHUB_TOKEN, PR_NUMBER, GITHUB_SERVER_URL, GITHUB_RUN_ID } = process.env;
if (!GITHUB_REPOSITORY || !GITHUB_TOKEN || !PR_NUMBER) {
  throw new Error('GITHUB_REPOSITORY, GITHUB_TOKEN, and PR_NUMBER must be set');
}
const [owner, repo] = GITHUB_REPOSITORY.split('/');
// GITHUB_SERVER_URL/GITHUB_RUN_ID are set by default on every GitHub Actions
// runner (unlike the vars above, they don't need to be passed in via the
// workflow's `env:`) — used below to link back to this run's log when the
// gh-pages publish fails, since that's where the actual error lives.
const runUrl =
  GITHUB_SERVER_URL && GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : undefined;

function formatMetric(metric) {
  if (!metric || metric.pct === 'Unknown') return 'N/A';
  return `${metric.pct.toFixed(2)}% (${metric.covered}/${metric.total})`;
}

// Bounds every git/GitHub API call below so a network stall (fetch/push
// against gh-pages) can't hang the CI job indefinitely.
const NETWORK_TIMEOUT_MS = 60_000;

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: NETWORK_TIMEOUT_MS, ...opts });
}

// Checkout's persisted credentials don't reliably reach git commands run
// against a linked worktree, so fetch/push against gh-pages authenticate
// explicitly with GITHUB_TOKEN — the same "AUTHORIZATION: basic" header
// actions/checkout itself sets up. Passed via GIT_CONFIG_* env vars rather
// than a `-c` argv flag: a failed exec's error includes its argv in the
// thrown message, and since the header is base64 (not the raw token),
// GitHub's log masking wouldn't catch it there.
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

// The 'lcov' reporter (vitest.config.ts's coverage.reporter) bundles its own
// html output under lcov-report/, duplicating what the 'html' reporter
// already writes at the coverage root — drop it (and the raw data files,
// already covered by the unit-coverage artifact) from the published copy so
// gh-pages doesn't carry ~5MB of redundant pages per PR.
const EXCLUDE_FROM_PUBLISH = new Set(['lcov-report', 'lcov.info', 'coverage-summary.json']);

// Copies the coverage report into dev/coverage/pr-<N>/ on gh-pages via a
// throwaway worktree, replacing whatever that PR published last time (so
// files removed/renamed since don't linger). Retries a few times since
// concurrent PR runs can race to push.
function publishReport() {
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-coverage-'));
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      gitAuthed(['fetch', 'origin', 'gh-pages']);
      if (attempt > 1) {
        git(['worktree', 'remove', '--force', worktreeDir]);
      }
      git(['worktree', 'add', '--detach', worktreeDir, 'origin/gh-pages']);

      const targetDir = path.join(worktreeDir, 'dev', 'coverage', `pr-${PR_NUMBER}`);
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.mkdirSync(targetDir, { recursive: true });
      fs.cpSync(coverageDir, targetDir, {
        recursive: true,
        filter: (source) => {
          const rel = path.relative(coverageDir, source);
          return rel === '' || !EXCLUDE_FROM_PUBLISH.has(rel.split(path.sep)[0]);
        },
      });

      // GitHub Pages runs its source branch through Jekyll by default, which
      // can mangle files/dirs starting with `_` — opt out repo-wide since
      // nothing on gh-pages needs Jekyll processing.
      fs.writeFileSync(path.join(worktreeDir, '.nojekyll'), '');

      git(['add', '-A'], { cwd: worktreeDir });
      const status = git(['status', '--porcelain'], { cwd: worktreeDir }).trim();
      if (!status) {
        return;
      }

      git(
        [
          '-c',
          'user.name=github-actions[bot]',
          '-c',
          'user.email=github-actions[bot]@users.noreply.github.com',
          'commit',
          '-m',
          `Update coverage report for PR #${PR_NUMBER}`,
        ],
        { cwd: worktreeDir },
      );
      try {
        gitAuthed(['push', 'origin', 'HEAD:gh-pages'], { cwd: worktreeDir });
        return;
      } catch (err) {
        if (attempt === 3) throw err;
        // Someone else pushed to gh-pages first — refetch and retry.
      }
    }
    throw new Error('Failed to publish coverage report after 3 attempts');
  } finally {
    try {
      git(['worktree', 'remove', '--force', worktreeDir]);
    } catch {
      // Best-effort cleanup.
    }
  }
}

let sections;
try {
  const { total } = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const table = [
    '| Metric | Coverage |',
    '| --- | --- |',
    `| Statements | ${formatMetric(total.statements)} |`,
    `| Branches | ${formatMetric(total.branches)} |`,
    `| Functions | ${formatMetric(total.functions)} |`,
    `| Lines | ${formatMetric(total.lines)} |`,
  ].join('\n');
  sections = ['## Unit test coverage', table];
} catch (err) {
  // Coverage summary can be missing if the unit test run crashed before
  // vitest finished writing reports (reportOnFailure only covers assertion
  // failures, not a hard crash) — note that in the stats comment instead of
  // failing this job, since coverage reporting isn't itself under test.
  console.error(`Failed to read coverage summary from ${summaryPath}:`, err);
  sections = ['## Unit test coverage', '_Coverage summary unavailable for this run._'];
}

// Kept out of the try/catch above: a gh-pages publish timeout is unrelated
// to whether the real coverage summary parsed fine, and shouldn't discard
// it — only the "Browse full coverage report" link is swapped for a note
// (with a link back to this run, since that's where the actual error is).
if (fs.existsSync(reportIndexPath)) {
  try {
    publishReport();
    const reportUrl = `https://${owner.toLowerCase()}.github.io/${repo}/dev/coverage/pr-${PR_NUMBER}/index.html`;
    sections.push(`[Browse full coverage report →](${reportUrl})`);
  } catch (err) {
    console.error('Failed to publish coverage report to gh-pages:', err);
    sections.push(
      runUrl
        ? `_Coverage report unavailable — publish to gh-pages failed. See the [failing run](${runUrl}) for details._`
        : '_Coverage report unavailable — publish to gh-pages failed._',
    );
  }
}

const body = sections.join('\n\n');

fs.writeFileSync(outputPath, `${body}\n`, 'utf8');
console.log(`Wrote coverage stats to ${outputPath}`);
