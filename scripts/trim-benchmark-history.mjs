import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeBenchmarkHistory, mergeBenchmarkHistory } from './render-benchmark-charts.mjs';

// dev/bench/data.js is github-action-benchmark's own history file on
// gh-pages: it appends one entry per tracked suite on every master push and
// never prunes anything, so left alone it grows forever (see #258 — it
// crossed 1MB and broke the baseline read in generate-benchmark-stats.mjs).
// Run this right after benchmark-action's own auto-push (same job, same
// master-only condition) to cap each suite's history to its most recent
// MAX_ENTRIES_PER_SUITE runs.
const MAX_ENTRIES_PER_SUITE = 200;

const DATA_FILE = 'dev/bench/data.js';
// The visual suite's per-run averages, derived from DATA_FILE before it's
// trimmed — kept indefinitely (never pruned) since a handful of numbers per
// run stays cheap forever, unlike the per-test breakdown they're computed
// from. See computeBenchmarkHistory/mergeBenchmarkHistory in
// render-benchmark-charts.mjs.
const HISTORY_AVERAGES_FILE = 'dev/bench/history-averages.json';
// One-off annotations for discontinuities in the trend (see
// renderHistoryTrendChart in render-benchmark-charts.mjs) — e.g. the backend
// binary gaining coverage instrumentation and becoming permanently slower.
// Sourced from MILESTONES_SEED_FILE (tracked in the main repo, so adding one
// is a normal PR) and copied here, stamped with the sha of the first master
// push that sees it, exactly once per label — every push after that is a
// no-op since the label is already recorded.
const MILESTONES_FILE = 'dev/bench/milestones.json';
const MILESTONES_SEED_FILE = 'scripts/benchmark-milestones-seed.json';
const PREFIX = 'window.BENCHMARK_DATA = ';
const NETWORK_TIMEOUT_MS = 60_000;

const { GITHUB_TOKEN } = process.env;
if (!GITHUB_TOKEN) {
  throw new Error('GITHUB_TOKEN must be set');
}

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: NETWORK_TIMEOUT_MS, ...opts });
}

// See generate-benchmark-stats.mjs's identical helper for why auth is
// passed via GIT_CONFIG_* env vars rather than a `-c` argv flag.
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

// Trims each suite's entries array in place; returns the total number of
// entries dropped across all suites.
function trimToRetention(data) {
  let dropped = 0;
  for (const [suite, entries] of Object.entries(data.entries ?? {})) {
    if (Array.isArray(entries) && entries.length > MAX_ENTRIES_PER_SUITE) {
      dropped += entries.length - MAX_ENTRIES_PER_SUITE;
      data.entries[suite] = entries.slice(-MAX_ENTRIES_PER_SUITE);
    }
  }
  return dropped;
}

// New (not yet recorded on gh-pages) entries from MILESTONES_SEED_FILE,
// stamped with this run's commit sha — on a master-push job this is the
// merge commit that just landed the seed entry, so the very first push to
// see a given label is exactly the one that introduced it.
function newMilestones(existingMilestones) {
  const seedPath = path.resolve(MILESTONES_SEED_FILE);
  if (!fs.existsSync(seedPath)) return [];
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const recordedLabels = new Set(existingMilestones.map((m) => m.label));
  const sha = git(['rev-parse', 'HEAD']).trim();
  const date = new Date().toISOString();
  return seed.filter((m) => !recordedLabels.has(m.label)).map((m) => ({ ...m, sha, date }));
}

async function main() {
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-trim-'));
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      gitAuthed(['fetch', 'origin', 'gh-pages']);
      if (attempt > 1) {
        git(['worktree', 'remove', '--force', worktreeDir]);
      }
      git(['worktree', 'add', '--detach', worktreeDir, 'origin/gh-pages']);

      const dataPath = path.join(worktreeDir, DATA_FILE);
      const raw = fs.readFileSync(dataPath, 'utf8');
      const data = JSON.parse(raw.slice(PREFIX.length));

      // Derive averages from the full (not yet trimmed) data before pruning
      // it, so nothing is lost the moment its raw per-test entry ages out.
      const historyAveragesPath = path.join(worktreeDir, HISTORY_AVERAGES_FILE);
      const existingAverages = fs.existsSync(historyAveragesPath)
        ? JSON.parse(fs.readFileSync(historyAveragesPath, 'utf8'))
        : [];
      const mergedAverages = mergeBenchmarkHistory(existingAverages, computeBenchmarkHistory(data));
      const addedAverages = mergedAverages.length - existingAverages.length;

      const dropped = trimToRetention(data);

      const milestonesPath = path.join(worktreeDir, MILESTONES_FILE);
      const existingMilestones = fs.existsSync(milestonesPath)
        ? JSON.parse(fs.readFileSync(milestonesPath, 'utf8'))
        : [];
      const added = newMilestones(existingMilestones);
      const mergedMilestones = [...existingMilestones, ...added];

      if (dropped === 0 && addedAverages === 0 && added.length === 0) {
        console.log(
          `${DATA_FILE} already within retention (<=${MAX_ENTRIES_PER_SUITE} entries/suite) and no new averages or milestones to record; nothing to do.`,
        );
        return;
      }

      const changedFiles = [];
      if (dropped > 0) {
        fs.writeFileSync(dataPath, PREFIX + JSON.stringify(data), 'utf8');
        changedFiles.push(DATA_FILE);
      }
      if (addedAverages > 0) {
        fs.writeFileSync(historyAveragesPath, JSON.stringify(mergedAverages), 'utf8');
        changedFiles.push(HISTORY_AVERAGES_FILE);
      }
      if (added.length > 0) {
        fs.mkdirSync(path.dirname(milestonesPath), { recursive: true });
        fs.writeFileSync(milestonesPath, JSON.stringify(mergedMilestones), 'utf8');
        changedFiles.push(MILESTONES_FILE);
      }

      const messageParts = [];
      if (dropped > 0) {
        messageParts.push(
          `trim ${DATA_FILE} to last ${MAX_ENTRIES_PER_SUITE} entries/suite (-${dropped})`,
        );
      }
      if (addedAverages > 0) {
        messageParts.push(`record ${addedAverages} new average(s) in ${HISTORY_AVERAGES_FILE}`);
      }
      if (added.length > 0) {
        messageParts.push(
          `record ${added.length} new milestone(s) in ${MILESTONES_FILE}: ${added.map((m) => m.label).join(', ')}`,
        );
      }

      git(['add', ...changedFiles], { cwd: worktreeDir });
      git(
        [
          '-c',
          'user.name=github-actions[bot]',
          '-c',
          'user.email=github-actions[bot]@users.noreply.github.com',
          'commit',
          '-m',
          messageParts.join('; '),
        ],
        { cwd: worktreeDir },
      );
      try {
        gitAuthed(['push', 'origin', 'HEAD:gh-pages'], { cwd: worktreeDir });
        console.log(`${messageParts.join('; ')}.`);
        return;
      } catch (err) {
        if (attempt === 3) throw err;
        // Someone else pushed to gh-pages first (e.g. a concurrent job) —
        // refetch and retry.
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

await main();
