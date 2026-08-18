import { expect, test } from '@playwright/test';
import { expectGraphAndScreenshot, openFixture, paddedGraphClip } from './helper';

test.describe('parameterized bus width resolution visual rendering', () => {
  test('resolves a bus breakout into taps sized from a parameterized input width', async ({ page }) => {
    const view = await openFixture(page, 'param_bus_widths.sv', 'bus', 'param_bus_breakout');

    const breakout = view.nodes.find(node => node.kind === 'bus' && node.label === 'data_i');
    expect(breakout).toBeDefined();
    expect(breakout?.ports.filter(port => port.direction === 'output').map(port => [port.label, port.width])).toEqual([
      ['[7:4]', '[3:0]'],
      ['[3:0]', '[3:0]']
    ]);

    const breakoutNode = page.locator('.hdl-bus-breakout');
    await expect(breakoutNode).toBeVisible();
    await expect(breakoutNode.locator('.svsch-bus-tap')).toHaveCount(2);
    await expect(breakoutNode.locator('.svsch-bus-tap-label', { hasText: '[7:4]' })).toBeVisible();
    await expect(breakoutNode.locator('.svsch-bus-tap-label', { hasText: '[3:0]' })).toBeVisible();

    await expectGraphAndScreenshot(page, 'param-bus-breakout-canvas.png', { clip: await paddedGraphClip(page) });
  });

  test('resolves a bus composition whose replication count is a parameter expression', async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 1000 });
    const view = await openFixture(page, 'param_bus_widths.sv', 'auto', 'param_bus_composition');

    const composition = view.nodes.find(node => node.kind === 'bus' && node.metadata?.role === undefined && node.ports.some(port => port.direction === 'output' && port.label === 'imm'));
    const replicate = view.nodes.find(node => node.kind === 'replicate');

    expect(composition).toBeDefined();
    expect(composition?.ports.find(port => port.direction === 'output')).toMatchObject({ width: '[7:0]' });
    expect(composition?.ports.filter(port => port.direction === 'input').map(port => [port.label, port.width])).toEqual([
      ['[7:4]', '[3:0]'],
      ['[3:0]', '[3:0]']
    ]);

    expect(replicate).toBeDefined();
    expect(replicate?.metadata?.repeatCount).toBe(4);
    expect(replicate?.metadata?.repeatExpression).toBe('DATA_WIDTH - 4');
    expect(replicate?.ports.find(port => port.direction === 'output')?.width).toBe('[3:0]');

    await expect(page.locator('.hdl-bus-composition')).toBeVisible();
    await expect(page.locator('[data-node-kind="replicate"]')).toContainText('DATA_WIDTH - 4');

    await expectGraphAndScreenshot(page, 'param-bus-composition-canvas.png', { clip: await paddedGraphClip(page) });
  });

  test('resolves a bus breakout on an interface field sized from an instance-overridden parameter', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const view = await openFixture(page, 'param_bus_widths.sv', 'auto', 'param_status_sink');

    const breakout = view.nodes.find(node => node.kind === 'bus' && node.label === 'level');
    expect(breakout).toBeDefined();
    expect(breakout?.ports.filter(port => port.direction === 'output').map(port => [port.label, port.width])).toEqual([
      ['[15:8]', '[7:0]'],
      ['[7:0]', '[7:0]']
    ]);

    const modport = page.locator('[data-node-id="interface_modport:param_status_sink:bus"]');
    await expect(modport).toBeVisible();
    await expect(modport.locator('.svsch-interface-field-label', { hasText: 'level' })).toBeVisible();

    const breakoutNode = page.locator('[data-node-id="bus:param_status_sink:level"]');
    await expect(breakoutNode).toBeVisible();
    await expect(breakoutNode.locator('.svsch-bus-tap-label', { hasText: '[15:8]' })).toBeVisible();
    await expect(breakoutNode.locator('.svsch-bus-tap-label', { hasText: '[7:0]' }).first()).toBeVisible();

    await expectGraphAndScreenshot(page, 'param-bus-interface-breakout-canvas.png', { clip: await paddedGraphClip(page) });
  });
});
