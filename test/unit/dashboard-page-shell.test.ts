import { describe, expect, it } from 'vitest';
import {
  renderDashboardPage,
  renderDashboardSection,
} from '../../scripts/dashboard-page-shell.mjs';

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

describe('renderDashboardSection', () => {
  it('renders a heading, body markup, and a link with the default label', () => {
    const section = renderDashboardSection({
      heading: 'Widget Trend',
      bodyHtml: '<img src="widget/trend.svg" alt="Widget trend" />',
      href: 'widget/index.html',
    });
    expect(section).toContain('<h2>Widget Trend</h2>');
    expect(section).toContain('<img src="widget/trend.svg" alt="Widget trend" />');
    expect(section).toContain('<a href="widget/index.html">Full history →</a>');
  });

  it('uses a custom link label when given', () => {
    const section = renderDashboardSection({
      heading: 'Widget Trend',
      bodyHtml: '<p>body</p>',
      href: 'widget/index.html',
      linkLabel: 'See more →',
    });
    expect(section).toContain('<a href="widget/index.html">See more →</a>');
  });
});
