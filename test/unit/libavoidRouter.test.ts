import { AvoidLib } from 'libavoid-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { diagramNodeDimensions } from '../../src/diagram/nodeSizing';
import type { DiagramEdge, PositionedNode } from '../../src/ir/types';
import {
  routeDiagramWithLibavoid,
  setLibavoidRuntimeForTests,
  type RoutingLeadPoint
} from '../../src/layout/libavoidRouter';
import { simplifyOrthogonalRoute } from '../../src/layout/orthogonalRouteSimplifier';

beforeAll(async () => {
  await AvoidLib.load();
  setLibavoidRuntimeForTests(AvoidLib.getInstance());
});

function node(
  id: string,
  x: number,
  y: number,
  ports: PositionedNode['ports']
): PositionedNode {
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
      { id: 'to-lower', source: source.id, sourcePort: 'out', target: lower.id, targetPort: 'in' }
    ];
    const leads = leadResolver(nodes);
    const originalPositions = nodes.map((candidate) => ({ ...candidate.position }));

    const results = await Promise.all(
      Array.from({ length: 5 }, () => routeDiagramWithLibavoid(nodes, edges, leads))
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
      { id: 'to-lower', source: source.id, sourcePort: 'out', target: lower.id, targetPort: 'in' }
    ];

    const result = await routeDiagramWithLibavoid(nodes, edges, leadResolver(nodes));

    expect(result.routes.size).toBe(0);
    expect(result.rejectedNets.get('source:out')).toBe('intersects node blocker');
  });

  it('keeps side-port endpoint corridors horizontal', async () => {
    const source = node('source', 0, 168, [{ id: 'out', name: 'out', direction: 'output' }]);
    const target = node('target', 480, 24, [{ id: 'in', name: 'in', direction: 'input' }]);
    const edges: DiagramEdge[] = [
      { id: 'staggered', source: source.id, sourcePort: 'out', target: target.id, targetPort: 'in' }
    ];

    const result = await routeDiagramWithLibavoid([source, target], edges, leadResolver([source, target]));
    const route = result.routes.get('staggered')!;

    expect(result.rejectedNets.size).toBe(0);
    expect(route.length).toBeGreaterThanOrEqual(4);
    expect(route[1].y).toBe(route[0].y);
    expect(route.at(-2)!.y).toBe(route.at(-1)!.y);
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
      { x: 552, y: 264 }
    ];

    expect(simplifyOrthogonalRoute(route, [], [])).toEqual([
      { x: 240, y: 240 },
      { x: 312, y: 240 },
      { x: 312, y: 312 },
      { x: 552, y: 312 },
      { x: 552, y: 264 }
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
      { x: 351, y: 240 }
    ];

    expect(simplifyOrthogonalRoute(route, [], [])).toEqual([
      { x: 1281, y: 144 },
      { x: 1296, y: 144 },
      { x: 1296, y: 216 },
      { x: 600, y: 216 },
      { x: 600, y: 168 },
      { x: 336, y: 168 },
      { x: 336, y: 240 },
      { x: 351, y: 240 }
    ]);
  });

  it.each([0, 1, 2, 3])('applies the same simplification after %s quarter turns', (turns) => {
    const route = [
      { x: 144, y: 0 },
      { x: 72, y: 0 },
      { x: 72, y: 24 },
      { x: 24, y: 24 },
      { x: 24, y: -48 },
      { x: -48, y: -48 }
    ].map((point) => rotatePoint(point, turns));

    const simplified = simplifyOrthogonalRoute(route, [], []);

    expect(simplified).toEqual([
      { x: 144, y: 0 },
      { x: 24, y: 0 },
      { x: 24, y: -48 },
      { x: -48, y: -48 }
    ].map((point) => rotatePoint(point, turns)));
  });

  it('keeps a dogleg when the shorter replacement would hit an obstacle', () => {
    const route = [
      { x: 144, y: 0 },
      { x: 72, y: 0 },
      { x: 72, y: 24 },
      { x: 24, y: 24 },
      { x: 24, y: -48 }
    ];

    expect(simplifyOrthogonalRoute(route, [
      { x: 36, y: -12, width: 12, height: 24 }
    ], [])).toEqual(route);
  });

  it('keeps a dogleg when the shorter replacement would add shared-path overlap', () => {
    const route = [
      { x: 144, y: 0 },
      { x: 72, y: 0 },
      { x: 72, y: 24 },
      { x: 24, y: 24 },
      { x: 24, y: -48 }
    ];
    const peer = [
      { x: 36, y: 0 },
      { x: 60, y: 0 }
    ];

    expect(simplifyOrthogonalRoute(route, [], [peer])).toEqual(route);
  });

  it('keeps a dogleg when the shorter replacement would add a crossing', () => {
    const route = [
      { x: 144, y: 0 },
      { x: 72, y: 0 },
      { x: 72, y: 24 },
      { x: 24, y: 24 },
      { x: 24, y: -48 }
    ];
    const peer = [
      { x: 48, y: -12 },
      { x: 48, y: 12 }
    ];

    expect(simplifyOrthogonalRoute(route, [], [peer])).toEqual(route);
  });
});

function leadResolver(nodes: PositionedNode[]) {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  return (nodeId: string, portId: string | undefined, includeLeadMargins: boolean): RoutingLeadPoint | undefined => {
    const candidate = byId.get(nodeId);
    const port = candidate?.ports.find((item) => item.id === portId);
    if (!candidate || !port) return undefined;
    const size = diagramNodeDimensions(candidate);
    const side = port.direction === 'output' ? 'EAST' : 'WEST';
    const x = side === 'EAST' ? candidate.position.x + size.width : candidate.position.x;
    return {
      point: {
        x: x + (includeLeadMargins ? (side === 'EAST' ? 24 : -24) : 0),
        y: candidate.position.y + size.height / 2
      },
      side
    };
  };
}

function routeIsOrthogonal(points: Array<{ x: number; y: number }>): boolean {
  return points.slice(1).every((point, index) => (
    point.x === points[index].x || point.y === points[index].y
  ));
}

function rotatePoint(point: { x: number; y: number }, turns: number): { x: number; y: number } {
  let rotated = point;
  for (let index = 0; index < turns; index += 1) {
    rotated = { x: -rotated.y, y: rotated.x };
  }
  return rotated;
}
