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
    const box = await instance.boundingBox();
    if (!box || !instanceId) throw new Error('Could not locate the "u1" instance node');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

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
    await expect(page.locator('.generate-region-expand')).toHaveCount(1);
    // The instance's own node stays on screen as a dimmed backdrop behind its
    // spliced-in contents, not removed — see expandOverlay's dimAsExpandGhost.
    // The dimming class lands on react-flow's own node wrapper (`data-id`),
    // one level up from the `data-node-id` element our components render.
    const ghostInstance = page.locator(`[data-node-id="${instanceId}"]`);
    const ghostInstanceWrapper = page.locator(`.react-flow__node[data-id="${instanceId}"]`);
    await expect(ghostInstance).toHaveCount(1);
    await expect(ghostInstanceWrapper).toHaveClass(/hdl-node-expand-ghost/);

    await fitGraphView(page, 0.2);
    await expectGraphAndScreenshot(page, 'expand-instance-in-place.png');

    // Re-selecting the (still-present, dimmed) instance node surfaces a
    // "Collapse" control in the same selection toolbar "Expand" used. Click
    // inside its header strip, offset from the top-left corner rather than
    // dead-center or right on the corner: the boundary port columns sit
    // directly on top of the ghost at its port rows (by design — they're
    // anchored to the instance's own port positions) and its corner/edge
    // resize handles sit right at its border, so either a center click or a
    // corner click risks landing on something other than the ghost's own
    // body. The node header strip, comfortably inset from both, is always
    // clear.
    const ghostBox = await ghostInstance.boundingBox();
    if (!ghostBox) throw new Error('Could not locate the dimmed "u1" instance node');
    await page.mouse.click(ghostBox.x + 30, ghostBox.y + 15);
    const collapseButton = page.locator('.svsch-selection-toolbar button', { hasText: 'Collapse' });
    await expect(collapseButton).toBeVisible();
    await collapseButton.click();

    await expect(page.locator('[data-node-kind="boundaryPort"]')).toHaveCount(0);
    await expect(page.locator('.generate-region-expand')).toHaveCount(0);
    await expect(ghostInstance).toHaveCount(1);
    await expect(ghostInstanceWrapper).not.toHaveClass(/hdl-node-expand-ghost/);
  });
});
