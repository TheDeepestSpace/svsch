import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COLORS, renderHistoryTrendChart, mergeBenchmarkHistory } from './render-benchmark-charts.mjs';

// gh-pages paths for the unit test coverage master-history trend (#412) —
// mirrors dev/ci-duration/ (scripts/ci-duration.mjs) and dev/mem-profile/
// (scripts/mem-profile.mjs) in both shape and how it's populated: a
// workflow_run-triggered job reads vitest's coverage-summary.json back out of
// the just-completed master-push CI run's own unit-coverage artifact and
// merges it in — the same file generate-coverage-stats.mjs reads for the
// PR-comment-only table this backfills a master trend for.
export const HISTORY_PATH = 'dev/coverage/history.json';
export const TREND_SVG_PATH = 'dev/coverage/trend.svg';
export const INDEX_HTML_PATH = 'dev/coverage/index.html';

const NETWORK_TIMEOUT_MS = 60_000;

// mergeBenchmarkHistory only ever looks at `.sha`/`.date` — see
// ci-duration.mjs's/mem-profile.mjs's identical re-exports for why it's
// already generic enough to dedupe/sort coverage's {sha, date, <metric>Pct}
// entries too.
export { mergeBenchmarkHistory as mergeCoverageHistory };

// The four vitest coverage-summary.json metrics (same set/order
// generate-coverage-stats.mjs's PR-comment table lists), each mapped to the
// key its persisted/current-point entries carry and the trend chart's line
// color — colors validated together (and alongside teal) via the dataviz
// skill's validator, see COLORS' own comment in render-benchmark-charts.mjs.
export const METRICS = [
  { key: 'statements', label: 'Statements', color: COLORS.indigo },
  { key: 'branches', label: 'Branches', color: COLORS.teal },
  { key: 'functions', label: 'Functions', color: COLORS.amber },
  { key: 'lines', label: 'Lines', color: COLORS.magenta },
];

const pctKey = (metric) => `${metric.key}Pct`;

// vitest's coverage-summary.json `total.<metric>.pct` is the string
// 'Unknown' (see generate-coverage-stats.mjs's own formatMetric) when that
// metric wasn't collected at all — treated as absent here too, rather than
// persisting a bogus entry. Returns null when every metric is absent (a
// malformed/empty summary), the same "guard a partial input" contract
// ci-duration.mjs's computeRunDurationEntry follows.
export function computeCoverageEntry({ sha, date, summaryTotal }) {
  const entry = { sha, date };
  let any = false;
  for (const metric of METRICS) {
    const pct = summaryTotal?.[metric.key]?.pct;
    if (typeof pct === 'number') {
      entry[pctKey(metric)] = pct;
      any = true;
    }
  }
  return any ? entry : null;
}

const COVERAGE_SERIES = METRICS.map((metric) => ({
  key: pctKey(metric),
  color: metric.color,
  label: metric.label,
}));

// The single-chart, 4-series form of render-benchmark-charts.mjs's trend
// chart — same `squish: true` choice ci-duration.mjs's/mem-profile.mjs's own
// trend charts make, since this history is master-push-only and grows
// unbounded the same way theirs do.
export function renderCoverageTrendChart({ history, currentPoint, currentLabel }) {
  return renderHistoryTrendChart({
    title: 'Unit test coverage — per master push',
    valueLabel: 'Unit test coverage per master push (%)',
    history,
    currentPoint,
    currentLabel,
    series: COVERAGE_SERIES,
    squish: true,
  });
}

// Minimal static viewer, styled consistently with dev/ci-duration/index.html
// and dev/mem-profile/index.html (same font stack/muted palette — see their
// own notes on why they don't reuse github-action-benchmark's dashboard).
// Hand-rolled the same way those two originally were, rather than importing
// #411's dashboard-page-shell.mjs — #411 and #412 are independent/parallel
// PRs, so this can't assume that module has landed yet. Worth revisiting
// once both have merged.
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
    <title>Unit Test Coverage</title>
  </head>
  <body>
    <h1>Unit test coverage</h1>
    <p class="small">Statements/branches/functions/lines coverage of the unit test suite, per master push. Raw data: <a href="history.json">history.json</a>. Per-PR detail: see that PR's stats comment for a link to its own report.</p>
    <img src="trend.svg" alt="Unit test coverage trend" />
  </body>
</html>
`;

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: NETWORK_TIMEOUT_MS, ...opts });
}

// Same auth-via-env-vars approach as ci-duration.mjs/mem-profile.mjs and
// trim-benchmark-history.mjs/generate-benchmark-stats.mjs — see their
// identical helpers for why.
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

// Merges `freshEntries` into gh-pages's persisted coverage history,
// regenerates the trend chart/viewer from the merged result, and pushes both
// in one commit — same shape and same retry-on-losing-push-race behavior as
// ci-duration.mjs's publishCiDurationHistory/mem-profile.mjs's
// publishMemProfileHistory, duplicated rather than shared for the same
// reason those two give each other: different persisted entry shapes.
export async function publishCoverageHistory({ freshEntries, githubToken, describeCommit }) {
  if (freshEntries.length === 0) {
    console.log('No coverage entries to record; nothing to do.');
    return;
  }

  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-coverage-history-'));
  let worktreeAdded = false;
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        gitAuthed(githubToken, ['fetch', '--depth=1', 'origin', 'gh-pages']);
        if (worktreeAdded) {
          git(['worktree', 'remove', '--force', worktreeDir]);
          worktreeAdded = false;
        }
        git(['worktree', 'add', '--detach', worktreeDir, 'origin/gh-pages']);
        worktreeAdded = true;
      } catch (err) {
        if (attempt === 3) throw err;
        // Transient network failure, or someone else's push race, fetching
        // or checking out gh-pages — refetch and retry.
        continue;
      }

      const historyPath = path.join(worktreeDir, HISTORY_PATH);
      const existingHistory = fs.existsSync(historyPath)
        ? JSON.parse(fs.readFileSync(historyPath, 'utf8'))
        : [];
      const mergedHistory = mergeBenchmarkHistory(existingHistory, freshEntries);
      const addedCount = mergedHistory.length - existingHistory.length;
      if (addedCount === 0) {
        console.log('Coverage history already up to date; nothing to do.');
        return;
      }

      fs.mkdirSync(path.dirname(historyPath), { recursive: true });
      fs.writeFileSync(historyPath, JSON.stringify(mergedHistory), 'utf8');
      fs.writeFileSync(
        path.join(worktreeDir, TREND_SVG_PATH),
        renderCoverageTrendChart({ history: mergedHistory }),
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
    if (worktreeAdded) {
      try {
        git(['worktree', 'remove', '--force', worktreeDir]);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}
