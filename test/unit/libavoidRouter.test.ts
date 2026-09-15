import { AvoidLib } from 'libavoid-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { diagramNodeDimensions, resolvedNodeDimensions } from '../../src/diagram/nodeSizing';
import type { DiagramEdge, PositionedNode } from '../../src/ir/types';
import {
  routeDiagramWithLibavoid,
  setLibavoidRuntimeForTests,
  type RoutingLeadPoint,
} from '../../src/layout/libavoidRouter';
import { renderedLeadPoint } from '../../src/layout/mergeLayout';
import { simplifyOrthogonalRoute } from '../../src/layout/orthogonalRouteSimplifier';

beforeAll(async () => {
  await AvoidLib.load();
  setLibavoidRuntimeForTests(AvoidLib.getInstance());
});

function node(id: string, x: number, y: number, ports: PositionedNode['ports']): PositionedNode {
  return { id, kind: 'comb', label: id, ports, position: { x, y }, fixed: true };
}

describe('libavoid production router', () => {
  it('routes a fixed-node fanout through a shared trunk', async () => {
    const source = node('source', 0, 96, [{ id: 'out', name: 'out', direction: 'output' }]);
    const upper = node('upper', 480, 24, [{ id: 'in', name: 'in', direction: 'input' }]);
    const lower = node('lower', 480, 216, [{ id: 'in', name: 'in', direction: 'input' }]);
    const nodes = [source, upper, lower];
    const edges: DiagramEdge[] = [
      { id: 'to-upper', source: source.id, sourcePort: 'out', target: upper.id, targetPort: 'in' },
      { id: 'to-lower', source: source.id, sourcePort: 'out', target: lower.id, targetPort: 'in' },
    ];
    const leads = leadResolver(nodes);
    const originalPositions = nodes.map((candidate) => ({ ...candidate.position }));

    const results = await Promise.all(
      Array.from({ length: 5 }, () => routeDiagramWithLibavoid(nodes, edges, leads)),
    );

    for (const result of results) {
      expect([...result.rejectedNets]).toEqual([]);
      expect(result.routes.size).toBe(2);
      const upperRoute = result.routes.get('to-upper')!;
      const lowerRoute = result.routes.get('to-lower')!;
      expect(upperRoute.slice(0, 2)).toEqual(lowerRoute.slice(0, 2));
      expect(routeIsOrthogonal(upperRoute)).toBe(true);
      expect(routeIsOrthogonal(lowerRoute)).toBe(true);
    }

    expect(nodes.map((candidate) => candidate.position)).toEqual(originalPositions);
  });

  it('rejects an entire fanout net when normalized routes hit an obstacle', async () => {
    const source = node('source', 0, 96, [{ id: 'out', name: 'out', direction: 'output' }]);
    const blocker = node('blocker', 240, 96, []);
    const upper = node('upper', 480, 24, [{ id: 'in', name: 'in', direction: 'input' }]);
    const lower = node('lower', 480, 216, [{ id: 'in', name: 'in', direction: 'input' }]);
    const nodes = [source, blocker, upper, lower];
    const edges: DiagramEdge[] = [
      { id: 'to-upper', source: source.id, sourcePort: 'out', target: upper.id, targetPort: 'in' },
      { id: 'to-lower', source: source.id, sourcePort: 'out', target: lower.id, targetPort: 'in' },
    ];

    const result = await routeDiagramWithLibavoid(nodes, edges, leadResolver(nodes));

    expect(result.routes.size).toBe(0);
    expect(result.rejectedNets.get('source:out')).toBe('intersects node blocker');
  });

  it('keeps side-port endpoint corridors horizontal', async () => {
    const source = node('source', 0, 168, [{ id: 'out', name: 'out', direction: 'output' }]);
    const target = node('target', 480, 24, [{ id: 'in', name: 'in', direction: 'input' }]);
    const edges: DiagramEdge[] = [
      {
        id: 'staggered',
        source: source.id,
        sourcePort: 'out',
        target: target.id,
        targetPort: 'in',
      },
    ];

    const result = await routeDiagramWithLibavoid(
      [source, target],
      edges,
      leadResolver([source, target]),
    );
    const route = result.routes.get('staggered')!;

    expect(result.rejectedNets.size).toBe(0);
    expect(route.length).toBeGreaterThanOrEqual(4);
    expect(route[1].y).toBe(route[0].y);
    expect(route.at(-2)!.y).toBe(route.at(-1)!.y);
  });

  // Regression for the FSM-rebuild partial-diagram scene (PR #408 review):
  // the IDLE cut label sits one grid row below the register's D pin, so its
  // obstacle margin used to swallow the pin and make it unreachable —
  // libavoid degraded the connector to a straight line into the shape
  // centre, the whole net was rejected, and the rendered fallback route ran
  // straight through the latch and register bodies.
  it('keeps a pin routable when a cut label margin reaches its port row', async () => {
    const cutLabel = (
      id: string,
      text: string,
      x: number,
      y: number,
      role: 'source' | 'sink',
      handleSide: 'left' | 'right' | 'top' | 'bottom',
    ): PositionedNode => ({
      id,
      kind: 'netLabel',
      label: text,
      ports: [{ id: 'cut', name: 'cut', direction: role === 'source' ? 'input' : 'output' }],
      metadata: { cutNet: { netKey: id, role, align: 'start', handleSide } },
      position: { x, y },
    });
    const nodes: PositionedNode[] = [
      cutLabel('lbl-idle', 'IDLE', 24, 96, 'sink', 'right'),
      cutLabel('lbl-net2-sink', 'NET_2', 24, 240, 'sink', 'right'),
      cutLabel('lbl-net2-src', 'NET_2', 816, 360, 'source', 'left'),
      cutLabel('lbl-net3-sink', 'NET_3', 528, 360, 'sink', 'right'),
      cutLabel('lbl-clk', 'clk', -72, 72, 'sink', 'right'),
      cutLabel('lbl-nse', 'next_state_en', 648, 264, 'sink', 'bottom'),
      cutLabel('lbl-rstn', 'rst_n', 168, 168, 'sink', 'right'),
      cutLabel('lbl-r-src', 'r', 312, 48, 'source', 'left'),
      {
        id: 'latch',
        kind: 'latch',
        label: 'next_r',
        width: '[1:0]',
        ports: [
          { id: 'd', name: 'D', direction: 'input' },
          { id: 'q', name: 'Q', direction: 'output' },
        ],
        position: { x: 144, y: 216 },
      },
      {
        id: 'mux',
        kind: 'mux',
        label: 'if next_state_en',
        ports: [
          { id: 'sel', name: 's', direction: 'input' },
          { id: 'in:true', name: 'true', direction: 'input', width: '[1:0]' },
          { id: 'in:false', name: 'false', direction: 'input', width: '[1:0]' },
          { id: 'out', name: 'out', direction: 'output', width: '[1:0]' },
        ],
        position: { x: 648, y: 336 },
      },
      {
        id: 'reg',
        kind: 'register',
        label: 'r',
        typeName: 'state_t',
        metadata: { clockSignal: 'clk', resetSignal: 'rst_n', resetActiveLow: true },
        ports: [
          { id: 'd', name: 'D', direction: 'input' },
          { id: 'rv', name: 'RV', direction: 'input' },
          { id: 'q', name: 'Q', direction: 'output' },
          { id: 'clk', name: 'clk', direction: 'input' },
          { id: 'rst_n', name: 'rst_n', direction: 'input' },
        ],
        position: { x: 144, y: 24 },
      },
    ];
    const edges: DiagramEdge[] = [
      { id: 'latch-mux', source: 'latch', sourcePort: 'q', target: 'mux', targetPort: 'in:false' },
      { id: 'latch-reg', source: 'latch', sourcePort: 'q', target: 'reg', targetPort: 'd' },
    ];
    const nodesById = new Map<string, PositionedNode>(nodes.map((item) => [item.id, item]));
    const positions = new Map(nodes.map((item) => [item.id, item.position]));

    const result = await routeDiagramWithLibavoid(nodes, edges, (nodeId, portId, lead, role) =>
      renderedLeadPoint(nodeId, portId, nodesById, positions, lead, role),
    );

    expect([...result.rejectedNets]).toEqual([]);
    for (const edge of edges) {
      const route = result.routes.get(edge.id)!;
      expect(routeIsOrthogonal(route)).toBe(true);
      for (const body of ['latch', 'mux', 'reg']) {
        const target = nodesById.get(body)!;
        const size = resolvedNodeDimensions(target);
        const intersects = route.slice(1).some((point, index) => {
          const previous = route[index];
          const minX = Math.min(previous.x, point.x);
          const maxX = Math.max(previous.x, point.x);
          const minY = Math.min(previous.y, point.y);
          const maxY = Math.max(previous.y, point.y);
          return (
            maxX > target.position.x &&
            minX < target.position.x + size.width &&
            maxY > target.position.y &&
            minY < target.position.y + size.height
          );
        });
        expect(intersects, `${edge.id} crosses ${body}`).toBe(false);
      }
    }
  });
});

describe('single-connection dogleg simplification', () => {
  it('removes the lower-lane dip before a bottom-facing target', () => {
    const route = [
      { x: 240, y: 240 },
      { x: 264, y: 240 },
      { x: 312, y: 240 },
      { x: 312, y: 336 },
      { x: 384, y: 336 },
      { x: 384, y: 312 },
      { x: 552, y: 312 },
      { x: 552, y: 264 },
    ];

    expect(simplifyOrthogonalRoute(route, [], [])).toEqual([
      { x: 240, y: 240 },
      { x: 312, y: 240 },
      { x: 312, y: 312 },
      { x: 552, y: 312 },
      { x: 552, y: 264 },
    ]);
  });

  it('removes the stacked feedback dip without changing the required wrap', () => {
    const route = [
      { x: 1281, y: 144 },
      { x: 1296, y: 144 },
      { x: 1296, y: 216 },
      { x: 672, y: 216 },
      { x: 672, y: 240 },
      { x: 600, y: 240 },
      { x: 600, y: 168 },
      { x: 336, y: 168 },
      { x: 336, y: 240 },
      { x: 351, y: 240 },
    ];

    expect(simplifyOrthogonalRoute(route, [], [])).toEqual([
      { x: 1281, y: 144 },
      { x: 1296, y: 144 },
      { x: 1296, y: 216 },
      { x: 600, y: 216 },
      { x: 600, y: 168 },
      { x: 336, y: 168 },
      { x: 336, y: 240 },
      { x: 351, y: 240 },
    ]);
  });

  it.each([0, 1, 2, 3])('applies the same simplification after %s quarter turns', (turns) => {
    const route = [
      { x: 144, y: 0 },
      { x: 72, y: 0 },
      { x: 72, y: 24 },
      { x: 24, y: 24 },
      { x: 24, y: -48 },
      { x: -48, y: -48 },
    ].map((point) => rotatePoint(point, turns));

    const simplified = simplifyOrthogonalRoute(route, [], []);

    expect(simplified).toEqual(
      [
        { x: 144, y: 0 },
        { x: 24, y: 0 },
        { x: 24, y: -48 },
        { x: -48, y: -48 },
      ].map((point) => rotatePoint(point, turns)),
    );
  });

  it('keeps a dogleg when the shorter replacement would hit an obstacle', () => {
    const route = [
      { x: 144, y: 0 },
      { x: 72, y: 0 },
      { x: 72, y: 24 },
      { x: 24, y: 24 },
      { x: 24, y: -48 },
    ];

    expect(simplifyOrthogonalRoute(route, [{ x: 36, y: -12, width: 12, height: 24 }], [])).toEqual(
      route,
    );
  });

  it('uses the mirrored elbow when an obstacle blocks the preferred shortcut', () => {
    const route = [
      { x: 144, y: 360 },
      { x: 216, y: 360 },
      { x: 216, y: 552 },
      { x: 384, y: 552 },
      { x: 384, y: 528 },
      { x: 456, y: 528 },
    ];

    expect(
      simplifyOrthogonalRoute(route, [{ x: 212, y: 452, width: 152, height: 104 }], []),
    ).toEqual([
      { x: 144, y: 360 },
      { x: 384, y: 360 },
      { x: 384, y: 528 },
      { x: 456, y: 528 },
    ]);
  });

  it('keeps a dogleg when the shorter replacement would add shared-path overlap', () => {
    const route = [
      { x: 144, y: 0 },
      { x: 72, y: 0 },
      { x: 72, y: 24 },
      { x: 24, y: 24 },
      { x: 24, y: -48 },
    ];
    const peer = [
      { x: 36, y: 0 },
      { x: 60, y: 0 },
    ];

    expect(simplifyOrthogonalRoute(route, [], [peer])).toEqual(route);
  });

  it('keeps a dogleg when the shorter replacement would add a crossing', () => {
    const route = [
      { x: 144, y: 0 },
      { x: 72, y: 0 },
      { x: 72, y: 24 },
      { x: 24, y: 24 },
      { x: 24, y: -48 },
    ];
    const peer = [
      { x: 48, y: -12 },
      { x: 48, y: 12 },
    ];

    expect(simplifyOrthogonalRoute(route, [], [peer])).toEqual(route);
  });
});

function leadResolver(nodes: PositionedNode[]) {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  return (
    nodeId: string,
    portId: string | undefined,
    includeLeadMargins: boolean,
  ): RoutingLeadPoint | undefined => {
    const candidate = byId.get(nodeId);
    const port = candidate?.ports.find((item) => item.id === portId);
    if (!candidate || !port) return undefined;
    const size = diagramNodeDimensions(candidate);
    const side = port.direction === 'output' ? 'EAST' : 'WEST';
    const x = side === 'EAST' ? candidate.position.x + size.width : candidate.position.x;
    return {
      point: {
        x: x + (includeLeadMargins ? (side === 'EAST' ? 24 : -24) : 0),
        y: candidate.position.y + size.height / 2,
      },
      side,
    };
  };
}

function routeIsOrthogonal(points: Array<{ x: number; y: number }>): boolean {
  return points
    .slice(1)
    .every((point, index) => point.x === points[index].x || point.y === points[index].y);
}

function rotatePoint(point: { x: number; y: number }, turns: number): { x: number; y: number } {
  let rotated = point;
  for (let index = 0; index < turns; index += 1) {
    rotated = { x: -rotated.y, y: rotated.x };
  }
  return rotated;
}
