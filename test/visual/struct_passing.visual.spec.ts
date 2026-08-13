import { expect, test } from '@playwright/test';
import { expectGraphAndScreenshot, paddedGraphClip, openFixture } from './helper';

test.describe('struct passing visual rendering', () => {
  test('renders thick aggregate edges for structs passed between modules', async ({ page }) => {
    await openFixture(page, 'struct_passing.sv', 'auto', 'top');

    const structEdge = page.locator('path.svsch-edge-struct').first();
    await expect(structEdge).toBeAttached();

    const structEdgeWidth = await structEdge.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).strokeWidth),
    );
    const normalEdgeWidth = await page
      .locator(
        'path.svsch-edge:not(.svsch-edge-interface):not(.svsch-edge-interface-bg)' +
          ':not(.svsch-edge-struct):not(.svsch-edge-struct-bg):not(.svsch-edge-thick)',
      )
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).strokeWidth));
    expect(structEdgeWidth).toBeGreaterThan(normalEdgeWidth * 2);

    await expectGraphAndScreenshot(page, 'struct-passing-edge.png', {
      clip: await paddedGraphClip(page),
    });
  });
});
