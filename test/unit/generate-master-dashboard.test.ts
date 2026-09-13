import { describe, expect, it } from 'vitest';
import {
  joinSections,
  renderBenchSection,
  renderMasterDashboard,
} from '../../scripts/generate-master-dashboard.mjs';

describe('joinSections', () => {
  it('joins present sections sorted by metric directory name', () => {
    const joined = joinSections({
      'ci-duration': '<section>ci</section>',
      bench: '<section>bench</section>',
      coverage: '<section>coverage</section>',
    });
    const benchIndex = joined.indexOf('<section>bench</section>');
    const ciIndex = joined.indexOf('<section>ci</section>');
    const coverageIndex = joined.indexOf('<section>coverage</section>');
    expect(benchIndex).toBeLessThan(ciIndex);
    expect(ciIndex).toBeLessThan(coverageIndex);
  });

  it('returns an empty string when there are no sections', () => {
    expect(joinSections({})).toBe('');
  });
});

describe('renderBenchSection', () => {
  it('returns null when there is no persisted history yet', () => {
    expect(renderBenchSection([])).toBeNull();
    expect(renderBenchSection(undefined)).toBeNull();
  });

  it('renders a section with a trend chart and a link to the full bench page', () => {
    const section = renderBenchSection([
      {
        sha: 'aaaa',
        date: '2026-01-01T00:00:00.000Z',
        elaborationAvgMs: 100,
        renderingAvgMs: 200,
      },
    ]);
    expect(section).toContain('<svg');
    expect(section).toContain('bench/index.html');
    expect(section).toContain('Diagram-generation benchmark');
  });
});

describe('renderMasterDashboard', () => {
  it('renders the shared shell with every section joined in', () => {
    const html = renderMasterDashboard({
      'ci-duration': '<section>ci-duration section</section>',
      coverage: '<section>coverage section</section>',
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Master Stats</title>');
    expect(html).toContain('ci-duration section');
    expect(html).toContain('coverage section');
  });
});
