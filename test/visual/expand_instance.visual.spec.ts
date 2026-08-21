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
  buildExampleDesignViewWithGraph,
  fixtureRoot,
  fitGraphView,
  expectGraphAndScreenshot,
  openView,
  paddedAllNodesClip,
  postView,
  trackView,
  waitForViewportTransformToSettle,
} from './helper';
import { mergeNodePositions, mergeRelayoutSelection } from '../../src/layout/mergeLayout';
import type { PositionedNode } from '../../src/ir/types';

// `openView`/`postView` only ever track the flat/collapsed DiagramViewModel
// actually posted to the page — the expand splice these tests drive in is
// applied entirely client-side in React Flow state and never round-trips
// back into a DiagramViewModel (see issue #248). Without this, the SVG half
// of expectGraphAndScreenshot's regression check (renderSvg on the tracked
// view) would silently keep comparing against the pre-expand diagram even
// though the PNG screenshot shows the spliced content. This mirrors
// applyExpandedInstances' real caller (svsch render, src/core/index.ts) by
// flagging the given instances expanded on a throwaway copy of `layout` and
// re-deriving their splice layout fresh — the same content the webview
// itself spliced in from expandPayloadFor's buildExpandSpliceLayout call,
// just re-anchored to wherever the instance ended up in `view`.
async function trackSplicedView(
  page: Page,
  graph: DesignGraph,
  layout: SavedLayout,
  view: DiagramViewModel,
  expandedInstanceIds: string[],
): Promise<void> {
  const moduleLayout = layout.modules[view.moduleName] ?? { nodes: {} };
  const expandedLayout: SavedLayout = {
    ...layout,
    modules: {
      ...layout.modules,
      [view.moduleName]: {
        ...moduleLayout,
        expanded: {
          ...(moduleLayout.expanded ?? {}),
          ...Object.fromEntries(expandedInstanceIds.map((id) => [id, true])),
        },
      },
    },
  };
  const splicedView = await applyExpandedInstances({
    graph,
    layout: expandedLayout,
    view,
    expandedSnapshots: new Map(),
  });
  trackView(page, splicedView);
}

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
      },
    });
  });
}

async function capturedMessages(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__svschMessages ?? []);
}

// Mirrors diagramPanel.ts's requestExpandInstance response: the raw child
// DesignModule plus the host-computed frame-local splice layout (the child's
// standalone place-and-route dropped into the frame with its boundary ports
// wired up by libavoid — see buildExpandSpliceLayout).
async function expandPayloadFor(
  graph: DesignGraph,
  layout: SavedLayout,
  request: any,
  childModuleName: string,
): Promise<Record<string, unknown>> {
  const parentModule = graph.modules[request.moduleName];
  const instanceNode = parentModule?.nodes.find((node: any) => node.id === request.instanceId);
  if (!instanceNode) throw new Error(`No instance ${request.instanceId} in ${request.moduleName}`);
  const spliceLayout = await buildExpandSpliceLayout({
    graph,
    layout,
    childModuleName,
    instanceId: request.instanceId,
    instancePorts: instanceNode.ports,
    instanceSize: request.instanceSize,
    instanceParamRows: request.instanceParamRows,
  });
  return {
    instanceId: request.instanceId,
    childModuleName,
    module: graph.modules[childModuleName],
    spliceLayout,
  };
}

// Select an instance node, click Expand, and answer the captured
// requestExpandInstance the way diagramPanel.ts's handler would — with the
// already-elaborated child DesignModule from the same graph plus the
// host-computed splice layout.
async function expandInstanceOnPage(
  page: Page,
  graph: DesignGraph,
  layout: SavedLayout,
  instanceLocator: ReturnType<Page['locator']>,
  childModuleName: string,
): Promise<void> {
  const box = await instanceLocator.boundingBox();
  if (!box) throw new Error('Could not locate the instance node to expand');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const expandButton = page.locator('.svsch-selection-toolbar button', { hasText: 'Expand' });
  await expect(expandButton).toBeVisible();
  await expandButton.click();
  await expect
    .poll(async () =>
      (await capturedMessages(page)).some(
        (message: any) => message.type === 'requestExpandInstance',
      ),
    )
    .toBe(true);
  const request = (await capturedMessages(page)).find(
    (message: any) => message.type === 'requestExpandInstance',
  );
  const payload = await expandPayloadFor(graph, layout, request, childModuleName);
  await page.evaluate(
    ({ moduleName, payload }) => {
      window.postMessage({ type: 'expandInstanceData', moduleName, payload }, '*');
    },
    { moduleName: request.moduleName, payload },
  );
  await page.waitForSelector('[data-node-kind="boundaryPort"]', { state: 'attached' });
}

// Every spliced non-boundary node and every spliced wire path must lie inside
// the dimmed instance node's own rect — the containment invariant of the
// expanded frame (boundary ports sit astride the border by design).
async function expectSplicedContentInsideFrame(page: Page, instanceId: string): Promise<void> {
  const violations = await page.evaluate((ghostId) => {
    const ghost = document.querySelector(`.react-flow__node[data-id="${ghostId}"]`);
    if (!ghost) return [`expanded instance node ${ghostId} not found`];
    const frame = ghost.getBoundingClientRect();
    const tolerance = 8; // half a stroke width plus antialiasing slack
    const within = (rect: DOMRect) =>
      rect.left >= frame.left - tolerance &&
      rect.top >= frame.top - tolerance &&
      rect.right <= frame.right + tolerance &&
      rect.bottom <= frame.bottom + tolerance;
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.react-flow__node'))) {
      const elId = el.getAttribute('data-id') ?? '';
      if (!elId.startsWith('expand:')) continue;
      if (el.querySelector('[data-node-kind="boundaryPort"]')) continue;
      if (!within(el.getBoundingClientRect())) bad.push(`node ${elId}`);
    }
    for (const el of Array.from(document.querySelectorAll('.react-flow__edge'))) {
      const elId = el.getAttribute('data-id') ?? '';
      if (!elId.startsWith('expand:')) continue;
      const path = el.querySelector('path.svsch-edge');
      if (path && !within(path.getBoundingClientRect())) bad.push(`wire ${elId}`);
    }
    return bad;
  }, instanceId);
  expect(violations, 'spliced content escaping the expanded frame').toEqual([]);
}

async function buildFixtureGraph(fixtureName: string): Promise<DesignGraph> {
  const fixturePath = path.join(fixtureRoot, fixtureName);
  const text = fs.readFileSync(fixturePath, 'utf8');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svsch-expand-visual-'));
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

test.describe('expand instance in place visual', () => {
  // eslint-disable-next-line max-len
  test('selecting a single instance shows Expand; clicking it splices in the child module, Collapse removes it', async ({
    page,
  }) => {
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
      height: (el as HTMLElement).offsetHeight,
    }));
    await page.mouse.click(
      collapsedBox.x + collapsedBox.width / 2,
      collapsedBox.y + collapsedBox.height / 2,
    );

    const expandButton = page.locator('.svsch-selection-toolbar button', { hasText: 'Expand' });
    await expect(expandButton).toBeVisible();
    await expandButton.click();

    await expect
      .poll(async () => {
        const messages = await capturedMessages(page);
        return messages.some((message: any) => message.type === 'requestExpandInstance');
      })
      .toBe(true);

    const request = (await capturedMessages(page)).find(
      (message: any) => message.type === 'requestExpandInstance',
    );
    expect(request.instanceId).toBe(instanceId);
    expect(request.topLevel).toBe(true);

    // Mirrors diagramPanel.ts's requestExpandInstance response — the raw
    // child DesignModule plus the host-computed splice layout.
    const payload = await expandPayloadFor(graph, emptyLayout, request, 'leaf');
    await page.evaluate(
      ({ moduleName, payload }) => {
        window.postMessage({ type: 'expandInstanceData', moduleName, payload }, '*');
      },
      { moduleName: request.moduleName, payload },
    );

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
      expect(splicedBox.x + splicedBox.width).toBeLessThanOrEqual(
        expandedBox.x + expandedBox.width,
      );
      expect(splicedBox.y + splicedBox.height).toBeLessThanOrEqual(
        expandedBox.y + expandedBox.height,
      );
    }

    await fitGraphView(page, 0.2);
    await trackSplicedView(page, graph, emptyLayout, view, [instanceId]);
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
    await expect
      .poll(() =>
        ghostInstance.evaluate((el) => ({
          width: (el as HTMLElement).offsetWidth,
          height: (el as HTMLElement).offsetHeight,
        })),
      )
      .toEqual(collapsedLayoutSize);
  });

  // eslint-disable-next-line max-len
  test('a multi-node child: boundary leads carry the wire styles and every internal wire stays inside the frame', async ({
    page,
  }) => {
    await installMessageCapture(page);

    const graph = await buildFixtureGraph('expand_instance_complex.sv');
    const emptyLayout: SavedLayout = { version: 1, modules: {} };
    const view = await buildViewModel(graph, 'top', emptyLayout);

    await openView(page, view);
    await page.waitForSelector('[data-node-kind="instance"]', { state: 'attached' });
    await waitForViewportTransformToSettle(page);

    const instance = page.locator('[data-node-kind="instance"]');
    await expect(instance).toHaveCount(1);
    const instanceId = await instance.getAttribute('data-node-id');
    if (!instanceId) throw new Error('Could not locate the "u_dp" instance node');
    await expandInstanceOnPage(page, graph, emptyLayout, instance, 'datapath');

    await expect(page.locator('[data-node-kind="boundaryPort"]')).toHaveCount(5);
    // Multiple internal nodes actually spliced in (registers + combs).
    const internalSpliced = page.locator(
      '.react-flow__node[data-id^="expand:"]:not(:has([data-node-kind="boundaryPort"]))',
    );
    expect(await internalSpliced.count()).toBeGreaterThanOrEqual(3);

    // The boundary-port leads are stubs of the wires they continue — they
    // must carry the wire's style: multi-bit ports get the thick lead,
    // struct ports the struct-striped one, plain scalars the default 1.5px.
    const boundaryFor = (name: string) =>
      page.locator('[data-node-kind="boundaryPort"]').filter({
        has: page.locator('.hdl-boundary-port-text', { hasText: new RegExp(`^${name}$`) }),
      });
    await expect(boundaryFor('bus_in').locator('.hdl-boundary-port-lead-thick')).toHaveCount(1);
    await expect(boundaryFor('bus_out').locator('.hdl-boundary-port-lead-thick')).toHaveCount(1);
    await expect(boundaryFor('pkt_in').locator('.hdl-boundary-port-lead-struct')).toHaveCount(1);
    await expect(boundaryFor('clk').locator('.hdl-boundary-port-lead')).toHaveCount(1);
    await expect(
      boundaryFor('clk').locator(
        '.hdl-boundary-port-lead-thick, .hdl-boundary-port-lead-struct, ' +
          '.hdl-boundary-port-lead-interface',
      ),
    ).toHaveCount(0);

    await expectSplicedContentInsideFrame(page, instanceId);

    await fitGraphView(page, 0.15);
    await trackSplicedView(page, graph, emptyLayout, view, [instanceId]);
    await expectGraphAndScreenshot(page, 'expand-instance-complex.png');
  });

  // A parameter-overridden instance renders its own instance-parameter chip
  // stacked atop its ports (see instanceParameterRows), and expandTopPad
  // reserves that same header height inside the frame so the spliced child
  // diagram never renders under/behind that chip. This is the same
  // register-leaf shape as the very first test in this file (one register
  // node, 3 boundary ports), just with the leaf's WIDTH parameter overridden
  // at the instantiation site, so the check is purely about whether the
  // splice's inner area clears the extra header row the chip needs, not
  // about splicing content that wasn't already covered elsewhere.
  // eslint-disable-next-line max-len
  test('an instance with an overridden parameter expanded: spliced content clears the parameter chip row', async ({
    page,
  }) => {
    await installMessageCapture(page);

    const graph = await buildFixtureGraph('expand_instance_with_params.sv');
    const emptyLayout: SavedLayout = { version: 1, modules: {} };
    const view = await buildViewModel(graph, 'top', emptyLayout);

    await openView(page, view);
    await page.waitForSelector('[data-node-kind="instance"]', { state: 'attached' });
    await waitForViewportTransformToSettle(page);

    const instance = page.locator('[data-node-kind="instance"]');
    await expect(instance).toHaveCount(1);
    const instanceId = await instance.getAttribute('data-node-id');
    if (!instanceId) throw new Error('Could not locate the "u1" instance node');
    await expect(instance.locator('.instance-parameter-chip')).toHaveCount(1);

    await expandInstanceOnPage(page, graph, emptyLayout, instance, 'param_leaf');
    await expect(page.locator('[data-node-kind="boundaryPort"]')).toHaveCount(3);
    // The register node from `always_ff` — real internal content, not just
    // boundary ports, so the "clears the chip row" check below is
    // meaningful.
    expect(
      await page.locator('[data-node-id^="expand:"]:not([data-node-kind="boundaryPort"])').count(),
    ).toBeGreaterThanOrEqual(1);

    const ghostInstance = page.locator(`[data-node-id="${instanceId}"]`);
    const chip = ghostInstance.locator('.instance-parameter-chip');
    await expect(chip).toHaveCount(1);
    const chipBottom = await chip.evaluate((element) => element.getBoundingClientRect().bottom);
    const tolerance = 4; // antialiasing/rounding slack, same as expectSplicedContentInsideFrame

    // Every spliced node (boundary ports included, since their vertical
    // anchor is offset by instanceParamRows too) must sit below the chip.
    for (const spliced of await page.locator('[data-node-id^="expand:"]').all()) {
      const box = await spliced.boundingBox();
      if (!box) continue;
      expect(
        box.y,
        `spliced node ${await spliced.getAttribute('data-node-id')}`,
      ).toBeGreaterThanOrEqual(chipBottom - tolerance);
    }

    await expectSplicedContentInsideFrame(page, instanceId);

    await fitGraphView(page, 0.2);
    await trackSplicedView(page, graph, emptyLayout, view, [instanceId]);
    await expectGraphAndScreenshot(page, 'expand-instance-with-parameters.png');
  });

  // The example design's cpu_top with its ALU expanded in place, then the
  // outer diagram auto-layouted from a border-crossing drag-selection — the
  // marquee must skip the sub-diagram's nodes, and the relayout round-trip
  // (played by this test in the extension host's role, same merge+build
  // calls diagramPanel.relayoutSelection makes) must carry the spliced
  // content along with the re-placed instance.
  // eslint-disable-next-line max-len
  test('example design: cpu_top with u_alu expanded, outer auto-layout applied', async ({
    page,
  }) => {
    await installMessageCapture(page);

    const { graph, layout, view } = await buildExampleDesignViewWithGraph('cpu_top');
    await openView(page, view);
    await page.waitForSelector('.react-flow__node', { state: 'attached' });
    await waitForViewportTransformToSettle(page);
    await fitGraphView(page, 0.15);

    // Resolve the instance from the IR ("u_alu" as a text filter would also
    // match u_alu_src_mux), then locate its node by id.
    const aluGraphNode = graph.modules.cpu_top.nodes.find(
      (node) => node.kind === 'instance' && node.moduleName === 'alu',
    );
    if (!aluGraphNode) throw new Error('No alu instance in cpu_top');
    const aluNodeId = aluGraphNode.id;
    const aluInstance = page.locator(`[data-node-id="${aluNodeId}"]`);
    await expandInstanceOnPage(page, graph, layout, aluInstance, 'alu');
    await expect(page.locator('[data-node-kind="boundaryPort"]')).toHaveCount(5);

    // Border-crossing marquee across the whole diagram: top-level nodes only.
    // Clamp the lasso to the React Flow pane so the starting press lands on
    // the pane itself (not the app header above it or the page body).
    const clip = await paddedAllNodesClip(page);
    const paneBox = await page.locator('.react-flow__pane').boundingBox();
    if (!paneBox) throw new Error('No React Flow pane to drag-select on');
    const startX = Math.max(clip.x, paneBox.x + 2);
    const startY = Math.max(clip.y, paneBox.y + 2);
    const endX = Math.min(clip.x + clip.width, paneBox.x + paneBox.width - 2);
    const endY = Math.min(clip.y + clip.height, paneBox.y + paneBox.height - 2);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 8 });
    await page.mouse.move(endX, endY, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).reactFlowInstance.getNodes().filter((n: any) => n.selected).length,
        ),
      )
      .toBeGreaterThan(2);
    const selectedSpliced = await page.evaluate(() =>
      (window as any).reactFlowInstance
        .getNodes()
        .filter((n: any) => n.selected && n.id.startsWith('expand:'))
        .map((n: any) => n.id),
    );
    expect(selectedSpliced, 'marquee must not select sub-diagram nodes').toEqual([]);

    const autoLayoutButton = page.locator('.svsch-selection-toolbar button', {
      hasText: 'Auto Layout',
    });
    await expect(autoLayoutButton).toBeVisible();
    await autoLayoutButton.click();
    await expect
      .poll(async () =>
        (await capturedMessages(page)).some((message: any) => message.type === 'relayoutSelection'),
      )
      .toBe(true);
    const relayout = (await capturedMessages(page)).find(
      (message: any) => message.type === 'relayoutSelection',
    );
    expect(
      relayout.nodeIds.filter((id: string) => id.startsWith('expand:')),
      'relayout payload must not contain sub-diagram ids',
    ).toEqual([]);

    // Play the extension host's role: the same merge + build + re-anchor
    // sequence diagramPanel.relayoutSelection runs, then post the resulting
    // view back — the webview reattaches the still-cached splice to it.
    const designModule = graph.modules.cpu_top;
    const selected = new Set<string>(relayout.nodeIds);
    const centroid = (nodes: PositionedNode[]) => {
      const inSelection = nodes.filter((node) => selected.has(node.id));
      if (inSelection.length === 0) return undefined;
      return {
        x: inSelection.reduce((sum, node) => sum + node.position.x, 0) / inSelection.length,
        y: inSelection.reduce((sum, node) => sum + node.position.y, 0) / inSelection.length,
      };
    };
    let hostLayout = mergeRelayoutSelection(
      layout,
      'cpu_top',
      relayout.nodeIds,
      relayout.nodes,
      designModule,
    );
    const originalCentroid = centroid(relayout.nodes);
    const relaidView = await buildViewModel(graph, 'cpu_top', hostLayout);
    const relaidCentroid = centroid(relaidView.nodes);
    if (originalCentroid && relaidCentroid) {
      const dx = originalCentroid.x - relaidCentroid.x;
      const dy = originalCentroid.y - relaidCentroid.y;
      const anchoredNodes = relaidView.nodes
        .filter((node) => selected.has(node.id))
        .map((node) => ({
          ...node,
          position: { x: node.position.x + dx, y: node.position.y + dy },
          fixed: true,
        }));
      hostLayout = mergeNodePositions(hostLayout, 'cpu_top', anchoredNodes);
    }
    const finalView = await buildViewModel(graph, 'cpu_top', hostLayout);
    await postView(page, finalView);

    // The splice reattaches to the re-laid-out diagram: boundary ports ride
    // along and the sub-diagram stays inside the (re-placed) frame.
    await expect(page.locator('[data-node-kind="boundaryPort"]')).toHaveCount(5);
    await expect(page.locator(`.react-flow__node[data-id="${aluNodeId}"]`)).toHaveClass(
      /hdl-node-expand-ghost/,
    );
    await expectSplicedContentInsideFrame(page, aluNodeId);

    // Auto Layout intentionally keeps the relaid blocks selected — drop the
    // selection before the screenshot so the baseline shows the diagram, not
    // the selection styling.
    await page.evaluate(() => {
      const rf = (window as any).reactFlowInstance;
      rf.setNodes(rf.getNodes().map((n: any) => (n.selected ? { ...n, selected: false } : n)));
    });
    await expect(page.locator('.svsch-selection-toolbar')).toHaveCount(0);

    await fitGraphView(page, 0.15);
    await trackSplicedView(page, graph, hostLayout, finalView, [aluNodeId]);
    await expectGraphAndScreenshot(page, 'example-design-alu-expanded-autolayout.png');
  });
});
