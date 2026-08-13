import { expect, test, type Locator } from '@playwright/test';
import type { DiagramViewModel } from '../../src/ir/types';
import { expectGraphAndScreenshot, openFixture, openView, paddedGraphClip } from './helper';

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

    await expectDualHandle(boundary, 'port:external_bus', 'right');
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
});

async function expectDualHandle(node: Locator, portId: string, side: 'left' | 'right'): Promise<void> {
  const handles = node.locator(`.react-flow__handle[data-handleid="${portId}"]`);
  await expect(handles).toHaveCount(2);
  await expect(node.locator(`.react-flow__handle.source[data-handleid="${portId}"]`)).toHaveCount(1);
  await expect(node.locator(`.react-flow__handle.target[data-handleid="${portId}"]`)).toHaveCount(1);
  await expect(handles).toHaveClass([new RegExp(`react-flow__handle-${side}`), new RegExp(`react-flow__handle-${side}`)]);
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
