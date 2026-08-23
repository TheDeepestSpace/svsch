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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = process.cwd();
const BUILD_COVERAGE_DIR = path.resolve(WORKSPACE_ROOT, 'src/parser/backend_cpp/build-coverage');
const COVERAGE_RAW_DIR = path.resolve(WORKSPACE_ROOT, 'coverage-raw');
const OUT_DIR = path.resolve(WORKSPACE_ROOT, 'coverage/backend');
const RUNTIME_INFO = path.join(OUT_DIR, 'lcov-runtime.info');
const COMBINED_INFO = path.join(OUT_DIR, 'lcov-combined.info');
const FINAL_INFO = path.join(OUT_DIR, 'lcov.info');

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

// gcov pairs a .gcda with a .gcno co-located in the same directory — GCOV_PREFIX
// only relocates where the (tiny, static) .gcno never travels with it, so mirror
// the whole .gcno tree into every invocation directory that actually wrote .gcda
// output before running lcov over it.
for (const invocationDir of invocationDirs) {
  const mirroredBuildDir = path.join(invocationDir, BUILD_COVERAGE_DIR);
  for (const gcno of gcnoFiles) {
    const rel = path.relative(BUILD_COVERAGE_DIR, gcno);
    const dest = path.join(mirroredBuildDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(gcno, dest);
  }
}

const infoFiles = [];

if (invocationDirs.length > 0) {
  // A single `lcov --capture --directory <tree>` walking many gcda/gcno pairs
  // for the same source file (one pair per invocation) sums their hit counts
  // into one result — this is the actual merge across every worker/shard.
  execFileSync(
    'lcov',
    ['--capture', '--directory', COVERAGE_RAW_DIR, '--output-file', RUNTIME_INFO],
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
