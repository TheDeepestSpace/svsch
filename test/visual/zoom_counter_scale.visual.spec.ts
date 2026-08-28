import { test, expect, type Page } from '@playwright/test';
import { openView, waitForViewportTransformToSettle } from './helper';
import type { DiagramViewModel } from '../../src/ir/types';

// Regression coverage for #307: the selection toolbar, wire hover controls, and
// cut-stub reset button all render inside ancestors that carry react-flow's
// scale(zoom) transform (see main.tsx's overlayPortalNode and the
// .react-flow__viewport foreignObject in OrthogonalEdge). Each button now wraps
// its markup in a counter-scale div (transform: scale(1 / zoom)) so it stays a
// constant screen-pixel size instead of growing/shrinking with the canvas.

function visualPort(
  id: string,
  label: string,
  direction: 'input' | 'output',
  x: number,
  y: number,
): DiagramViewModel['nodes'][number] {
  return {
    id,
    kind: 'port',
    label,
    ports: [{ id: 'p', name: label, direction }],
    position: { x, y },
  };
}

async function setZoom(page: Page, zoom: number): Promise<void> {
  await page.evaluate((z) => {
    (window as any).reactFlowInstance.zoomTo(z);
  }, zoom);
  await waitForViewportTransformToSettle(page);
}

async function hoverEdgeBridge(page: Page, edgeId: string): Promise<void> {
  const point = await page
    .locator(`.react-flow__edge[data-id="${edgeId}"] path.svsch-edge-bridge`)
    .evaluate((path) => {
      const svgPath = path as SVGPathElement;
      const length = svgPath.getTotalLength();
      const local = svgPath.getPointAtLength(length / 2);
      const matrix = svgPath.getScreenCTM();
      if (!matrix) {
        throw new Error(`Unable to calculate screen coordinates for ${edgeId}`);
      }
      return {
        x: matrix.a * local.x + matrix.c * local.y + matrix.e,
        y: matrix.b * local.x + matrix.d * local.y + matrix.f,
      };
    });

  await page.mouse.move(point.x, point.y);
}

// Buttons are laid out with static CSS px sizing (e.g. height: 22px); the fix
// keeps them within a fraction of a px of that regardless of zoom, so a small
// tolerance absorbs sub-pixel rounding without masking a real regression (an
// un-counter-scaled button would be off by tens of px at these zoom levels).
const SIZE_TOLERANCE_PX = 1.5;
const ZOOM_LEVELS = [1, 0.4, 2];

function createWireControlsView(): DiagramViewModel {
  return {
    moduleName: 'zoom_counter_scale_wire',
    nodes: [
      visualPort('source:a', 'a', 'input', 0, 108),
      visualPort('target:x', 'x', 'output', 360, 108),
    ],
    edges: [
      {
        id: 'edge-a-to-x',
        source: 'source:a',
        target: 'target:x',
        sourcePort: 'p',
        targetPort: 'p',
        signal: 'a',
      },
    ],
    diagnostics: [],
  };
}

function createCutStubView(): DiagramViewModel {
  const netKey = 'a';
  return {
    moduleName: 'zoom_counter_scale_cut_stub',
    nodes: [
      visualPort('source:a', 'a', 'input', 0, 108),
      {
        id: 'cut-label:a:source',
        kind: 'netLabel',
        label: 'a',
        parentModule: 'zoom_counter_scale_cut_stub',
        ports: [{ id: 'cut', name: 'cut', direction: 'input' }],
        position: { x: 144, y: 108 },
        metadata: {
          cutNet: {
            netKey,
            role: 'source',
            align: 'end',
            handleSide: 'left',
            originalEdgeId: 'edge-a-to-x',
          },
        },
      },
    ],
    edges: [
      {
        id: 'cut-stub:a:source',
        source: 'source:a',
        sourcePort: 'p',
        target: 'cut-label:a:source',
        targetPort: 'cut',
        signal: 'a',
        metadata: {
          forceStraight: true,
          cutStub: { netKey, role: 'source', originalEdgeId: 'edge-a-to-x' },
        },
      },
    ],
    diagnostics: [],
  };
}

function createSelectionToolbarView(): DiagramViewModel {
  return {
    moduleName: 'zoom_counter_scale_selection',
    nodes: [
      visualPort('source:a', 'a', 'input', 0, 108),
      visualPort('source:b', 'b', 'input', 0, 204),
      visualPort('target:x', 'x', 'output', 360, 156),
    ],
    edges: [],
    diagnostics: [],
  };
}

test.describe('zoom counter-scale for floating action buttons', () => {
  test('wire hover Reroute/Cut buttons stay a constant screen size across zoom levels', async ({
    page,
  }) => {
    await openView(page, createWireControlsView());
    await page.waitForSelector('[data-node-id="source:a"]');
    await waitForViewportTransformToSettle(page);

    let baselineHeight: number | undefined;
    for (const zoom of ZOOM_LEVELS) {
      await setZoom(page, zoom);
      await hoverEdgeBridge(page, 'edge-a-to-x');
      const cutButton = page.locator(
        '.react-flow__edge[data-id="edge-a-to-x"] .svsch-edge-cut-control',
      );
      await expect(cutButton).toBeVisible();
      const box = await cutButton.boundingBox();
      if (!box) throw new Error(`No bounding box for cut control at zoom ${zoom}`);
      if (baselineHeight === undefined) {
        baselineHeight = box.height;
      } else {
        expect(Math.abs(box.height - baselineHeight)).toBeLessThan(SIZE_TOLERANCE_PX);
      }
    }
  });

  test('cut-stub reset button stays a constant screen size across zoom levels', async ({
    page,
  }) => {
    await openView(page, createCutStubView());
    await page.waitForSelector('[data-node-id="source:a"]');
    await waitForViewportTransformToSettle(page);

    let baselineHeight: number | undefined;
    for (const zoom of ZOOM_LEVELS) {
      await setZoom(page, zoom);
      await hoverEdgeBridge(page, 'cut-stub:a:source');
      const resetButton = page.locator('.svsch-edge-reroute-control-solo');
      await expect(resetButton).toBeVisible();
      const box = await resetButton.boundingBox();
      if (!box) throw new Error(`No bounding box for cut-stub reset button at zoom ${zoom}`);
      if (baselineHeight === undefined) {
        baselineHeight = box.height;
      } else {
        expect(Math.abs(box.height - baselineHeight)).toBeLessThan(SIZE_TOLERANCE_PX);
      }
    }
  });

  test('node selection toolbar buttons stay a constant screen size across zoom levels', async ({
    page,
  }) => {
    await openView(page, createSelectionToolbarView());
    await page.waitForSelector('[data-node-id="source:a"]');
    await waitForViewportTransformToSettle(page);

    // React Flow's multiSelectionKeyCode defaults to Control (see
    // selection_styles.visual.spec.ts) — hold it for real keydown/keyup,
    // not just a per-click ctrlKey flag.
    await page.keyboard.down('Control');
    for (const nodeId of ['source:a', 'source:b']) {
      const box = await page.locator(`[data-node-id="${nodeId}"]`).boundingBox();
      if (!box) throw new Error(`No bounding box for ${nodeId}`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await page.keyboard.up('Control');

    await expect
      .poll(async () =>
        page.evaluate(
          () => (window as any).reactFlowInstance.getNodes().filter((n: any) => n.selected).length,
        ),
      )
      .toBe(2);

    let baselineHeight: number | undefined;
    for (const zoom of ZOOM_LEVELS) {
      await setZoom(page, zoom);
      const autoLayoutButton = page.locator('.svsch-selection-relayout-control');
      await expect(autoLayoutButton).toBeVisible();
      const box = await autoLayoutButton.boundingBox();
      if (!box) throw new Error(`No bounding box for Auto Layout button at zoom ${zoom}`);
      if (baselineHeight === undefined) {
        baselineHeight = box.height;
      } else {
        expect(Math.abs(box.height - baselineHeight)).toBeLessThan(SIZE_TOLERANCE_PX);
      }
    }
  });
});
