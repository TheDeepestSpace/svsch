import { describe, expect, it } from 'vitest';
import {
  COLORS,
  computeBenchmarkHistory,
  computeHistoryTrendData,
  computeMonthTicks,
  computeMovingAverages,
  mergeBenchmarkHistory,
  renderHistoryTrendChart,
  renderMemoryTimeseriesChart,
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
    date: '2026-01-05T00:00:00.000Z',
    elaborationAvgMs: 120,
    renderingAvgMs: 80,
  };
  const entryB = {
    sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    date: '2026-01-10T00:00:00.000Z',
    elaborationAvgMs: 110,
    renderingAvgMs: 90,
  };

  it('appends the current run as a marked preview point after history, oldest first', () => {
    const currentDateMs = new Date('2026-01-15T00:00:00.000Z').getTime();
    const points = computeHistoryTrendData([entryA, entryB], {
      dateMs: currentDateMs,
      elaborationAvgMs: 100,
      renderingAvgMs: 70,
    });
    expect(points).toEqual([
      {
        dateMs: new Date(entryA.date).getTime(),
        elaborationAvgMs: entryA.elaborationAvgMs,
        renderingAvgMs: entryA.renderingAvgMs,
        isCurrent: false,
      },
      {
        dateMs: new Date(entryB.date).getTime(),
        elaborationAvgMs: entryB.elaborationAvgMs,
        renderingAvgMs: entryB.renderingAvgMs,
        isCurrent: false,
      },
      { dateMs: currentDateMs, elaborationAvgMs: 100, renderingAvgMs: 70, isCurrent: true },
    ]);
  });

  it('produces just the preview point when there is no history yet', () => {
    const currentDateMs = new Date('2026-01-15T00:00:00.000Z').getTime();
    const points = computeHistoryTrendData([], {
      dateMs: currentDateMs,
      elaborationAvgMs: 50,
      renderingAvgMs: 40,
    });
    expect(points).toEqual([
      { dateMs: currentDateMs, elaborationAvgMs: 50, renderingAvgMs: 40, isCurrent: true },
    ]);
  });
});

describe('computeMovingAverages', () => {
  const point = (dateMs: number, elaborationAvgMs: number, renderingAvgMs: number) => ({
    dateMs,
    elaborationAvgMs,
    renderingAvgMs,
  });

  it('averages over a widening window until it reaches the full window size', () => {
    const points = [point(1, 10, 100), point(2, 20, 200), point(3, 30, 300)];
    expect(computeMovingAverages(points, 2)).toEqual([
      point(1, 10, 100),
      point(2, 15, 150),
      point(3, 25, 250),
    ]);
  });

  it('only averages over the trailing windowSize points once history exceeds it', () => {
    const points = [point(1, 10, 0), point(2, 20, 0), point(3, 30, 0), point(4, 40, 0)];
    expect(computeMovingAverages(points, 2).at(-1)).toEqual(point(4, 35, 0));
  });

  it('returns an empty list for no points', () => {
    expect(computeMovingAverages([])).toEqual([]);
  });

  it('defaults to a 10-run window', () => {
    const points = Array.from({ length: 12 }, (_, i) => point(i, i, i * 10));
    const result = computeMovingAverages(points);
    // Last point averages indices 2..11 (10 points): elaboration mean of 2..11 = 6.5
    expect(result.at(-1)).toEqual(point(11, 6.5, 65));
  });
});

describe('computeMonthTicks', () => {
  it('returns one tick per calendar month starting the month at-or-before the min date', () => {
    const minDateMs = new Date('2026-01-15T00:00:00.000Z').getTime();
    const maxDateMs = new Date('2026-03-05T00:00:00.000Z').getTime();
    expect(computeMonthTicks(minDateMs, maxDateMs)).toEqual([
      { dateMs: Date.UTC(2026, 0, 1), label: 'Jan' },
      { dateMs: Date.UTC(2026, 1, 1), label: 'Feb' },
      { dateMs: Date.UTC(2026, 2, 1), label: 'Mar' },
    ]);
  });

  it('adds a two-digit year suffix once the range spans more than one year', () => {
    const minDateMs = new Date('2025-12-20T00:00:00.000Z').getTime();
    const maxDateMs = new Date('2026-01-10T00:00:00.000Z').getTime();
    expect(computeMonthTicks(minDateMs, maxDateMs)).toEqual([
      { dateMs: Date.UTC(2025, 11, 1), label: "Dec '25" },
      { dateMs: Date.UTC(2026, 0, 1), label: "Jan '26" },
    ]);
  });

  it('returns a single tick when min and max fall in the same month', () => {
    const dateMs = new Date('2026-06-15T00:00:00.000Z').getTime();
    expect(computeMonthTicks(dateMs, dateMs)).toEqual([
      { dateMs: Date.UTC(2026, 5, 1), label: 'Jun' },
    ]);
  });
});

describe('renderHistoryTrendChart milestones', () => {
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
  const currentRunAverages = { elaborationAvgMs: 100, renderingAvgMs: 70 };

  it('draws a dashed marker and label for a milestone matching a history sha', () => {
    const svg = renderHistoryTrendChart({
      title: 'test',
      history: [entryA, entryB],
      currentRunAverages,
      milestones: [{ sha: entryB.sha, label: 'Coverage instrumentation introduced' }],
    });
    expect(svg).toContain('stroke-dasharray="3,3"');
    expect(svg).toContain('Coverage instrumentation introduced');
  });

  it('omits the marker when no milestone matches a history sha', () => {
    const svg = renderHistoryTrendChart({
      title: 'test',
      history: [entryA, entryB],
      currentRunAverages,
      milestones: [{ sha: 'unknown-sha', label: 'Should not appear' }],
    });
    expect(svg).not.toContain('stroke-dasharray="3,3"');
    expect(svg).not.toContain('Should not appear');
  });

  it('defaults to no markers when milestones is omitted', () => {
    const svg = renderHistoryTrendChart({ title: 'test', history: [entryA], currentRunAverages });
    expect(svg).not.toContain('stroke-dasharray="3,3"');
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
    const currentDateMs = new Date('2026-01-02T00:00:00.000Z').getTime();
    const points = computeHistoryTrendData(
      [historyEntry],
      { dateMs: currentDateMs, durationSec: 480 },
      CUSTOM_SERIES,
    );
    expect(points).toEqual([
      { dateMs: new Date(historyEntry.date).getTime(), durationSec: 500, isCurrent: false },
      { dateMs: currentDateMs, durationSec: 480, isCurrent: true },
    ]);
  });

  it('omits the preview point entirely when currentPoint is nullish', () => {
    const points = computeHistoryTrendData([historyEntry], undefined, CUSTOM_SERIES);
    expect(points).toEqual([
      { dateMs: new Date(historyEntry.date).getTime(), durationSec: 500, isCurrent: false },
    ]);
  });
});

describe('renderMemoryTimeseriesChart', () => {
  it('renders a valid SVG with a peak marker for a non-empty timeseries', () => {
    const svg = renderMemoryTimeseriesChart({
      title: 'visual — shard 1',
      samples: [
        { t: 0, rss: 100 * 1024 * 1024 },
        { t: 250, rss: 250 * 1024 * 1024 },
        { t: 500, rss: 180 * 1024 * 1024 },
      ],
      color: COLORS.teal,
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('visual — shard 1');
    expect(svg).toContain('peak 250 MB');
    expect(svg).toContain(COLORS.teal);
  });

  it('renders a placeholder rather than throwing when there are no samples', () => {
    const svg = renderMemoryTimeseriesChart({ title: 'empty shard', samples: [] });
    expect(svg).toContain('<svg');
    expect(svg).toContain('No samples recorded');
  });

  it('defaults to blue when no color is given', () => {
    const svg = renderMemoryTimeseriesChart({ title: 't', samples: [{ t: 0, rss: 1024 * 1024 }] });
    expect(svg).toContain(COLORS.blue);
  });
});
