import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openView, paddedAllNodesClip, recordPendingRenderDuration, waitForViewportTransformToSettle } from './helper';
import { renderSvg } from '../../src/cli/svgRenderer';
import { compareSvgSnapshot } from '../graphRegression';
import type { DiagramViewModel } from '../../src/ir/types';
import { GRID, collectNodes, buildGridView, type OverlayEntry } from './nodeGridFixtures';

// Renders one node of every diagram kind in a grid and overlays the geometry
// routing sees: pink dashed rect = the placement box with lead margins,
// purple dashed rect = the candidate route obstacle with safety margins,
// filled dot = the route anchor, hollow dot = the rendered handle,
// and the orange segment joins the two.

const PLACEMENT_BOUNDS_COLOR = '#ff5f9e';
const ROUTING_BOUNDS_COLOR = '#a855f7';
const LEAD_COLOR = '#fb7a1f';
const MARGIN_COLOR = '#3ddc97';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Overlay shapes in flow coordinates, shared between the live page injection
// and the exported SVG baseline.
function overlayMarkup(overlay: OverlayEntry[]): string {
  const parts: string[] = ['<g class="elk-geometry-overlay">'];
  for (const entry of overlay) {
    if (entry.marginRect) {
      parts.push(
        `<rect x="${entry.marginRect.x}" y="${entry.marginRect.y}" width="${entry.marginRect.width}" height="${entry.marginRect.height}" fill="none" stroke="${MARGIN_COLOR}" stroke-width="1.5" stroke-dasharray="2 3" />`,
        `<text x="${entry.marginRect.x}" y="${entry.marginRect.y + entry.marginRect.height + 16}" fill="${MARGIN_COLOR}" font-size="11" font-family="monospace">+ cut-net margin</text>`
      );
    }
    parts.push(
      `<rect x="${entry.placementRect.x}" y="${entry.placementRect.y}" width="${entry.placementRect.width}" height="${entry.placementRect.height}" fill="none" stroke="${PLACEMENT_BOUNDS_COLOR}" stroke-width="1.5" stroke-dasharray="6 4" />`,
      `<rect x="${entry.routingRect.x}" y="${entry.routingRect.y}" width="${entry.routingRect.width}" height="${entry.routingRect.height}" fill="none" stroke="${ROUTING_BOUNDS_COLOR}" stroke-width="1.75" stroke-dasharray="7 5" />`,
      `<text x="${entry.routingRect.x}" y="${entry.routingRect.y - 8}" fill="${ROUTING_BOUNDS_COLOR}" font-size="13" font-family="monospace">${escapeXml(entry.label)}</text>`
    );
    for (const port of entry.ports) {
      parts.push(
        `<line x1="${port.surface.x}" y1="${port.surface.y}" x2="${port.anchor.x}" y2="${port.anchor.y}" stroke="${LEAD_COLOR}" stroke-width="1.75" />`,
        `<circle cx="${port.surface.x}" cy="${port.surface.y}" r="5" fill="none" stroke="${LEAD_COLOR}" stroke-width="2" />`,
        `<circle cx="${port.anchor.x}" cy="${port.anchor.y}" r="7" fill="${LEAD_COLOR}" fill-opacity="0.9" />`
      );
    }
  }
  parts.push('</g>');
  return parts.join('\n');
}

async function injectOverlay(page: Page, overlay: OverlayEntry[]): Promise<void> {
  await page.evaluate((markup) => {
    const viewport = document.querySelector('.react-flow__viewport');
    if (!viewport) {
      throw new Error('react-flow viewport not found');
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '1');
    svg.setAttribute('height', '1');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.overflow = 'visible';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '1000';
    svg.innerHTML = markup;
    viewport.appendChild(svg);
  }, overlayMarkup(overlay));
}

// renderSvg emits `<g transform="translate(..)">…</g>\n</svg>` at the end of
// the document; splice the overlay inside that translated group so it shares
// the node coordinate space.
function renderSvgWithOverlay(view: DiagramViewModel, overlay: OverlayEntry[]): string {
  const reactFlowCss = fs.readFileSync(require.resolve('@xyflow/react/dist/style.css'), 'utf8');
  const extensionCss = fs.readFileSync(path.resolve(__dirname, '../../src/webview/diagram.css'), 'utf8');
  const svg = renderSvg(view, { theme: 'dark', reactFlowCss, extensionCss, padding: GRID * 3 });
  const tail = '</g>\n</svg>';
  const tailIndex = svg.lastIndexOf(tail);
  if (tailIndex === -1) {
    throw new Error('Unexpected renderSvg output: closing tags not found');
  }
  return `${svg.slice(0, tailIndex)}${overlayMarkup(overlay)}\n${svg.slice(tailIndex)}`;
}

test.describe('elk geometry grid', () => {
  // The grid is taller than the default 1400x1000 viewport permits at React
  // Flow's minimum zoom, which would clip the bottom rows out of the PNG.
  test.use({ viewport: { width: 1700, height: 2200 } });

  test('shows elk bounds and port anchors for every node kind', async ({ page }) => {
    const collected = await collectNodes();
    const { view, overlay } = buildGridView(collected);

    await openView(page, view);
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.react-flow__node').length >= expected,
      view.nodes.length
    );

    // Fit the viewport ourselves from the known overlay bounds instead of
    // fitView: the webview's own auto-fit races with it and can settle on a
    // clamped zoom that pushes the first grid row off screen.
    const margin = GRID * 2;
    const minX = Math.min(...overlay.map((e) => Math.min(e.placementRect.x, e.routingRect.x, e.marginRect?.x ?? Infinity))) - margin;
    const minY = Math.min(...overlay.map((e) => Math.min(e.placementRect.y, e.routingRect.y, e.marginRect?.y ?? Infinity))) - margin;
    const maxX = Math.max(...overlay.map((e) => Math.max(
      e.placementRect.x + e.placementRect.width,
      e.routingRect.x + e.routingRect.width,
      e.marginRect ? e.marginRect.x + e.marginRect.width : -Infinity
    ))) + margin;
    const maxY = Math.max(...overlay.map((e) => Math.max(
      e.placementRect.y + e.placementRect.height,
      e.routingRect.y + e.routingRect.height,
      e.marginRect ? e.marginRect.y + e.marginRect.height : -Infinity
    ))) + margin;
    await page.waitForFunction(() => Boolean((window as any).reactFlowInstance));
    await page.evaluate(async (bounds) => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const zoom = Math.min(viewport.width / (bounds.maxX - bounds.minX), viewport.height / (bounds.maxY - bounds.minY), 1);
      await (window as any).reactFlowInstance.setViewport({
        x: (viewport.width - (bounds.maxX - bounds.minX) * zoom) / 2 - bounds.minX * zoom,
        y: (viewport.height - (bounds.maxY - bounds.minY) * zoom) / 2 - bounds.minY * zoom,
        zoom
      });
    }, { minX, minY, maxX, maxY });
    await injectOverlay(page, overlay);
    await waitForViewportTransformToSettle(page);
    await page.waitForTimeout(100);
    recordPendingRenderDuration(page);

    await expect(page).toHaveScreenshot('elk-geometry-grid.png', {
      clip: await paddedAllNodesClip(page)
    });

    // Platform-independent SVG twin of the screenshot, with the same overlay
    // baked in (mirrors the update-mode handling in helper.ts).
    const snapshotsDir = path.dirname(test.info().snapshotPath('elk-geometry-grid.svg'));
    const resultsDir = path.resolve(__dirname, '../../test-results/visual/graph-diffs');
    const updateMode = test.info().config.updateSnapshots;
    const updateSnapshots = !!process.env.UPDATE_SNAPSHOTS
      || updateMode === 'all'
      || updateMode === 'changed';
    compareSvgSnapshot(renderSvgWithOverlay(view, overlay), 'elk-geometry-grid', snapshotsDir, resultsDir, updateSnapshots);
  });
});
