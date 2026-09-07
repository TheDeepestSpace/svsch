import { describe, expect, it } from 'vitest';
import { renderDashboardPage } from '../../scripts/dashboard-page-shell.mjs';

describe('renderDashboardPage', () => {
  it('renders the shared shell with the given title/description/body', () => {
    const html = renderDashboardPage({
      title: 'Widget Stats',
      description: 'Some description with a <a href="history.json">link</a>.',
      bodyHtml: '<img src="trend.svg" alt="Widget trend" />',
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Widget Stats</title>');
    expect(html).toContain('<h1>Widget Stats</h1>');
    expect(html).toContain('Some description with a <a href="history.json">link</a>.');
    expect(html).toContain('<img src="trend.svg" alt="Widget trend" />');
  });

  it('uses a distinct heading when given, separate from the <title>', () => {
    const html = renderDashboardPage({
      title: 'Short Title',
      heading: 'Longer descriptive heading',
      description: 'desc',
      bodyHtml: '<p>body</p>',
    });
    expect(html).toContain('<title>Short Title</title>');
    expect(html).toContain('<h1>Longer descriptive heading</h1>');
  });
});
