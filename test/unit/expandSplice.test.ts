import { describe, expect, it } from 'vitest';
import {
  spliceExpandedInstance,
  boundaryPortEdgeStyle,
  childNamespace,
  namespacedId,
  expandRegionId,
  isExpandNamespacedId,
  EXPAND_CONTENT_INSET,
  EXPAND_RING_PULLBACK,
} from '../../src/webview/expand/splice';
import { absorbSplicedEdgeRouteChanges } from '../../src/webview/expand/expandOverlay';
import { boundaryPortLeadClassName } from '../../src/webview/nodes/BoundaryPortNode';
import type { DesignModule, DiagramEdge, DiagramPort } from '../../src/ir/types';
import { diagramNodeDimensions, resolvedNodeDimensions } from '../../src/diagram/nodeSizing';

// A tiny two-port-plus-register module, standing in for the child module
// being spliced in when its instance is "Expand"ed in place (issue #232).
const clkPort: DiagramPort = { id: 'p:clk', name: 'clk', direction: 'input' };
const aPort: DiagramPort = { id: 'p:a', name: 'a', direction: 'input' };
const sumPort: DiagramPort = { id: 'p:sum', name: 'sum', direction: 'output' };

const childModule: DesignModule = {
  name: 'adder',
  file: 'adder.sv',
  ports: [clkPort, aPort, sumPort],
  nodes: [
    { id: 'port:clk', kind: 'port', label: 'clk', ports: [clkPort] },
    { id: 'port:a', kind: 'port', label: 'a', ports: [aPort] },
    { id: 'port:sum', kind: 'port', label: 'sum', ports: [sumPort] },
    {
      id: 'reg1',
      kind: 'register',
      label: 'reg1',
      ports: [
        { id: 'd', name: 'd', direction: 'input' },
        { id: 'q', name: 'q', direction: 'output' },
      ],
    },
  ],
  edges: [
    {
      id: 'e-clk-reg1',
      source: 'port:clk',
      target: 'reg1',
      sourcePort: 'p:clk',
      targetPort: 'clk',
    },
    { id: 'e-a-reg1', source: 'port:a', target: 'reg1', sourcePort: 'p:a', targetPort: 'd' },
    { id: 'e-reg1-sum', source: 'reg1', target: 'port:sum', sourcePort: 'q', targetPort: 'p:sum' },
  ],
};

const instancePosition = { x: 240, y: 120 };
const instanceSize = { width: 192, height: 96 };
// Instance ports mirror the module's own port list (same names/ids) — the
// contract splice.ts relies on to match an instance port to the child's own
// port-kind node.
const instancePorts: DiagramPort[] = [clkPort, aPort, sumPort];

function baseInput() {
  return {
    namespace: 'u0',
    parentModuleName: 'top',
    instanceId: 'u0',
    instanceLabel: 'u0',
    instancePosition,
    instanceSize,
    instanceParamRows: 0,
    instancePorts,
    childModule,
  };
}

describe('spliceExpandedInstance', () => {
  // eslint-disable-next-line max-len
  it("replaces the child module's own port nodes with namespaced boundary-port nodes anchored to the instance's port positions", async () => {
    const result = await spliceExpandedInstance(baseInput());

    const boundaryNodes = result.nodes.filter((n) => n.kind === 'boundaryPort');
    expect(boundaryNodes).toHaveLength(3);
    for (const node of boundaryNodes) {
      expect(isExpandNamespacedId(node.id)).toBe(true);
    }

    const clkBoundaryId = result.boundaryNodeIdByChildPortName.get('clk');
    const sumBoundaryId = result.boundaryNodeIdByChildPortName.get('sum');
    expect(clkBoundaryId).toBe(namespacedId('u0', 'port:clk'));
    expect(sumBoundaryId).toBe(namespacedId('u0', 'port:sum'));

    const clkNode = result.nodes.find((n) => n.id === clkBoundaryId)!;
    const sumNode = result.nodes.find((n) => n.id === sumBoundaryId)!;
    // Input port -> boundary node's outer (left) edge sits exactly at the
    // instance's own left edge, so the pre-existing external wire (which
    // already terminates there) needs no route change at all.
    expect(clkNode.metadata?.boundaryPort?.outerSide).toBe('left');
    expect(clkNode.position.x).toBe(instancePosition.x);
    // Output port -> boundary node's outer (right) edge sits at the
    // *expanded* node's right border (the node itself grows to contain the
    // spliced diagram — its border is the frame).
    expect(sumNode.metadata?.boundaryPort?.outerSide).toBe('right');
    expect(sumNode.position.x + resolvedNodeDimensions(sumNode).width).toBe(
      instancePosition.x + result.expandedSize.width,
    );
  });

  // eslint-disable-next-line max-len
  it("widens every boundary node in a column to the column's max width so inner handles clear every label in the column", async () => {
    const longPort: DiagramPort = {
      id: 'p:long',
      name: 'a_much_longer_port_name',
      direction: 'input',
    };
    const withLongLabel: DesignModule = {
      ...childModule,
      ports: [clkPort, longPort, sumPort],
      nodes: [
        { id: 'port:clk', kind: 'port', label: 'clk', ports: [clkPort] },
        { id: 'port:long', kind: 'port', label: 'a_much_longer_port_name', ports: [longPort] },
        { id: 'port:sum', kind: 'port', label: 'sum', ports: [sumPort] },
        childModule.nodes.find((n) => n.id === 'reg1')!,
      ],
      edges: [],
    };
    const result = await spliceExpandedInstance({
      ...baseInput(),
      instancePorts: [clkPort, longPort, sumPort],
      childModule: withLongLabel,
    });

    const leftNodes = result.nodes.filter((n) => n.metadata?.boundaryPort?.outerSide === 'left');
    expect(leftNodes).toHaveLength(2);
    const leftWidths = leftNodes.map((n) => resolvedNodeDimensions(n).width);
    // Uniform: the short "clk" node is widened (via sizeOverride) to the long
    // label's column width, so both inner handles land on the same x — a
    // vertical jog just past clk's inner handle can never cross the longer
    // label on the row below.
    expect(new Set(leftWidths).size).toBe(1);
    expect(leftWidths[0]).toBeGreaterThanOrEqual(
      Math.max(...leftNodes.map((n) => diagramNodeDimensions(n).width)),
    );
    // Both nodes still start at the border, so their labels (anchored to the
    // outer edge — see BoundaryPortNode) stay at the pre-expand position.
    for (const node of leftNodes) {
      expect(node.position.x).toBe(instancePosition.x);
    }
  });

  // eslint-disable-next-line max-len
  it('grows the instance node to contain the spliced diagram with label clearances on every side', async () => {
    const result = await spliceExpandedInstance(baseInput());

    // Grow-only: never smaller than the instance's pre-expand size.
    expect(result.expandedSize.width).toBeGreaterThanOrEqual(instanceSize.width);
    expect(result.expandedSize.height).toBeGreaterThanOrEqual(instanceSize.height);
    // Snapped to the grid.
    expect(result.expandedSize.width % 24).toBe(0);
    expect(result.expandedSize.height % 24).toBe(0);

    const reg = result.nodes.find((n) => n.id === namespacedId('u0', 'reg1'))!;
    const regSize = diagramNodeDimensions(reg);
    const boundaryNodes = result.nodes.filter((n) => n.kind === 'boundaryPort');
    const inputWidths = boundaryNodes
      .filter((n) => n.metadata?.boundaryPort?.outerSide === 'left')
      .map((n) => resolvedNodeDimensions(n).width);
    const outputWidths = boundaryNodes
      .filter((n) => n.metadata?.boundaryPort?.outerSide === 'right')
      .map((n) => resolvedNodeDimensions(n).width);

    // The internal diagram sits fully inside the expanded node, clear of the
    // port-label columns on both sides and below the header row.
    expect(reg.position.x).toBeGreaterThanOrEqual(instancePosition.x + Math.max(...inputWidths));
    expect(reg.position.x + regSize.width).toBeLessThanOrEqual(
      instancePosition.x + result.expandedSize.width - Math.max(...outputWidths),
    );
    expect(reg.position.y).toBeGreaterThanOrEqual(instancePosition.y + 48); // below header text
    expect(reg.position.y + regSize.height).toBeLessThanOrEqual(
      instancePosition.y + result.expandedSize.height,
    );
  });

  // eslint-disable-next-line max-len
  it('reports the frame border ring as contentInsets, with the spliced content fully inside the ring', async () => {
    // contentInsets drive the expand ghost's grab bands (see HdlNode's
    // ExpandGrabBands): the frame is only selectable/draggable from the ring,
    // and the area inside it is pointer-transparent canvas — so the ring
    // must exactly clear the spliced content.
    const result = await spliceExpandedInstance(baseInput());
    const insets = result.contentInsets;

    expect(insets.bottom).toBe(EXPAND_CONTENT_INSET - EXPAND_RING_PULLBACK);
    expect(insets.top).toBeGreaterThan(0);

    const boundaryNodes = result.nodes.filter((n) => n.kind === 'boundaryPort');
    const leftColumnWidths = boundaryNodes
      .filter((n) => n.metadata?.boundaryPort?.outerSide === 'left')
      .map((n) => resolvedNodeDimensions(n).width);
    const rightColumnWidths = boundaryNodes
      .filter((n) => n.metadata?.boundaryPort?.outerSide === 'right')
      .map((n) => resolvedNodeDimensions(n).width);
    // Each side's inset clears its boundary-label column up to the half-grid
    // pullback that keeps the drawn inner border off the wire grid.
    expect(insets.left).toBeGreaterThanOrEqual(
      Math.max(...leftColumnWidths) - EXPAND_RING_PULLBACK,
    );
    expect(insets.right).toBeGreaterThanOrEqual(
      Math.max(...rightColumnWidths) - EXPAND_RING_PULLBACK,
    );

    // The internal content sits inside the ring, never under a grab band.
    const reg = result.nodes.find((n) => n.id === namespacedId('u0', 'reg1'))!;
    const regSize = diagramNodeDimensions(reg);
    expect(reg.position.x).toBeGreaterThanOrEqual(instancePosition.x + insets.left);
    expect(reg.position.x + regSize.width).toBeLessThanOrEqual(
      instancePosition.x + result.expandedSize.width - insets.right,
    );
    expect(reg.position.y).toBeGreaterThanOrEqual(instancePosition.y + insets.top);
  });

  // eslint-disable-next-line max-len
  it('keeps the ring tighter than the content padding — the label-clearance gap is sub-canvas, not grab band', async () => {
    // A boundary stub's vertical jog lives in the gap between the label
    // column and the content; the ring (grab bands, visible border, wire
    // clamp) must stop at the label column so that jog stays selectable.
    const result = await spliceExpandedInstance(baseInput());
    const insets = result.contentInsets;

    const boundaryNodes = result.nodes.filter((n) => n.kind === 'boundaryPort');
    const leftColumnWidth = Math.max(
      ...boundaryNodes
        .filter((n) => n.metadata?.boundaryPort?.outerSide === 'left')
        .map((n) => resolvedNodeDimensions(n).width),
    );
    expect(insets.left).toBe(leftColumnWidth - EXPAND_RING_PULLBACK);

    // The content itself sits clear of the ring with the jog gap in between.
    const reg = result.nodes.find((n) => n.id === namespacedId('u0', 'reg1'))!;
    expect(reg.position.x).toBeGreaterThan(instancePosition.x + insets.left);
  });

  // A manual frame resize persists through the snapshot's bounds (see
  // main.tsx's ghost-resize commit / persistActiveSplices): restoring the
  // splice grows the frame back to the saved rect, never shrinking below the
  // content-required size.
  describe('saved manual frame resize', () => {
    it('grows the restored frame to the saved bounds (fallback path)', async () => {
      const base = await spliceExpandedInstance(baseInput());
      const savedLayout = {
        childModuleName: 'adder',
        nodes: { reg1: { x: 400, y: 220, fixed: true } },
        instanceOrigin: instancePosition,
        bounds: {
          x: instancePosition.x,
          y: instancePosition.y,
          width: base.minExpandedSize.width + 240,
          height: base.minExpandedSize.height + 120,
        },
      };
      const result = await spliceExpandedInstance({ ...baseInput(), savedLayout });

      expect(result.expandedSize).toEqual({
        width: savedLayout.bounds.width,
        height: savedLayout.bounds.height,
      });
      // The floor stays the content-required size, so the user can shrink
      // the frame back down to it later.
      expect(result.minExpandedSize.width).toBeLessThan(result.expandedSize.width);
      // The right boundary column sits on the *enlarged* border.
      const right = result.nodes.find((n) => n.metadata?.boundaryPort?.outerSide === 'right')!;
      expect(right.position.x + resolvedNodeDimensions(right).width).toBe(
        instancePosition.x + result.expandedSize.width,
      );
      expect(result.region.bounds.width).toBe(savedLayout.bounds.width);
    });

    it('never shrinks the frame below the content-required size', async () => {
      const savedLayout = {
        childModuleName: 'adder',
        nodes: { reg1: { x: 400, y: 220, fixed: true } },
        instanceOrigin: instancePosition,
        bounds: { x: instancePosition.x, y: instancePosition.y, width: 24, height: 24 },
      };
      const result = await spliceExpandedInstance({ ...baseInput(), savedLayout });
      expect(result.expandedSize).toEqual(result.minExpandedSize);
    });
  });

  // eslint-disable-next-line max-len
  it('still widens the node enough to separate the boundary label columns when the child has no internal nodes at all', async () => {
    // e.g. `assign y = a` — every child node is a port, so the spliced
    // content is just the two boundary columns and a pass-through wire.
    const passThrough: DesignModule = {
      name: 'wirey',
      file: 'wirey.sv',
      ports: [aPort, sumPort],
      nodes: [
        { id: 'port:a', kind: 'port', label: 'a', ports: [aPort] },
        { id: 'port:sum', kind: 'port', label: 'sum', ports: [sumPort] },
      ],
      edges: [
        {
          id: 'e-a-sum',
          source: 'port:a',
          target: 'port:sum',
          sourcePort: 'p:a',
          targetPort: 'p:sum',
        },
      ],
    };
    const result = await spliceExpandedInstance({
      ...baseInput(),
      instancePorts: [aPort, sumPort],
      childModule: passThrough,
    });

    const left = result.nodes.find((n) => n.metadata?.boundaryPort?.outerSide === 'left')!;
    const right = result.nodes.find((n) => n.metadata?.boundaryPort?.outerSide === 'right')!;
    const gap = right.position.x - (left.position.x + resolvedNodeDimensions(left).width);
    // Room for the pass-through wire's Z-route between the two label columns
    // (a lead leaving each inner handle) — otherwise it degenerates into a
    // wrap-around loop.
    expect(gap).toBeGreaterThan(48);
  });

  // eslint-disable-next-line max-len
  it("lays out the child's internal (non-port) nodes via elkjs, namespaced under the instance", async () => {
    const result = await spliceExpandedInstance(baseInput());

    const reg = result.nodes.find((n) => n.id === namespacedId('u0', 'reg1'));
    expect(reg).toBeDefined();
    expect(reg?.kind).toBe('register');
    expect(Number.isFinite(reg?.position.x)).toBe(true);
    expect(Number.isFinite(reg?.position.y)).toBe(true);
  });

  // eslint-disable-next-line max-len
  it("rewires internal edges onto the namespaced nodes, pointing a former child-port endpoint at the boundary node's inner handle", async () => {
    const result = await spliceExpandedInstance(baseInput());

    const clkEdge = result.edges.find((e) => e.id === namespacedId('u0', 'e-clk-reg1'));
    expect(clkEdge).toBeDefined();
    expect(clkEdge?.source).toBe(namespacedId('u0', 'port:clk'));
    expect(clkEdge?.sourcePort).toBe('inner');
    expect(clkEdge?.target).toBe(namespacedId('u0', 'reg1'));
    expect(clkEdge?.targetPort).toBe('clk'); // untouched — real node ports aren't namespaced
    // No stale absolute-coordinate route carried over from the child's own
    // standalone layout — OrthogonalEdge derives a fresh default route from
    // the real (live) handle positions when none is supplied.
    expect(clkEdge?.routePoints).toBeUndefined();
    expect(clkEdge?.waypoint).toBeUndefined();

    const sumEdge = result.edges.find((e) => e.id === namespacedId('u0', 'e-reg1-sum'));
    expect(sumEdge?.source).toBe(namespacedId('u0', 'reg1'));
    expect(sumEdge?.target).toBe(namespacedId('u0', 'port:sum'));
    expect(sumEdge?.targetPort).toBe('inner');
  });

  // eslint-disable-next-line max-len
  it("produces a region shaped like the rest of the region overlay machinery, with bounds exactly the expanded node's rect", async () => {
    const result = await spliceExpandedInstance(baseInput());

    expect(result.region.id).toBe(expandRegionId('u0'));
    expect(result.region.kind).toBe('expand');
    expect(result.region.expandedInstance).toEqual({
      instanceId: 'u0',
      childModuleName: 'adder',
      parentModuleName: 'top',
    });
    expect(new Set(result.region.nodeIds)).toEqual(new Set(result.nodes.map((n) => n.id)));
    // The region is never rendered as its own frame — the expanded node is
    // the frame, so the region's bounds are exactly the node's rect.
    expect(result.region.bounds).toEqual({
      x: instancePosition.x,
      y: instancePosition.y,
      width: result.expandedSize.width,
      height: result.expandedSize.height,
    });
  });

  // eslint-disable-next-line max-len
  it("round-trips through toSavedLayout keyed by the child module's own (unnamespaced) node ids, boundary nodes excluded", async () => {
    const result = await spliceExpandedInstance(baseInput());
    const saved = result.toSavedLayout(result.nodes, result.region.bounds, true, instancePosition);

    expect(saved.childModuleName).toBe('adder');
    expect(Object.keys(saved.nodes)).toEqual(['reg1']);
    expect(saved.instanceOrigin).toEqual(instancePosition);
    expect(saved.fixed).toBe(true);
  });

  // eslint-disable-next-line max-len
  it("reuses a saved snapshot verbatim when the instance hasn't moved since it was saved", async () => {
    const savedLayout = {
      childModuleName: 'adder',
      nodes: { reg1: { x: 999, y: 111, fixed: true } },
      instanceOrigin: instancePosition,
    };
    const result = await spliceExpandedInstance({ ...baseInput(), savedLayout });
    const reg = result.nodes.find((n) => n.id === namespacedId('u0', 'reg1'));
    expect(reg?.position).toEqual({ x: 999, y: 111 });
  });

  // eslint-disable-next-line max-len
  it('rigidly translates a saved snapshot when the instance has moved since it was saved', async () => {
    const savedLayout = {
      childModuleName: 'adder',
      nodes: { reg1: { x: 100, y: 50, fixed: true } },
      instanceOrigin: { x: 0, y: 0 },
    };
    // Instance is now at (240, 120) — 240 right, 120 down from where it was
    // when this snapshot was saved.
    const result = await spliceExpandedInstance({ ...baseInput(), savedLayout });
    const reg = result.nodes.find((n) => n.id === namespacedId('u0', 'reg1'));
    expect(reg?.position).toEqual({ x: 340, y: 170 });
  });

  it('namespaces recursively for a nested Expand (expand-of-an-expanded-instance)', async () => {
    const nestedNamespace = childNamespace('u0', 'u1');
    expect(nestedNamespace).toBe('u0::u1');
    const result = await spliceExpandedInstance({
      ...baseInput(),
      namespace: nestedNamespace,
      parentModuleName: 'adder',
      instanceId: 'u1',
      parentRegionId: expandRegionId('u0'),
    });
    expect(result.region.parentRegionId).toBe(expandRegionId('u0'));
    expect(result.nodes.every((n) => n.id.startsWith(namespacedId(nestedNamespace, '')))).toBe(
      true,
    );
  });

  // The host-computed frame-local layout (src/layout/expandLayout.ts — the
  // child's standalone place-and-route with ports dropped and boundary stubs
  // libavoid-routed) is authoritative for a fresh expand: the webview only
  // translates it to the instance's canvas position and namespaces the ids.
  describe('host-computed splice layout', () => {
    const hostLayout = () => ({
      nodes: [
        {
          id: 'port:a',
          kind: 'boundaryPort' as const,
          label: 'a',
          ports: [aPort],
          metadata: {
            boundaryPort: {
              instanceId: 'u0',
              childModuleName: 'adder',
              childPortId: 'port:a',
              outerSide: 'left' as const,
            },
          },
          position: { x: 0, y: 36 },
        },
        {
          id: 'reg1',
          kind: 'register' as const,
          label: 'reg1',
          ports: [],
          position: { x: 120, y: 64 },
        },
      ],
      edges: [
        {
          id: 'e-a-reg1',
          source: 'port:a',
          sourcePort: 'inner',
          target: 'reg1',
          targetPort: 'd',
          routePoints: [
            { x: 80, y: 44 },
            { x: 80, y: 72 },
          ],
        },
      ],
      expandedSize: { width: 400, height: 200 },
    });

    // eslint-disable-next-line max-len
    it('translates the frame-local layout to the instance position and namespaces the ids', async () => {
      const result = await spliceExpandedInstance({ ...baseInput(), hostLayout: hostLayout() });

      const reg = result.nodes.find((n) => n.id === namespacedId('u0', 'reg1'));
      expect(reg?.position).toEqual({ x: 120 + instancePosition.x, y: 64 + instancePosition.y });
      const boundary = result.nodes.find((n) => n.id === namespacedId('u0', 'port:a'));
      expect(boundary?.kind).toBe('boundaryPort');
      expect(boundary?.position).toEqual({ x: instancePosition.x, y: 36 + instancePosition.y });
      expect(result.boundaryNodeIdByChildPortName.get('a')).toBe(namespacedId('u0', 'port:a'));

      expect(result.expandedSize).toEqual({ width: 400, height: 200 });
      expect(result.region.bounds).toEqual({
        x: instancePosition.x,
        y: instancePosition.y,
        width: 400,
        height: 200,
      });
    });

    // eslint-disable-next-line max-len
    it('derives the same contentInsets as the webview-local path — the ring depends only on ports and header rows', async () => {
      const fallback = await spliceExpandedInstance(baseInput());
      const hosted = await spliceExpandedInstance({ ...baseInput(), hostLayout: hostLayout() });
      expect(hosted.contentInsets).toEqual(fallback.contentInsets);
    });

    it("keeps the host's routes, translated with the content", async () => {
      const result = await spliceExpandedInstance({ ...baseInput(), hostLayout: hostLayout() });
      const edge = result.edges.find((e) => e.id === namespacedId('u0', 'e-a-reg1'));
      expect(edge?.source).toBe(namespacedId('u0', 'port:a'));
      expect(edge?.sourcePort).toBe('inner');
      expect(edge?.routePoints).toEqual([
        { x: 80 + instancePosition.x, y: 44 + instancePosition.y },
        { x: 80 + instancePosition.x, y: 72 + instancePosition.y },
      ]);
    });

    // eslint-disable-next-line max-len
    it('applies a saved manual frame enlargement on top of the host layout, carrying the right column to the wider border', async () => {
      const withRightBoundary = {
        ...hostLayout(),
        nodes: [
          ...hostLayout().nodes,
          {
            id: 'port:sum',
            kind: 'boundaryPort' as const,
            label: 'sum',
            ports: [sumPort],
            metadata: {
              boundaryPort: {
                instanceId: 'u0',
                childModuleName: 'adder',
                childPortId: 'port:sum',
                outerSide: 'right' as const,
              },
            },
            position: { x: 400 - 72, y: 36 },
          },
        ],
        edges: [
          ...hostLayout().edges,
          {
            id: 'e-reg1-sum',
            source: 'reg1',
            sourcePort: 'q',
            target: 'port:sum',
            targetPort: 'inner',
            routePoints: [
              { x: 300, y: 72 },
              { x: 300, y: 44 },
            ],
          },
        ],
      };
      const savedLayout = {
        childModuleName: 'adder',
        // Bounds only — no covering node snapshot, so the host layout stays
        // authoritative for placement.
        nodes: {},
        instanceOrigin: instancePosition,
        bounds: { x: instancePosition.x, y: instancePosition.y, width: 520, height: 200 },
      };
      const result = await spliceExpandedInstance({
        ...baseInput(),
        savedLayout,
        hostLayout: withRightBoundary,
      });

      expect(result.expandedSize).toEqual({ width: 520, height: 200 });
      expect(result.minExpandedSize).toEqual({ width: 400, height: 200 });
      const right = result.nodes.find((n) => n.id === namespacedId('u0', 'port:sum'))!;
      expect(right.position.x).toBe(instancePosition.x + 520 - 72);
      // The left column doesn't move, and its host route survives.
      const left = result.nodes.find((n) => n.id === namespacedId('u0', 'port:a'))!;
      expect(left.position.x).toBe(instancePosition.x);
      const leftEdge = result.edges.find((e) => e.id === namespacedId('u0', 'e-a-reg1'));
      expect(leftEdge?.routePoints).toBeDefined();
      // The shifted column's stub route is stale against the new border —
      // dropped so it re-derives from the live handles.
      const rightEdge = result.edges.find((e) => e.id === namespacedId('u0', 'e-reg1-sum'));
      expect(rightEdge?.routePoints).toBeUndefined();
    });

    // eslint-disable-next-line max-len
    it('lets a covering saved snapshot win over the host layout, dropping its stale routes', async () => {
      const savedLayout = {
        childModuleName: 'adder',
        nodes: { reg1: { x: 999, y: 111, fixed: true } },
        instanceOrigin: instancePosition,
      };
      const result = await spliceExpandedInstance({
        ...baseInput(),
        savedLayout,
        hostLayout: hostLayout(),
      });

      const reg = result.nodes.find((n) => n.id === namespacedId('u0', 'reg1'));
      expect(reg?.position).toEqual({ x: 999, y: 111 });
      // The edge set still comes from the host layout (labels, cut stubs),
      // but its routes are stale against the saved positions.
      const edge = result.edges.find((e) => e.id === namespacedId('u0', 'e-a-reg1'));
      expect(edge?.routePoints).toBeUndefined();
      // Boundary nodes are re-derived locally in this path.
      expect(result.nodes.some((n) => n.id === namespacedId('u0', 'port:a'))).toBe(true);
    });
  });

  // The lead stub a boundary-port node draws is a continuation of the wire
  // passing through the port — it must carry the same struct/interface/
  // multi-bit style as the child module's own annotated edges on that net.
  describe('boundary port wire style', () => {
    const styledPorts: DiagramPort[] = [
      { id: 'p:bus', name: 'bus', direction: 'input', width: '[7:0]' },
      { id: 'p:pkt', name: 'pkt', direction: 'input', typeName: 'packet_t' },
      { id: 'p:bit', name: 'bit', direction: 'output' },
    ];
    const styledChild: DesignModule = {
      name: 'styled',
      file: 'styled.sv',
      ports: styledPorts,
      nodes: [
        { id: 'port:bus', kind: 'port', label: 'bus', ports: [styledPorts[0]] },
        { id: 'port:pkt', kind: 'port', label: 'pkt', ports: [styledPorts[1]] },
        { id: 'port:bit', kind: 'port', label: 'bit', ports: [styledPorts[2]] },
        childModule.nodes.find((n) => n.id === 'reg1')!,
      ],
      edges: [
        // annotateWireStyles has already run on real extracted modules — the
        // stamps live on edge.metadata.
        {
          id: 'e-bus',
          source: 'port:bus',
          target: 'reg1',
          sourcePort: 'p:bus',
          targetPort: 'd',
          metadata: { thick: true },
        },
        {
          id: 'e-pkt',
          source: 'port:pkt',
          target: 'reg1',
          sourcePort: 'p:pkt',
          targetPort: 'd',
          metadata: { aggregate: 'struct' },
        },
        { id: 'e-bit', source: 'reg1', target: 'port:bit', sourcePort: 'q', targetPort: 'p:bit' },
      ],
    };

    it('stamps edgeStyle from the annotated edges touching each port node', () => {
      const busNode = styledChild.nodes.find((n) => n.id === 'port:bus')!;
      const pktNode = styledChild.nodes.find((n) => n.id === 'port:pkt')!;
      const bitNode = styledChild.nodes.find((n) => n.id === 'port:bit')!;
      expect(boundaryPortEdgeStyle(styledChild, busNode, styledPorts[0])).toEqual({
        aggregate: undefined,
        thick: true,
      });
      expect(boundaryPortEdgeStyle(styledChild, pktNode, styledPorts[1])?.aggregate).toBe('struct');
      expect(boundaryPortEdgeStyle(styledChild, bitNode, styledPorts[2])).toBeUndefined();
    });

    it('falls back to the port declaration when the port is unconnected inside', () => {
      const unconnected: DesignModule = { ...styledChild, edges: [] };
      const busNode = unconnected.nodes.find((n) => n.id === 'port:bus')!;
      const bitNode = unconnected.nodes.find((n) => n.id === 'port:bit')!;
      expect(boundaryPortEdgeStyle(unconnected, busNode, styledPorts[0])?.thick).toBe(true);
      expect(boundaryPortEdgeStyle(unconnected, bitNode, styledPorts[2])).toBeUndefined();
      const ifacePort: DiagramPort = {
        id: 'p:bus',
        name: 'bus',
        direction: 'input',
        width: 'interface',
      };
      expect(boundaryPortEdgeStyle(unconnected, busNode, ifacePort)?.aggregate).toBe('interface');
    });

    // eslint-disable-next-line max-len
    it('carries the style onto the spliced boundary nodes so the rendered lead can match', async () => {
      const result = await spliceExpandedInstance({
        ...baseInput(),
        instancePorts: styledPorts,
        childModule: styledChild,
      });
      const bus = result.nodes.find((n) => n.id === namespacedId('u0', 'port:bus'));
      const pkt = result.nodes.find((n) => n.id === namespacedId('u0', 'port:pkt'));
      const bit = result.nodes.find((n) => n.id === namespacedId('u0', 'port:bit'));
      expect(bus?.metadata?.boundaryPort?.edgeStyle?.thick).toBe(true);
      expect(pkt?.metadata?.boundaryPort?.edgeStyle?.aggregate).toBe('struct');
      expect(bit?.metadata?.boundaryPort?.edgeStyle).toBeUndefined();
    });
  });

  // Route drags on wires inside an expanded instance stay entirely in the
  // webview: they're absorbed into the splice cache (so they survive the next
  // reattachment) and never leak to the extension host, which knows nothing
  // about spliced edge ids.
  describe('absorbSplicedEdgeRouteChanges', () => {
    it('stores spliced changes on the owning splice and returns only host-owned ones', async () => {
      const result = await spliceExpandedInstance(baseInput());
      // Only `edges` matters here — the rest of the ActiveSplice bookkeeping
      // fields aren't consulted by the absorb path.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const splices = new Map<string, any>([['u0', { ...result, namespace: 'u0' }]]);
      const splicedEdgeId = namespacedId('u0', 'e-a-reg1');
      const route = [
        { x: 10, y: 20 },
        { x: 10, y: 80 },
      ];
      const remaining = absorbSplicedEdgeRouteChanges(splices, [
        { edgeId: splicedEdgeId, routePoints: route },
        { edgeId: 'host-edge', routePoints: [{ x: 1, y: 2 }] },
      ]);
      expect(remaining).toEqual([{ edgeId: 'host-edge', routePoints: [{ x: 1, y: 2 }] }]);
      const stored = splices
        .get('u0')!
        .edges.find((edge: DiagramEdge) => edge.id === splicedEdgeId);
      expect(stored?.routePoints).toEqual(route);
      // Untouched spliced edges keep their (absent) route.
      const other = splices
        .get('u0')!
        .edges.find((edge: DiagramEdge) => edge.id === namespacedId('u0', 'e-clk-reg1'));
      expect(other?.routePoints).toBeUndefined();
    });
  });
});

// The rendered lead's CSS classes mirror the stamped style — locked in here
// (and visually via the expand_instance visual spec's complex fixture).
describe('boundaryPortLeadClassName', () => {
  it('maps edgeStyle onto the lead modifier classes', () => {
    expect(boundaryPortLeadClassName(undefined)).toBe('hdl-boundary-port-lead');
    expect(boundaryPortLeadClassName({ thick: true })).toBe(
      'hdl-boundary-port-lead hdl-boundary-port-lead-thick',
    );
    expect(boundaryPortLeadClassName({ aggregate: 'struct' })).toBe(
      'hdl-boundary-port-lead hdl-boundary-port-lead-struct',
    );
    expect(boundaryPortLeadClassName({ aggregate: 'interface' })).toBe(
      'hdl-boundary-port-lead hdl-boundary-port-lead-interface',
    );
  });
});
