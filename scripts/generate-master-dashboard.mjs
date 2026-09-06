import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderHistoryTrendChart } from './render-benchmark-charts.mjs';
import { renderDashboardPage, renderDashboardSection } from './dashboard-page-shell.mjs';

// Publishes the combined dev/index.html master-stats dashboard (#413) —
// mirrors upsert-pr-stats-comment.mjs's join mechanism for the PR comment:
// each metric's own master-history job commits a small
// dev/<metric>/section.html fragment alongside its history.json/index.html
// (see ci-duration.mjs's/mem-profile.mjs's/coverage-history.mjs's/
// backend-coverage-history.mjs's own publish*History functions and
// renderXSection functions). This script re-reads whatever fragments
// currently exist on gh-pages and joins them, sorted by metric directory
// name (same "sorted-filename order" convention upsert-pr-stats-comment.mjs
// uses for its *.md files), into one page. "Re-read from gh-pages" rather
// than "fed a fixed set of just-produced fragments" is deliberate: this runs
// on its own workflow_run trigger (any completed CI run on master), not
// downstream of the 5 metrics' own jobs, so it's self-healing when only some
// of them ran/succeeded for a given push — a metric with no section yet (or
// a stale one from a previous push) just shows its last-known state rather
// than the whole page failing to build.
export const DASHBOARD_INDEX_PATH = 'dev/index.html';

// dev/bench doesn't have a record-*.mjs of its own to write a section.html —
// it's github-action-benchmark's own auto-generated dashboard (see
// dashboard-page-shell.mjs's note on why #411 doesn't touch it either) — so
// its section is derived here directly from the persisted
// dev/bench/history-averages.json (see generate-benchmark-stats.mjs's own
// note on that file's shape/lifetime) instead of a fragment file it never
// writes.
export const OWN_SECTION_METRIC_DIRS = ['backend-coverage', 'ci-duration', 'coverage', 'mem-profile'];

const NETWORK_TIMEOUT_MS = 60_000;

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

// dev/bench's own section, rendered the same way the other 4 metrics render
// theirs (renderDashboardSection) — see module doc above for why it's
// derived here instead of read from a fragment file. Returns null when
// there's no persisted history yet (e.g. a brand new gh-pages branch),
// matching the other metrics' "just absent from the page" contract rather
// than rendering an empty chart.
export function renderBenchSection(historyAverages) {
  if (!historyAverages || historyAverages.length === 0) return null;
  const chartSvg = renderHistoryTrendChart({
    title: 'Diagram-generation benchmark — per master push',
    valueLabel: 'Average elaboration/rendering duration per master push (ms)',
    history: historyAverages,
    squish: true,
  });
  return renderDashboardSection({
    heading: 'Diagram-generation benchmark',
    bodyHtml: chartSvg,
    href: 'bench/index.html',
  });
}

// Joins whatever section fragments are present, sorted by metric directory
// name — same "sorted-filename order" convention upsert-pr-stats-comment.mjs
// uses for its *.md files. A metric with no section yet is just absent from
// the page rather than a placeholder/error, so a brand new metric (or one
// whose history job hasn't run since this shipped) doesn't block the rest.
export function joinSections(sectionsByMetric) {
  return Object.keys(sectionsByMetric)
    .sort()
    .map((metric) => sectionsByMetric[metric])
    .join('\n\n');
}

export function renderMasterDashboard(sectionsByMetric) {
  return renderDashboardPage({
    title: 'Master Stats',
    heading: 'Master stats dashboard',
    description:
      'Unit coverage, backend coverage, CI duration, diagram-generation benchmark, and memory profiling — one point per master push. Each section links to its own full history.',
    bodyHtml: joinSections(sectionsByMetric),
  });
}

// Reads whatever dev/<metric>/section.html fragments currently exist in the
// gh-pages worktree — a missing one (metric never ran, or its job failed
// this push) is just skipped, not an error.
function readOwnSections(worktreeDir) {
  const sections = {};
  for (const dir of OWN_SECTION_METRIC_DIRS) {
    const sectionPath = path.join(worktreeDir, 'dev', dir, 'section.html');
    if (fs.existsSync(sectionPath)) {
      sections[dir] = fs.readFileSync(sectionPath, 'utf8');
    }
  }
  return sections;
}

function readBenchHistoryAverages(worktreeDir) {
  const historyPath = path.join(worktreeDir, 'dev', 'bench', 'history-averages.json');
  if (!fs.existsSync(historyPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse ${historyPath}:`, err);
    return [];
  }
}

// Rebuilds dev/index.html from whatever fragments currently exist on
// gh-pages and pushes it — same worktree-commit-push-with-retry shape as
// ci-duration.mjs's publishCiDurationHistory and friends, but with nothing
// of its own to merge in: it's purely a view over the other metrics' already
//-published state, so "up to date" is decided by `git status` after
// rewriting the file rather than an addedCount computed beforehand.
export async function publishMasterDashboard({ githubToken, describeCommit }) {
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-master-dashboard-'));
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

      const sectionsByMetric = readOwnSections(worktreeDir);
      const benchSection = renderBenchSection(readBenchHistoryAverages(worktreeDir));
      if (benchSection) sectionsByMetric.bench = benchSection;

      if (Object.keys(sectionsByMetric).length === 0) {
        console.log('No metric sections found on gh-pages yet; nothing to do.');
        return;
      }

      const indexPath = path.join(worktreeDir, DASHBOARD_INDEX_PATH);
      fs.mkdirSync(path.dirname(indexPath), { recursive: true });
      fs.writeFileSync(indexPath, renderMasterDashboard(sectionsByMetric), 'utf8');

      git(['add', DASHBOARD_INDEX_PATH], { cwd: worktreeDir });
      const status = git(['status', '--porcelain', '--', DASHBOARD_INDEX_PATH], {
        cwd: worktreeDir,
      }).trim();
      if (!status) {
        console.log('Master dashboard already up to date; nothing to do.');
        return;
      }

      const message = describeCommit(Object.keys(sectionsByMetric).sort());
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
