import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  computePeakRssBytes,
  computeTrailingMedianPeakBytes,
  computeWorstPeak,
  loadShardsByCategory,
  mergeMemProfileHistory,
  parseArtifactFilename,
  relativeJsonPath,
  renderMemProfileSection,
  renderMemProfileTrendChart,
} from '../../scripts/mem-profile.mjs';

const visualCategory = CATEGORIES.find((c) => c.key === 'visual')!;

describe('computePeakRssBytes', () => {
  it('returns the maximum rss across the timeseries', () => {
    expect(
      computePeakRssBytes([
        { t: 0, rss: 100 },
        { t: 1, rss: 300 },
        { t: 2, rss: 200 },
      ]),
    ).toBe(300);
  });

  it('returns 0 for an empty timeseries', () => {
    expect(computePeakRssBytes([])).toBe(0);
  });
});

describe('parseArtifactFilename', () => {
  it('parses a visual shard filename', () => {
    expect(parseArtifactFilename('visual-shard-3.json')).toEqual({
      category: 'visual',
      label: 'shard 3',
      sortKey: 3,
    });
  });

  it('parses a bdd shard filename', () => {
    expect(parseArtifactFilename('bdd-shard-8.json')).toEqual({
      category: 'bdd',
      label: 'shard 8',
      sortKey: 8,
    });
  });

  it('parses a system leg filename, keeping the version as the sort key', () => {
    expect(parseArtifactFilename('system-1.90.0.json')).toEqual({
      category: 'system',
      label: 'VS Code 1.90.0',
      sortKey: '1.90.0',
    });
  });

  it('returns null for anything that does not match', () => {
    expect(parseArtifactFilename('unexpected-file.json')).toBeNull();
    expect(parseArtifactFilename('visual-shard-x.json')).toBeNull();
  });
});

describe('relativeJsonPath', () => {
  it('strips the category prefix back off the flattened filename', () => {
    expect(relativeJsonPath('visual', 'visual-shard-1.json')).toBe('visual/shard-1.json');
    expect(relativeJsonPath('system', 'system-1.90.0.json')).toBe('system/1.90.0.json');
  });
});

describe('loadShardsByCategory', () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('buckets and sorts shards/legs by category from a flat directory', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-profile-test-'));
    fs.writeFileSync(path.join(dir, 'visual-shard-2.json'), JSON.stringify([{ t: 0, rss: 20 }]));
    fs.writeFileSync(path.join(dir, 'visual-shard-1.json'), JSON.stringify([{ t: 0, rss: 10 }]));
    fs.writeFileSync(path.join(dir, 'bdd-shard-1.json'), JSON.stringify([{ t: 0, rss: 5 }]));
    fs.writeFileSync(path.join(dir, 'system-1.90.0.json'), JSON.stringify([{ t: 0, rss: 7 }]));
    fs.writeFileSync(path.join(dir, 'unexpected-file.json'), JSON.stringify([]));

    const byCategory = loadShardsByCategory(dir);
    expect(byCategory.get('visual')!.map((s) => s.label)).toEqual(['shard 1', 'shard 2']);
    expect(byCategory.get('visual')!.map((s) => s.peakBytes)).toEqual([10, 20]);
    expect(byCategory.get('bdd')!.map((s) => s.label)).toEqual(['shard 1']);
    expect(byCategory.get('system')!.map((s) => s.label)).toEqual(['VS Code 1.90.0']);
  });

  it('returns empty buckets for every category when the directory is missing', () => {
    const byCategory = loadShardsByCategory('/nonexistent/mem-profile-raw-dir');
    for (const category of CATEGORIES) {
      expect(byCategory.get(category.key)).toEqual([]);
    }
  });
});

describe('computeWorstPeak', () => {
  it('returns the entry with the highest peakBytes', () => {
    expect(
      computeWorstPeak([
        { label: 'shard 1', peakBytes: 100 },
        { label: 'shard 2', peakBytes: 300 },
        { label: 'shard 3', peakBytes: 200 },
      ]),
    ).toEqual({ label: 'shard 2', peakBytes: 300 });
  });

  it('returns null for an empty list', () => {
    expect(computeWorstPeak([])).toBeNull();
  });
});

describe('computeTrailingMedianPeakBytes', () => {
  const historyEntry = (sha: string, visualPeakBytes: number) => ({
    sha,
    date: '2026-01-01T00:00:00.000Z',
    visualPeakBytes,
  });

  it('returns null when there is no persisted history yet', () => {
    expect(computeTrailingMedianPeakBytes([], visualCategory)).toBeNull();
  });

  it('computes the median over an odd-length trailing window', () => {
    const history = [historyEntry('a', 100), historyEntry('b', 300), historyEntry('c', 200)];
    expect(computeTrailingMedianPeakBytes(history, visualCategory)).toBe(200);
  });

  it('averages the two middle values over an even-length trailing window', () => {
    const history = [
      historyEntry('a', 100),
      historyEntry('b', 200),
      historyEntry('c', 300),
      historyEntry('d', 400),
    ];
    expect(computeTrailingMedianPeakBytes(history, visualCategory)).toBe(250);
  });

  it('only considers the last windowSize entries', () => {
    const history = [
      historyEntry('old-1', 999_999),
      historyEntry('old-2', 999_999),
      historyEntry('a', 100),
      historyEntry('b', 200),
      historyEntry('c', 300),
    ];
    expect(computeTrailingMedianPeakBytes(history, visualCategory, 3)).toBe(200);
  });
});

describe('mergeMemProfileHistory', () => {
  it('dedupes by sha, keeping the existing entry, sorted oldest-first', () => {
    const older = { sha: 'aaaa', date: '2026-01-01T00:00:00.000Z', visualPeakBytes: 100 };
    const staleOlder = { ...older, visualPeakBytes: 999 };
    const newer = { sha: 'bbbb', date: '2026-01-02T00:00:00.000Z', visualPeakBytes: 200 };
    expect(mergeMemProfileHistory([older], [staleOlder, newer])).toEqual([older, newer]);
  });
});

describe('renderMemProfileTrendChart', () => {
  const history = [
    {
      sha: 'aaaa',
      date: '2026-01-01T00:00:00.000Z',
      visualPeakBytes: 500 * 1024 * 1024,
      systemPeakBytes: 600 * 1024 * 1024,
      bddPeakBytes: 700 * 1024 * 1024,
    },
  ];

  it('renders a valid SVG from history alone', () => {
    const svg = renderMemProfileTrendChart({ history });
    expect(svg).toContain('<svg');
  });

  it('renders a dashed preview segment when a currentPoint is given', () => {
    const svg = renderMemProfileTrendChart({
      history,
      currentPoint: {
        dateMs: new Date('2026-01-02T00:00:00.000Z').getTime(),
        visualPeakBytes: 550 * 1024 * 1024,
        systemPeakBytes: 610 * 1024 * 1024,
        bddPeakBytes: 690 * 1024 * 1024,
      },
      currentLabel: 'this PR',
    });
    expect(svg).toContain('this PR');
  });
});

describe('renderMemProfileSection', () => {
  it('links/embeds via paths relative to dev/, not dev/mem-profile/', () => {
    const section = renderMemProfileSection();
    expect(section).toContain('mem-profile/trend.svg');
    expect(section).toContain('mem-profile/index.html');
  });
});
