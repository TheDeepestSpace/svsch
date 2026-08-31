// Merges the many per-invocation .gcda trees written by the coverage-
// instrumented svsch_backend (see backendExecOptions in
// src/parser/uhdmExtractor.ts) — one directory per backend invocation across
// test_unit/test_bdd/test_visual/test_syntax/test_system, isolated via
// GCOV_PREFIX so concurrent workers never race on the same counters file —
// into a single lcov.info,
// optionally combined with other already-captured lcov tracefiles (e.g. the
// gtest-only capture from `npm run test:backend:coverage`).
//
// Usage: node scripts/collect-backend-coverage.mjs [extra-lcov-info-file ...]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = process.cwd();
const BUILD_COVERAGE_DIR = path.resolve(WORKSPACE_ROOT, 'src/parser/backend_cpp/build-coverage');
const COVERAGE_RAW_DIR = path.resolve(WORKSPACE_ROOT, 'coverage-raw');
const MERGED_RAW_DIR = path.resolve(WORKSPACE_ROOT, 'coverage-raw-merged');
const MERGE_STEP_DIR = path.resolve(WORKSPACE_ROOT, 'coverage-raw-merge-step');
const OUT_DIR = path.resolve(WORKSPACE_ROOT, 'coverage/backend');
const RUNTIME_INFO = path.join(OUT_DIR, 'lcov-runtime.info');
const COMBINED_INFO = path.join(OUT_DIR, 'lcov-combined.info');
const FINAL_INFO = path.join(OUT_DIR, 'lcov.info');
const HTML_DIR = path.join(OUT_DIR, 'html');

const extraInfoFiles = process.argv.slice(2);

fs.mkdirSync(OUT_DIR, { recursive: true });

if (!fs.existsSync(BUILD_COVERAGE_DIR)) {
  throw new Error(
    `Expected the coverage-instrumented build tree at ${BUILD_COVERAGE_DIR} — download the backend-binary-coverage artifact first.`,
  );
}

function findFiles(dir, suffix) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(full, suffix));
    else if (entry.name.endsWith(suffix)) found.push(full);
  }
  return found;
}

const gcnoFiles = findFiles(BUILD_COVERAGE_DIR, '.gcno');
if (gcnoFiles.length === 0) {
  throw new Error(`No .gcno files found under ${BUILD_COVERAGE_DIR}`);
}

// Each test_unit/test_bdd-shard-N/test_visual-shard-N job namespaces its own
// GCOV_PREFIX root (see ci.yml) before per-invocation ids branch off it, so
// after merge-multiple flattens every backend-gcda-* artifact into one
// COVERAGE_RAW_DIR, an "invocation dir" isn't a fixed depth below it —
// recurse and treat any directory whose GCOV_PREFIX-mirrored build path
// exists as one, regardless of how deep it sits.
function findInvocationDirs(dir) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (fs.existsSync(path.join(full, BUILD_COVERAGE_DIR))) {
      found.push(full);
    } else {
      found.push(...findInvocationDirs(full));
    }
  }
  return found;
}

const invocationDirs = fs.existsSync(COVERAGE_RAW_DIR) ? findInvocationDirs(COVERAGE_RAW_DIR) : [];
if (invocationDirs.length === 0) {
  console.warn(
    `No backend invocation coverage directories found under ${COVERAGE_RAW_DIR}; proceeding without runtime capture.`,
  );
}

// `lcov --capture` re-parses and re-merges its whole in-memory model on every
// directory it visits, so pointing it at thousands of invocation directories
// (one per backend invocation — see uhdmExtractor.ts) directly never finishes:
// verified locally, capturing over just test_syntax's 69 invocation dirs alone
// already exceeds two minutes, and a real run across unit/bdd/visual/syntax/
// system produces thousands of them. gcov-tool merge instead sums the raw
// counter files pairwise with no text parsing, so fold every invocation
// directory's .gcda tree down into one directory first — that fold is
// O(invocations) with a tiny constant factor (~1s for the 69-dir case above)
// — and only ask lcov to capture that single merged tree.
fs.rmSync(MERGED_RAW_DIR, { recursive: true, force: true });
if (invocationDirs.length > 0) {
  fs.cpSync(invocationDirs[0], MERGED_RAW_DIR, { recursive: true });
  for (const invocationDir of invocationDirs.slice(1)) {
    fs.rmSync(MERGE_STEP_DIR, { recursive: true, force: true });
    execFileSync('gcov-tool', ['merge', MERGED_RAW_DIR, invocationDir, '-o', MERGE_STEP_DIR], {
      stdio: 'inherit',
    });
    fs.rmSync(MERGED_RAW_DIR, { recursive: true, force: true });
    fs.renameSync(MERGE_STEP_DIR, MERGED_RAW_DIR);
  }
}

// gcov pairs a .gcda with a .gcno co-located in the same directory — GCOV_PREFIX
// only relocates where the (tiny, static) .gcno never travels with it, so mirror
// the whole .gcno tree into the merged directory before running lcov over it.
if (invocationDirs.length > 0) {
  const mirroredBuildDir = path.join(MERGED_RAW_DIR, BUILD_COVERAGE_DIR);
  for (const gcno of gcnoFiles) {
    const rel = path.relative(BUILD_COVERAGE_DIR, gcno);
    const dest = path.join(mirroredBuildDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(gcno, dest);
  }
}

const infoFiles = [];

if (invocationDirs.length > 0) {
  execFileSync(
    'lcov',
    ['--capture', '--directory', MERGED_RAW_DIR, '--output-file', RUNTIME_INFO],
    { stdio: 'inherit' },
  );
  infoFiles.push(RUNTIME_INFO);
}

for (const extra of extraInfoFiles) {
  if (fs.existsSync(extra)) {
    infoFiles.push(extra);
  } else {
    console.warn(`Skipping missing extra coverage file: ${extra}`);
  }
}

if (infoFiles.length === 0) {
  throw new Error(
    'No coverage data collected from any source (runtime capture or extra lcov.info files).',
  );
}

execFileSync('lcov', [...infoFiles.flatMap((f) => ['-a', f]), '-o', COMBINED_INFO], {
  stdio: 'inherit',
});

// Scope to the backend's own source, same as run-backend-coverage.js — excludes
// UHDM headers, FetchContent-fetched googletest, and the vendored json.hpp.
execFileSync(
  'lcov',
  ['--extract', COMBINED_INFO, '*/backend_cpp/src/*', '--output-file', FINAL_INFO],
  { stdio: 'inherit' },
);

execFileSync('lcov', ['--summary', FINAL_INFO], { stdio: 'inherit' });

// Same optional genhtml step run-backend-coverage.js does for local runs —
// report_backend_coverage_stats (ci.yml) publishes this directory to
// gh-pages if it exists, so CI gets the same annotated report a local
// `npm run test:backend:coverage` produces.
if (spawnSync('genhtml', ['--version']).status === 0) {
  execFileSync('genhtml', [FINAL_INFO, '--output-directory', HTML_DIR], { stdio: 'inherit' });
} else {
  console.warn('genhtml not found; skipping HTML report generation.');
}
