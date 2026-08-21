import { AvoidLib } from 'libavoid-js';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  DesignGraph,
  DesignModule,
  DiagramPort,
  InstanceDiagramNode,
} from '../../src/ir/types';
import { applyExpandedInstances } from '../../src/layout/expandSpliceView';
import { setLibavoidRuntimeForTests } from '../../src/layout/libavoidRouter';
import { buildViewModel } from '../../src/layout/mergeLayout';
import type { SavedLayout } from '../../src/storage/layoutStore';

beforeAll(async () => {
  await AvoidLib.load();
  setLibavoidRuntimeForTests(AvoidLib.getInstance());
});

const innerAPort: DiagramPort = { id: 'p:a', name: 'a', direction: 'input' };
const innerYPort: DiagramPort = { id: 'p:y', name: 'y', direction: 'output' };

const innerModule: DesignModule = {
  name: 'inner',
  file: 'inner.sv',
  ports: [innerAPort, innerYPort],
  nodes: [
    { id: 'port:a', kind: 'port', label: 'a', ports: [innerAPort] },
    { id: 'port:y', kind: 'port', label: 'y', ports: [innerYPort] },
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
    { id: 'e-a-comb1', source: 'port:a', target: 'comb1', sourcePort: 'p:a', targetPort: 'in' },
    { id: 'e-comb1-y', source: 'comb1', target: 'port:y', sourcePort: 'out', targetPort: 'p:y' },
  ],
};

const u1Node: InstanceDiagramNode = {
  id: 'u1',
  kind: 'instance',
  label: 'u1',
  moduleName: 'inner',
  ports: [
    { id: 'u1:a', name: 'a', direction: 'input' },
    { id: 'u1:y', name: 'y', direction: 'output' },
  ],
};

const topAPort: DiagramPort = { id: 'p:top-a', name: 'a', direction: 'input' };
const topYPort: DiagramPort = { id: 'p:top-y', name: 'y', direction: 'output' };

const topModule: DesignModule = {
  name: 'top',
  file: 'top.sv',
  ports: [topAPort, topYPort],
  nodes: [
    { id: 'port:top:a', kind: 'port', label: 'a', ports: [topAPort] },
    { id: 'port:top:y', kind: 'port', label: 'y', ports: [topYPort] },
    u1Node,
  ],
  edges: [
    {
      id: 'e-top-a-u1',
      source: 'port:top:a',
      target: 'u1',
      sourcePort: 'p:top-a',
      targetPort: 'u1:a',
    },
    {
      id: 'e-u1-top-y',
      source: 'u1',
      target: 'port:top:y',
      sourcePort: 'u1:y',
      targetPort: 'p:top-y',
    },
  ],
};

const graph: DesignGraph = {
  rootModules: ['top'],
  modules: { top: topModule, inner: innerModule },
  diagnostics: [],
  generatedAt: 'test',
};

function layoutWithExpandedU1(): SavedLayout {
  return { version: 1, modules: { top: { nodes: {}, expanded: { u1: true } } } };
}

describe('applyExpandedInstances', () => {
  it('leaves the view untouched when nothing is flagged expanded', async () => {
    const layout: SavedLayout = { version: 1, modules: {} };
    const view = await buildViewModel(graph, 'top', layout);
    const result = await applyExpandedInstances({
      graph,
      layout,
      view,
      expandedSnapshots: new Map(),
    });
    expect(result).toBe(view);
  });

  it('splices the boundary/internal nodes and edges of an expanded instance', async () => {
    const layout = layoutWithExpandedU1();
    const view = await buildViewModel(graph, 'top', layout);
    const result = await applyExpandedInstances({
      graph,
      layout,
      view,
      expandedSnapshots: new Map(),
    });

    const boundaryNodes = result.nodes.filter((node) => node.kind === 'boundaryPort');
    expect(boundaryNodes.map((node) => node.id).sort()).toEqual([
      'expand:u1::port:a',
      'expand:u1::port:y',
    ]);

    const internal = result.nodes.find((node) => node.id === 'expand:u1::comb1');
    expect(internal).toBeDefined();

    const region = result.generateRegions?.find((r) => r.kind === 'expand');
    expect(region).toBeDefined();
    expect(region!.expandedInstance).toEqual({
      instanceId: 'u1',
      childModuleName: 'inner',
      parentModuleName: 'top',
    });
    expect(region!.nodeIds).toEqual(
      expect.arrayContaining([...boundaryNodes.map((n) => n.id), 'expand:u1::comb1']),
    );
  });

  it('dims the instance node into a ghost, grown to contain the spliced content', async () => {
    const layout = layoutWithExpandedU1();
    const view = await buildViewModel(graph, 'top', layout);
    const result = await applyExpandedInstances({
      graph,
      layout,
      view,
      expandedSnapshots: new Map(),
    });

    const ghost = result.nodes.find((node) => node.id === 'u1')!;
    expect(ghost.metadata?.expandGhost).toBeDefined();
    expect(ghost.sizeOverride).toBeDefined();
    expect(ghost.sizeOverride!.width).toBeGreaterThan(0);
    expect(ghost.sizeOverride!.height).toBeGreaterThan(0);
  });

  it("rewires the parent's edges off the instance onto the matching boundary node", async () => {
    const layout = layoutWithExpandedU1();
    const view = await buildViewModel(graph, 'top', layout);
    const result = await applyExpandedInstances({
      graph,
      layout,
      view,
      expandedSnapshots: new Map(),
    });

    const inbound = result.edges.find((edge) => edge.id === 'e-top-a-u1')!;
    expect(inbound.target).toBe('expand:u1::port:a');
    expect(inbound.targetPort).toBe('outer');
    expect(inbound.routePoints).toBeUndefined();

    const outbound = result.edges.find((edge) => edge.id === 'e-u1-top-y')!;
    expect(outbound.source).toBe('expand:u1::port:y');
    expect(outbound.sourcePort).toBe('outer');
  });
});
