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
    expect(internals.map((node) => node.id).sort()).toEqual([
      'comb1',
      'expand-port-label:port:a',
      'expand-port-label:port:clk',
      'expand-port-label:port:sum',
      'reg1',
    ]);
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
  it('replaces each port with a cut net end and rewires the port-touching edges onto it, keeping the standalone routes inside the frame', async () => {
    const layout = await buildExpandSpliceLayout(baseInput());
    expect(layout).toBeDefined();

    // The former port endpoint now terminates on the cut net end's 'cut'
    // handle — there is no routed wire to the boundary label on the frame.
    const aEdge = layout!.edges.find((edge) => edge.id === 'e-a-reg1')!;
    expect(aEdge.source).toBe('expand-port-label:port:a');
    expect(aEdge.sourcePort).toBe('cut');
    expect(aEdge.targetPort).toBe('d');
    const sumEdge = layout!.edges.find((edge) => edge.id === 'e-comb1-sum')!;
    expect(sumEdge.target).toBe('expand-port-label:port:sum');
    expect(sumEdge.targetPort).toBe('cut');
    expect(
      layout!.edges.some((edge) => edge.sourcePort === 'inner' || edge.targetPort === 'inner'),
    ).toBe(false);

    // An input port drives the net inward — its stand-in is a 'sink'-role cut
    // end (the label is the wire's source); an output port receives — a
    // 'source'-role cut end. Port names are declared, never renameable.
    const aLabel = layout!.nodes.find((node) => node.id === 'expand-port-label:port:a')!;
    expect(aLabel.kind).toBe('netLabel');
    expect(aLabel.label).toBe('a');
    expect(aLabel.metadata?.cutNet?.role).toBe('sink');
    expect(aLabel.metadata?.cutNet?.handleSide).toBe('right');
    expect(aLabel.metadata?.cutNet?.origin).toBe('declared');
    const sumLabel = layout!.nodes.find((node) => node.id === 'expand-port-label:port:sum')!;
    expect(sumLabel.metadata?.cutNet?.role).toBe('source');
    expect(sumLabel.metadata?.cutNet?.handleSide).toBe('left');

    // The kept standalone routes stay orthogonal and inside the frame.
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

  // eslint-disable-next-line max-len
  it("anchors each cut net end's handle exactly where the port's own handle sat in the standalone layout", async () => {
    const [standalone, layout] = [
      await buildViewModel(graph, 'adder', emptyLayout),
      await buildExpandSpliceLayout(baseInput()),
    ];

    // Derive the rigid content translation from a node present in both views.
    const standaloneReg = standalone.nodes.find((node) => node.id === 'reg1')!;
    const placedReg = layout!.nodes.find((node) => node.id === 'reg1')!;
    const dx = placedReg.position.x - standaloneReg.position.x;
    const dy = placedReg.position.y - standaloneReg.position.y;

    const standalonePortA = standalone.nodes.find((node) => node.id === 'port:a')!;
    const portASize = resolvedNodeDimensions(standalonePortA);
    const aLabel = layout!.nodes.find((node) => node.id === 'expand-port-label:port:a')!;
    const aLabelSize = resolvedNodeDimensions(aLabel);
    // handleSide 'right': the label's right edge midpoint is the handle.
    expect(aLabel.position.x + aLabelSize.width).toBeCloseTo(
      standalonePortA.position.x + portASize.width + dx,
    );
    expect(aLabel.position.y + aLabelSize.height / 2).toBeCloseTo(
      standalonePortA.position.y + portASize.height / 2 + dy,
    );
  });

  // eslint-disable-next-line max-len
  it('collapses a net the user already cut at a port to a no-op — port, stub and dangling label all vanish, content-side cut ends stay', async () => {
    // Cut the a -> reg1 net at its source (the input port), the way the Cut
    // control saves it: the standalone view then shows
    //   "port a --- cut end a"   and   "cut end a --- reg1".
    const cutLayout = {
      version: 1,
      modules: {
        adder: {
          nodes: {},
          netCuts: {
            'port:a:p:a': {
              label: 'a',
              source: { nodeId: 'port:a', portId: 'p:a' },
            },
          },
        },
      },
    };
    const standalone = await buildViewModel(graph, 'adder', cutLayout);
    const standaloneLabelIds = standalone.nodes
      .filter((node) => node.kind === 'netLabel')
      .map((node) => node.id)
      .sort();
    // Sanity: the standalone view really carries both dangling ends.
    expect(standaloneLabelIds).toEqual([
      'cut-label:port:a:p:a:sink:e-a-reg1',
      'cut-label:port:a:p:a:source',
    ]);

    const layout = await buildExpandSpliceLayout({ ...baseInput(), layout: cutLayout });
    const labelIds = layout!.nodes
      .filter((node) => node.kind === 'netLabel')
      .map((node) => node.id)
      .sort();
    // The port-side source label vanished with the port; no synthesized
    // stand-in was added for the already-cut port. The reg1-side sink label
    // stays, and the other two (uncut) ports still get their stand-ins.
    expect(labelIds).toEqual([
      'cut-label:port:a:p:a:sink:e-a-reg1',
      'expand-port-label:port:clk',
      'expand-port-label:port:sum',
    ]);
    // The port-side stub collapsed entirely; the content-side stub survives.
    expect(layout!.edges.some((edge) => edge.id === 'cut-stub:port:a:p:a:source')).toBe(false);
    const sinkStub = layout!.edges.find((edge) => edge.id === 'cut-stub:port:a:p:a:sink:e-a-reg1');
    expect(sinkStub).toBeDefined();
    expect(sinkStub!.target).toBe('reg1');
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
