import { describe, expect, it } from 'vitest';
import {
  computeCoverageEntry,
  mergeCoverageHistory,
  renderCoverageTrendChart,
} from '../../scripts/coverage-history.mjs';

describe('computeCoverageEntry', () => {
  it('picks out the numeric pct of every metric present', () => {
    expect(
      computeCoverageEntry({
        sha: 'abcdef0123456789',
        date: '2026-01-01T00:00:00.000Z',
        summaryTotal: {
          statements: { pct: 80.5 },
          branches: { pct: 70.25 },
          functions: { pct: 90 },
          lines: { pct: 82.1 },
        },
      }),
    ).toEqual({
      sha: 'abcdef0123456789',
      date: '2026-01-01T00:00:00.000Z',
      statementsPct: 80.5,
      branchesPct: 70.25,
      functionsPct: 90,
      linesPct: 82.1,
    });
  });

  it('drops a metric whose pct is the "Unknown" string rather than a number', () => {
    const entry = computeCoverageEntry({
      sha: 'aaaa',
      date: '2026-01-01T00:00:00.000Z',
      summaryTotal: {
        statements: { pct: 'Unknown' },
        branches: { pct: 70 },
        functions: { pct: 'Unknown' },
        lines: { pct: 82 },
      },
    });
    expect(entry).toEqual({
      sha: 'aaaa',
      date: '2026-01-01T00:00:00.000Z',
      branchesPct: 70,
      linesPct: 82,
    });
  });

  it('returns null when every metric is unusable', () => {
    expect(
      computeCoverageEntry({
        sha: 'aaaa',
        date: '2026-01-01T00:00:00.000Z',
        summaryTotal: {},
      }),
    ).toBeNull();
  });

  it('returns null for a nullish summary rather than throwing', () => {
    expect(
      computeCoverageEntry({
        sha: 'aaaa',
        date: '2026-01-01T00:00:00.000Z',
        summaryTotal: undefined,
      }),
    ).toBeNull();
  });
});

describe('mergeCoverageHistory', () => {
  it('dedupes by sha, keeping the existing entry, sorted oldest-first', () => {
    const older = { sha: 'aaaa', date: '2026-01-01T00:00:00.000Z', statementsPct: 80 };
    const staleOlder = { ...older, statementsPct: 1 };
    const newer = { sha: 'bbbb', date: '2026-01-02T00:00:00.000Z', statementsPct: 81 };
    expect(mergeCoverageHistory([older], [staleOlder, newer])).toEqual([older, newer]);
  });
});

describe('renderCoverageTrendChart', () => {
  const history = [
    {
      sha: 'aaaa',
      date: '2026-01-01T00:00:00.000Z',
      statementsPct: 80,
      branchesPct: 70,
      functionsPct: 90,
      linesPct: 82,
    },
  ];

  it('renders a valid SVG from history alone', () => {
    const svg = renderCoverageTrendChart({ history });
    expect(svg).toContain('<svg');
  });

  it('renders a dashed preview segment when a currentPoint is given', () => {
    const svg = renderCoverageTrendChart({
      history,
      currentPoint: {
        dateMs: new Date('2026-01-02T00:00:00.000Z').getTime(),
        statementsPct: 81,
        branchesPct: 71,
        functionsPct: 91,
        linesPct: 83,
      },
      currentLabel: 'this PR',
    });
    expect(svg).toContain('this PR');
  });
});
