import { AvoidLib } from 'libavoid-js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DesignModule } from '../../src/ir/types';
import { setLibavoidRuntimeForTests } from '../../src/layout/libavoidRouter';
import { mergeNodePositions } from '../../src/layout/mergeLayout';
import {
  buildPartialViewModel,
  resolveExtendTarget,
  type PartialDiagramState,
} from '../../src/layout/partialDiagram';
import type { SavedLayout } from '../../src/storage/layoutStore';

beforeAll(async () => {
  await AvoidLib.load();
  setLibavoidRuntimeForTests(AvoidLib.getInstance());
});

// reg1 --mid--> comb1 --out--> port:sum, plus port:a --a--> reg1. The "mid"
// net carries a declared name; the reg1->comb1 pair is the extend target.
const sourceModule: DesignModule = {
  name: 'top',
  file: 'top.sv',
  ports: [],
  nodes: [
    {
      id: 'port:a',
      kind: 'port',
      label: 'a',
      ports: [{ id: 'p:a', name: 'a', direction: 'input' }],
    },
    {
      id: 'port:sum',
      kind: 'port',
      label: 'sum',
      ports: [{ id: 'p:sum', name: 'sum', direction: 'output' }],
    },
    {
      id: 'reg1',
      kind: 'register',
      label: 'reg1',
      ports: [
        { id: 'd', name: 'D', direction: 'input' },
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
    { id: 'e-a-reg1', source: 'port:a', target: 'reg1', sourcePort: 'p:a', targetPort: 'd' },
    {
      id: 'e-reg1-comb1',
      source: 'reg1',
      target: 'comb1',
      sourcePort: 'q',
      targetPort: 'in',
      signal: 'mid',
      metadata: { declaredNetName: 'mid' },
    },
    {
      id: 'e-comb1-sum',
      source: 'comb1',
      target: 'port:sum',
      sourcePort: 'out',
      targetPort: 'p:sum',
    },
  ],
};

const emptyLayout: SavedLayout = { version: 1, modules: {} };

describe('buildPartialViewModel', () => {
  it('renders a lone included node with every net cut', async () => {
    const state: PartialDiagramState = {
      sourceModuleName: 'top',
      includedNodeIds: ['reg1'],
      tiedNetKeys: [],
    };
    const view = await buildPartialViewModel(sourceModule, state, emptyLayout);

    const realNodes = view.nodes.filter((node) => node.kind !== 'netLabel');
    expect(realNodes.map((node) => node.id)).toEqual(['reg1']);

    const labels = view.nodes.filter((node) => node.kind === 'netLabel');
    expect(labels.map((node) => node.label).sort()).toEqual(['a', 'mid']);
    // reg1 is the sink of net "a" and the source of net "mid".
    expect(labels.map((node) => node.metadata?.cutNet?.role).sort()).toEqual(['sink', 'source']);

    // Every edge is a stub to a cut end — no real wires.
    expect(view.edges).toHaveLength(2);
    expect(view.edges.every((edge) => edge.metadata?.cutStub !== undefined)).toBe(true);
  });

  it('ties a net into a real wire once both ends are included', async () => {
    const state: PartialDiagramState = {
      sourceModuleName: 'top',
      includedNodeIds: ['reg1', 'comb1'],
      tiedNetKeys: ['reg1:q'],
    };
    const view = await buildPartialViewModel(sourceModule, state, emptyLayout);

    const realEdges = view.edges.filter((edge) => edge.metadata?.cutStub === undefined);
    expect(realEdges.map((edge) => edge.id)).toEqual(['e-reg1-comb1']);
    // No cut end left for the tied "mid" net; the a and comb1->sum nets stay
    // cut (the latter has no declared name, so it gets the NET_n fallback —
    // same as a manual cut on the main diagram).
    const labels = view.nodes.filter((node) => node.kind === 'netLabel');
    expect(labels.map((node) => node.label).sort()).toEqual(['NET_1', 'a']);
  });

  it('keeps both cut ends of an included-but-untied net', async () => {
    const state: PartialDiagramState = {
      sourceModuleName: 'top',
      includedNodeIds: ['reg1', 'comb1'],
      tiedNetKeys: [],
    };
    const view = await buildPartialViewModel(sourceModule, state, emptyLayout);

    const midLabels = view.nodes.filter((node) => node.kind === 'netLabel' && node.label === 'mid');
    expect(midLabels).toHaveLength(2);
    expect(view.edges.filter((edge) => edge.metadata?.cutStub === undefined)).toHaveLength(0);
  });

  it('locks existing nodes in place while ELK places only the newcomer', async () => {
    const first: PartialDiagramState = {
      sourceModuleName: 'top',
      includedNodeIds: ['reg1'],
      tiedNetKeys: [],
    };
    const firstView = await buildPartialViewModel(sourceModule, first, emptyLayout);
    const anchored = mergeNodePositions(
      emptyLayout,
      'top',
      firstView.nodes.map((node) => ({
        ...node,
        fixed: node.kind === 'netLabel' ? node.fixed : true,
      })),
    );
    const reg1Before = firstView.nodes.find((node) => node.id === 'reg1')!.position;

    const extended: PartialDiagramState = {
      sourceModuleName: 'top',
      includedNodeIds: ['reg1', 'comb1'],
      tiedNetKeys: ['reg1:q'],
    };
    const secondView = await buildPartialViewModel(sourceModule, extended, anchored);
    const reg1After = secondView.nodes.find((node) => node.id === 'reg1')!;
    expect(reg1After.position).toEqual(reg1Before);
    expect(reg1After.fixed).toBe(true);
    expect(secondView.nodes.find((node) => node.id === 'comb1')).toBeDefined();
  });
});

// port:d fans out to comb_a and comb_b on the same net — resolveExtendTarget
// should pull in every branch at once (there's no partially-cut-net mechanic).
const fanoutModule: DesignModule = {
  name: 'fan',
  file: 'fan.sv',
  ports: [],
  nodes: [
    {
      id: 'port:d',
      kind: 'port',
      label: 'd',
      ports: [{ id: 'p:d', name: 'd', direction: 'input' }],
    },
    {
      id: 'comb_a',
      kind: 'comb',
      label: 'comb_a',
      ports: [{ id: 'in', name: 'in', direction: 'input' }],
    },
    {
      id: 'comb_b',
      kind: 'comb',
      label: 'comb_b',
      ports: [{ id: 'in', name: 'in', direction: 'input' }],
    },
  ],
  edges: [
    { id: 'e-d-comb_a', source: 'port:d', target: 'comb_a', sourcePort: 'p:d', targetPort: 'in' },
    { id: 'e-d-comb_b', source: 'port:d', target: 'comb_b', sourcePort: 'p:d', targetPort: 'in' },
  ],
};

describe('resolveExtendTarget', () => {
  const state: PartialDiagramState = {
    sourceModuleName: 'top',
    includedNodeIds: ['reg1'],
    tiedNetKeys: [],
  };

  it('resolves the far end of the clicked label edge', () => {
    const target = resolveExtendTarget(sourceModule, state, 'reg1:q', 'e-reg1-comb1');
    expect(target?.newNodeIds).toEqual(['comb1']);
  });

  it('pulls in every branch of a fanout net at once, not just the clicked one', () => {
    const fanoutState: PartialDiagramState = {
      sourceModuleName: 'fan',
      includedNodeIds: ['comb_a'],
      tiedNetKeys: [],
    };
    const target = resolveExtendTarget(fanoutModule, fanoutState, 'port:d:p:d', 'e-d-comb_a');
    expect(new Set(target?.newNodeIds)).toEqual(new Set(['port:d', 'comb_b']));
  });

  it('falls back to the net boundary edge without an originalEdgeId', () => {
    const target = resolveExtendTarget(sourceModule, state, 'port:a:p:a');
    expect(target?.newNodeIds).toEqual(['port:a']);
  });

  it('returns no new nodes when both ends are already included', () => {
    const bothIn: PartialDiagramState = {
      sourceModuleName: 'top',
      includedNodeIds: ['reg1', 'comb1'],
      tiedNetKeys: [],
    };
    const target = resolveExtendTarget(sourceModule, bothIn, 'reg1:q', 'e-reg1-comb1');
    expect(target?.newNodeIds).toEqual([]);
  });

  it('returns undefined for an unknown net', () => {
    expect(resolveExtendTarget(sourceModule, state, 'nope')).toBeUndefined();
  });
});
