import fs from 'node:fs';
import path from 'node:path';

// Shape consumed by benchmark-action/github-action-benchmark's "customSmallerIsBetter" tool.
export type BenchmarkEntry = { name: string; unit: string; value: number };

export function writeBenchmark(benchmarkFile: string, name: string, valueMs: number): void {
  fs.mkdirSync(path.dirname(benchmarkFile), { recursive: true });
  const entries: BenchmarkEntry[] = [{ name, unit: 'ms', value: Math.round(valueMs) }];
  fs.writeFileSync(benchmarkFile, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

// Appends one duration sample and rewrites benchmarkFile with the mean of every
// sample recorded so far. Suites with many scenarios/fixtures call this once per
// scenario/fixture; the benchmark file always reflects the full run's mean,
// regardless of worker count or call order, without needing a separate
// finalization/teardown step.
export function recordBenchmarkSample(
  samplesFile: string,
  benchmarkFile: string,
  name: string,
  durationMs: number
): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;

  fs.mkdirSync(path.dirname(samplesFile), { recursive: true });
  fs.appendFileSync(samplesFile, `${durationMs}\n`, 'utf8');

  const samples = fs.readFileSync(samplesFile, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(Number)
    .filter(value => Number.isFinite(value) && value >= 0);
  if (samples.length === 0) return;

  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  writeBenchmark(benchmarkFile, name, mean);
}
