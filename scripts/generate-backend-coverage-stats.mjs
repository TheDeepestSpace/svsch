import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Renders collect-backend-coverage.mjs's merged lcov.info as a markdown
// section for report_pr_stats to fold into the combined PR stats comment,
// and publishes the genhtml report that job also produces (when genhtml is
// available) to gh-pages — same gh-pages-as-static-host approach
// generate-coverage-stats.mjs uses for the frontend's vitest report, and
// generate-benchmark-stats.mjs uses for chart SVGs. Duplicated here rather
// than shared, for the same reason generate-coverage-stats.mjs gives: these
// publish different shapes of content, and that script was the template
// this one was pulled from, not a dependency to share.
const [, , lcovInfoPathArg, outputPathArg, htmlDirArg] = process.argv;
const lcovInfoPath = lcovInfoPathArg ?? 'coverage/backend/lcov.info';
const outputPath = outputPathArg ?? 'backend-coverage-stats.md';
const htmlDir = htmlDirArg ?? 'coverage/backend/html';
const reportIndexPath = path.join(htmlDir, 'index.html');

const { GITHUB_REPOSITORY, GITHUB_TOKEN, PR_NUMBER, GITHUB_SERVER_URL, GITHUB_RUN_ID } =
  process.env;
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

// Copies the genhtml report into dev/backend-coverage/pr-<N>/ on gh-pages via
// a throwaway worktree, replacing whatever that PR published last time (so
// files removed/renamed since don't linger). Retries a few times since
// concurrent PR runs can race to push.
function publishReport() {
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-backend-coverage-'));
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      gitAuthed(['fetch', 'origin', 'gh-pages']);
      if (attempt > 1) {
        git(['worktree', 'remove', '--force', worktreeDir]);
      }
      git(['worktree', 'add', '--detach', worktreeDir, 'origin/gh-pages']);

      const targetDir = path.join(worktreeDir, 'dev', 'backend-coverage', `pr-${PR_NUMBER}`);
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.mkdirSync(targetDir, { recursive: true });
      fs.cpSync(htmlDir, targetDir, { recursive: true });

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
          `Update backend coverage report for PR #${PR_NUMBER}`,
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
    throw new Error('Failed to publish backend coverage report after 3 attempts');
  } finally {
    try {
      git(['worktree', 'remove', '--force', worktreeDir]);
    } catch {
      // Best-effort cleanup.
    }
  }
}

// lcov --summary prints a report shaped like:
//   Summary coverage rate:
//     lines......: 22.4% (123 of 550 lines)
//     functions..: 30.0% (12 of 40 functions)
//     branches...: 15.0% (5 of 33 branches)
// Pull the three metric rows out of that instead of hand-parsing the
// tracefile format (SF:/DA:/FN:/BRDA: records) — lcov is already a required
// tool here (run-backend-coverage.js and collect-backend-coverage.mjs both
// shell out to it), so this stays in sync with however that version of lcov
// aggregates multi-file tracefiles.
function formatMetric(summaryText, metric) {
  const match = summaryText.match(
    new RegExp(`^\\s*${metric}\\.*:\\s*([\\d.]+)%\\s*\\((\\d+) of (\\d+)`, 'm'),
  );
  if (!match) return 'N/A';
  const [, pct, covered, total] = match;
  return `${Number(pct).toFixed(2)}% (${covered}/${total})`;
}

let sections;
try {
  const summaryText = execFileSync('lcov', ['--summary', lcovInfoPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const table = [
    '| Metric | Coverage |',
    '| --- | --- |',
    `| Lines | ${formatMetric(summaryText, 'lines')} |`,
    `| Functions | ${formatMetric(summaryText, 'functions')} |`,
    `| Branches | ${formatMetric(summaryText, 'branches')} |`,
  ].join('\n');
  sections = ['## Backend coverage', table];
} catch (err) {
  // Coverage can be missing if every producer job (test_unit/test_bdd/
  // test_visual/test_syntax/test_system/test_backend_coverage) failed before
  // uploading its share, or if collect-backend-coverage.mjs itself errored —
  // note that in the stats comment instead of failing this job, since
  // backend coverage is non-blocking/visibility-only (see collect_backend_coverage
  // in ci.yml).
  console.error(`Failed to read backend coverage summary from ${lcovInfoPath}:`, err);
  sections = ['## Backend coverage', '_Coverage summary unavailable for this run._'];
}

// Kept out of the try/catch above: a gh-pages publish failure is unrelated
// to whether the real coverage summary parsed fine, and shouldn't discard
// it — only the "Browse full coverage report" link is swapped for a note
// (with a link back to this run, since that's where the actual error is).
if (fs.existsSync(reportIndexPath)) {
  try {
    publishReport();
    const reportUrl = `https://${owner.toLowerCase()}.github.io/${repo}/dev/backend-coverage/pr-${PR_NUMBER}/index.html`;
    sections.push(`[Browse full backend coverage report →](${reportUrl})`);
  } catch (err) {
    console.error('Failed to publish backend coverage report to gh-pages:', err);
    sections.push(
      runUrl
        ? `_Backend coverage report unavailable — publish to gh-pages failed. See the [failing run](${runUrl}) for details._`
        : '_Backend coverage report unavailable — publish to gh-pages failed._',
    );
  }
}

const body = sections.join('\n\n');

fs.writeFileSync(outputPath, `${body}\n`, 'utf8');
console.log(`Wrote backend coverage stats to ${outputPath}`);
