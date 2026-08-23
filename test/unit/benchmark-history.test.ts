import { describe, expect, it } from 'vitest';
import {
  computeBenchmarkHistory,
  computeHistoryTrendData,
  mergeBenchmarkHistory,
} from '../../scripts/render-benchmark-charts.mjs';

function benchmarkEntry(commitId: string, date: number, values: number[]) {
  return {
    commit: { id: commitId },
    date,
    benches: values.map((value, index) => ({ name: `test-${index}`, value, unit: 'ms' })),
  };
}

describe('computeBenchmarkHistory', () => {
  it('returns an empty list when there is no gh-pages data yet', () => {
    expect(computeBenchmarkHistory(undefined)).toEqual([]);
  });

  it('pairs elaboration and rendering entries by commit id, oldest first', () => {
    const benchmarkData = {
      entries: {
        'visual-elaboration-diagram-generation-duration': [
          benchmarkEntry('aaaa', 1786680254321, [100, 120]),
          benchmarkEntry('bbbb', 1786680300000, [90, 110]),
        ],
        'visual-rendering-diagram-generation-duration': [
          benchmarkEntry('aaaa', 1786680254321, [50, 70]),
          benchmarkEntry('bbbb', 1786680300000, [40, 60]),
        ],
      },
    };
    expect(computeBenchmarkHistory(benchmarkData)).toEqual([
      {
        sha: 'aaaa',
        date: new Date(1786680254321).toISOString(),
        elaborationAvgMs: 110,
        renderingAvgMs: 60,
      },
      {
        sha: 'bbbb',
        date: new Date(1786680300000).toISOString(),
        elaborationAvgMs: 100,
        renderingAvgMs: 50,
      },
    ]);
  });

  it('drops a commit that only has one side recorded', () => {
    const benchmarkData = {
      entries: {
        'visual-elaboration-diagram-generation-duration': [
          benchmarkEntry('aaaa', 1786680254321, [100]),
          benchmarkEntry('bbbb', 1786680300000, [90]),
        ],
        'visual-rendering-diagram-generation-duration': [
          benchmarkEntry('aaaa', 1786680254321, [50]),
        ],
      },
    };
    expect(computeBenchmarkHistory(benchmarkData)).toEqual([
      {
        sha: 'aaaa',
        date: new Date(1786680254321).toISOString(),
        elaborationAvgMs: 100,
        renderingAvgMs: 50,
      },
    ]);
  });
});

describe('mergeBenchmarkHistory', () => {
  const older = {
    sha: 'aaaa',
    date: '2026-01-01T00:00:00.000Z',
    elaborationAvgMs: 100,
    renderingAvgMs: 50,
  };
  const newer = {
    sha: 'bbbb',
    date: '2026-01-02T00:00:00.000Z',
    elaborationAvgMs: 90,
    renderingAvgMs: 40,
  };

  it('appends fresh entries not already present, sorted oldest-first', () => {
    expect(mergeBenchmarkHistory([older], [older, newer])).toEqual([older, newer]);
  });

  it('keeps the existing entry on a sha collision rather than the fresh one', () => {
    const staleOlder = { ...older, elaborationAvgMs: 999 };
    expect(mergeBenchmarkHistory([older], [staleOlder, newer])).toEqual([older, newer]);
  });

  it('returns the fresh history unchanged when there is nothing persisted yet', () => {
    expect(mergeBenchmarkHistory([], [older, newer])).toEqual([older, newer]);
  });

  it('is a no-op when the fresh history has nothing new', () => {
    expect(mergeBenchmarkHistory([older, newer], [older])).toEqual([older, newer]);
  });
});

describe('computeHistoryTrendData', () => {
  const entryA = {
    sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    elaborationAvgMs: 120,
    renderingAvgMs: 80,
  };
  const entryB = {
    sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    elaborationAvgMs: 110,
    renderingAvgMs: 90,
  };

  it('appends the current run as a marked preview point after history, oldest first', () => {
    const points = computeHistoryTrendData([entryA, entryB], {
      elaborationAvgMs: 100,
      renderingAvgMs: 70,
    });
    expect(points).toEqual([
      {
        label: entryA.sha.slice(0, 7),
        elaborationAvgMs: entryA.elaborationAvgMs,
        renderingAvgMs: entryA.renderingAvgMs,
        isCurrent: false,
      },
      {
        label: entryB.sha.slice(0, 7),
        elaborationAvgMs: entryB.elaborationAvgMs,
        renderingAvgMs: entryB.renderingAvgMs,
        isCurrent: false,
      },
      { label: 'this PR', elaborationAvgMs: 100, renderingAvgMs: 70, isCurrent: true },
    ]);
  });

  it('produces just the preview point when there is no history yet', () => {
    const points = computeHistoryTrendData([], { elaborationAvgMs: 50, renderingAvgMs: 40 });
    expect(points).toEqual([
      { label: 'this PR', elaborationAvgMs: 50, renderingAvgMs: 40, isCurrent: true },
    ]);
  });
});

describe('computeHistoryTrendData with a custom series', () => {
  const CUSTOM_SERIES = [{ key: 'durationSec', color: '#000000', label: 'Duration' }];
  const historyEntry = {
    sha: 'cccccccccccccccccccccccccccccccccccccccc',
    date: '2026-01-01T00:00:00.000Z',
    durationSec: 500,
  };

  it('only copies the given series keys onto each point (not the whole entry)', () => {
    const points = computeHistoryTrendData([historyEntry], { durationSec: 480 }, CUSTOM_SERIES);
    expect(points).toEqual([
      { label: historyEntry.sha.slice(0, 7), durationSec: 500, isCurrent: false },
      { label: 'this PR', durationSec: 480, isCurrent: true },
    ]);
  });

  it('omits the preview point entirely when currentPoint is nullish', () => {
    const points = computeHistoryTrendData([historyEntry], undefined, CUSTOM_SERIES);
    expect(points).toEqual([
      { label: historyEntry.sha.slice(0, 7), durationSec: 500, isCurrent: false },
    ]);
  });

  it('labels the preview point with a custom currentLabel', () => {
    const points = computeHistoryTrendData(
      [],
      { durationSec: 10 },
      CUSTOM_SERIES,
      'this run (so far)',
    );
    expect(points).toEqual([{ label: 'this run (so far)', durationSec: 10, isCurrent: true }]);
  });
});
