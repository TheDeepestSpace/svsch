import { AvoidLib } from 'libavoid-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { diagramNodeDimensions } from '../../src/diagram/nodeSizing';
import type { DiagramEdge, PositionedNode } from '../../src/ir/types';
import {
  routeDiagramWithLibavoid,
  selectLibavoidRoutesAgainstFallbacks,
  setLibavoidRuntimeForTests,
  type RoutingLeadPoint
} from '../../src/layout/libavoidRouter';

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

  it('falls back when a candidate overlaps a net already using fallback routing', () => {
    const edges: DiagramEdge[] = [
      { id: 'candidate', source: 'a', sourcePort: 'out', target: 'b', targetPort: 'in' },
      { id: 'fallback', source: 'c', sourcePort: 'out', target: 'd', targetPort: 'in' }
    ];
    const candidates = new Map([
      ['candidate', [{ x: 0, y: 24 }, { x: 96, y: 24 }]]
    ]);
    const fallbacks = new Map([
      ['candidate', [{ x: 0, y: 48 }, { x: 96, y: 48 }]],
      ['fallback', [{ x: 24, y: 24 }, { x: 72, y: 24 }]]
    ]);

    expect(selectLibavoidRoutesAgainstFallbacks(edges, candidates, fallbacks).size).toBe(0);
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
