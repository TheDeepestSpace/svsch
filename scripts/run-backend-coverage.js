const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const surelogBin = path.join(WORKSPACE_ROOT, 'dist', 'surelog', 'bin');
const envPath = `${process.env.PATH}${path.delimiter}${surelogBin}`;
const env = { ...process.env, PATH: envPath };

const buildDir = path.join(WORKSPACE_ROOT, 'src', 'parser', 'backend_cpp', 'build-coverage');
const coverageDir = path.join(WORKSPACE_ROOT, 'coverage', 'backend');
const rawInfoPath = path.join(buildDir, 'lcov-raw.info');
const lcovInfoPath = path.join(coverageDir, 'lcov.info');

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(coverageDir, { recursive: true });

execFileSync('cmake', ['..', '-G', 'Ninja', '-DENABLE_COVERAGE=ON'], {
  cwd: buildDir,
  stdio: 'inherit',
  env,
});
execFileSync('cmake', ['--build', '.', '--target', 'svsch_test'], {
  cwd: buildDir,
  stdio: 'inherit',
  env,
});

// Reset counters from any previous run so coverage reflects this run only.
spawnSync('find', ['.', '-name', '*.gcda', '-delete'], { cwd: buildDir, env });

const testRes = spawnSync('./svsch_test', process.argv.slice(2), {
  cwd: buildDir,
  stdio: 'inherit',
  env,
});
if (testRes.status !== 0) {
  process.exit(testRes.status !== null ? testRes.status : 1);
}

execFileSync('lcov', ['--capture', '--directory', '.', '--output-file', rawInfoPath], {
  cwd: buildDir,
  stdio: 'inherit',
  env,
});

// Scope to the backend's own source (src/parser/backend_cpp/src/**), excluding
// UHDM headers, FetchContent-fetched googletest, and the vendored include/json.hpp.
execFileSync(
  'lcov',
  ['--extract', rawInfoPath, '*/backend_cpp/src/*', '--output-file', lcovInfoPath],
  { cwd: buildDir, stdio: 'inherit', env },
);

execFileSync('lcov', ['--summary', lcovInfoPath], { cwd: buildDir, stdio: 'inherit', env });

const genhtml = spawnSync('genhtml', ['--version'], { env });
if (genhtml.status === 0) {
  execFileSync('genhtml', [lcovInfoPath, '--output-directory', path.join(coverageDir, 'html')], {
    cwd: buildDir,
    stdio: 'inherit',
    env,
  });
} else {
  console.warn('genhtml not found; skipping HTML report generation.');
}
