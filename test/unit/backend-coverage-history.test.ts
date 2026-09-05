import { describe, expect, it } from 'vitest';
import {
  computeBackendCoverageEntry,
  mergeBackendCoverageHistory,
  parseLcovSummaryMetric,
  renderBackendCoverageSection,
  renderBackendCoverageTrendChart,
} from '../../scripts/backend-coverage-history.mjs';

const SUMMARY_TEXT = `Reading tracefile lcov.info
Summary coverage rate:
  lines......: 22.4% (123 of 550 lines)
  functions..: 30.0% (12 of 40 functions)
  branches...: 15.0% (5 of 33 branches)
`;

describe('parseLcovSummaryMetric', () => {
  it('parses each metric row out of an lcov --summary report', () => {
    expect(parseLcovSummaryMetric(SUMMARY_TEXT, 'lines')).toBe(22.4);
    expect(parseLcovSummaryMetric(SUMMARY_TEXT, 'functions')).toBe(30);
    expect(parseLcovSummaryMetric(SUMMARY_TEXT, 'branches')).toBe(15);
  });

  it('returns null when the metric row is missing', () => {
    expect(parseLcovSummaryMetric(SUMMARY_TEXT, 'statements')).toBeNull();
  });
});

describe('computeBackendCoverageEntry', () => {
  it('picks out the numeric pct of every metric present', () => {
    expect(
      computeBackendCoverageEntry({
        sha: 'abcdef0123456789',
        date: '2026-01-01T00:00:00.000Z',
        summaryText: SUMMARY_TEXT,
      }),
    ).toEqual({
      sha: 'abcdef0123456789',
      date: '2026-01-01T00:00:00.000Z',
      linesPct: 22.4,
      functionsPct: 30,
      branchesPct: 15,
    });
  });

  it('returns null when the summary text has no usable metric rows', () => {
    expect(
      computeBackendCoverageEntry({
        sha: 'aaaa',
        date: '2026-01-01T00:00:00.000Z',
        summaryText: 'not a real lcov summary',
      }),
    ).toBeNull();
  });
});

describe('mergeBackendCoverageHistory', () => {
  it('dedupes by sha, keeping the existing entry, sorted oldest-first', () => {
    const older = { sha: 'aaaa', date: '2026-01-01T00:00:00.000Z', linesPct: 20 };
    const staleOlder = { ...older, linesPct: 1 };
    const newer = { sha: 'bbbb', date: '2026-01-02T00:00:00.000Z', linesPct: 21 };
    expect(mergeBackendCoverageHistory([older], [staleOlder, newer])).toEqual([older, newer]);
  });
});

describe('renderBackendCoverageTrendChart', () => {
  const history = [
    {
      sha: 'aaaa',
      date: '2026-01-01T00:00:00.000Z',
      linesPct: 22,
      functionsPct: 30,
      branchesPct: 15,
    },
  ];

  it('renders a valid SVG from history alone', () => {
    const svg = renderBackendCoverageTrendChart({ history });
    expect(svg).toContain('<svg');
  });

  it('renders a dashed preview segment when a currentPoint is given', () => {
    const svg = renderBackendCoverageTrendChart({
      history,
      currentPoint: {
        dateMs: new Date('2026-01-02T00:00:00.000Z').getTime(),
        linesPct: 23,
        functionsPct: 31,
        branchesPct: 16,
      },
      currentLabel: 'this PR',
    });
    expect(svg).toContain('this PR');
  });
});

describe('renderBackendCoverageSection', () => {
  it('links/embeds via paths relative to dev/, not dev/backend-coverage/', () => {
    const section = renderBackendCoverageSection();
    expect(section).toContain('backend-coverage/trend.svg');
    expect(section).toContain('backend-coverage/index.html');
  });
});
