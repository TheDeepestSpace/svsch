import { expect, test } from '@playwright/test';
import { expectGraphAndScreenshot, paddedGraphClip, openFixture } from './helper';

test.describe('struct passing visual rendering', () => {
  test('renders thick aggregate edges for structs passed between modules', async ({ page }) => {
    const graph = await openFixture(page, 'struct_passing.sv', 'auto', 'top');

    // Find the edge between producer p and consumer c
    const structEdge = page.locator('path.svsch-edge-struct').first();
    
    // If the issue exists, this locator might fail or return 0 items if no edge has the class
    const structEdgeCount = await structEdge.count();
    console.log(`[test] Found ${structEdgeCount} struct edges`);

    if (structEdgeCount === 0) {
        // Find ANY edge between the two instances to confirm it exists but lacks the class
        const allEdges = page.locator('path.svsch-edge');
        const allEdgeCount = await allEdges.count();
        console.log(`[test] Found ${allEdgeCount} total edges`);
    }

    await expect(structEdge).toBeAttached();

    const edgeStyle = await structEdge.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        strokeWidth: Number.parseFloat(style.strokeWidth),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left }
      };
    });

    console.log(`[test] Struct edge style:`, JSON.stringify(edgeStyle, null, 2));

    const normalEdgeWidth = await page.locator('path.svsch-edge:not(.svsch-edge-interface):not(.svsch-edge-interface-bg):not(.svsch-edge-struct)').first().evaluate((element) => {
      return Number.parseFloat(getComputedStyle(element).strokeWidth);
    });

    console.log(`[test] Struct edge width: ${edgeStyle.strokeWidth}, Normal edge width: ${normalEdgeWidth}`);
    expect(edgeStyle.strokeWidth).toBeGreaterThan(normalEdgeWidth * 2);

    await expectGraphAndScreenshot(page, 'struct-passing-edge.png', { clip: await paddedGraphClip(page) });
  });
});
