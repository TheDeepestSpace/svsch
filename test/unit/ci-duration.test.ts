import { describe, expect, it } from 'vitest';
import {
  computeRunDurationEntry,
  mergeCiDurationHistory,
  renderCiDurationTrendChart,
} from '../../scripts/ci-duration.mjs';

function run(overrides = {}) {
  return {
    status: 'completed',
    head_sha: 'abcdef0123456789',
    run_started_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:10:00.000Z',
    ...overrides,
  };
}

describe('computeRunDurationEntry', () => {
  it('computes durationSec from run_started_at to updated_at', () => {
    expect(computeRunDurationEntry(run())).toEqual({
      sha: 'abcdef0123456789',
      date: '2026-01-01T00:00:00.000Z',
      durationSec: 600,
    });
  });

  it('returns null for a run that has not completed yet', () => {
    expect(computeRunDurationEntry(run({ status: 'in_progress' }))).toBeNull();
  });

  it('returns null when timing fields are missing', () => {
    expect(computeRunDurationEntry(run({ run_started_at: null }))).toBeNull();
    expect(computeRunDurationEntry(run({ updated_at: undefined }))).toBeNull();
    expect(computeRunDurationEntry(run({ head_sha: undefined }))).toBeNull();
  });

  it('returns null for a nullish run rather than throwing', () => {
    expect(computeRunDurationEntry(undefined)).toBeNull();
    expect(computeRunDurationEntry(null)).toBeNull();
  });
});

describe('mergeCiDurationHistory', () => {
  const older = { sha: 'aaaa', date: '2026-01-01T00:00:00.000Z', durationSec: 500 };
  const newer = { sha: 'bbbb', date: '2026-01-02T00:00:00.000Z', durationSec: 480 };

  it('appends fresh entries not already present, sorted oldest-first', () => {
    expect(mergeCiDurationHistory([older], [older, newer])).toEqual([older, newer]);
  });

  it('keeps the existing entry on a sha collision rather than the fresh one', () => {
    const staleOlder = { ...older, durationSec: 999 };
    expect(mergeCiDurationHistory([older], [staleOlder, newer])).toEqual([older, newer]);
  });
});

describe('renderCiDurationTrendChart', () => {
  it('renders an SVG with just the history when currentPoint is omitted', () => {
    const svg = renderCiDurationTrendChart({
      history: [
        { sha: 'aaaa', date: '2026-01-01T00:00:00.000Z', durationSec: 500 },
        { sha: 'bbbb', date: '2026-01-02T00:00:00.000Z', durationSec: 480 },
      ],
    });
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('draws a dashed preview segment labeled with currentLabel when currentPoint is given', () => {
    const svg = renderCiDurationTrendChart({
      history: [{ sha: 'aaaa', date: '2026-01-01T00:00:00.000Z', durationSec: 500 }],
      currentPoint: { durationSec: 42 },
      currentLabel: 'this run (so far)',
    });
    expect(svg).toContain('this run (so far)');
    expect(svg).toContain('stroke-dasharray');
  });
});
