import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COLORS, renderHistoryTrendChart, mergeBenchmarkHistory } from './render-benchmark-charts.mjs';
import { renderDashboardPage } from './dashboard-page-shell.mjs';

// gh-pages paths for the memory (RSS) profiling history (#400) — one
// {sha, date, visualPeakBytes, systemPeakBytes, bddPeakBytes} entry per
// master push, mirroring dev/ci-duration/ (scripts/ci-duration.mjs) in both
// shape and how it's populated: a workflow_run-triggered job reads the
// worst shard/leg's peak per category back out of that completed run's own
// artifacts and merges it in, decoupled from ci.yml itself the same way
// record-ci-duration.mjs is.
export const HISTORY_PATH = 'dev/mem-profile/history.json';
export const TREND_SVG_PATH = 'dev/mem-profile/trend.svg';
export const INDEX_HTML_PATH = 'dev/mem-profile/index.html';

const NETWORK_TIMEOUT_MS = 60_000;

// mergeBenchmarkHistory only ever looks at `.sha`/`.date`, so it's already
// generic enough to dedupe/sort mem-profile's {sha, date, <category>PeakBytes}
// entries too — re-exported under a name that doesn't read as
// benchmark-specific, same reasoning ci-duration.mjs's own re-export gives.
export { mergeBenchmarkHistory as mergeMemProfileHistory };

// The three suites #400 profiles, in the order the trend chart's legend and
// the PR-stats comment list them. `color` is also the shard/leg chart color
// each category's per-PR HTML report uses (see generate-memory-stats.mjs) —
// keeping it here means the trend chart and the per-shard charts can never
// disagree on which color means "visual" versus "system" versus "bdd".
export const CATEGORIES = [
  { key: 'visual', label: 'Visual', color: COLORS.blue },
  { key: 'system', label: 'System', color: COLORS.purple },
  { key: 'bdd', label: 'BDD', color: COLORS.teal },
];

const peakMbKey = (category) => `${category.key}PeakMb`;
const peakBytesKey = (category) => `${category.key}PeakBytes`;

// Peak RSS (bytes) across one shard/leg's raw {t, rss} timeseries (see
// scripts/mem-poller.mjs) — the scalar every reduction in this file (worst
// shard/leg, trailing baseline, the per-shard chart's own peak marker) is
// ultimately built from.
export function computePeakRssBytes(samples) {
  return samples.reduce((max, sample) => Math.max(max, sample.rss), 0);
}

// Each poller run writes one file named after its own category/shard-or-leg
// — this is the only place that knows how to sort a flat directory of them
// (report_memory_stats and mem-profile-history.yml both download every
// shard's/leg's artifact merged into one flat directory) back into
// {visual: [...], system: [...], bdd: [...]}, so the two can never disagree
// about which category a given filename belongs to.
export function parseArtifactFilename(filename) {
  let match = filename.match(/^visual-shard-(\d+)\.json$/);
  if (match) return { category: 'visual', label: `shard ${match[1]}`, sortKey: Number(match[1]) };
  match = filename.match(/^bdd-shard-(\d+)\.json$/);
  if (match) return { category: 'bdd', label: `shard ${match[1]}`, sortKey: Number(match[1]) };
  match = filename.match(/^system-(.+)\.json$/);
  if (match) return { category: 'system', label: `VS Code ${match[1]}`, sortKey: match[1] };
  return null;
}

// dev/mem-profile/pr-<N>/<category>/<rest> — strips the category name back
// off the flattened artifact filename (e.g. "visual-shard-1.json" ->
// "visual/shard-1.json", "system-1.90.0.json" -> "system/1.90.0.json"),
// matching the tree layout #400 specifies.
export function relativeJsonPath(category, filename) {
  return `${category}/${filename.slice(category.length + 1)}`;
}

// Reads every shard's/leg's raw timeseries out of a flat directory (as
// downloaded via `actions/download-artifact` with `merge-multiple: true`)
// and buckets them by category, each shard/leg sorted the same way its
// number/version sorts naturally. Skips (with a warning, not a crash)
// anything that doesn't match the expected naming — a malformed or
// unexpected artifact shouldn't take down the whole report.
export function loadShardsByCategory(rawDir) {
  const filesByCategory = new Map(CATEGORIES.map((category) => [category.key, []]));
  if (fs.existsSync(rawDir)) {
    for (const filename of fs.readdirSync(rawDir)) {
      const parsed = parseArtifactFilename(filename);
      if (!parsed) {
        console.warn(`Skipping unrecognized mem-profile artifact file: ${filename}`);
        continue;
      }
      const raw = fs.readFileSync(path.join(rawDir, filename), 'utf8');
      const samples = JSON.parse(raw);
      filesByCategory.get(parsed.category).push({
        label: parsed.label,
        sortKey: parsed.sortKey,
        filename,
        raw,
        samples,
        peakBytes: computePeakRssBytes(samples),
      });
    }
  } else {
    console.error(`No raw memory-profile directory found at ${rawDir}`);
  }
  for (const shards of filesByCategory.values()) {
    shards.sort((a, b) => (a.sortKey > b.sortKey ? 1 : a.sortKey < b.sortKey ? -1 : 0));
  }
  return filesByCategory;
}

const MEM_SERIES = CATEGORIES.map((category) => ({
  key: peakMbKey(category),
  color: category.color,
  label: `${category.label} peak RSS`,
}));

// Persisted/current-point entries carry `<category>PeakBytes` (raw, matching
// what the poller itself measures), but the trend chart reads more naturally
// in MB — same "derive a display unit rather than change the stored one"
// approach as ci-duration.mjs's withDurationMin.
const withPeakMb = (entry) => {
  const derived = { ...entry };
  for (const category of CATEGORIES) {
    derived[peakMbKey(category)] = entry[peakBytesKey(category)] / (1024 * 1024);
  }
  return derived;
};

export function renderMemProfileTrendChart({ history, currentPoint, currentLabel }) {
  return renderHistoryTrendChart({
    title: 'Memory profiling (RSS) — worst shard/leg per category, per master push',
    valueLabel: 'Peak RSS per category, per master push (MB)',
    history: history.map(withPeakMb),
    currentPoint: currentPoint ? withPeakMb(currentPoint) : currentPoint,
    currentLabel,
    series: MEM_SERIES,
    // Master-push-only history that, once this has run for a while, grows to
    // hundreds of points the same way CI duration's does — see
    // TREND_SQUISHED_WIDTH's own comment in render-benchmark-charts.mjs for
    // why that history opts into `squish` while the visual suite's
    // per-master-push-but-short benchmark history doesn't.
    squish: true,
  });
}

// The worst (highest-peak) shard/leg for one category this run, out of every
// shard/leg's own {label, peakBytes} — this is "that PR's number" #400 calls
// for: a single spike anywhere in the category is what the trend line and
// PR-stats comment surface, not an average that could hide it.
export function computeWorstPeak(shardPeaks) {
  if (shardPeaks.length === 0) return null;
  return shardPeaks.reduce((worst, entry) => (entry.peakBytes > worst.peakBytes ? entry : worst));
}

// Median of the last `windowSize` entries' `${category}PeakBytes` — the
// "trailing-20-PR" baseline the PR-stats comment compares this PR's peak
// against (#400). Even-length windows average the two middle values, same as
// any standard median. Returns null once there's nothing persisted yet to
// compare against (e.g. before the first master push after this shipped).
export function computeTrailingMedianPeakBytes(history, category, windowSize = 20) {
  const key = peakBytesKey(category);
  const values = history
    .slice(-windowSize)
    .map((entry) => entry[key])
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
}

// Minimal static viewer for the gh-pages trend chart, styled consistently
// with dev/ci-duration/index.html (same font stack/muted palette, same
// "just an <img> embedding a static SVG" approach, since duration's own note
// on why it doesn't reuse github-action-benchmark's dashboard applies here
// too: a differently-shaped history file doesn't fit that generator).
export const INDEX_HTML = renderDashboardPage({
  title: 'Memory profiling',
  heading: 'Memory (RSS) profiling',
  description:
    'Worst shard/leg peak RSS per category, per master push. Raw data: <a href="history.json">history.json</a>. Per-PR per-shard/leg detail: see that PR\'s stats comment for a link to its own report.',
  bodyHtml: '<img src="trend.svg" alt="Memory profiling trend" />',
});

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: NETWORK_TIMEOUT_MS, ...opts });
}

// Same auth-via-env-vars approach as ci-duration.mjs/trim-benchmark-history.mjs
// and generate-benchmark-stats.mjs — see their identical helpers for why.
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

// Merges `freshEntries` into gh-pages's persisted mem-profile history,
// regenerates the trend chart/viewer from the merged result, and pushes both
// in one commit — same shape and same retry-on-losing-push-race behavior as
// ci-duration.mjs's publishCiDurationHistory, duplicated rather than shared
// since the two persist different entry shapes (durationSec vs
// per-category PeakBytes) and generalizing the one function to cover both
// would cost more clarity than the duplication does.
export async function publishMemProfileHistory({ freshEntries, githubToken, describeCommit }) {
  if (freshEntries.length === 0) {
    console.log('No memory profiling entries to record; nothing to do.');
    return;
  }

  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-mem-profile-'));
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
        console.log('Memory profiling history already up to date; nothing to do.');
        return;
      }

      fs.mkdirSync(path.dirname(historyPath), { recursive: true });
      fs.writeFileSync(historyPath, JSON.stringify(mergedHistory), 'utf8');
      fs.writeFileSync(
        path.join(worktreeDir, TREND_SVG_PATH),
        renderMemProfileTrendChart({ history: mergedHistory }),
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
