import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// dev/bench/data.js is github-action-benchmark's own history file on
// gh-pages: it appends one entry per tracked suite on every master push and
// never prunes anything, so left alone it grows forever (see #258 — it
// crossed 1MB and broke the baseline read in comment-benchmark-summary.mjs).
// Run this right after benchmark-action's own auto-push (same job, same
// master-only condition) to cap each suite's history to its most recent
// MAX_ENTRIES_PER_SUITE runs.
const MAX_ENTRIES_PER_SUITE = 200;

const DATA_FILE = 'dev/bench/data.js';
const PREFIX = 'window.BENCHMARK_DATA = ';
const NETWORK_TIMEOUT_MS = 60_000;

const { GITHUB_TOKEN } = process.env;
if (!GITHUB_TOKEN) {
  throw new Error('GITHUB_TOKEN must be set');
}

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: NETWORK_TIMEOUT_MS, ...opts });
}

// See comment-benchmark-summary.mjs's identical helper for why auth is
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
      const dropped = trimToRetention(data);
      if (dropped === 0) {
        console.log(`${DATA_FILE} already within retention (<=${MAX_ENTRIES_PER_SUITE} entries/suite); nothing to trim.`);
        return;
      }
      fs.writeFileSync(dataPath, PREFIX + JSON.stringify(data), 'utf8');

      git(['add', DATA_FILE], { cwd: worktreeDir });
      git(
        [
          '-c',
          'user.name=github-actions[bot]',
          '-c',
          'user.email=github-actions[bot]@users.noreply.github.com',
          'commit',
          '-m',
          `Trim ${DATA_FILE} to last ${MAX_ENTRIES_PER_SUITE} entries/suite (-${dropped})`,
        ],
        { cwd: worktreeDir },
      );
      try {
        gitAuthed(['push', 'origin', 'HEAD:gh-pages'], { cwd: worktreeDir });
        console.log(`Trimmed ${dropped} old entries from ${DATA_FILE}.`);
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
