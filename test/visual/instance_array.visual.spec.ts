import { test, expect } from '@playwright/test';
import { openFixture, fitGraphView, expectGraphAndScreenshot } from './helper';

test.describe('instance array visual', () => {
  test('renders a [MSB:LSB] multi-instance instantiation as a single stacked instance node', async ({ page }) => {
    await openFixture(page, 'instance_array.sv', 'auto');
    await fitGraphView(page, 0.2);

    const instanceNodes = page.locator('[data-node-kind="instance"]');
    await expect(instanceNodes).toHaveCount(1);
    await expect(instanceNodes.first().locator('.hdl-node-array-layer')).toHaveCount(3);
    await expect(instanceNodes.first().locator('.svsch-array-badge')).toHaveText('[3:0]');

    await expectGraphAndScreenshot(page, 'instance-array-stacked.png');
  });
});
