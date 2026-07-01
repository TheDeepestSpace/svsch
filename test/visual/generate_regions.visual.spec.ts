import { expect, test, type Page } from '@playwright/test';
import { diagramSizing } from '../../src/diagram/constants';
import type { DiagramViewModel } from '../../src/ir/types';
import { GENERATE_REGION_EXTERNAL_BLOCK_WARNING } from '../../src/layout/generateRegionValidation';
import { expectGraphAndScreenshot, openFixture, openView, paddedGraphAndRegionsClip, trackView } from './helper';

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

  test('shows warning icons when arm blocks overlap', async ({ page }) => {
    await openView(page, generateWarningView({
      includeSecondRegion: true,
      includeExternalNode: false
    }));
    await page.waitForSelector('.generate-region');

    const overlapView = generateWarningView({ includeSecondRegion: true, includeExternalNode: false });
    await moveGenerateRegionByGridCells(page, 'g_warn_one', -10, 0, { release: false });

    await expect(page.locator('.generate-region-invalid')).toHaveCount(2);
    await expect(page.locator('.generate-region-warning[aria-label*="arm blocks overlapping"]')).toHaveCount(2);

    trackView(page, await viewWithRenderedGenerateRegionBounds(page, overlapView));
    await expectGraphAndScreenshot(page, 'generate-region-overlap-warning.png', {
      clip: await paddedGraphAndRegionsClip(page),
      maxDiffPixels: 120
    });
    await page.mouse.up();
  });

  test('shows a warning icon when an arm block contains an unrelated node', async ({ page }) => {
    await openView(page, generateWarningView({
      includeSecondRegion: false,
      includeExternalNode: true
    }));
    await page.waitForSelector('.generate-region');

    const externalNodeView = generateWarningView({ includeSecondRegion: false, includeExternalNode: true });
    await moveGenerateRegionByGridCells(page, 'g_warn_zero', 12, 0, { release: false });

    await expect(page.locator('.generate-region-invalid')).toHaveCount(1);
    await expect(page.locator('.generate-region-warning[aria-label="node does not belong to arm block"]')).toHaveCount(1);
    await expect(page.locator(`.node-warning[aria-label="${GENERATE_REGION_EXTERNAL_BLOCK_WARNING}"]`)).toHaveCount(1);

    trackView(page, await viewWithRenderedGenerateRegionBounds(page, externalNodeView));
    await expectGraphAndScreenshot(page, 'generate-region-external-node-warning.png', {
      clip: await paddedGraphAndRegionsClip(page),
      maxDiffPixels: 120
    });
    await page.mouse.up();
  });

  test('renders the shared error highlight for each block type and a generate arm', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1300 });
    await openView(page, errorHighlightGridView());
    await page.waitForSelector('.react-flow__node');

    // Every block in the grid plus the arm carries the error style.
    await expect(page.locator('.react-flow__node.svsch-node-invalid')).toHaveCount(ERROR_BLOCK_VARIANTS.length);
    await expect(page.locator(`.node-warning[aria-label="${GENERATE_REGION_EXTERNAL_BLOCK_WARNING}"]`)).toHaveCount(ERROR_BLOCK_VARIANTS.length);
    await expect(page.locator('.generate-region-invalid')).toHaveCount(1);

    await expectGraphAndScreenshot(page, 'error-highlight-block-types.png', {
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

      // Give g_if_one room on the side it grows into so the resize doesn't bump a
      // neighbouring arm — arm overlap is covered by its own dedicated tests.
      if (side === 'top') {
        await moveGenerateRegionByGridCells(page, 'g_if_zero', 0, -3);
      } else if (side === 'bottom') {
        await moveGenerateRegionByGridCells(page, 'g_if_other', 0, 3);
      }

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

async function moveGenerateRegionByGridCells(
  page: Page,
  label: string,
  cellsX: number,
  cellsY: number,
  options: { release?: boolean } = {}
): Promise<void> {
  const title = generateRegionLocator(page, label).locator('.generate-region-title');
  const box = await title.boundingBox();
  if (!box) throw new Error(`Could not find title for ${label}`);
  const zoom = await page.locator('html').evaluate(() => (window as any).reactFlowInstance?.getViewport()?.zoom ?? 1);
  const dx = cellsX * diagramSizing.gridSize * zoom;
  const dy = cellsY * diagramSizing.gridSize * zoom;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 12 });
  if (options.release !== false) {
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
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

type ErrorBlockVariant = {
  key: string;
  kind: DiagramViewModel['nodes'][number]['kind'];
  label: string;
  ports?: DiagramViewModel['nodes'][number]['ports'];
  instanceOf?: string;
  role?: string;
  typeName?: string;
  modportName?: string;
  operation?: string;
  repeatExpression?: string;
  isArrayNode?: boolean;
  arrayDimension?: string;
  metadata?: Record<string, unknown>;
};

const ERROR_BLOCK_VARIANTS: ErrorBlockVariant[] = [
  { key: 'input_port', kind: 'port', label: 'input', ports: [port('input_port', 'input', 'input')] },
  { key: 'output_port', kind: 'port', label: 'output', ports: [port('output_port', 'output', 'output')] },
  {
    key: 'interface_port',
    kind: 'interface',
    label: 'if_port',
    role: 'port',
    typeName: 'stream_if',
    modportName: 'master',
    ports: [port('interface_port', 'stream', 'input', { typeName: 'stream_if', modportName: 'master' })]
  },
  { key: 'comb', kind: 'comb', label: 'comb' },
  { key: 'loop', kind: 'loop', label: 'loop' },
  {
    key: 'register',
    kind: 'register',
    label: 'register',
    ports: [port('register', 'D', 'input'), port('register', 'clk', 'input'), port('register', 'Q', 'output')],
    metadata: { clockSignal: 'clk' }
  },
  { key: 'latch', kind: 'latch', label: 'latch', ports: [port('latch', 'D', 'input'), port('latch', 'G', 'input'), port('latch', 'Q', 'output')] },
  { key: 'mux', kind: 'mux', label: 'mux', ports: [port('mux', 'sel', 'input'), port('mux', 'a', 'input'), port('mux', 'b', 'input'), port('mux', 'y', 'output')] },
  { key: 'select', kind: 'select', label: 'select', ports: [port('select', 's', 'input'), port('select', 'in', 'input'), port('select', 'y', 'output')] },
  { key: 'alu', kind: 'alu', label: 'alu', operation: '+', ports: defaultPorts('alu') },
  { key: 'inverter', kind: 'inverter', label: 'inv', ports: [port('inverter', 'a', 'input'), port('inverter', 'y', 'output')] },
  { key: 'literal', kind: 'literal', label: "1'b1", ports: [port('literal', 'y', 'output')] },
  {
    key: 'replicate',
    kind: 'replicate',
    label: 'x N',
    repeatExpression: 'N',
    ports: [port('replicate', 'a', 'input'), port('replicate', 'y', 'output')]
  },
  { key: 'instance', kind: 'instance', label: 'instance', instanceOf: 'sub' },
  { key: 'module', kind: 'module', label: 'module' },
  { key: 'unknown', kind: 'unknown', label: 'unknown' },
  { key: 'bus_comp', kind: 'bus', label: 'bus comp', ports: [port('bus_comp', 'a', 'input'), port('bus_comp', 'b', 'input'), port('bus_comp', 'out', 'output')] },
  { key: 'bus_break', kind: 'bus', label: 'bus break', ports: [port('bus_break', 'in', 'input'), port('bus_break', 'lo', 'output'), port('bus_break', 'hi', 'output')] },
  {
    key: 'struct_comp',
    kind: 'struct',
    label: 'packet',
    role: 'composition',
    ports: [port('struct_comp', 'opcode', 'input', { width: '[3:0]' }), port('struct_comp', 'valid', 'input'), port('struct_comp', 'pkt', 'output', { typeName: 'packet_t' })]
  },
  {
    key: 'struct_break',
    kind: 'struct',
    label: 'packet',
    role: 'breakout',
    ports: [port('struct_break', 'pkt', 'input', { typeName: 'packet_t' }), port('struct_break', 'opcode', 'output', { width: '[3:0]' }), port('struct_break', 'valid', 'output')]
  },
  {
    key: 'interface_inst',
    kind: 'interface',
    label: 'if_inst',
    role: 'instance',
    typeName: 'stream_if',
    ports: [
      port('interface_inst', 'clk', 'input'),
      port('interface_inst', 'ready', 'output'),
      port('interface_inst', 'master', 'inout', { width: 'interface', preferredSide: 'left', modportName: 'master' }),
      port('interface_inst', 'slave', 'inout', { width: 'interface', preferredSide: 'right', modportName: 'slave' })
    ]
  },
  {
    key: 'interface_modport',
    kind: 'interface',
    label: 'master',
    role: 'modport',
    typeName: 'stream_if',
    ports: [
      port('interface_modport', 'req', 'input'),
      port('interface_modport', 'rsp', 'output'),
      port('interface_modport', 'bus', 'inout', { width: 'interface', modportName: 'slave' })
    ]
  },
  {
    key: 'net_label',
    kind: 'netLabel',
    label: 'cut_net',
    ports: [],
    metadata: { cutNet: { netKey: 'cut_net', role: 'source', align: 'start', handleSide: 'right' } }
  },
  { key: 'array_port', kind: 'port', label: 'port[]', ports: [port('array_port', 'p', 'input')], isArrayNode: true, arrayDimension: '[3:0]' },
  { key: 'array_comb', kind: 'comb', label: 'comb[]', isArrayNode: true, arrayDimension: '[3:0]' },
  {
    key: 'array_register',
    kind: 'register',
    label: 'reg[]',
    ports: [port('array_register', 'D', 'input'), port('array_register', 'clk', 'input'), port('array_register', 'Q', 'output')],
    isArrayNode: true,
    arrayDimension: '[3:0]',
    metadata: { clockSignal: 'clk' }
  },
  {
    key: 'array_mux',
    kind: 'mux',
    label: 'mux[]',
    ports: [port('array_mux', 'sel', 'input'), port('array_mux', 'a', 'input'), port('array_mux', 'b', 'input'), port('array_mux', 'y', 'output')],
    isArrayNode: true,
    arrayDimension: '[3:0]'
  },
  { key: 'array_instance', kind: 'instance', label: 'inst[]', instanceOf: 'sub', isArrayNode: true, arrayDimension: '[3:0]' },
  {
    key: 'array_bus',
    kind: 'bus',
    label: 'bus[]',
    ports: [port('array_bus', 'a', 'input'), port('array_bus', 'b', 'input'), port('array_bus', 'out', 'output')],
    isArrayNode: true,
    arrayDimension: '[3:0]',
    metadata: { aggregateKind: 'array' }
  },
  { key: 'array_literal', kind: 'literal', label: "8'hAA", ports: [port('array_literal', 'y', 'output')], isArrayNode: true, arrayDimension: '[3:0]' },
  {
    key: 'array_replicate',
    kind: 'replicate',
    label: 'x N[]',
    repeatExpression: 'N',
    ports: [port('array_replicate', 'a', 'input'), port('array_replicate', 'y', 'output')],
    isArrayNode: true,
    arrayDimension: '[3:0]'
  }
];

// A grid of unconnected blocks (one per kind) plus a generate arm, all forced into
// the error state, so the snapshot locks in the shared error highlight per block type.
function errorHighlightGridView(): DiagramViewModel {
  const cols = 5;
  const cellX = 270;
  const cellY = 210;
  const originX = 80;
  const originY = 80;

  const nodes = ERROR_BLOCK_VARIANTS.map((variant, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return errorBlock(variant, originX + col * cellX, originY + row * cellY);
  });

  // A real owned block inside the arm — it belongs to the arm, so it stays
  // un-highlighted, and it keeps the arm inside the fitted view for the snapshot.
  const armY = originY + Math.ceil(ERROR_BLOCK_VARIANTS.length / cols) * cellY;
  const ownedBlock = errorBlock({ key: 'arm_owned', kind: 'comb', label: 'owned' }, originX + 24, armY + 44);
  ownedBlock.id = 'err_arm_owned';
  ownedBlock.label = 'owned';
  delete (ownedBlock as { invalid?: boolean }).invalid;
  delete (ownedBlock as { warningNote?: string }).warningNote;
  nodes.push(ownedBlock);

  const generateRegions: NonNullable<DiagramViewModel['generateRegions']> = [
    {
      id: 'region:g_error',
      kind: 'if',
      label: 'g_error /* MODE == 0 */',
      blockLabel: 'g_error',
      condition: 'MODE == 0',
      activeState: 'active',
      nodeIds: ['err_arm_owned'],
      bounds: { x: originX, y: armY, width: cellX * 2 - 40, height: cellY - 20 },
      invalid: true,
      warningNote: 'node does not belong to arm block'
    }
  ];

  return {
    moduleName: 'error_highlight_grid',
    nodes,
    edges: [],
    generateRegions,
    diagnostics: []
  } as DiagramViewModel;
}

function errorBlock(variant: ErrorBlockVariant, x: number, y: number): DiagramViewModel['nodes'][number] {
  const metadata = {
    ...(variant.metadata ?? {}),
    ...(variant.isArrayNode ? { isArrayNode: true, arrayDimension: variant.arrayDimension } : {})
  };
  return {
    id: `err_${variant.key}`,
    kind: variant.kind,
    label: variant.label,
    instanceOf: variant.instanceOf,
    role: variant.role,
    typeName: variant.typeName,
    modportName: variant.modportName,
    repeatExpression: variant.repeatExpression,
    ports: variant.ports ?? defaultPorts(variant.key),
    position: { x, y },
    isArrayNode: variant.isArrayNode,
    arrayDimension: variant.arrayDimension,
    metadata,
    operation: variant.operation,
    invalid: true,
    warningNote: GENERATE_REGION_EXTERNAL_BLOCK_WARNING
  } as unknown as DiagramViewModel['nodes'][number];
}

function defaultPorts(key: string): DiagramViewModel['nodes'][number]['ports'] {
  return [
    port(key, 'a', 'input'),
    port(key, 'b', 'input'),
    port(key, 'y', 'output')
  ];
}

function port(
  key: string,
  name: string,
  direction: 'input' | 'output' | 'inout' | 'unknown',
  extra: Partial<DiagramViewModel['nodes'][number]['ports'][number]> = {}
): DiagramViewModel['nodes'][number]['ports'][number] {
  return {
    id: `${key}:${name}`,
    name,
    direction,
    ...extra
  };
}

function generateWarningView(options: { includeSecondRegion: boolean; includeExternalNode: boolean }): DiagramViewModel {
  const nodes: DiagramViewModel['nodes'] = [
    {
      id: 'node:warn:a',
      kind: 'comb',
      label: 'owned_a',
      ports: [],
      position: { x: 80, y: 80 }
    }
  ];

  const generateRegions: NonNullable<DiagramViewModel['generateRegions']> = [
    {
      id: 'region:g_warn_zero',
      kind: 'if',
      label: 'g_warn_zero /* MODE == 0 */',
      blockLabel: 'g_warn_zero',
      condition: 'MODE == 0',
      activeState: 'active',
      nodeIds: ['node:warn:a'],
      bounds: { x: 48, y: 48, width: 240, height: 160 }
    }
  ];

  if (options.includeSecondRegion) {
    nodes.push({
      id: 'node:warn:b',
      kind: 'comb',
      label: 'owned_b',
      ports: [],
      position: { x: 360, y: 80 }
    });
    generateRegions.push({
      id: 'region:g_warn_one',
      kind: 'else-if',
      label: 'g_warn_one /* MODE == 1 */',
      blockLabel: 'g_warn_one',
      condition: 'MODE == 1',
      activeState: 'inactive',
      nodeIds: ['node:warn:b'],
      bounds: { x: 328, y: 48, width: 240, height: 160 }
    });
  }

  if (options.includeExternalNode) {
    nodes.push({
      id: 'node:warn:external',
      kind: 'comb',
      label: 'external',
      ports: [],
      position: { x: 360, y: 80 }
    });
  }

  return {
    moduleName: 'generate_region_warning_visual',
    nodes,
    edges: [],
    generateRegions,
    diagnostics: []
  };
}

type RenderedRegionState = { bounds: RegionBounds; invalid: boolean; warningNote?: string };

async function viewWithRenderedGenerateRegionBounds(page: Page, view: DiagramViewModel): Promise<DiagramViewModel> {
  const stateById: Record<string, RenderedRegionState> = await page.locator('.generate-region').evaluateAll((elements): Record<string, RenderedRegionState> => {
    return Object.fromEntries(elements.map((element) => {
      const html = element as HTMLElement;
      return [html.dataset.regionId ?? '', {
        bounds: {
          x: Number.parseFloat(html.style.left || '0'),
          y: Number.parseFloat(html.style.top || '0'),
          width: Number.parseFloat(html.style.width || '0'),
          height: Number.parseFloat(html.style.height || '0')
        },
        invalid: html.classList.contains('generate-region-invalid'),
        warningNote: html.dataset.warningNote || undefined
      }];
    }).filter(([id]) => id));
  });

  // Dragging a region also moves its owned nodes, so capture the live node
  // positions too — otherwise the SVG (rendered from this view) would draw nodes
  // at their pre-drag spots while the webview screenshot shows the dragged ones.
  const nodePositions: Record<string, { x: number; y: number }> = await page.evaluate(() => {
    const rf = (window as { reactFlowInstance?: { getNodes(): Array<{ id: string; position: { x: number; y: number } }> } }).reactFlowInstance;
    if (!rf) return {};
    return Object.fromEntries(rf.getNodes().map((node) => [node.id, { x: node.position.x, y: node.position.y }]));
  });

  const invalidNodeStateById: Record<string, { warningNote?: string }> = await page.locator('.react-flow__node.svsch-node-invalid').evaluateAll(
    (elements) => Object.fromEntries(elements.map((element) => {
      const html = element as HTMLElement;
      const id = html.dataset.id ?? '';
      const warningNote = html.querySelector('.node-warning')?.getAttribute('aria-label') ?? undefined;
      return [id, { warningNote }];
    }).filter(([id]) => id))
  );

  return {
    ...view,
    nodes: view.nodes.map((node) => {
      const position = nodePositions[node.id];
      const invalidState = invalidNodeStateById[node.id];
      const invalid = Boolean(invalidState) || undefined;
      if (!position && !invalid) return node;
      return {
        ...node,
        ...(position ? { position } : {}),
        invalid,
        warningNote: invalidState?.warningNote
      };
    }),
    generateRegions: view.generateRegions?.map((region) => {
      const state = stateById[region.id];
      if (!state) return region;
      return {
        ...region,
        bounds: state.bounds,
        invalid: state.invalid || undefined,
        warningNote: state.warningNote
      };
    })
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
