import { execFileSync } from 'node:child_process';
import { benchmarkHistoryChanged, BENCHMARK_HISTORY_PATH } from '../test/benchmarkHistory';

function usage(): never {
  throw new Error('Usage: check-benchmark-history-unchanged <base-commit> [head-commit]');
}

const [baseCommit, headCommit = 'HEAD', ...extraArgs] = process.argv.slice(2);
if (!baseCommit || extraArgs.length > 0) usage();

// CI checks out GitHub's merge commit, which can include base-branch changes
// newer than the event payload. An explicit head keeps the gate scoped to
// the PR, same reasoning as check-snapshot-updates.ts.
const nameStatusOutput = execFileSync(
  'git',
  ['diff', '--name-status', '-z', '-M', baseCommit, headCommit],
  { encoding: 'utf8' }
);

if (benchmarkHistoryChanged(nameStatusOutput)) {
  console.error(
    `::error file=${BENCHMARK_HISTORY_PATH}::${BENCHMARK_HISTORY_PATH} is append-only and written `
    + 'automatically on merge to master — this PR must not add, remove, or edit it by hand. '
    + 'Revert the change to this file.'
  );
  process.exit(1);
}

console.log(`${BENCHMARK_HISTORY_PATH} is unchanged.`);
