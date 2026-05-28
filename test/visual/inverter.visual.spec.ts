import { expect, test } from '@playwright/test';
import { expectGraphAndScreenshot, openFixture, paddedGraphClip } from './helper';

test.describe('inverter visual rendering', () => {
  test('renders scalar and vector bitwise inversion as inverter gates', async ({ page }) => {
    const view = await openFixture(page, 'inverter_expr.sv', 'inverter');

    const inverters = view.nodes.filter((node) => node.kind === 'inverter');
    expect(inverters).toHaveLength(3);
    expect(view.nodes.some((node) => node.kind === 'comb')).toBe(false);
    expect(inverters.some((node) => node.ports.some((port) => port.width === '[3:0]'))).toBe(true);
    expect(inverters.some((node) => node.ports.some((port) => port.width === '[1:0]'))).toBe(true);

    await expect(page.locator('[data-node-kind="inverter"]')).toHaveCount(3);
    await expect(page.locator('[data-node-kind="comb"]')).toHaveCount(0);
    await expect(page.locator('.inverter-skin')).toHaveCount(3);
    await expect(page.locator('.inverter-bubble')).toHaveCount(3);

    await expectGraphAndScreenshot(page, 'inverter-node-canvas.png', { clip: await paddedGraphClip(page) });

    for (const edge of view.edges) {
      await expect(page.locator(`.react-flow__edge[data-id="${edge.id}"]`)).toBeAttached();
    }
  });
});
