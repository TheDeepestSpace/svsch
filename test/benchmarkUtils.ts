import fs from 'node:fs';
import path from 'node:path';

// Shape consumed by benchmark-action/github-action-benchmark's "customSmallerIsBetter" tool.
export type BenchmarkEntry = { name: string; unit: string; value: number };

function writeBenchmarkEntries(benchmarkFile: string, entries: BenchmarkEntry[]): void {
  fs.mkdirSync(path.dirname(benchmarkFile), { recursive: true });
  fs.writeFileSync(benchmarkFile, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

export function writeBenchmark(benchmarkFile: string, name: string, valueMs: number): void {
  writeBenchmarkEntries(benchmarkFile, [{ name, unit: 'ms', value: Math.round(valueMs) }]);
}

// Records one named sample (e.g. one per test/scenario/fixture) by appending
// it to a shared, durable, append-only log — safe to call concurrently from
// many worker processes, since each append is independent and nothing reads
// the log back until finalizeNamedBenchmarkSamples() runs once, after every
// worker has finished.
export function recordNamedBenchmarkSample(
  samplesLogFile: string,
  name: string,
  unit: string,
  value: number,
): void {
  if (!Number.isFinite(value) || value < 0) return;

  fs.mkdirSync(path.dirname(samplesLogFile), { recursive: true });
  fs.appendFileSync(
    samplesLogFile,
    `${JSON.stringify({ name, unit, value: Math.round(value) })}\n`,
    'utf8',
  );
}

// Collapses a samples log into the benchmark file consumed by
// github-action-benchmark: one entry per distinct name (a later sample for
// the same name — e.g. a retried test, or a test that renders more than
// once — overwrites the earlier value rather than accumulating a mean).
// Must run once, after every worker that might call recordNamedBenchmarkSample
// has finished (e.g. from a Playwright globalTeardown) — reading the log
// while workers are still appending to it would race an in-progress write.
export function finalizeNamedBenchmarkSamples(samplesLogFile: string, benchmarkFile: string): void {
  if (!fs.existsSync(samplesLogFile)) return;

  const entries = new Map<string, BenchmarkEntry>();
  for (const line of fs.readFileSync(samplesLogFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as BenchmarkEntry;
      entries.set(entry.name, entry);
    } catch {
      // An unterminated last line (process killed mid-write) — skip it.
    }
  }
  writeBenchmarkEntries(
    benchmarkFile,
    [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
  );
}
