import { test, expect } from '@playwright/test';
import { openView, expectGraphAndScreenshot, paddedAllNodesClip, waitForViewportTransformToSettle } from './helper';
import type { DiagramViewModel } from '../../src/ir/types';

function visualPort(
  id: string,
  label: string,
  direction: 'input' | 'output',
  x: number,
  y: number,
  isArray = false,
  width?: string
): DiagramViewModel['nodes'][number] {
  return {
    id,
    kind: 'port',
    label,
    ports: [{
      id: 'p',
      name: label,
      direction,
      width,
      isArrayNode: isArray,
      arrayDimension: isArray ? '[3:0]' : undefined
    }],
    position: { x, y },
    isArrayNode: isArray,
    metadata: isArray ? { isArrayNode: true, arrayDimension: '[3:0]' } : undefined
  };
}

// The wire-style matrix: every style crosses every other style in both grids.
// multiBit entries carry [7:0] so the thick / wide-stack styling engages.
const WIRE_SPECS = [
  { name: 'reg', isStacked: false, isStruct: false, isInterface: false, isMultiBit: false },
  { name: 'mbit', isStacked: false, isStruct: false, isInterface: false, isMultiBit: true },
  { name: 'str', isStacked: false, isStruct: true, isInterface: false, isMultiBit: false },
  { name: 'int', isStacked: false, isStruct: false, isInterface: true, isMultiBit: false },
  { name: 'stk', isStacked: true, isStruct: false, isInterface: false, isMultiBit: false },
  { name: 'wstk', isStacked: true, isStruct: false, isInterface: false, isMultiBit: true }
] as const;

type WireSpec = (typeof WIRE_SPECS)[number];

function edgeWidth(spec: WireSpec): string | undefined {
  return spec.isMultiBit ? '[7:0]' : undefined;
}

function aggregateMetadata(spec: WireSpec): { aggregate?: string } {
  return spec.isStruct ? { aggregate: 'struct' } : spec.isInterface ? { aggregate: 'interface' } : {};
}

function createCrossProductView(): DiagramViewModel {
  const nodes: DiagramViewModel['nodes'] = [];
  const edges: DiagramViewModel['edges'] = [];

  // Two grids: in grid 1 the horizontal wires jump (their IDs sort after the
  // vertical ones); in grid 2 the vertical wires jump. Each grid crosses all
  // six wire styles in both orientations.
  //
  // Horizontal wires: Y centers at 96px steps; handles land on grid lines at
  // Y center + 12. Vertical wires: X centers at 96px steps with the backbone
  // at X center + 48, staggered start/end so labels do not overlap.
  const buildGrid = (baseX: number, horizontalPrefix: string, verticalPrefix: string) => {
    WIRE_SPECS.forEach((spec, i) => {
      const yNode = 108 + i * 96;
      const yHandle = yNode + 12;
      nodes.push(visualPort(`${horizontalPrefix}_${spec.name}_src`, `${spec.name}_src`, 'input', baseX - 144, yNode, spec.isStacked, edgeWidth(spec)));
      nodes.push(visualPort(`${horizontalPrefix}_${spec.name}_tgt`, `${spec.name}_tgt`, 'output', baseX + 696, yNode, spec.isStacked, edgeWidth(spec)));
      edges.push({
        id: `${horizontalPrefix}_${spec.name}`,
        source: `${horizontalPrefix}_${spec.name}_src`,
        target: `${horizontalPrefix}_${spec.name}_tgt`,
        sourcePort: 'p',
        targetPort: 'p',
        routePoints: [
          { x: baseX + 120, y: yHandle },
          { x: baseX + 696, y: yHandle }
        ],
        isStacked: spec.isStacked,
        width: edgeWidth(spec),
        metadata: aggregateMetadata(spec)
      });
    });

    WIRE_SPECS.forEach((spec, i) => {
      const xCenter = baseX + 24 + i * 96;
      const srcHandleY = -192 + i * 48;
      const tgtHandleY = 912 - i * 48;
      // Wide stacks exit with longer leads: give the source an extra grid of
      // horizontal room so the lead-to-lane connection stays orthogonal.
      const srcX = xCenter - (spec.isStacked && spec.isMultiBit ? 144 : 120);
      nodes.push(visualPort(`${verticalPrefix}_${spec.name}_src`, `${spec.name}_src`, 'input', srcX, srcHandleY - 12, spec.isStacked, edgeWidth(spec)));
      nodes.push(visualPort(`${verticalPrefix}_${spec.name}_tgt`, `${spec.name}_tgt`, 'output', xCenter + 96, tgtHandleY - 12, spec.isStacked, edgeWidth(spec)));
      edges.push({
        id: `${verticalPrefix}_${spec.name}`,
        source: `${verticalPrefix}_${spec.name}_src`,
        target: `${verticalPrefix}_${spec.name}_tgt`,
        sourcePort: 'p',
        targetPort: 'p',
        routePoints: [
          { x: xCenter + 48, y: srcHandleY },
          { x: xCenter + 48, y: srcHandleY },
          { x: xCenter + 48, y: tgtHandleY },
          { x: xCenter + 48, y: tgtHandleY }
        ],
        isStacked: spec.isStacked,
        width: edgeWidth(spec),
        metadata: {
          ...aggregateMetadata(spec),
          forceStraight: true
        }
      });
    });
  };

  // GRID 1: horizontal wires jump (horizontal IDs sort after vertical IDs).
  buildGrid(0, 'z_h1', 'a_v1');
  // GRID 2: vertical wires jump (vertical IDs sort after horizontal IDs).
  buildGrid(1104, 'a_h2', 'z_v2');

  return {
    moduleName: 'intersection_cross_product_visual',
    nodes,
    edges,
    diagnostics: []
  };
}

test.describe('Wire Intersections Cross Product', () => {
  test('renders all wire types crossing combinations in both directions', async ({ page }) => {
    await page.setViewportSize({ width: 4200, height: 3200 });
    await openView(page, createCrossProductView());
    // Wait for one of the target port nodes to mount.
    await page.waitForSelector('[data-node-id="z_h1_reg_src"]', { state: 'attached' });
    await waitForViewportTransformToSettle(page);

    // Path count per orientation per grid: reg 1 + mbit 1 + str 2 (bg + stripes)
    // + int 2 (bg + stripes) + stk 3 (lanes) + wstk 3 (lanes) = 12.
    // Two orientations x two grids = 48 total.
    await expect(page.locator('.svsch-edge')).toHaveCount(48);

    // Check that we have a screenshot of the crossings
    await expectGraphAndScreenshot(page, 'wire-intersections-crossing-grid.png', {
      clip: await paddedAllNodesClip(page)
    });
  });
});
