import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderMemoryTimeseriesChart } from './render-benchmark-charts.mjs';
import {
  CATEGORIES,
  computeTrailingMedianPeakBytes,
  computeWorstPeak,
  loadShardsByCategory,
  relativeJsonPath,
  renderMemProfileTrendChart,
} from './mem-profile.mjs';

// Renders this PR's memory (RSS) profiling section — one line per suite
// (visual/system/BDD) comparing this run's worst shard/leg peak against the
// trailing-20-master-push median, plus a trend-chart preview and a link to
// the full per-shard/leg report — for report_pr_stats to fold into the
// combined PR stats comment (#400). Mirrors generate-benchmark-stats.mjs /
// generate-ci-duration-stats.mjs: publishes its own gh-pages assets (here, a
// whole per-PR directory tree rather than a couple of chart files) and reads
// its own baseline back from gh-pages, so this and the master-push history
// recorder (mem-profile-history.yml) never disagree about what's persisted.
const [, , outputFileArg, rawDirArg] = process.argv;
const outputFile = outputFileArg ?? 'memory-stats.md';
const rawDir = rawDirArg ?? 'mem-profile-raw';

const { GITHUB_REPOSITORY, GITHUB_TOKEN, PR_NUMBER } = process.env;
if (!GITHUB_REPOSITORY || !GITHUB_TOKEN || !PR_NUMBER) {
  throw new Error('GITHUB_REPOSITORY, GITHUB_TOKEN, and PR_NUMBER must be set');
}
const [owner, repo] = GITHUB_REPOSITORY.split('/');

const NETWORK_TIMEOUT_MS = 60_000;
const TRAILING_WINDOW = 20;

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

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(0);
}

const persistedHistory = (() => {
  try {
    const json = git(['show', 'origin/gh-pages:dev/mem-profile/history.json']);
    return JSON.parse(json);
  } catch (err) {
    console.error('No mem-profile history.json on gh-pages yet (or failed to read it):', err);
    return [];
  }
})();

const filesByCategory = loadShardsByCategory(rawDir);

const categoryResults = CATEGORIES.map((category) => {
  const shards = filesByCategory.get(category.key);
  const worst = computeWorstPeak(shards.map((s) => ({ label: s.label, peakBytes: s.peakBytes })));
  const baselineBytes = computeTrailingMedianPeakBytes(persistedHistory, category, TRAILING_WINDOW);
  const deltaPct =
    worst && baselineBytes ? ((worst.peakBytes - baselineBytes) / baselineBytes) * 100 : undefined;

  return { category, shards, worst, baselineBytes, deltaPct };
});

// Publishes the raw per-shard/leg timeseries + the self-contained HTML
// report + this PR's trend-chart preview to gh-pages
// (dev/mem-profile/pr-<N>/), replacing whatever that PR published last time
// (so shards/legs removed since — e.g. a shard count change — don't linger).
// Same worktree-commit-push-with-retry shape as generate-coverage-stats.mjs's
// publishReport / generate-benchmark-stats.mjs's publishFiles.
function publishReport(filesByRelativePath) {
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-mem-profile-'));
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        gitAuthed(['fetch', '--depth=1', 'origin', 'gh-pages']);
        if (attempt > 1) {
          git(['worktree', 'remove', '--force', worktreeDir]);
        }
        git(['worktree', 'add', '--detach', worktreeDir, 'origin/gh-pages']);

        const targetDir = path.join(worktreeDir, 'dev', 'mem-profile', `pr-${PR_NUMBER}`);
        fs.rmSync(targetDir, { recursive: true, force: true });
        fs.mkdirSync(targetDir, { recursive: true });
        for (const [relativePath, content] of filesByRelativePath) {
          const filePath = path.join(targetDir, relativePath);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, content, 'utf8');
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
            `Update memory profiling report for PR #${PR_NUMBER}`,
          ],
          { cwd: worktreeDir },
        );
        gitAuthed(['push', 'origin', 'HEAD:gh-pages'], { cwd: worktreeDir });
        return git(['rev-parse', 'HEAD'], { cwd: worktreeDir }).trim();
      } catch (err) {
        if (attempt === 3) throw err;
        // Retry transient fetch failures and concurrent push races.
      }
    }
    throw new Error('Failed to publish memory profiling report after 3 attempts');
  } finally {
    try {
      git(['worktree', 'remove', '--force', worktreeDir]);
    } catch {
      // Best-effort cleanup.
    }
  }
}

function renderCategorySection({ category, shards }) {
  if (shards.length === 0) {
    return `<h2>${category.label}</h2>\n<p>No data recorded for this category.</p>`;
  }
  const charts = shards
    .map(({ label, samples }) =>
      renderMemoryTimeseriesChart({
        title: `${category.label} — ${label}`,
        samples,
        color: category.color,
      }),
    )
    .join('\n');
  return `<h2>${category.label}</h2>\n<div class="charts">\n${charts}\n</div>`;
}

function renderIndexHtml() {
  const sections = categoryResults.map(renderCategorySection).join('\n');
  return `<!DOCTYPE html>
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
        margin: 8px 16px 24px;
      }
      h1 {
        font-size: 1.75rem;
        font-weight: 600;
      }
      h2 {
        font-size: 1.25rem;
        font-weight: 600;
        margin-top: 2rem;
      }
      .small {
        font-size: 0.75rem;
      }
      .charts {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
      }
      svg {
        max-width: 100%;
        border: 1px solid #e1e0d9;
        border-radius: 4px;
      }
    </style>
    <title>Memory profiling — PR #${PR_NUMBER}</title>
  </head>
  <body>
    <h1>Memory (RSS) profiling — PR #${PR_NUMBER}</h1>
    <p class="small">One chart per shard/leg, raw {t, rss} samples polled every 100-500ms across that shard/leg's full process tree. Peak-per-category summary and trailing-baseline comparison: see this PR's stats comment.</p>
    ${sections}
  </body>
</html>
`;
}

let body;
try {
  const filesByRelativePath = new Map();
  for (const { category, shards } of categoryResults) {
    for (const { filename, raw } of shards) {
      filesByRelativePath.set(relativeJsonPath(category.key, filename), raw);
    }
  }

  const currentPoint = {
    dateMs: Date.now(),
    ...Object.fromEntries(
      categoryResults.map(({ category, worst }) => [
        `${category.key}PeakBytes`,
        worst?.peakBytes ?? 0,
      ]),
    ),
  };
  filesByRelativePath.set(
    'trend.svg',
    renderMemProfileTrendChart({ history: persistedHistory, currentPoint, currentLabel: 'this PR' }),
  );
  filesByRelativePath.set('index.html', renderIndexHtml());

  const commitSha = publishReport(filesByRelativePath);
  const trendUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${commitSha}/dev/mem-profile/pr-${PR_NUMBER}/trend.svg`;
  const reportUrl = `https://${owner.toLowerCase()}.github.io/${repo}/dev/mem-profile/pr-${PR_NUMBER}/index.html`;

  const summaryLines = categoryResults.map(({ category, worst, baselineBytes, deltaPct }) => {
    if (!worst) return `- **${category.label}:** _no data recorded_`;
    const peak = `${formatMb(worst.peakBytes)} MB peak (worst: ${worst.label})`;
    if (deltaPct === undefined) {
      return `- **${category.label}:** ${peak} — no trailing baseline yet`;
    }
    const sign = deltaPct > 0 ? '+' : '';
    return `- **${category.label}:** ${peak} — ${sign}${deltaPct.toFixed(1)}% vs trailing-${TRAILING_WINDOW}-run median (${formatMb(baselineBytes)} MB)`;
  });

  body = [
    '## Memory (RSS) profiling',
    summaryLines.join('\n'),
    `![Memory profiling trend](${trendUrl})`,
    `[Full per-shard/leg report →](${reportUrl})`,
  ].join('\n\n');
} catch (err) {
  // A failure reading the baseline, computing peaks, or publishing to
  // gh-pages shouldn't fail the whole PR stats comment — note it in this
  // section instead, same as generate-coverage-stats.mjs does for a missing
  // coverage summary.
  console.error('Memory profiling section failed:', err);
  body = ['## Memory (RSS) profiling', `_Unavailable: ${err.message}_`].join('\n\n');
}

fs.writeFileSync(outputFile, `${body}\n`, 'utf8');
console.log(`Wrote memory profiling stats to ${outputFile}`);
