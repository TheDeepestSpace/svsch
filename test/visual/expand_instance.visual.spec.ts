import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildViewModel } from '../../src/layout/mergeLayout';
import { buildDesignGraph } from '../../src/parser/backend';
import type { DesignGraph } from '../../src/ir/types';
import type { SavedLayout } from '../../src/storage/layoutStore';
import {
  fixtureRoot,
  fitGraphView,
  expectGraphAndScreenshot,
  openView,
  waitForViewportTransformToSettle
} from './helper';

// "Expand instance in place" (issue #232) is entirely client-side once the
// host hands over the child module's IR (see webview/expand/splice.ts and
// diagramPanel.ts's requestExpandInstance) — vitest's expandSplice.test.ts
// already covers that splicing math against a synthetic module. This spec
// instead drives the real interactive flow (select -> click Expand -> the
// webview's own postMessage listener splices in the response -> click
// Collapse) the way a user actually would, and locks in the resulting DOM/
// CSS via a screenshot. There's no live extension host in this browser-only
// harness (see getVscodeApi's no-op postMessage fallback below), so the
// host's `expandInstanceData` reply is simulated from the same DesignGraph
// the fixture's own view was built from — exactly the payload
// diagramPanel.ts would have sent.
async function installMessageCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__svschMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (message: unknown) => {
        (window as any).__svschMessages.push(message);
      }
    });
  });
}

async function capturedMessages(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__svschMessages ?? []);
}

async function buildFixtureGraph(fixtureName: string): Promise<DesignGraph> {
  const fixturePath = path.join(fixtureRoot, fixtureName);
  const text = fs.readFileSync(fixturePath, 'utf8');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svsch-expand-visual-'));
  try {
    fs.writeFileSync(path.join(tmpDir, fixtureName), text);
    const surelogPath = process.env.SVSCH_SURELOG_PATH ?? path.resolve(__dirname, '../../dist/surelog/bin/surelog');
    const backendPath = path.resolve(__dirname, '../../dist/svsch_backend');
    return await buildDesignGraph({
      workspaceRoot: tmpDir,
      projectFolder: '.',
      backend: (process.env.SVSCH_BACKEND as any) || 'uhdm',
      veriblePath: 'verible-verilog-syntax',
      surelogPath,
      backendPath,
      includeExternalDiagnostics: false
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test.describe('expand instance in place visual', () => {
  test('selecting a single instance shows Expand; clicking it splices in the child module, Collapse removes it', async ({ page }) => {
    await installMessageCapture(page);

    const graph = await buildFixtureGraph('expand_instance.sv');
    const emptyLayout: SavedLayout = { version: 1, modules: {} };
    const view = await buildViewModel(graph, 'top', emptyLayout);

    await openView(page, view);
    await page.waitForSelector('[data-node-kind="instance"]', { state: 'attached' });
    await waitForViewportTransformToSettle(page);

    const instance = page.locator('[data-node-kind="instance"]');
    await expect(instance).toHaveCount(1);
    const instanceId = await instance.getAttribute('data-node-id');
    const collapsedBox = await instance.boundingBox();
    if (!collapsedBox || !instanceId) throw new Error('Could not locate the "u1" instance node');
    // Layout (offset) size is independent of the canvas zoom, unlike
    // boundingBox — captured for the size-revert check after Collapse, which
    // runs at a different zoom level than this point.
    const collapsedLayoutSize = await instance.evaluate((el) => ({
      width: (el as HTMLElement).offsetWidth,
      height: (el as HTMLElement).offsetHeight
    }));
    await page.mouse.click(collapsedBox.x + collapsedBox.width / 2, collapsedBox.y + collapsedBox.height / 2);

    const expandButton = page.locator('.svsch-selection-toolbar button', { hasText: 'Expand' });
    await expect(expandButton).toBeVisible();
    await expandButton.click();

    await expect.poll(async () => {
      const messages = await capturedMessages(page);
      return messages.some((message: any) => message.type === 'requestExpandInstance');
    }).toBe(true);

    const request = (await capturedMessages(page)).find((message: any) => message.type === 'requestExpandInstance');
    expect(request.instanceId).toBe(instanceId);
    expect(request.topLevel).toBe(true);

    // Mirrors diagramPanel.ts's requestExpandInstance response — the
    // extension host has no logic of its own here beyond handing back the
    // already-elaborated child DesignModule.
    await page.evaluate(({ moduleName, payload }) => {
      window.postMessage({ type: 'expandInstanceData', moduleName, payload }, '*');
    }, {
      moduleName: request.moduleName,
      payload: {
        instanceId: request.instanceId,
        childModuleName: 'leaf',
        module: graph.modules.leaf
      }
    });

    await page.waitForSelector('[data-node-kind="boundaryPort"]', { state: 'attached' });
    await expect(page.locator('[data-node-kind="boundaryPort"]')).toHaveCount(3);
    // The expanded instance's own node IS the frame: dimmed and grown so its
    // body contains the whole spliced-in child diagram — there is no
    // separate region outline rendered at all (see expandOverlay's
    // dimAsExpandGhost). The dimming class lands on react-flow's own node
    // wrapper (`data-id`), one level up from the `data-node-id` element our
    // components render.
    await expect(page.locator('.generate-region-expand')).toHaveCount(0);
    const ghostInstance = page.locator(`[data-node-id="${instanceId}"]`);
    const ghostInstanceWrapper = page.locator(`.react-flow__node[data-id="${instanceId}"]`);
    await expect(ghostInstance).toHaveCount(1);
    await expect(ghostInstanceWrapper).toHaveClass(/hdl-node-expand-ghost/);
    const expandedBox = await ghostInstance.boundingBox();
    if (!expandedBox) throw new Error('Could not locate the expanded "u1" instance node');
    expect(expandedBox.width).toBeGreaterThan(collapsedBox.width);
    expect(expandedBox.height).toBeGreaterThan(collapsedBox.height);
    // Every spliced-in internal node sits fully inside the expanded node's body.
    for (const spliced of await page.locator('[data-node-id^="expand:"]').all()) {
      const kind = await spliced.getAttribute('data-node-kind');
      if (kind === 'boundaryPort') continue; // sits astride the border by design
      const splicedBox = await spliced.boundingBox();
      if (!splicedBox) continue;
      expect(splicedBox.x).toBeGreaterThanOrEqual(expandedBox.x);
      expect(splicedBox.y).toBeGreaterThanOrEqual(expandedBox.y);
      expect(splicedBox.x + splicedBox.width).toBeLessThanOrEqual(expandedBox.x + expandedBox.width);
      expect(splicedBox.y + splicedBox.height).toBeLessThanOrEqual(expandedBox.y + expandedBox.height);
    }

    await fitGraphView(page, 0.2);
    await expectGraphAndScreenshot(page, 'expand-instance-in-place.png');

    // Re-selecting the (still-present, dimmed and enlarged) instance node
    // surfaces a "Collapse" control in the same selection toolbar "Expand"
    // used. Click inside its header strip, offset from the top-left corner
    // rather than dead-center or right on the corner: the spliced-in child
    // diagram now sits on top of the node's body (by design — the node is
    // the frame) and its corner/edge resize handles sit right at its border,
    // so either a center click or a corner click risks landing on something
    // other than the node's own body. The node header strip, comfortably
    // inset from both, is always clear.
    const ghostBox = await ghostInstance.boundingBox();
    if (!ghostBox) throw new Error('Could not locate the dimmed "u1" instance node');
    await page.mouse.click(ghostBox.x + 30, ghostBox.y + 15);
    const collapseButton = page.locator('.svsch-selection-toolbar button', { hasText: 'Collapse' });
    await expect(collapseButton).toBeVisible();
    await collapseButton.click();

    await expect(page.locator('[data-node-kind="boundaryPort"]')).toHaveCount(0);
    await expect(ghostInstance).toHaveCount(1);
    await expect(ghostInstanceWrapper).not.toHaveClass(/hdl-node-expand-ghost/);
    // Collapsing reverts the node to its original (pre-expand) size — the
    // expanded size is splice state, never persisted as a manual resize.
    await expect.poll(() => ghostInstance.evaluate((el) => ({
      width: (el as HTMLElement).offsetWidth,
      height: (el as HTMLElement).offsetHeight
    }))).toEqual(collapsedLayoutSize);
  });
});
