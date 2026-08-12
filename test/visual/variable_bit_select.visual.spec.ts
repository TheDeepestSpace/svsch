import { test, expect } from '@playwright/test';
import { openFixture, fitGraphView, expectGraphAndScreenshot } from './helper';

test.describe('variable bit select visual', () => {
  test('renders variable bit select block', async ({ page }) => {
    await openFixture(page, 'var_bit_select.sv', 'auto');
    await fitGraphView(page, 0.2);

    await expect(page.locator('[data-node-kind="select"]')).toHaveCount(2);
    await expectGraphAndScreenshot(page, 'variable-bit-select.png');

    const select = page.locator('[data-node-kind="select"]').first();
    await select.click();
    await expect(select.locator('.node-skin-selection')).toHaveCSS('opacity', '1');
    await expect(select.locator('.hdl-node-selection-rect')).toHaveCount(0);
  });
});
