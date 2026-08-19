import { describe, expect, it } from 'vitest';
import {
  appendBenchmarkHistoryEntry,
  benchmarkHistoryChanged,
  computeRunAverageMs,
  parseBenchmarkHistory,
  serializeBenchmarkHistory,
  BENCHMARK_HISTORY_HEADER,
  type BenchmarkHistoryEntry,
} from '../benchmarkHistory';
import { computeHistoryTrendData } from '../../scripts/render-benchmark-charts.mjs';

const entryA: BenchmarkHistoryEntry = {
  sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  date: '2026-08-01T00:00:00.000Z',
  elaborationAvgMs: 120,
  renderingAvgMs: 80,
};
const entryB: BenchmarkHistoryEntry = {
  sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  date: '2026-08-10T00:00:00.000Z',
  elaborationAvgMs: 110,
  renderingAvgMs: 90,
};

describe('parseBenchmarkHistory', () => {
  it('parses an empty file as an empty list', () => {
    expect(parseBenchmarkHistory('[]\n')).toEqual([]);
  });

  it('parses a populated file', () => {
    const yamlText = serializeBenchmarkHistory([entryA, entryB]);
    expect(parseBenchmarkHistory(yamlText)).toEqual([entryA, entryB]);
  });

  it('rejects a non-list document', () => {
    expect(() => parseBenchmarkHistory('sha: not-a-list\n')).toThrow('must contain a YAML list');
  });

  it('rejects an entry missing a required field', () => {
    const yamlText = '- sha: aaaa\n  date: 2026-08-01\n  renderingAvgMs: 80\n';
    expect(() => parseBenchmarkHistory(yamlText)).toThrow(/elaborationAvgMs/);
  });
});

describe('appendBenchmarkHistoryEntry', () => {
  it('appends to an empty history, keeping the header', () => {
    const result = appendBenchmarkHistoryEntry('[]\n', entryA);
    expect(result.startsWith(BENCHMARK_HISTORY_HEADER)).toBe(true);
    expect(parseBenchmarkHistory(result)).toEqual([entryA]);
  });

  it('appends after existing entries, preserving their order', () => {
    const withA = appendBenchmarkHistoryEntry('[]\n', entryA);
    const withBoth = appendBenchmarkHistoryEntry(withA, entryB);
    expect(parseBenchmarkHistory(withBoth)).toEqual([entryA, entryB]);
  });
});

describe('computeRunAverageMs', () => {
  it('rounds the mean of a run\'s per-test values', () => {
    expect(computeRunAverageMs([{ value: 100 }, { value: 101 }, { value: 102 }])).toBe(101);
  });

  it('throws on an empty run', () => {
    expect(() => computeRunAverageMs([])).toThrow('zero benchmark entries');
  });
});

describe('benchmarkHistoryChanged', () => {
  function nameStatus(...records: string[]): string {
    return `${records.join('\0')}\0`;
  }

  it('is false when the history file is untouched', () => {
    const output = nameStatus('M', 'src/index.ts', 'A', 'test/unit/foo.test.ts');
    expect(benchmarkHistoryChanged(output)).toBe(false);
  });

  it('is true when the history file is modified', () => {
    const output = nameStatus('M', 'test/visual/benchmark-history.yaml');
    expect(benchmarkHistoryChanged(output)).toBe(true);
  });

  it('is true when the history file is added or deleted', () => {
    expect(benchmarkHistoryChanged(nameStatus('A', 'test/visual/benchmark-history.yaml'))).toBe(true);
    expect(benchmarkHistoryChanged(nameStatus('D', 'test/visual/benchmark-history.yaml'))).toBe(true);
  });

  it('is true when the history file is one side of a rename', () => {
    const output = nameStatus('R100', 'test/visual/benchmark-history.yaml', 'test/visual/benchmark-history-old.yaml');
    expect(benchmarkHistoryChanged(output)).toBe(true);
  });
});

describe('computeHistoryTrendData', () => {
  it('appends the current run as a marked preview point after history, oldest first', () => {
    const points = computeHistoryTrendData([entryA, entryB], { elaborationAvgMs: 100, renderingAvgMs: 70 });
    expect(points).toEqual([
      { label: entryA.sha.slice(0, 7), elaborationAvgMs: entryA.elaborationAvgMs, renderingAvgMs: entryA.renderingAvgMs, isCurrent: false },
      { label: entryB.sha.slice(0, 7), elaborationAvgMs: entryB.elaborationAvgMs, renderingAvgMs: entryB.renderingAvgMs, isCurrent: false },
      { label: 'this PR', elaborationAvgMs: 100, renderingAvgMs: 70, isCurrent: true },
    ]);
  });

  it('produces just the preview point when there is no history yet', () => {
    const points = computeHistoryTrendData([], { elaborationAvgMs: 50, renderingAvgMs: 40 });
    expect(points).toEqual([{ label: 'this PR', elaborationAvgMs: 50, renderingAvgMs: 40, isCurrent: true }]);
  });
});
