import { expect, test, type Locator } from '@playwright/test';
import type { DiagramViewModel } from '../../src/ir/types';
import { expectGraphAndScreenshot, fitGraphView, openFixture, openView, paddedAllNodesClip, paddedGraphClip } from './helper';

test.describe('inout port rendering', () => {
  test('renders boundary and instance inout ports as bidirectional', async ({ page }) => {
    const view = await openFixture(page, 'inout_ports.sv', 'auto', 'inout_ports');
    const boundary = page.locator('[data-node-id="port:inout_ports:external_bus"]');
    const instance = page.locator('[data-node-id="instance:inout_ports:u_leaf"]');

    await expect(boundary).toHaveClass(/hdl-port-inout/);
    await expect(boundary).toHaveClass(/hdl-port-skinned/);
    await expect(boundary.locator('.port-skin-inout')).toBeVisible();
    await expect(boundary.locator('.port-skin-body')).toHaveAttribute(
      'd',
      /^M 12 0 H \d+ L \d+ 12 L \d+ 24 H 12 L 0 12 Z$/
    );

    const inoutStroke = await boundary.locator('.port-skin-body').evaluate((element) => getComputedStyle(element).stroke);
    const inputStroke = await page.locator('[data-node-id="port:inout_ports:output_enable"] .port-skin-body').evaluate((element) => getComputedStyle(element).stroke);
    expect(inoutStroke).not.toBe(inputStroke);

    // A boundary inout port's hexagonal skin has two distinct attach points:
    // driving edges land on the left notch, edges reading the net leave from
    // the right point — unlike an ordinary node's inout, which stays on one
    // physical pin (see portDirection.ts).
    await expectDualHandle(boundary, 'port:external_bus', { target: 'left', source: 'right' });
    await expectDualHandle(instance, 'port:io', 'left');

    expect(view.nodes.find((node) => node.id === 'port:inout_ports:external_bus')?.ports[0]?.direction).toBe('inout');
    expect(view.nodes.find((node) => node.id === 'instance:inout_ports:u_leaf')?.ports.find((port) => port.id === 'port:io')?.direction).toBe('inout');

    await expectGraphAndScreenshot(page, 'inout-ports-canvas.png', { clip: await paddedGraphClip(page) });
  });

  test('gives internal inout pins source and target handles on one physical side', async ({ page }) => {
    await openView(page, internalInoutView());

    await expectDualHandle(page.locator('[data-node-id="comb"]'), 'io', 'left');
    await expectDualHandle(page.locator('[data-node-id="bus"]'), 'io', 'left');
    await expectDualHandle(page.locator('[data-node-id="struct"]'), 'io', 'left');
    await expectDualHandle(page.locator('[data-node-id="interface"]'), 'io', 'left');
  });

  test('renders an I2C open-drain SDA line as a real-world inout usecase', async ({ page }) => {
    const view = await openFixture(page, 'i2c_master_sda_example.sv', 'auto', 'i2c_master_sda_example');
    const sda = page.locator('[data-node-id="port:i2c_master_sda_example:sda"]');

    await expect(sda).toHaveClass(/hdl-port-inout/);
    await expect(sda.locator('.port-skin-inout')).toBeVisible();

    expect(view.nodes.find((node) => node.id === 'port:i2c_master_sda_example:sda')?.ports[0]?.direction).toBe('inout');

    await expectGraphAndScreenshot(page, 'i2c-master-sda-canvas.png', { clip: await paddedAllNodesClip(page) });
  });

  test('routes a mux into a multi-bit boundary inout port with no overlap, same as the scalar case', async ({ page }) => {
    const view = await openFixture(page, 'inout_mux_array.sv', 'auto', 'inout_mux_array');
    const boundary = page.locator('[data-node-id="port:inout_mux_array:a"]');

    await expect(boundary).toHaveClass(/hdl-port-inout/);
    await expectDualHandle(boundary, 'port:a', { target: 'left', source: 'right' });

    expect(view.nodes.find((node) => node.id === 'port:inout_mux_array:a')?.ports[0]?.direction).toBe('inout');
    expect(view.edges.filter((edge) => edge.target === 'port:inout_mux_array:a' || edge.source === 'port:inout_mux_array:a')).toHaveLength(2);

    await expectGraphAndScreenshot(page, 'inout-mux-array-canvas.png', { clip: await paddedGraphClip(page) });
  });

  test('routes an unpacked-array boundary inout port as a single hub edge, not a duplicate from the array composition', async ({ page }) => {
    const view = await openFixture(page, 'inout_array_alias.sv', 'auto', 'inout_array_alias');
    await fitGraphView(page, 0.2);
    const boundary = page.locator('[data-node-id="port:inout_array_alias:a"]');

    await expect(boundary).toHaveClass(/hdl-port-inout/);
    await expectDualHandle(boundary, 'port:a', { target: 'left', source: 'right' });

    // Regression coverage for the array-composition alias bug (see
    // InoutArrayAliasProducesSingleEdgeIntoReader in test_main.cpp): the
    // per-element mux drives should combine through the boundary port hub,
    // not pair a second time directly with `y` via the array-composition
    // node — which used to render as two overlapping wires.
    const edgesIntoY = view.edges.filter((edge) => edge.target === 'port:inout_array_alias:y');
    expect(edgesIntoY).toHaveLength(1);
    expect(edgesIntoY[0]?.source).toBe('port:inout_array_alias:a');

    await expectGraphAndScreenshot(page, 'inout-array-alias-canvas.png', { clip: await paddedAllNodesClip(page) });
  });
});

async function expectDualHandle(
  node: Locator,
  portId: string,
  side: 'left' | 'right' | { target: 'left' | 'right'; source: 'left' | 'right' }
): Promise<void> {
  const targetSide = typeof side === 'string' ? side : side.target;
  const sourceSide = typeof side === 'string' ? side : side.source;
  const handles = node.locator(`.react-flow__handle[data-handleid="${portId}"]`);
  await expect(handles).toHaveCount(2);
  const targetHandle = node.locator(`.react-flow__handle.target[data-handleid="${portId}"]`);
  const sourceHandle = node.locator(`.react-flow__handle.source[data-handleid="${portId}"]`);
  await expect(targetHandle).toHaveCount(1);
  await expect(sourceHandle).toHaveCount(1);
  await expect(targetHandle).toHaveClass(new RegExp(`react-flow__handle-${targetSide}`));
  await expect(sourceHandle).toHaveClass(new RegExp(`react-flow__handle-${sourceSide}`));
}

function internalInoutView(): DiagramViewModel {
  return {
    moduleName: 'internal_inout',
    nodes: [
      {
        id: 'comb',
        kind: 'comb',
        label: 'comb',
        ports: [
          { id: 'io', name: 'io', direction: 'inout' },
          { id: 'y', name: 'y', direction: 'output' }
        ],
        position: { x: 24, y: 24 }
      },
      {
        id: 'bus',
        kind: 'bus',
        label: 'bus',
        ports: [
          { id: 'io', name: 'io', direction: 'inout' },
          { id: 'lo', name: 'lo', direction: 'output' },
          { id: 'hi', name: 'hi', direction: 'output' }
        ],
        position: { x: 240, y: 24 }
      },
      {
        id: 'struct',
        kind: 'struct',
        label: 'packet',
        ports: [
          { id: 'io', name: 'io', direction: 'inout' },
          { id: 'field', name: 'field', direction: 'output' }
        ],
        metadata: { role: 'breakout' },
        position: { x: 432, y: 24 }
      },
      {
        id: 'interface',
        kind: 'interface',
        label: 'link',
        ports: [
          { id: 'io', name: 'io', direction: 'inout', preferredSide: 'left' }
        ],
        metadata: { role: 'instance', typeName: 'link_if' },
        position: { x: 624, y: 24 }
      }
    ],
    edges: [],
    diagnostics: []
  };
}
