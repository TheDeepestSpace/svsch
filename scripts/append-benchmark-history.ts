import * as fs from 'node:fs';
import {
  appendBenchmarkHistoryEntry,
  computeRunAverageMs,
  BENCHMARK_HISTORY_PATH,
  type BenchmarkHistoryEntry,
} from '../test/benchmarkHistory';
import type { BenchmarkEntry } from '../test/benchmarkUtils';

function usage(): never {
  throw new Error(
    'Usage: append-benchmark-history <elaboration-benchmark-file> <rendering-benchmark-file>'
  );
}

const [elaborationFile, renderingFile, ...extraArgs] = process.argv.slice(2);
if (!elaborationFile || !renderingFile || extraArgs.length > 0) usage();

const { GITHUB_SHA } = process.env;
if (!GITHUB_SHA) {
  throw new Error('GITHUB_SHA must be set');
}

function readEntries(file: string): BenchmarkEntry[] {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const entry: BenchmarkHistoryEntry = {
  sha: GITHUB_SHA,
  date: new Date().toISOString(),
  elaborationAvgMs: computeRunAverageMs(readEntries(elaborationFile)),
  renderingAvgMs: computeRunAverageMs(readEntries(renderingFile)),
};

const existing = fs.existsSync(BENCHMARK_HISTORY_PATH)
  ? fs.readFileSync(BENCHMARK_HISTORY_PATH, 'utf8')
  : '';
fs.writeFileSync(BENCHMARK_HISTORY_PATH, appendBenchmarkHistoryEntry(existing, entry), 'utf8');

console.log(`Appended benchmark history entry for ${GITHUB_SHA.slice(0, 7)}:`, entry);
