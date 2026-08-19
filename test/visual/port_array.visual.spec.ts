import { test, expect, type Page } from '@playwright/test';
import { expectGraphAndScreenshot, openFixture, paddedLocatorClip } from './helper';

test.describe('Stacked Port Visuals', () => {
  test('stacked port selection covers the entire stack', async ({ page }) => {
    await openFixture(page, 'array_port_register.sv', 'register');

    const inDataId = 'port:array_port_register:in_data';
    const outDataId = 'port:array_port_register:out_data';

    // Check input port selection
    await page.click(`[data-node-id="${inDataId}"]`);
    await expectArrayStackPortSelectionCoversFullStack(page, inDataId);
    await expectGraphAndScreenshot(page, 'array-input-port-selected.png', {
      clip: await paddedLocatorClip(page, `[data-node-id="${inDataId}"]`),
    });

    // Check output port selection
    await page.click(`[data-node-id="${outDataId}"]`);
    await expectArrayStackPortSelectionCoversFullStack(page, outDataId);
    await expectGraphAndScreenshot(page, 'array-output-port-selected.png', {
      clip: await paddedLocatorClip(page, `[data-node-id="${outDataId}"]`),
    });
  });
});

async function expectArrayStackPortSelectionCoversFullStack(
  page: Page,
  nodeId: string,
): Promise<void> {
  const geometry = await page.locator(`[data-node-id="${nodeId}"]`).evaluate((node) => {
    type Rect = {
      left: number;
      right: number;
      top: number;
      bottom: number;
      width: number;
      height: number;
    };

    function rectFor(selector: string): Rect | undefined {
      const rect = node.querySelector(selector)?.getBoundingClientRect();
      if (!rect) return undefined;
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }

    return {
      selection: rectFor('.hdl-node-array-selection'),
      front: rectFor('.port-skin-array-front'),
      middle: rectFor('.port-skin-array-middle'),
      back: rectFor('.port-skin-array-back'),
    };
  });

  expect(geometry.selection).toBeDefined();
  expect(geometry.front).toBeDefined();
  expect(geometry.middle).toBeDefined();
  expect(geometry.back).toBeDefined();

  // Selection should be at least as large as the union of all layers
  // Allow a small margin (0.5px) for subpixel rendering differences
  expect(geometry.selection!.left).toBeLessThanOrEqual(
    Math.min(geometry.front!.left, geometry.middle!.left, geometry.back!.left) + 0.5,
  );
  expect(geometry.selection!.top).toBeLessThanOrEqual(
    Math.min(geometry.front!.top, geometry.middle!.top, geometry.back!.top) + 0.5,
  );
  expect(geometry.selection!.right).toBeGreaterThanOrEqual(
    Math.max(geometry.front!.right, geometry.middle!.right, geometry.back!.right) - 0.5,
  );
  expect(geometry.selection!.bottom).toBeGreaterThanOrEqual(
    Math.max(geometry.front!.bottom, geometry.middle!.bottom, geometry.back!.bottom) - 0.5,
  );
}
