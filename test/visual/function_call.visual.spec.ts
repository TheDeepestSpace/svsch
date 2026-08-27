import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildViewModel } from '../../src/layout/mergeLayout';
import { buildExpandSpliceLayout } from '../../src/layout/expandLayout';
import { applyExpandedInstances } from '../../src/layout/expandSpliceView';
import { buildDesignGraph } from '../../src/parser/backend';
import type { DesignGraph, DiagramViewModel } from '../../src/ir/types';
import type { SavedLayout } from '../../src/storage/layoutStore';
import {
  fixtureRoot,
  expectGraphAndScreenshot,
  fitGraphView,
  openFixture,
  openView,
  trackView,
  waitForViewportTransformToSettle,
} from './helper';

// "Support expandable function call diagrams" (issue #335): a function call
// site renders as its own FUNCTION block (InstanceNodeSvg's funcCall
// kindLabel), and double-clicking it splices the function's own
// combinational body in place — the callable counterpart to
// expand_instance.visual.spec.ts's "Expand instance in place" coverage.
// There's no live extension host in this browser-only harness, so the
// host's expandFunctionCallData reply is simulated from the same
// DesignGraph the fixture's own view was built from, mirroring
// diagramPanel.ts's requestExpandFunctionCall handler.
async function installMessageCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__svschMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (message: unknown) => {
        (window as any).__svschMessages.push(message);
      },
    });
  });
}

async function capturedMessages(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__svschMessages ?? []);
}

async function buildFixtureGraph(fixtureName: string): Promise<DesignGraph> {
  const fixturePath = path.join(fixtureRoot, fixtureName);
  const text = fs.readFileSync(fixturePath, 'utf8');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svsch-function-call-visual-'));
  try {
    fs.writeFileSync(path.join(tmpDir, fixtureName), text);
    const surelogPath =
      process.env.SVSCH_SURELOG_PATH ?? path.resolve(__dirname, '../../dist/surelog/bin/surelog');
    const backendPath = path.resolve(__dirname, '../../dist/svsch_backend');
    return await buildDesignGraph({
      workspaceRoot: tmpDir,
      projectFolder: '.',
      backend: (process.env.SVSCH_BACKEND as any) || 'uhdm',
      veriblePath: 'verible-verilog-syntax',
      surelogPath,
      backendPath,
      includeExternalDiagnostics: false,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Mirrors diagramPanel.ts's requestExpandFunctionCall response: the callable
// body from graph.functions plus the host-computed splice layout.
async function expandFunctionCallPayloadFor(
  graph: DesignGraph,
  layout: SavedLayout,
  request: any,
): Promise<Record<string, unknown>> {
  const parentModule = graph.modules[request.moduleName];
  const callNode = parentModule?.nodes.find((node: any) => node.id === request.callId);
  if (!callNode || callNode.kind !== 'funcCall' || !callNode.functionId) {
    throw new Error(`No function call ${request.callId} in ${request.moduleName}`);
  }
  const functionId = callNode.functionId;
  const callable = graph.functions?.[functionId];
  if (!callable) throw new Error(`No function body for ${functionId}`);
  const spliceLayout = await buildExpandSpliceLayout({
    graph,
    layout,
    childModuleName: functionId,
    instanceId: request.callId,
    instancePorts: callNode.ports,
    instanceSize: request.callSize,
    instanceParamRows: 0,
    childModule: callable,
  });
  return { callId: request.callId, functionId, module: callable, spliceLayout };
}

// Double-clicks the given funcCall node — its own double-click handler
// unfolds it directly (see InstanceNode.tsx), unlike an instance node, which
// needs the select-then-click-Expand round trip.
async function expandFunctionCallOnPage(
  page: Page,
  graph: DesignGraph,
  layout: SavedLayout,
  callLocator: ReturnType<Page['locator']>,
): Promise<void> {
  const box = await callLocator.boundingBox();
  if (!box) throw new Error('Could not locate the function call node to expand');
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(async () =>
      (await capturedMessages(page)).some(
        (message: any) => message.type === 'requestExpandFunctionCall',
      ),
    )
    .toBe(true);
  const request = (await capturedMessages(page)).find(
    (message: any) => message.type === 'requestExpandFunctionCall',
  );
  const payload = await expandFunctionCallPayloadFor(graph, layout, request);
  await page.evaluate(
    ({ moduleName, payload }) => {
      window.postMessage({ type: 'expandFunctionCallData', moduleName, payload }, '*');
    },
    { moduleName: request.moduleName, payload },
  );
  await page.waitForSelector('[data-node-kind="boundaryPort"]', { state: 'attached' });
}

// Flags `callIds` expanded in a throwaway copy of `layout`, then re-derives
// their splice fresh — the same content the webview itself spliced in — so
// the SVG half of expectGraphAndScreenshot's regression check (renderSvg on
// the tracked view) reflects the expanded state the PNG screenshot shows.
async function trackFunctionCallSplicedView(
  page: Page,
  graph: DesignGraph,
  layout: SavedLayout,
  view: DiagramViewModel,
  callIds: string[],
): Promise<void> {
  const moduleLayout = layout.modules[view.moduleName] ?? { nodes: {} };
  const expandedLayout: SavedLayout = {
    ...layout,
    modules: {
      ...layout.modules,
      [view.moduleName]: {
        ...moduleLayout,
        expandedFunctionCalls: {
          ...(moduleLayout.expandedFunctionCalls ?? {}),
          ...Object.fromEntries(callIds.map((id) => [id, true])),
        },
      },
    },
  };
  const splicedView = await applyExpandedInstances({ graph, layout: expandedLayout, view });
  trackView(page, splicedView);
}

test.describe('function call diagrams visual', () => {
  test('a function call renders as a FUNCTION block, and expanding it splices in its body', async ({
    page,
  }) => {
    await installMessageCapture(page);

    const graph = await buildFixtureGraph('function_call.sv');
    const emptyLayout: SavedLayout = { version: 1, modules: {} };
    const view = await buildViewModel(graph, 'function_call', emptyLayout);

    await openView(page, view);
    await page.waitForSelector('[data-node-kind="funcCall"]', { state: 'attached' });
    await waitForViewportTransformToSettle(page);

    const call = page.locator('[data-node-kind="funcCall"]');
    await expect(call).toHaveCount(1);
    const callId = await call.getAttribute('data-node-id');
    if (!callId) throw new Error('Could not locate the "foo" function call node');
    await expect(call).toContainText('FUNCTION');
    await expect(call).toContainText('foo');

    await fitGraphView(page, 0.2);
    await expectGraphAndScreenshot(page, 'function-call-collapsed.png');

    await expandFunctionCallOnPage(page, graph, emptyLayout, call);

    await expect(page.locator('[data-node-kind="boundaryPort"]')).toHaveCount(3);
    const callWrapper = page.locator(`.react-flow__node[data-id="${callId}"]`);
    await expect(callWrapper).toHaveClass(/hdl-node-expand-ghost/);
    // The function's own body (an ALU add node, per test/unit/backend.test.ts)
    // is spliced in inside the call's frame.
    await expect(page.locator('[data-node-kind="alu"]')).toHaveCount(1);

    await fitGraphView(page, 0.2);
    await trackFunctionCallSplicedView(page, graph, emptyLayout, view, [callId]);
    await expectGraphAndScreenshot(page, 'function-call-expanded.png');

    // Collapse restores the original small FUNCTION block. A function call's
    // frame is only as tall as its 2-3 boundary ports, so its header strip is
    // much shorter than a typical expanded instance's — click the header
    // row's horizontal center, clear of the input boundary ports hugging the
    // left edge and the output one hugging the right, rather than a
    // corner-offset click that risks landing on one of them.
    const ghostBox = await callWrapper.boundingBox();
    if (!ghostBox) throw new Error('Could not locate the expanded "foo" function call node');
    await page.mouse.click(ghostBox.x + ghostBox.width / 2, ghostBox.y + 15);
    const collapseButton = page.locator('.svsch-selection-toolbar button', { hasText: 'Collapse' });
    await expect(collapseButton).toBeVisible();
    await collapseButton.click();

    await expect(page.locator('[data-node-kind="boundaryPort"]')).toHaveCount(0);
    await expect(call).toHaveCount(1);
    await expect(callWrapper).not.toHaveClass(/hdl-node-expand-ghost/);
  });

  test('a task call renders as a TASK block', async ({ page }) => {
    await openFixture(page, 'task_call.sv', 'auto', 'task_call');

    const call = page.locator('[data-node-kind="taskCall"]');
    await expect(call).toHaveCount(1);
    await expect(call).toContainText('TASK');
    await expect(call).toContainText('add_values');

    await fitGraphView(page, 0.2);
    await expectGraphAndScreenshot(page, 'task-call.png');
  });
});
