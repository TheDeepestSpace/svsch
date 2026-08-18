import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  renderStackedSuiteChart,
  renderDeltaTableMarkdown,
  renderStackedCsv,
  computeDeltaRows,
  computeAverageDelta,
  extractBaseline,
} from './render-benchmark-charts.mjs';

// visual (one column per spec file/test) can run into the dozens of entries,
// so its chart drops x-axis labels and per-bar delta text in favor of showing
// every bar, however thin — it also gets a full CSV (both elaboration and
// rendering values, plus their sum) so the exact numbers aren't lost along
// with the labels.
const CHART_KEYS_WITH_LABELS = new Set();
const CHART_KEYS_WITH_CSV = new Set(['visual']);

// One review comment covering every diagram-generation benchmark suite, with
// a real "master vs. this run" bar chart (hosted on gh-pages, since GitHub
// comments can't embed raw <svg>) plus a worst/best delta table per suite.
// Args are "<benchmark-name>=<benchmark-file>" pairs — one per individually
// tracked benchmark (visual has two: elaboration and rendering).
const suiteArgs = process.argv.slice(2).map((arg) => {
  const [name, file] = arg.split('=');
  if (!name || !file) {
    throw new Error(`Invalid suite argument "${arg}", expected <benchmark-name>=<benchmark-file>`);
  }
  return { name, file };
});

const { GITHUB_API_URL = 'https://api.github.com', GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_TOKEN, PR_NUMBER } =
  process.env;

if (suiteArgs.length === 0) {
  throw new Error('Usage: node scripts/comment-benchmark-summary.mjs <name>=<file> [<name>=<file> ...]');
}
if (!GITHUB_REPOSITORY || !GITHUB_SHA || !GITHUB_TOKEN || !PR_NUMBER) {
  throw new Error('GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_TOKEN, and PR_NUMBER must be set');
}

// Which chart each benchmark suite belongs to, and how it's labeled there.
// visual's two suites share one stacked chart (elaboration segment drawn
// first since that's the Surelog/UHDM C++ path).
const METRIC_META = {
  'visual-elaboration-diagram-generation-duration': { chartKey: 'visual', chartTitle: 'Visual suite performance statistics', label: 'Elaboration — Surelog/UHDM (C++ path)', order: 0 },
  'visual-rendering-diagram-generation-duration': { chartKey: 'visual', chartTitle: 'Visual suite performance statistics', label: 'Rendering — webview paint', order: 1 },
};

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...opts });
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

const baselineData = (() => {
  try {
    const script = git(['show', 'origin/gh-pages:dev/bench/data.js']);
    return JSON.parse(script.slice('window.BENCHMARK_DATA = '.length));
  } catch {
    return undefined;
  }
})();

const chartGroups = new Map();
for (const { name, file } of suiteArgs) {
  const meta = METRIC_META[name];
  if (!meta) {
    throw new Error(`Unknown benchmark suite "${name}" — add it to METRIC_META in comment-benchmark-summary.mjs`);
  }
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  const baselineByName = extractBaseline(baselineData, name);
  const group = chartGroups.get(meta.chartKey) ?? { title: meta.chartTitle, metrics: [] };
  group.metrics.push({ name, order: meta.order, label: meta.label, unit: entries[0]?.unit ?? 'ms', entries, baselineByName });
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
      gitAuthed(['fetch', 'origin', 'gh-pages']);
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

      git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=github-actions[bot]@users.noreply.github.com',
        'commit', '-m', `Update benchmark charts for PR #${PR_NUMBER}`], { cwd: worktreeDir });
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
  const svg = renderStackedSuiteChart({ suiteTitle: `${group.title} — baseline vs. this run, fastest to slowest`, metrics, showLabels });
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
    summaryLines.push(`- **${metric.label}:** ${signMs}${avg.avgNominal.toFixed(0)} ms (${signPct}${avg.avgPct.toFixed(1)}%) avg across ${avg.count} test${avg.count === 1 ? '' : 's'}`);
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
      lines.push('', `<details><summary>${heading} (worst 5 / best 5 / average)</summary>`, '', table, '', '</details>');
    }
  }
  sections.push(lines.join('\n'));
}

const commentId = 'diagram-generation-benchmark Summary';
const startTag = `<!-- github-benchmark-action-comment(start): ${commentId} -->`;
const endTag = `<!-- github-benchmark-action-comment(end): ${commentId} -->`;
const body = [
  startTag,
  `# Diagram generation benchmark — ${GITHUB_SHA.slice(0, 7)}`,
  ...(summaryLines.length ? [summaryLines.join('\n')] : []),
  '',
  ...sections,
  '',
  endTag,
].join('\n\n');

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  'Content-Type': 'application/json',
  'X-GitHub-Api-Version': '2022-11-28',
};
// GitHub's REST layer resolves the PR through its GraphQL node under the
// hood, and that lookup can 404 for a few seconds right after the PR was
// pushed to — even though the PR itself, and that exact node id, are fine.
// Retry that specific transient shape instead of failing the whole job.
const isTransientNodeLookupFailure = (status, text) =>
  status === 404 && /Could not resolve to a node with the global id/.test(text);
const request = async (method, apiPath, requestBody) => {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${GITHUB_API_URL}${apiPath}`, {
      method,
      headers,
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
    });
    if (response.ok) return response.json();
    const text = await response.text();
    if (attempt >= 4 || !isTransientNodeLookupFailure(response.status, text)) {
      throw new Error(`${method} ${apiPath} failed (${response.status}): ${text}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
  }
};

const reviews = [];
for (let page = 1; ; page++) {
  const batch = await request('GET', `/repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews?per_page=100&page=${page}`);
  reviews.push(...batch);
  if (batch.length < 100) break;
}
const existing = reviews.find((review) => review.body?.startsWith(startTag));
if (existing) {
  await request('PUT', `/repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews/${existing.id}`, { body });
  console.log('Updated combined benchmark comment.');
} else {
  await request('POST', `/repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews`, { event: 'COMMENT', body });
  console.log('Created combined benchmark comment.');
}
