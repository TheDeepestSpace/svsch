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

// Records one named sample (e.g. one per test/scenario/fixture) into a shared
// benchmark file, so the file ends up holding one entry per distinct name
// instead of a single suite-wide aggregate. Suites with many workers call this
// once per test; each call appends to samplesLogFile (a durable, append-only
// record safe under concurrent workers) and rewrites benchmarkFile from every
// line recorded so far, keyed by name — a later call for the same name (e.g. a
// retried test, or a test that renders more than once) overwrites the earlier
// value rather than accumulating a mean, so the file always reflects the most
// recent sample per name without needing a separate finalization step.
export function recordNamedBenchmarkSample(
  samplesLogFile: string,
  benchmarkFile: string,
  name: string,
  unit: string,
  value: number
): void {
  if (!Number.isFinite(value) || value < 0) return;

  fs.mkdirSync(path.dirname(samplesLogFile), { recursive: true });
  fs.appendFileSync(samplesLogFile, `${JSON.stringify({ name, unit, value: Math.round(value) })}\n`, 'utf8');

  const entries = new Map<string, BenchmarkEntry>();
  for (const line of fs.readFileSync(samplesLogFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as BenchmarkEntry;
      entries.set(entry.name, entry);
    } catch {
      // A concurrent worker's write can be read mid-flush; the line self-heals
      // once that worker's append completes, so just skip it for now.
    }
  }
  writeBenchmarkEntries(
    benchmarkFile,
    [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
  );
}
