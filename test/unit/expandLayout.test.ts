import { AvoidLib } from 'libavoid-js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DesignGraph, DesignModule, DiagramPort } from '../../src/ir/types';
import { buildExpandSpliceLayout } from '../../src/layout/expandLayout';
import { setLibavoidRuntimeForTests } from '../../src/layout/libavoidRouter';
import { buildViewModel } from '../../src/layout/mergeLayout';
import { resolvedNodeDimensions } from '../../src/diagram/nodeSizing';

beforeAll(async () => {
  await AvoidLib.load();
  setLibavoidRuntimeForTests(AvoidLib.getInstance());
});

const clkPort: DiagramPort = { id: 'p:clk', name: 'clk', direction: 'input' };
const aPort: DiagramPort = { id: 'p:a', name: 'a', direction: 'input' };
const sumPort: DiagramPort = { id: 'p:sum', name: 'sum', direction: 'output' };

// A child with a real internal wire (reg1 -> comb1) in addition to the
// port-touching ones, so both halves of the contract are observable: the
// standalone route is kept for the internal wire, libavoid re-routes the
// boundary stubs.
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
        { id: 'd', name: 'D', direction: 'input' },
        { id: 'clk', name: 'clk', direction: 'input' },
        { id: 'q', name: 'Q', direction: 'output' },
      ],
    },
    {
      id: 'comb1',
      kind: 'comb',
      label: 'comb1',
      ports: [
        { id: 'in', name: 'in', direction: 'input' },
        { id: 'out', name: 'out', direction: 'output' },
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
    { id: 'e-reg1-comb1', source: 'reg1', target: 'comb1', sourcePort: 'q', targetPort: 'in' },
    {
      id: 'e-comb1-sum',
      source: 'comb1',
      target: 'port:sum',
      sourcePort: 'out',
      targetPort: 'p:sum',
    },
  ],
};

const graph: DesignGraph = {
  rootModules: ['adder'],
  modules: { adder: childModule },
  diagnostics: [],
  generatedAt: 'test',
};

const emptyLayout = { version: 1, modules: {} };

function baseInput() {
  return {
    graph,
    layout: emptyLayout,
    childModuleName: 'adder',
    instanceId: 'u0',
    instancePorts: [clkPort, aPort, sumPort] as DiagramPort[],
    instanceSize: { width: 192, height: 96 },
    instanceParamRows: 0,
  };
}

function routeIsOrthogonal(points: Array<{ x: number; y: number }>): boolean {
  return points
    .slice(1)
    .every((point, index) => point.x === points[index].x || point.y === points[index].y);
}

describe('buildExpandSpliceLayout', () => {
  it('drops the port nodes and replaces them with boundary nodes on the frame border', async () => {
    const layout = await buildExpandSpliceLayout(baseInput());
    expect(layout).toBeDefined();

    expect(layout!.nodes.some((node) => node.kind === 'port')).toBe(false);
    expect(layout!.nodes.some((node) => node.id.startsWith('expand-frame-wall:'))).toBe(false);

    const boundary = layout!.nodes.filter((node) => node.kind === 'boundaryPort');
    expect(boundary.map((node) => node.id).sort()).toEqual(['port:a', 'port:clk', 'port:sum']);
    for (const node of boundary) {
      const side = node.metadata?.boundaryPort?.outerSide;
      const size = resolvedNodeDimensions(node);
      if (side === 'left') {
        expect(node.position.x).toBe(0);
      } else {
        expect(node.position.x + size.width).toBe(layout!.expandedSize.width);
      }
    }
  });

  // eslint-disable-next-line max-len
  it("places the child's standalone-laid-out internals inside the frame, keeping their standalone routes", async () => {
    const [standalone, layout] = [
      await buildViewModel(graph, 'adder', emptyLayout),
      await buildExpandSpliceLayout(baseInput()),
    ];
    expect(layout).toBeDefined();

    const internals = layout!.nodes.filter((node) => node.kind !== 'boundaryPort');
    expect(internals.map((node) => node.id).sort()).toEqual(['comb1', 'reg1']);
    for (const node of internals) {
      const size = resolvedNodeDimensions(node);
      expect(node.position.x).toBeGreaterThan(0);
      expect(node.position.y).toBeGreaterThan(0);
      expect(node.position.x + size.width).toBeLessThanOrEqual(layout!.expandedSize.width);
      expect(node.position.y + size.height).toBeLessThanOrEqual(layout!.expandedSize.height);
    }

    // The internal wire keeps the standalone libavoid route, rigidly
    // translated: same relative offset for every point as for the nodes.
    const standaloneReg = standalone.nodes.find((node) => node.id === 'reg1')!;
    const placedReg = internals.find((node) => node.id === 'reg1')!;
    const dx = placedReg.position.x - standaloneReg.position.x;
    const dy = placedReg.position.y - standaloneReg.position.y;
    const standaloneRoute = standalone.edges.find(
      (edge) => edge.id === 'e-reg1-comb1',
    )!.routePoints;
    const placedRoute = layout!.edges.find((edge) => edge.id === 'e-reg1-comb1')!.routePoints;
    expect(standaloneRoute).toBeDefined();
    expect(placedRoute).toEqual(
      standaloneRoute!.map((point) => ({ x: point.x + dx, y: point.y + dy })),
    );
  });

  // eslint-disable-next-line max-len
  it('rewires port-touching edges onto boundary inner handles and routes them inside the frame', async () => {
    const layout = await buildExpandSpliceLayout(baseInput());
    expect(layout).toBeDefined();

    const stub = layout!.edges.find((edge) => edge.id === 'e-a-reg1')!;
    expect(stub.source).toBe('port:a');
    expect(stub.sourcePort).toBe('inner');
    expect(stub.targetPort).toBe('d');

    for (const edgeId of ['e-clk-reg1', 'e-a-reg1', 'e-comb1-sum']) {
      const edge = layout!.edges.find((candidate) => candidate.id === edgeId)!;
      expect(edge.routePoints, edgeId).toBeDefined();
      expect(routeIsOrthogonal(edge.routePoints!), edgeId).toBe(true);
      for (const point of edge.routePoints!) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(layout!.expandedSize.width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(layout!.expandedSize.height);
      }
    }
  });

  it('grows the frame grow-only against the instance size', async () => {
    const layout = await buildExpandSpliceLayout({
      ...baseInput(),
      instanceSize: { width: 2000, height: 1500 },
    });
    expect(layout!.expandedSize).toEqual({ width: 2000, height: 1500 });
  });

  it('returns undefined for an unknown child module', async () => {
    const layout = await buildExpandSpliceLayout({
      ...baseInput(),
      childModuleName: 'missing',
    });
    expect(layout).toBeUndefined();
  });
});
