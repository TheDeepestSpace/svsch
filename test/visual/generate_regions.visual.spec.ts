import { expect, test, type Page } from '@playwright/test';
import { diagramSizing } from '../../src/diagram/constants';
import type { DiagramViewModel } from '../../src/ir/types';
import { expectGraphAndScreenshot, openFixture, paddedGraphAndRegionsClip, trackView } from './helper';

type RegionSide = 'left' | 'right' | 'top' | 'bottom';
type RegionBounds = { x: number; y: number; width: number; height: number };

test.describe('generate region visual rendering', () => {
  test('renders if, else-if, and else generate regions from a fixture', async ({ page }) => {
    const view = await openFixture(page, 'generate_if_else_regions.sv', 'generate', 'generate_if_else_regions');
    const regions = view.generateRegions ?? [];

    expect(regions).toHaveLength(3);
    expect(regions.map((region) => region.blockLabel)).toEqual(expect.arrayContaining([
      'g_if_zero',
      'g_if_one',
      'g_if_other'
    ]));
    expect(regions.map((region) => region.kind)).toEqual(expect.arrayContaining([
      'if',
      'else-if',
      'else'
    ]));

    await expect(page.locator('.generate-region')).toHaveCount(3);
    await expect(page.locator('.generate-region[data-region-kind="if"] .generate-region-title')).toContainText('g_if_zero');
    await expect(page.locator('.generate-region[data-region-kind="else-if"] .generate-region-title')).toContainText('g_if_one');
    await expect(page.locator('.generate-region[data-region-kind="else"] .generate-region-title')).toContainText('g_if_other');
    await expect(page.locator('.generate-region-active')).toHaveCount(1);
    await expect(page.locator('.generate-region-active .generate-region-title')).toContainText('g_if_one');
    await expect(page.locator('.generate-region-inactive')).toHaveCount(2);

    await expectGraphAndScreenshot(page, 'generate-if-else-regions-canvas.png', {
      clip: await paddedGraphAndRegionsClip(page),
      maxDiffPixels: 120
    });
  });

  test('renders all generate case arms from a fixture', async ({ page }) => {
    const view = await openFixture(page, 'generate_case_regions.sv', 'generate', 'generate_case_regions');
    const regions = view.generateRegions ?? [];

    expect(regions).toHaveLength(3);
    expect(regions.map((region) => region.blockLabel)).toEqual(expect.arrayContaining([
      'g_case_0',
      'g_case_1',
      'g_case_default'
    ]));
    expect(regions.map((region) => region.kind)).toEqual(expect.arrayContaining([
      'case',
      'case-default'
    ]));

    await expect(page.locator('.generate-region')).toHaveCount(3);
    await expect(page.locator('.generate-region[data-region-kind="case"] .generate-region-title', { hasText: 'g_case_0' })).toBeVisible();
    await expect(page.locator('.generate-region[data-region-kind="case"] .generate-region-title', { hasText: 'g_case_1' })).toBeVisible();
    await expect(page.locator('.generate-region[data-region-kind="case-default"] .generate-region-title')).toContainText('g_case_default');
    await expect(page.locator('.generate-region-active')).toHaveCount(1);
    await expect(page.locator('.generate-region-active .generate-region-title')).toContainText('g_case_1');
    await expect(page.locator('.generate-region-inactive')).toHaveCount(2);

    await expectGraphAndScreenshot(page, 'generate-case-regions-canvas.png', {
      clip: await paddedGraphAndRegionsClip(page),
      maxDiffPixels: 120
    });
  });

  test('auto-layouts if, else-if, and else generate regions with ELK compound parents', async ({ page }) => {
    const view = await openFixture(page, 'generate_if_else_regions.sv', 'auto', 'generate_if_else_regions');
    const regions = view.generateRegions ?? [];

    expect(regions).toHaveLength(3);
    await expect(page.locator('.generate-region')).toHaveCount(3);
    await expect(page.locator('.generate-region-invalid')).toHaveCount(0);
    await expect(page.locator('.generate-region-active')).toHaveCount(1);
    await expect(page.locator('.generate-region-active .generate-region-title')).toContainText('g_if_one');

    await expectGraphAndScreenshot(page, 'generate-if-else-regions-auto-canvas.png', {
      clip: await paddedGraphAndRegionsClip(page),
      maxDiffPixels: 120
    });
  });

  test('auto-layouts all generate case arms with ELK compound parents', async ({ page }) => {
    const view = await openFixture(page, 'generate_case_regions.sv', 'auto', 'generate_case_regions');
    const regions = view.generateRegions ?? [];

    expect(regions).toHaveLength(3);
    await expect(page.locator('.generate-region')).toHaveCount(3);
    await expect(page.locator('.generate-region-invalid')).toHaveCount(0);
    await expect(page.locator('.generate-region-active')).toHaveCount(1);
    await expect(page.locator('.generate-region-active .generate-region-title')).toContainText('g_case_1');

    await expectGraphAndScreenshot(page, 'generate-case-regions-auto-canvas.png', {
      clip: await paddedGraphAndRegionsClip(page),
      maxDiffPixels: 120
    });
  });

  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    test(`resizes the ${side} side of a generate region with a two-grid content clamp`, async ({ page }) => {
      const label = 'g_if_one';

      const clampView = await openFixture(page, 'generate_if_else_regions.sv', 'auto', 'generate_if_else_regions');
      await resizeGenerateRegionSideByGridCells(page, label, side, side === 'right' || side === 'bottom' ? -30 : 30);
      const padding = await regionContentPadding(page, clampView, label);
      expect(padding[side]).toBe(diagramSizing.gridSize * 2);

      const expandedView = await openFixture(page, 'generate_if_else_regions.sv', 'auto', 'generate_if_else_regions');
      const before = await regionBounds(page, label);

      await resizeGenerateRegionSideByGridCells(page, label, side, side === 'right' || side === 'bottom' ? 3 : -3);
      const expanded = await regionBounds(page, label);
      expect(regionSide(expanded, side)).toBe(regionSide(before, side) + (side === 'right' || side === 'bottom' ? 3 : -3) * diagramSizing.gridSize);

      trackView(page, await viewWithRenderedGenerateRegionBounds(page, expandedView));
      await expectGraphAndScreenshot(page, `generate-region-resize-${side}.png`, {
        clip: await paddedGraphAndRegionsClip(page),
        maxDiffPixels: 120
      });
    });
  }
});

function generateRegionLocator(page: Page, label: string) {
  return page.locator('.generate-region').filter({
    has: page.locator('.generate-region-title', { hasText: label })
  }).first();
}

async function resizeGenerateRegionSideByGridCells(page: Page, label: string, side: RegionSide, cells: number): Promise<void> {
  const handle = generateRegionLocator(page, label).locator(`.generate-region-resize-${side}`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`Could not find ${side} resize handle for ${label}`);
  const zoom = await page.locator('html').evaluate(() => (window as any).reactFlowInstance?.getViewport()?.zoom ?? 1);
  const dx = (side === 'left' || side === 'right') ? cells * diagramSizing.gridSize * zoom : 0;
  const dy = (side === 'top' || side === 'bottom') ? cells * diagramSizing.gridSize * zoom : 0;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + Math.sign(dx || 1) * 2, startY + Math.sign(dy || 1) * 2, { steps: 3 });
  await page.mouse.move(startX + dx, startY + dy, { steps: 12 });
  await page.mouse.up();
  const canvas = await page.locator('.canvas').boundingBox();
  if (canvas) {
    await page.mouse.move(canvas.x + 16, canvas.y + 16);
  }
  await page.waitForTimeout(650);
}

async function regionBounds(page: Page, label: string): Promise<RegionBounds> {
  return generateRegionLocator(page, label).evaluate((element) => {
    const html = element as HTMLElement;
    return {
      x: Number.parseFloat(html.style.left || '0'),
      y: Number.parseFloat(html.style.top || '0'),
      width: Number.parseFloat(html.style.width || '0'),
      height: Number.parseFloat(html.style.height || '0')
    };
  });
}

async function viewWithRenderedGenerateRegionBounds(page: Page, view: DiagramViewModel): Promise<DiagramViewModel> {
  const boundsById: Record<string, RegionBounds> = await page.locator('.generate-region').evaluateAll((elements): Record<string, RegionBounds> => {
    return Object.fromEntries(elements.map((element) => {
      const html = element as HTMLElement;
      return [html.dataset.regionId ?? '', {
        x: Number.parseFloat(html.style.left || '0'),
        y: Number.parseFloat(html.style.top || '0'),
        width: Number.parseFloat(html.style.width || '0'),
        height: Number.parseFloat(html.style.height || '0')
      }];
    }).filter(([id]) => id));
  });

  return {
    ...view,
    generateRegions: view.generateRegions?.map((region) => ({
      ...region,
      bounds: boundsById[region.id] ?? region.bounds
    }))
  };
}

function regionSide(bounds: RegionBounds, side: RegionSide): number {
  if (side === 'left') return bounds.x;
  if (side === 'right') return bounds.x + bounds.width;
  if (side === 'top') return bounds.y;
  return bounds.y + bounds.height;
}

async function regionContentPadding(page: Page, view: DiagramViewModel, label: string): Promise<Record<RegionSide, number>> {
  const region = view.generateRegions?.find((candidate) => candidate.blockLabel === label || candidate.label.includes(label));
  if (!region) throw new Error(`Could not find region ${label}`);
  const bounds = await regionBounds(page, label);
  const content = await page.evaluate((nodeIds) => {
    const rf = (window as any).reactFlowInstance;
    const nodes = rf.getNodes().filter((node: any) => nodeIds.includes(node.id));
    const rects = nodes.map((node: any) => ({
      x: node.position.x,
      y: node.position.y,
      width: node.measured?.width ?? node.width ?? 0,
      height: node.measured?.height ?? node.height ?? 0
    }));
    return {
      x: Math.min(...rects.map((rect: any) => rect.x)),
      y: Math.min(...rects.map((rect: any) => rect.y)),
      right: Math.max(...rects.map((rect: any) => rect.x + rect.width)),
      bottom: Math.max(...rects.map((rect: any) => rect.y + rect.height))
    };
  }, region.nodeIds);

  return {
    left: content.x - bounds.x,
    top: content.y - bounds.y,
    right: bounds.x + bounds.width - content.right,
    bottom: bounds.y + bounds.height - content.bottom
  };
}
