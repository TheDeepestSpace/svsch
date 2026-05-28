import { test, expect } from '@playwright/test';
import { openView, expectGraphAndScreenshot, paddedAllNodesClip, waitForViewportTransformToSettle } from './helper';
import type { DiagramViewModel } from '../../src/ir/types';

function visualPort(
  id: string,
  label: string,
  direction: 'input' | 'output',
  x: number,
  y: number,
  isArray = false
): DiagramViewModel['nodes'][number] {
  return {
    id,
    kind: 'port',
    label,
    ports: [{
      id: 'p',
      name: label,
      direction,
      isArrayNode: isArray,
      arrayDimension: isArray ? '[3:0]' : undefined
    }],
    position: { x, y },
    isArrayNode: isArray,
    metadata: isArray ? { isArrayNode: true, arrayDimension: '[3:0]' } : undefined
  };
}

function createCrossProductView(): DiagramViewModel {
  const nodes: DiagramViewModel['nodes'] = [];
  const edges: DiagramViewModel['edges'] = [];

  // GRID 1: Horizontal Jumps (Horizontal IDs are lexicographically larger than Vertical IDs)
  // Horizontal wires: Y centers 108, 204, 300, 396.
  // Port Y positions are placed exactly at Y centers so that their handles are at Y_center + 12 (which is 120, 216, 312, 408).
  const g1HYs = [108, 204, 300, 396];
  const g1HSpecs = [
    { name: 'reg', isStacked: false, isStruct: false, isInterface: false },
    { name: 'str', isStacked: false, isStruct: true, isInterface: false },
    { name: 'int', isStacked: false, isStruct: false, isInterface: true },
    { name: 'stk', isStacked: true, isStruct: false, isInterface: false }
  ];

  g1HSpecs.forEach((spec, i) => {
    const yNode = g1HYs[i]; // 108, 204, 300, 396 (grid centers)
    const yHandle = yNode + 12; // 120, 216, 312, 408 (grid lines)
    nodes.push(visualPort(`g1_h_${spec.name}_src`, `${spec.name}_src`, 'input', -144, yNode, spec.isStacked));
    nodes.push(visualPort(`g1_h_${spec.name}_tgt`, `${spec.name}_tgt`, 'output', 504, yNode, spec.isStacked));
    edges.push({
      id: `z_h1_${spec.name}`,
      source: `g1_h_${spec.name}_src`,
      target: `g1_h_${spec.name}_tgt`,
      sourcePort: 'p',
      targetPort: 'p',
      routePoints: [
        { x: 120, y: yHandle },
        { x: 504, y: yHandle }
      ],
      isStacked: spec.isStacked,
      metadata: spec.isStruct ? { aggregate: 'struct' } : spec.isInterface ? { aggregate: 'interface' } : undefined
    });
  });

  // Vertical wires: X centers 24, 120, 216, 312 (shifted 5 grid widths left from original)
  // src (input) tip at xCenter, tgt (output) tip at xCenter+96, backbone at xCenter+48 (2 grid leading each side).
  // Port Y positions are placed exactly offset by 12 (grid centers) so their handles align perfectly at multiples of 24 (grid lines).
  const g1VXs = [24, 120, 216, 312];
  const g1VYStaggers = [
    { srcY: -204, tgtY: 612, srcHandleY: -192, tgtHandleY: 624 },
    { srcY: -156, tgtY: 564, srcHandleY: -144, tgtHandleY: 576 },
    { srcY: -108, tgtY: 516, srcHandleY: -96, tgtHandleY: 528 },
    { srcY: -60, tgtY: 468, srcHandleY: -48, tgtHandleY: 480 }
  ];
  const g1VSpecs = [
    { name: 'reg', isStacked: false, isStruct: false, isInterface: false },
    { name: 'str', isStacked: false, isStruct: true, isInterface: false },
    { name: 'int', isStacked: false, isStruct: false, isInterface: true },
    { name: 'stk', isStacked: true, isStruct: false, isInterface: false }
  ];

  g1VSpecs.forEach((spec, i) => {
    const xCenter = g1VXs[i];
    const stagger = g1VYStaggers[i];
    nodes.push(visualPort(`g1_v_${spec.name}_src`, `${spec.name}_src`, 'input', xCenter - 120, stagger.srcY, spec.isStacked));
    nodes.push(visualPort(`g1_v_${spec.name}_tgt`, `${spec.name}_tgt`, 'output', xCenter + 96, stagger.tgtY, spec.isStacked));
    edges.push({
      id: `a_v1_${spec.name}`,
      source: `g1_v_${spec.name}_src`,
      target: `g1_v_${spec.name}_tgt`,
      sourcePort: 'p',
      targetPort: 'p',
      routePoints: [
        { x: xCenter + 48, y: stagger.srcHandleY },
        { x: xCenter + 48, y: stagger.srcHandleY },
        { x: xCenter + 48, y: stagger.tgtHandleY },
        { x: xCenter + 48, y: stagger.tgtHandleY }
      ],
      isStacked: spec.isStacked,
      metadata: {
        ...(spec.isStruct ? { aggregate: 'struct' } : spec.isInterface ? { aggregate: 'interface' } : {}),
        forceStraight: true
      }
    });
  });

  // GRID 2: Vertical Jumps (Vertical IDs are lexicographically larger than Horizontal IDs)
  // Horizontal wires: Y centers 108, 204, 300, 396
  const g2HYs = [108, 204, 300, 396];
  const g2HSpecs = [
    { name: 'reg', isStacked: false, isStruct: false, isInterface: false },
    { name: 'str', isStacked: false, isStruct: true, isInterface: false },
    { name: 'int', isStacked: false, isStruct: false, isInterface: true },
    { name: 'stk', isStacked: true, isStruct: false, isInterface: false }
  ];

  g2HSpecs.forEach((spec, i) => {
    const yNode = g2HYs[i]; // grid centers
    const yHandle = yNode + 12; // grid lines
    nodes.push(visualPort(`g2_h_${spec.name}_src`, `${spec.name}_src`, 'input', 672, yNode, spec.isStacked));
    nodes.push(visualPort(`g2_h_${spec.name}_tgt`, `${spec.name}_tgt`, 'output', 1200, yNode, spec.isStacked));
    edges.push({
      id: `a_h2_${spec.name}`,
      source: `g2_h_${spec.name}_src`,
      target: `g2_h_${spec.name}_tgt`,
      sourcePort: 'p',
      targetPort: 'p',
      routePoints: [
        { x: 816, y: yHandle },
        { x: 1200, y: yHandle }
      ],
      isStacked: spec.isStacked,
      metadata: spec.isStruct ? { aggregate: 'struct' } : spec.isInterface ? { aggregate: 'interface' } : undefined
    });
  });

  // Vertical wires: X centers 768, 864, 960, 1056 (shifted 3 grid widths left; g2 horizontal span starts at x=792 so max shift is 3)
  const g2VXs = [768, 864, 960, 1056];
  const g2VYStaggers = [
    { srcY: -204, tgtY: 612, srcHandleY: -192, tgtHandleY: 624 },
    { srcY: -156, tgtY: 564, srcHandleY: -144, tgtHandleY: 576 },
    { srcY: -108, tgtY: 516, srcHandleY: -96, tgtHandleY: 528 },
    { srcY: -60, tgtY: 468, srcHandleY: -48, tgtHandleY: 480 }
  ];
  const g2VSpecs = [
    { name: 'reg', isStacked: false, isStruct: false, isInterface: false },
    { name: 'str', isStacked: false, isStruct: true, isInterface: false },
    { name: 'int', isStacked: false, isStruct: false, isInterface: true },
    { name: 'stk', isStacked: true, isStruct: false, isInterface: false }
  ];

  g2VSpecs.forEach((spec, i) => {
    const xCenter = g2VXs[i];
    const stagger = g2VYStaggers[i];
    nodes.push(visualPort(`g2_v_${spec.name}_src`, `${spec.name}_src`, 'input', xCenter - 120, stagger.srcY, spec.isStacked));
    nodes.push(visualPort(`g2_v_${spec.name}_tgt`, `${spec.name}_tgt`, 'output', xCenter + 96, stagger.tgtY, spec.isStacked));
    edges.push({
      id: `z_v2_${spec.name}`,
      source: `g2_v_${spec.name}_src`,
      target: `g2_v_${spec.name}_tgt`,
      sourcePort: 'p',
      targetPort: 'p',
      routePoints: [
        { x: xCenter + 48, y: stagger.srcHandleY },
        { x: xCenter + 48, y: stagger.srcHandleY },
        { x: xCenter + 48, y: stagger.tgtHandleY },
        { x: xCenter + 48, y: stagger.tgtHandleY }
      ],
      isStacked: spec.isStacked,
      metadata: {
        ...(spec.isStruct ? { aggregate: 'struct' } : spec.isInterface ? { aggregate: 'interface' } : {}),
        forceStraight: true
      }
    });
  });

  return {
    moduleName: 'intersection_cross_product_visual',
    nodes,
    edges,
    diagnostics: []
  };
}

test.describe('Wire Intersections Cross Product', () => {
  test('renders all wire types crossing combinations in both directions', async ({ page }) => {
    await page.setViewportSize({ width: 3200, height: 2800 });
    await openView(page, createCrossProductView());
    // Wait for one of the target port nodes to be visible
    await page.waitForSelector('[data-node-id="g1_h_reg_src"]');
    await waitForViewportTransformToSettle(page);

    // Verify that edges are rendered (4 regular/struct * 1 path + 2 interface * 2 paths + 2 stacked * 3 paths = 14 paths per grid, 28 total)
    await expect(page.locator('.svsch-edge')).toHaveCount(28);
    
    // Check that we have a screenshot of the crossings
    await expectGraphAndScreenshot(page, 'wire-intersections-crossing-grid.png', {
      clip: await paddedAllNodesClip(page)
    });
  });
});
