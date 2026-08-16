import { test } from '@playwright/test';
import { openView, expectGraphAndScreenshot, fitGraphView, paddedAllNodesClip } from './helper';
import { diagramNodeDimensions } from '../../src/diagram/nodeSizing';
import { gateInputPortCenterY } from '../../src/diagram/muxGeometry';
import type { DiagramViewModel, DiagramNode, DiagramEdge, PositionedNode, GateOperation } from '../../src/ir/types';

// Regression coverage for the curved-left-edge wire gap: OR/NOR/XOR/XNOR gates
// have a concave back curve that recedes away from x=0 everywhere except the
// very top/bottom of the body (see orBodyPath/gateConcaveEdgeReachX in
// GateNodeSvg.tsx). A wire routed flush to the port used to stop short of
// that curve, leaving a visible gap; extendTargetIntoGate now pushes it past
// the curve so it disappears under the node's fill instead. AND/NAND's flat
// left edge never had this problem — they're excluded here on purpose.
//
// One gate per (operation, input count) combination, each fed by that many
// individual driver ports so every input row — including the ones nearest
// the top/bottom margin and the ones deep in the middle of a tall 10-input
// gate — gets its own wire crossing the curve.

const GATE_OPS: GateOperation[] = ['or', 'nor', 'xor', 'xnor'];
const INPUT_COUNTS = [2, 3, 4, 5, 10];

// Horizontal room reserved for each driver port + its wire before the gate's
// own left edge. Comfortably wider than a short-label port node so the wire
// itself stays visible instead of the port and gate touching.
const SOURCE_RUNWAY = 260;
const COLUMN_GAP = 60;
const ROW_GAP = 48;
// Half of diagramSizing.portHeight — a 'port' node centers its single handle
// vertically, so this is the offset from the node's top edge to the handle.
const PORT_HANDLE_OFFSET = 12;

function buildGateNode(op: GateOperation, count: number, id: string): DiagramNode {
  const ports: DiagramNode['ports'] = [];
  for (let i = 0; i < count; i += 1) {
    ports.push({ id: `in${i}`, name: `in${i}`, direction: 'input' });
  }
  ports.push({ id: 'out', name: 'y', direction: 'output' });
  return {
    id,
    kind: 'gate',
    label: `${op} ×${count}`,
    operation: op,
    ports
  };
}

// direction: 'input' renders as a module input port — a signal *source* whose
// handle sits on its right edge (see HdlNode.tsx's 'port' branch), matching
// how real diagrams draw the driving end of a net on the left of the canvas.
function buildDriverPort(id: string, label: string): DiagramNode {
  return {
    id,
    kind: 'port',
    label,
    ports: [{ id: 'p', name: label, direction: 'input' }]
  };
}

function buildView(): DiagramViewModel {
  const nodes: PositionedNode[] = [];
  const edges: DiagramEdge[] = [];

  let y = 0;
  for (const count of INPUT_COUNTS) {
    let x = 0;
    let rowHeight = 0;
    for (const op of GATE_OPS) {
      const gateId = `gate_${op}_${count}`;
      const gateNode = buildGateNode(op, count, gateId);
      const { width, height } = diagramNodeDimensions(gateNode);
      rowHeight = Math.max(rowHeight, height);

      const gateX = x + SOURCE_RUNWAY;
      nodes.push({ ...gateNode, position: { x: gateX, y } });

      for (let i = 0; i < count; i += 1) {
        const targetHandleY = y + gateInputPortCenterY(i, count, height);
        const sourceId = `${gateId}_src${i}`;
        nodes.push({
          ...buildDriverPort(sourceId, `${op}${count}i${i}`),
          position: { x, y: targetHandleY - PORT_HANDLE_OFFSET }
        });
        edges.push({
          id: `${sourceId}_edge`,
          source: sourceId,
          target: gateId,
          sourcePort: 'p',
          targetPort: `in${i}`
        });
      }

      x += SOURCE_RUNWAY + width + COLUMN_GAP;
    }
    y += rowHeight + ROW_GAP;
  }

  return {
    moduleName: 'gate_curved_edge_grid',
    nodes,
    edges,
    diagnostics: []
  };
}

test.describe('gate curved-left-edge wire routing', () => {
  test.use({ viewport: { width: 1700, height: 1700 } });

  test('wires reach the concave edge of OR/NOR/XOR/XNOR gates for 2, 3, 4, 5, and 10 inputs', async ({ page }) => {
    const view = buildView();

    await openView(page, view);
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.react-flow__node').length >= expected,
      view.nodes.length
    );
    await fitGraphView(page, 0.05);

    await expectGraphAndScreenshot(page, 'gate-curved-edge-grid.png', {
      clip: await paddedAllNodesClip(page)
    });
  });
});
