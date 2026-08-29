import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COLORS,
  renderHistoryTrendChart,
  mergeBenchmarkHistory,
} from './render-benchmark-charts.mjs';

// gh-pages paths for the CI workflow wall-clock-duration history (#282) —
// kept alongside dev/bench (the diagram-generation benchmarks) but in its
// own directory, since overall workflow duration isn't a "benchmark" in
// github-action-benchmark's sense, just whole-run wall clock computed
// straight from the Actions API rather than measured in-process.
export const HISTORY_PATH = 'dev/ci-duration/history.json';
export const TREND_SVG_PATH = 'dev/ci-duration/trend.svg';
export const INDEX_HTML_PATH = 'dev/ci-duration/index.html';

const NETWORK_TIMEOUT_MS = 60_000;

// mergeBenchmarkHistory only ever looks at `.sha`/`.date`, so it's already
// generic enough to dedupe/sort {sha, date, durationSec} entries too —
// re-exported under a name that doesn't read as visual-suite-specific
// rather than duplicating the same merge-by-sha logic here.
export { mergeBenchmarkHistory as mergeCiDurationHistory };

const DURATION_SERIES = [{ key: 'durationMin', color: COLORS.blue, label: 'CI duration (min)' }];

// A GitHub Actions run's wall-clock duration: run_started_at (when a runner
// actually picked it up, not when it sat queued) to updated_at (its last
// state change, which for a `completed` run is when it finished). Returns
// null for a run that isn't `completed` yet, or is missing timing fields —
// guards a malformed/partial API response rather than persisting a garbage
// entry.
export function computeRunDurationEntry(run) {
  if (run?.status !== 'completed' || !run.run_started_at || !run.updated_at || !run.head_sha) {
    return null;
  }
  const startedMs = new Date(run.run_started_at).getTime();
  const updatedMs = new Date(run.updated_at).getTime();
  return {
    sha: run.head_sha,
    date: new Date(run.run_started_at).toISOString(),
    durationSec: Math.round((updatedMs - startedMs) / 1000),
  };
}

// Persisted history/currentPoint entries carry `durationSec` (matching the
// GitHub Actions API's own second-granularity timestamps), but a multi-hour
// axis reads more naturally in minutes — so the chart-facing points get a
// derived `durationMin` alongside it rather than changing the stored unit.
const withDurationMin = (entry) => ({ ...entry, durationMin: entry.durationSec / 60 });

// The single-series form of render-benchmark-charts.mjs's trend chart —
// reuses that renderer (generalized in the same change that introduced this
// module) rather than hand-rolling a second SVG line chart. `squish: true`
// since this history is master-push-only and, once backfilled, runs to
// hundreds of points — the visual suite's chart (one point per master push,
// no backfill) keeps the renderer's unsquished default instead.
export function renderCiDurationTrendChart({ history, currentPoint, currentLabel }) {
  return renderHistoryTrendChart({
    title: 'CI workflow duration — per master push',
    valueLabel: 'CI workflow duration per master push (minutes)',
    history: history.map(withDurationMin),
    currentPoint: currentPoint ? withDurationMin(currentPoint) : currentPoint,
    currentLabel,
    series: DURATION_SERIES,
    squish: true,
  });
}

// Minimal static viewer, styled consistently with dev/bench/index.html
// (same font stack/muted palette) but without that page's Chart.js +
// data.js machinery — github-action-benchmark's own dashboard is
// auto-generated from its own schema on every push, so hooking a second,
// differently-shaped history file into it would mean fighting its
// generator rather than reusing it. The trend chart here is already a
// static SVG (see renderCiDurationTrendChart), so the "viewer" is just this
// page embedding it.
export const INDEX_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, minimum-scale=1.0, initial-scale=1, user-scalable=yes" />
    <style>
      html {
        font-family: BlinkMacSystemFont,-apple-system,"Segoe UI",Roboto,Oxygen,Ubuntu,Cantarell,"Fira Sans","Droid Sans","Helvetica Neue",Helvetica,Arial,sans-serif;
        -webkit-font-smoothing: antialiased;
        background-color: #fff;
        font-size: 16px;
      }
      body {
        color: #4a4a4a;
        margin: 8px;
      }
      h1 {
        font-size: 1.75rem;
        font-weight: 600;
      }
      img {
        max-width: 100%;
      }
      .small {
        font-size: 0.75rem;
      }
    </style>
    <title>CI Duration</title>
  </head>
  <body>
    <h1>CI workflow duration</h1>
    <p class="small">Wall-clock duration of the CI workflow's push-to-master runs. Raw data: <a href="history.json">history.json</a>.</p>
    <img src="trend.svg" alt="CI workflow duration trend" />
  </body>
</html>
`;

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: NETWORK_TIMEOUT_MS, ...opts });
}

// Same auth-via-env-vars approach as trim-benchmark-history.mjs and
// generate-benchmark-stats.mjs — see their identical helpers for why.
function gitAuthed(githubToken, args, opts = {}) {
  const authHeader = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${githubToken}`).toString('base64')}`;
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

// GitHub API GET with the same retry-on-5xx backoff pattern used elsewhere
// in these scripts (e.g. generate-benchmark-stats.mjs's gh-pages fetches).
export async function fetchGitHubJson(url, githubToken) {
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (response.ok) return response.json();
    const text = await response.text();
    if (attempt >= maxAttempts || response.status < 500) {
      throw new Error(`GET ${url} failed (${response.status}): ${text}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
  }
}

// Fetches one run's current state/timing directly — used both by the
// live-capture workflow (keyed off the run id workflow_run handed it) and by
// generate-ci-duration-stats.mjs's "this run so far" preview point.
export async function fetchRun({ owner, repo, runId, githubToken }) {
  return fetchGitHubJson(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`,
    githubToken,
  );
}

// Paginates every run of the named workflow file on `branch`/`event`,
// completed only — used by the one-off backfill script to reconstruct
// history as far back as the Actions API retains it.
export async function fetchCompletedRuns({
  owner,
  repo,
  workflowFile,
  branch,
  event,
  githubToken,
}) {
  const runs = [];
  for (let page = 1; ; page += 1) {
    const url =
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs` +
      `?branch=${encodeURIComponent(branch)}&event=${encodeURIComponent(event)}&status=completed&per_page=100&page=${page}`;
    const body = await fetchGitHubJson(url, githubToken);
    runs.push(...body.workflow_runs);
    if (body.workflow_runs.length < 100) break;
  }
  return runs;
}

// Merges `freshEntries` into gh-pages's persisted CI-duration history,
// regenerates the trend chart/viewer from the merged result, and pushes
// both in one commit — shared by the live-capture workflow (one entry at a
// time) and the one-off backfill script (many at once), so the two can
// never disagree on how a duration entry gets from "just computed" to "on
// gh-pages". Retries on a losing push race the same way
// trim-benchmark-history.mjs does.
export async function publishCiDurationHistory({ freshEntries, githubToken, describeCommit }) {
  if (freshEntries.length === 0) {
    console.log('No CI duration entries to record; nothing to do.');
    return;
  }

  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-ci-duration-'));
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      gitAuthed(githubToken, ['fetch', 'origin', 'gh-pages']);
      if (attempt > 1) {
        git(['worktree', 'remove', '--force', worktreeDir]);
      }
      git(['worktree', 'add', '--detach', worktreeDir, 'origin/gh-pages']);

      const historyPath = path.join(worktreeDir, HISTORY_PATH);
      const existingHistory = fs.existsSync(historyPath)
        ? JSON.parse(fs.readFileSync(historyPath, 'utf8'))
        : [];
      const mergedHistory = mergeBenchmarkHistory(existingHistory, freshEntries);
      const addedCount = mergedHistory.length - existingHistory.length;
      if (addedCount === 0) {
        console.log('CI duration history already up to date; nothing to do.');
        return;
      }

      fs.mkdirSync(path.dirname(historyPath), { recursive: true });
      fs.writeFileSync(historyPath, JSON.stringify(mergedHistory), 'utf8');
      fs.writeFileSync(
        path.join(worktreeDir, TREND_SVG_PATH),
        renderCiDurationTrendChart({ history: mergedHistory }),
        'utf8',
      );
      fs.writeFileSync(path.join(worktreeDir, INDEX_HTML_PATH), INDEX_HTML, 'utf8');

      git(['add', HISTORY_PATH, TREND_SVG_PATH, INDEX_HTML_PATH], { cwd: worktreeDir });
      const message = describeCommit(addedCount);
      git(
        [
          '-c',
          'user.name=github-actions[bot]',
          '-c',
          'user.email=github-actions[bot]@users.noreply.github.com',
          'commit',
          '-m',
          message,
        ],
        { cwd: worktreeDir },
      );
      try {
        gitAuthed(githubToken, ['push', 'origin', 'HEAD:gh-pages'], { cwd: worktreeDir });
        console.log(`${message}.`);
        return;
      } catch (err) {
        if (attempt === 3) throw err;
        // Someone else pushed to gh-pages first — refetch and retry.
      }
    }
  } finally {
    try {
      git(['worktree', 'remove', '--force', worktreeDir]);
    } catch {
      // Best-effort cleanup.
    }
  }
}
