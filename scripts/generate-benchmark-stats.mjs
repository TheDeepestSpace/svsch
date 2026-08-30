import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  renderStackedSuiteChart,
  renderHistoryTrendChart,
  renderDeltaTableMarkdown,
  renderStackedCsv,
  computeDeltaRows,
  computeAverageDelta,
  computeBenchmarkHistory,
  mergeBenchmarkHistory,
  extractBaseline,
} from './render-benchmark-charts.mjs';

// visual (one column per spec file/test) can run into the dozens of entries,
// so its chart drops x-axis labels and per-bar delta text in favor of showing
// every bar, however thin — it also gets a full CSV (both elaboration and
// rendering values, plus their sum) so the exact numbers aren't lost along
// with the labels.
const CHART_KEYS_WITH_LABELS = new Set();
const CHART_KEYS_WITH_CSV = new Set(['visual']);

// Renders a markdown section covering every diagram-generation benchmark
// suite, with a real "master vs. this run" bar chart (hosted on gh-pages,
// since GitHub comments can't embed raw <svg>) plus a worst/best delta table
// per suite — report_pr_stats folds this into the combined PR stats comment
// (see upsert-pr-stats-comment.mjs). First arg is the output markdown file;
// the rest are "<benchmark-name>=<benchmark-file>" pairs, one per
// individually tracked benchmark (visual has two: elaboration and
// rendering).
const [outputFile, ...suiteRawArgs] = process.argv.slice(2);
if (!outputFile) {
  throw new Error(
    'Usage: node scripts/generate-benchmark-stats.mjs <output-file> <name>=<file> [<name>=<file> ...]',
  );
}
const suiteArgs = suiteRawArgs.map((arg) => {
  const [name, file] = arg.split('=');
  if (!name || !file) {
    throw new Error(`Invalid suite argument "${arg}", expected <benchmark-name>=<benchmark-file>`);
  }
  return { name, file };
});

const { GITHUB_REPOSITORY, GITHUB_TOKEN, PR_NUMBER } = process.env;

if (suiteArgs.length === 0) {
  throw new Error(
    'Usage: node scripts/generate-benchmark-stats.mjs <output-file> <name>=<file> [<name>=<file> ...]',
  );
}
if (!GITHUB_REPOSITORY || !GITHUB_TOKEN || !PR_NUMBER) {
  throw new Error('GITHUB_REPOSITORY, GITHUB_TOKEN, and PR_NUMBER must be set');
}

// Which chart each benchmark suite belongs to, and how it's labeled there.
// visual's two suites share one stacked chart (elaboration segment drawn
// first since that's the Surelog/UHDM C++ path).
const METRIC_META = {
  'visual-elaboration-diagram-generation-duration': {
    chartKey: 'visual',
    chartTitle: 'Visual suite performance statistics',
    label: 'Elaboration — Surelog/UHDM (C++ path)',
    order: 0,
  },
  'visual-rendering-diagram-generation-duration': {
    chartKey: 'visual',
    chartTitle: 'Visual suite performance statistics',
    label: 'Rendering — webview paint',
    order: 1,
  },
};

// Bounds every git/GitHub API call below so a network stall (fetch/push
// against gh-pages, or the GitHub API) can't hang the CI job indefinitely.
const NETWORK_TIMEOUT_MS = 60_000;

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: NETWORK_TIMEOUT_MS, ...opts });
}

// Checkout's persisted credentials don't reliably reach git commands run
// against a linked worktree (fetch/read still work anonymously since the
// repo is public, but push needs real auth and gets none there), so
// fetch/push against gh-pages authenticate explicitly with GITHUB_TOKEN —
// the same "AUTHORIZATION: basic" header actions/checkout itself sets up.
// Passed via GIT_CONFIG_* env vars rather than a `-c` argv flag: a failed
// exec's error includes its argv in the thrown message, and since the header
// is base64 (not the raw token), GitHub's log masking wouldn't catch it there.
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

// dev/bench/data.js is github-action-benchmark's full history file, appended
// to (never pruned) on every master push — it's grown well past git show's
// default 1MB maxBuffer (see #258), so raise it generously and give it
// headroom to keep growing between now and whenever trim-benchmark-history.mjs
// next runs.
const BASELINE_MAX_BUFFER = 20 * 1024 * 1024;

const baselineData = (() => {
  try {
    const script = git(['show', 'origin/gh-pages:dev/bench/data.js'], {
      maxBuffer: BASELINE_MAX_BUFFER,
    });
    return JSON.parse(script.slice('window.BENCHMARK_DATA = '.length));
  } catch (err) {
    // Surface the real failure (e.g. a future maxBuffer regression, or gh-pages
    // truly missing the file) instead of silently falling back to "no
    // baseline" — that failure mode renders every test as new with an empty
    // trend chart and previously went unnoticed for days (#258).
    console.error('Failed to read baseline benchmark data from gh-pages:dev/bench/data.js:', err);
    return undefined;
  }
})();

// dev/bench/history-averages.json holds the visual suite's per-run
// {sha, date, elaborationAvgMs, renderingAvgMs} averages, kept indefinitely by
// trim-benchmark-history.mjs even as it prunes the raw per-test entries in
// dev/bench/data.js those averages were derived from — so the trend chart
// below prefers reading its history from here rather than recomputing it from
// baselineData, which only ever holds the most recent MAX_ENTRIES_PER_SUITE
// runs. Missing (e.g. before trim-benchmark-history.mjs has ever run — it's
// master-push-only, so a brand new gh-pages branch or a PR opened before the
// first post-merge master run since this file was introduced won't have it
// yet) or unparseable just means nothing persisted yet, not a hard failure.
const persistedHistory = (() => {
  try {
    const json = git(['show', 'origin/gh-pages:dev/bench/history-averages.json']);
    return JSON.parse(json);
  } catch (err) {
    console.error(
      'No benchmark history-averages.json on gh-pages yet (or failed to read it):',
      err,
    );
    return [];
  }
})();
// Merged with history freshly derived from baselineData (already fetched
// above) rather than used alone: right after this persistence was introduced,
// or if trim-benchmark-history.mjs's master-only step ever fails to run, the
// persisted file lags or is missing entirely and the trend chart would
// otherwise render as a single dangling "this PR" point with no history.
// mergeBenchmarkHistory dedups by sha with the persisted entry winning, so
// this never disagrees with the persisted file once it catches up.
const historyAverages = mergeBenchmarkHistory(
  persistedHistory,
  computeBenchmarkHistory(baselineData),
);

const chartGroups = new Map();
for (const { name, file } of suiteArgs) {
  const meta = METRIC_META[name];
  if (!meta) {
    throw new Error(
      `Unknown benchmark suite "${name}" — add it to METRIC_META in generate-benchmark-stats.mjs`,
    );
  }
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  const baselineByName = extractBaseline(baselineData, name);
  const group = chartGroups.get(meta.chartKey) ?? { title: meta.chartTitle, metrics: [] };
  group.metrics.push({
    name,
    order: meta.order,
    label: meta.label,
    unit: entries[0]?.unit ?? 'ms',
    entries,
    baselineByName,
  });
  chartGroups.set(meta.chartKey, group);
}

// Publishes chart SVGs (and, for CHART_KEYS_WITH_CSV, per-metric CSVs) to
// gh-pages (dev/bench-charts/pr-<N>/<file>) via a throwaway worktree, so
// they're reachable at a raw.githubusercontent URL for the PR comment —
// GitHub markdown can't render inline <svg>, only <img>/link references to a
// hosted file. Same branch github-action-benchmark already publishes
// benchmark history to; this just adds a few static files there rather than
// a second place to manage. Retries a few times since concurrent PR runs can
// race to push.
function publishFiles(contentByFilename) {
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-charts-'));
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      gitAuthed(['fetch', '--depth=1', 'origin', 'gh-pages']);
      if (attempt > 1) {
        git(['worktree', 'remove', '--force', worktreeDir]);
      }
      git(['worktree', 'add', '--detach', worktreeDir, 'origin/gh-pages']);

      const chartsDir = path.join(worktreeDir, 'dev', 'bench-charts', `pr-${PR_NUMBER}`);
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
          `Update benchmark charts for PR #${PR_NUMBER}`,
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
    throw new Error('Failed to publish benchmark charts after 3 attempts');
  } finally {
    try {
      git(['worktree', 'remove', '--force', worktreeDir]);
    } catch {
      // Best-effort cleanup.
    }
  }
}

const [owner, repo] = GITHUB_REPOSITORY.split('/');
const contentByFilename = new Map();
const csvFilenamesByKey = new Map();
for (const [key, group] of chartGroups) {
  const metrics = [...group.metrics].sort((a, b) => a.order - b.order);
  const showLabels = CHART_KEYS_WITH_LABELS.has(key);
  const svg = renderStackedSuiteChart({
    suiteTitle: `${group.title} — baseline vs. this run, fastest to slowest`,
    metrics,
    showLabels,
  });
  contentByFilename.set(`${key}.svg`, svg);

  if (CHART_KEYS_WITH_CSV.has(key)) {
    // One row per test with both elaboration and rendering values plus their
    // sum, ordered fastest-to-slowest by that sum — same order
    // computeStackedData sorts the chart's bars in, so the CSV never
    // disagrees with what the chart shows.
    const filename = `${key}.csv`;
    contentByFilename.set(filename, renderStackedCsv(metrics));
    csvFilenamesByKey.set(key, [{ filename }]);
  }
}

// The trend chart only exists for the visual suite — it's the only one with
// per-master-run history to derive (see historyAverages above).
const visualGroup = chartGroups.get('visual');
const elaborationMetric = visualGroup?.metrics.find(
  (m) => m.name === 'visual-elaboration-diagram-generation-duration',
);
const renderingMetric = visualGroup?.metrics.find(
  (m) => m.name === 'visual-rendering-diagram-generation-duration',
);
if (elaborationMetric && renderingMetric) {
  const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const currentRunAverages = {
    dateMs: Date.now(),
    elaborationAvgMs: average(elaborationMetric.entries.map((entry) => entry.value)),
    renderingAvgMs: average(renderingMetric.entries.map((entry) => entry.value)),
  };
  contentByFilename.set(
    'visual-trend.svg',
    renderHistoryTrendChart({
      title: 'Visual suite — historical average per master run',
      history: historyAverages,
      currentRunAverages,
    }),
  );
}

const chartCommitSha = publishFiles(contentByFilename);

// A one-line "how'd it move" per tracked metric, surfaced right after the
// report header — so the headline number is visible without expanding any
// suite's collapsed delta table first. Same order as METRIC_META.
const summaryLines = [];
for (const [, group] of chartGroups) {
  const metrics = [...group.metrics].sort((a, b) => a.order - b.order);
  for (const metric of metrics) {
    const rows = computeDeltaRows(metric.entries, metric.baselineByName);
    const avg = computeAverageDelta(rows);
    if (!avg) continue;
    const signMs = avg.avgNominal > 0 ? '+' : '';
    const signPct = avg.avgPct > 0 ? '+' : '';
    summaryLines.push(
      `- **${metric.label}:** ${signMs}${avg.avgNominal.toFixed(0)} ms (${signPct}${avg.avgPct.toFixed(1)}%) avg across ${avg.count} test${avg.count === 1 ? '' : 's'}`,
    );
  }
}

const sections = [];
for (const [key, group] of chartGroups) {
  const metrics = [...group.metrics].sort((a, b) => a.order - b.order);
  const chartUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${chartCommitSha}/dev/bench-charts/pr-${PR_NUMBER}/${key}.svg`;
  const lines = [`### ${group.title}`, '', `![${group.title} chart](${chartUrl})`];

  const csvFilenames = csvFilenamesByKey.get(key);
  if (csvFilenames?.length) {
    const csvLinks = csvFilenames.map(({ label, filename }) => {
      const csvUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${chartCommitSha}/dev/bench-charts/pr-${PR_NUMBER}/${filename}`;
      const linkLabel = csvFilenames.length > 1 ? `${label} CSV` : 'CSV';
      return `[${linkLabel}](${csvUrl})`;
    });
    lines.push('', `Full data (chart omits labels above ~10 entries): ${csvLinks.join(' · ')}`);
  }

  for (const metric of metrics) {
    const rows = computeDeltaRows(metric.entries, metric.baselineByName);
    const table = renderDeltaTableMarkdown(rows);
    if (table) {
      const heading = metrics.length > 1 ? `${metric.label} delta` : 'Delta summary';
      lines.push(
        '',
        `<details><summary>${heading} (worst 5 / best 5 / average)</summary>`,
        '',
        table,
        '',
        '</details>',
      );
    }
  }
  if (key === 'visual' && contentByFilename.has('visual-trend.svg')) {
    const trendUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${chartCommitSha}/dev/bench-charts/pr-${PR_NUMBER}/visual-trend.svg`;
    // Plain markdown image syntax never renders wider than the SVG's own
    // pixel width, leaving the trend chart narrower than the comment body
    // even though there's room — an explicit width="100%" <img> stretches it
    // to fill the available width instead (height follows automatically
    // since no height attribute is set).
    lines.push('', `<img src="${trendUrl}" alt="Visual suite historical trend" width="100%" />`);
  }

  sections.push(lines.join('\n'));
}

const body = [
  '## Diagram generation benchmark',
  ...(summaryLines.length ? [summaryLines.join('\n')] : []),
  ...sections,
].join('\n\n');

fs.writeFileSync(outputFile, `${body}\n`, 'utf8');
console.log(`Wrote benchmark stats to ${outputFile}`);
