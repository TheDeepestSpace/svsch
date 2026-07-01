import { describe, expect, it } from 'vitest';
import { buildViewModel, defaultNetCutLabel, mergeEdgeRoutePoints, mergeEdgeWaypoint, mergeNetCut, mergeNodePositions, mergeRerouteLayout, removeNetCut, renameCutNet } from '../../src/layout/mergeLayout';
import { diagramSizing, ioPortCenterOffset, muxHeightForPortRows, nodeHeightForPortRows, nodePortCenterOffset } from '../../src/diagram/constants';
import { diagramNodeDimensions } from '../../src/diagram/nodeSizing';
import { edgeNetKey } from '../../src/ir/edgeNet';
import type { DesignGraph, PositionedNode } from '../../src/ir/types';
import type { SavedLayout } from '../../src/storage/layoutStore';

const graph: DesignGraph = {
  rootModules: ['top'],
  generatedAt: 'now',
  diagnostics: [],
  modules: {
    top: {
      name: 'top',
      file: 'top.sv',
      ports: [],
      edges: [
        { id: 'e-a-u', source: 'a', target: 'u' }
      ],
      nodes: [
        { id: 'a', kind: 'port', label: 'a', ports: [] },
        { id: 'u', kind: 'instance', label: 'u', ports: [] }
      ]
    }
  }
};

const fanoutGraph: DesignGraph = {
  rootModules: ['top'],
  generatedAt: 'now',
  diagnostics: [],
  modules: {
    top: {
      name: 'top',
      file: 'top.sv',
      ports: [],
      nodes: [
        {
          id: 'clk',
          kind: 'port',
          label: 'clk',
          ports: [{ id: 'p', name: 'clk', direction: 'input' }]
        },
        {
          id: 'u1',
          kind: 'instance',
          label: 'u1',
          ports: [{ id: 'in', name: 'in', direction: 'input' }]
        },
        {
          id: 'u2',
          kind: 'instance',
          label: 'u2',
          ports: [{ id: 'in', name: 'in', direction: 'input' }]
        }
      ],
      edges: [
        { id: 'e-clk-u1', source: 'clk', sourcePort: 'p', target: 'u1', targetPort: 'in', signal: 'clk' },
        { id: 'e-clk-u2', source: 'clk', sourcePort: 'p', target: 'u2', targetPort: 'in', signal: 'clk' }
      ]
    }
  }
};

function renderedPortCenterY(node: PositionedNode): number {
  return node.position.y + diagramSizing.portHeight / 2;
}

function renderedNodeInputCenterY(node: PositionedNode, row: number): number {
  return node.position.y + nodePortCenterOffset(row);
}

function renderedBusTapCenterY(node: PositionedNode, tapIndex: number): number {
  return node.position.y + diagramSizing.gridSize * (tapIndex * 2 + 1);
}

function renderedMuxSideInputCenterY(node: PositionedNode, index: number, count: number): number {
  const height = diagramNodeDimensions(node).height;
  const heightUnits = Math.max(1, Math.round(height / diagramSizing.gridSize));
  const startUnit = Math.max(1, Math.ceil((heightUnits - count + 1) / 2));
  return node.position.y + diagramSizing.gridSize * (startUnit + index);
}

function renderedAluInputCenterY(node: PositionedNode, index: number): number {
  return node.position.y + (index === 0 ? diagramSizing.gridSize : diagramSizing.gridSize * 3);
}

function routeCrossesNodeInterior(route: Array<{ x: number; y: number }>, node: PositionedNode): boolean {
  return route.slice(0, -1).some((point, index) => segmentCrossesNodeInterior(point, route[index + 1], node));
}

function segmentCrossesNodeInterior(
  start: { x: number; y: number },
  end: { x: number; y: number },
  node: PositionedNode,
  inflate = 0
): boolean {
  if (start.x === end.x && start.y === end.y) {
    return false;
  }

  const dimensions = diagramNodeDimensions(node);
  const epsilon = 0.5;
  const rect = {
    x: node.position.x - inflate,
    y: node.position.y - inflate,
    width: dimensions.width + inflate * 2,
    height: dimensions.height + inflate * 2
  };

  if (start.y === end.y) {
    return start.y > rect.y + epsilon
      && start.y < rect.y + rect.height - epsilon
      && Math.min(start.x, end.x) < rect.x + rect.width - epsilon
      && Math.max(start.x, end.x) > rect.x + epsilon;
  }
  if (start.x === end.x) {
    return start.x > rect.x + epsilon
      && start.x < rect.x + rect.width - epsilon
      && Math.min(start.y, end.y) < rect.y + rect.height - epsilon
      && Math.max(start.y, end.y) > rect.y + epsilon;
  }
  return false;
}

describe('layout merge', () => {
  it('uses node and port dimensions that align with the snap grid', () => {
    expect(diagramSizing.nodeWidth % diagramSizing.gridSize).toBe(0);
    expect(diagramSizing.muxWidth % diagramSizing.gridSize).toBe(0);
    expect(diagramSizing.muxWidth).toBe(diagramSizing.gridSize * 4);
    expect(diagramSizing.registerWidth % diagramSizing.gridSize).toBe(0);
    expect(diagramSizing.registerWidth).toBe(diagramSizing.gridSize * 4);
    expect(diagramSizing.nodeHeight % diagramSizing.gridSize).toBe(0);
    expect(diagramSizing.portWidth % diagramSizing.gridSize).toBe(0);
    expect(diagramSizing.portHeight % diagramSizing.gridSize).toBe(0);
    expect(diagramSizing.portSkinHeight % diagramSizing.gridSize).toBe(0);
    expect((diagramSizing.portNoseLength * 2) % diagramSizing.gridSize).toBe(0);
    expect(diagramSizing.muxRightSideHeight % (diagramSizing.gridSize * 2)).toBe(0);
    expect(diagramSizing.edgeLeadLength % diagramSizing.gridSize).toBe(0);
    expect(diagramSizing.minNodeSeparation % diagramSizing.gridSize).toBe(0);
    expect(diagramSizing.sameLayerNodeSeparation % diagramSizing.gridSize).toBe(0);
    expect(diagramSizing.sameLayerNodeSeparation).toBeLessThan(diagramSizing.minNodeSeparation);
    expect(diagramSizing.minNodeSeparation).toBeGreaterThanOrEqual(diagramSizing.edgeLeadLength * 2);
    expect(nodeHeightForPortRows(1)).toBe(diagramSizing.nodeHeight);
    expect(nodeHeightForPortRows(3)).toBe(diagramSizing.gridSize * 5);
    expect(muxHeightForPortRows(3)).toBe(diagramSizing.gridSize * 6);
    expect((muxHeightForPortRows(3) / 2) % diagramSizing.gridSize).toBe(0);
    expect(nodeHeightForPortRows(5) % diagramSizing.gridSize).toBe(0);
    expect(ioPortCenterOffset()).toBe(diagramSizing.gridSize / 2);
    expect(nodePortCenterOffset(0) % diagramSizing.gridSize).toBe(0);
    expect(nodePortCenterOffset(1) % diagramSizing.gridSize).toBe(0);
    expect(nodePortCenterOffset(2) % diagramSizing.gridSize).toBe(0);
    expect(nodePortCenterOffset(1) - nodePortCenterOffset(0)).toBe(diagramSizing.gridSize);
  });

  it('preserves saved node positions on the snap grid', async () => {
    const layout: SavedLayout = {
      version: 1,
      modules: {
        top: {
          nodes: {
            a: { x: 10, y: 20, fixed: true }
          }
        }
      }
    };

    const view = await buildViewModel(graph, 'top', layout);

    expect(view.nodes.find((node) => node.id === 'a')?.position).toEqual({ x: 0, y: 12 });
    expect(view.nodes.find((node) => node.id === 'u')?.position).toBeDefined();
  });

  it('snaps initial auto-layout positions before the webview sees them', async () => {
    const view = await buildViewModel(graph, 'top', { version: 1, modules: {} });

    for (const node of view.nodes) {
      expect(node.position.x % diagramSizing.gridSize).toBe(0);
      if (node.kind === 'port' || node.kind === 'literal') {
        expect(node.position.y % diagramSizing.gridSize).toBe(diagramSizing.gridSize / 2);
      } else {
        expect(node.position.y % diagramSizing.gridSize).toBe(0);
      }
    }
  });

  it('keeps at least one grid of clearance between auto-laid-out blocks, including bare IO ports', async () => {
    const minGap = diagramSizing.gridSize;
    const ioOnlyGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          edges: [],
          nodes: [
            { id: 'a', kind: 'port', label: 'a', ports: [{ id: 'a', name: 'a', direction: 'output' }] },
            { id: 'b', kind: 'port', label: 'b', ports: [{ id: 'b', name: 'b', direction: 'input' }] },
            { id: 'c', kind: 'port', label: 'c', ports: [{ id: 'c', name: 'c', direction: 'output' }] }
          ]
        }
      }
    };

    const view = await buildViewModel(ioOnlyGraph, 'top', { version: 1, modules: {} });
    const blocks = view.nodes.map((node) => ({
      id: node.id,
      ...node.position,
      ...diagramNodeDimensions(node)
    }));
    expect(blocks).toHaveLength(3);

    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i];
        const b = blocks[j];
        const horizontalGap = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
        const verticalGap = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
        const clear = horizontalGap >= minGap - 0.5 || verticalGap >= minGap - 0.5;
        expect(clear, `${a.id}/${b.id} gaps h=${horizontalGap} v=${verticalGap}`).toBe(true);
      }
    }
  });

  it('marks removed fixed layout entries stale and writes active fixed positions', () => {
    const layout: SavedLayout = {
      version: 1,
      modules: {
        top: {
          nodes: {
            old: { x: 1, y: 2, fixed: true },
            a: { x: 3, y: 4, fixed: true },
            auto: { x: 5, y: 6 } // not fixed
          }
        }
      }
    };
    const nodes: PositionedNode[] = [
      { id: 'a', kind: 'port', label: 'a', ports: [], position: { x: 20.2, y: 31.8 }, fixed: true },
      { id: 'b', kind: 'port', label: 'b', ports: [], position: { x: 100, y: 100 } } // not fixed
    ];

    const merged = mergeNodePositions(layout, 'top', nodes);

    expect(merged.modules.top.nodes.old.stale).toBe(true);
    expect(merged.modules.top.nodes.old.fixed).toBe(true);
    expect(merged.modules.top.nodes.a).toEqual({ x: 24, y: 36, fixed: true });
    expect(merged.modules.top.nodes.auto).toBeUndefined(); // auto was not fixed
    expect(merged.modules.top.nodes.b).toBeUndefined(); // b was not fixed
  });

  it('persists edge waypoints and applies them to the view model', async () => {
    const layout = mergeEdgeWaypoint({ version: 1, modules: {} }, 'top', 'e-a-u', { x: 42.4, y: 92.6 });
    const view = await buildViewModel(graph, 'top', layout);

    expect(layout.modules.top.edges?.['e-a-u'].waypoint).toEqual({ x: 42, y: 93 });
    expect(view.edges.find((edge) => edge.id === 'e-a-u')?.waypoint).toEqual({ x: 42, y: 93 });
  });

  it('persists edge route points and applies them to the view model', async () => {
    const layout = mergeEdgeRoutePoints({ version: 1, modules: {} }, 'top', 'e-a-u', [
      { x: 10.2, y: 20.8 },
      { x: 30.1, y: 40.5 }
    ]);
    const view = await buildViewModel(graph, 'top', layout);

    expect(layout.modules.top.edges?.['e-a-u'].routePoints).toEqual([
      { x: 10, y: 21 },
      { x: 30, y: 41 }
    ]);
    expect(view.edges.find((edge) => edge.id === 'e-a-u')?.routePoints).toEqual([
      { x: 10, y: 21 },
      { x: 30, y: 41 }
    ]);
  });

  it('freezes active nodes and clears manual edge routes for rerouting', () => {
    const layout = mergeEdgeRoutePoints({
      version: 1,
      modules: {
        top: {
          nodes: {
            old: { x: 1, y: 2, fixed: true }
          },
          viewport: { x: 4, y: 5, zoom: 1.25 }
        }
      }
    }, 'top', 'e-a-u', [
      { x: 10, y: 20 },
      { x: 30, y: 40 }
    ]);

    const rerouted = mergeRerouteLayout(layout, 'top', [
      { id: 'a', kind: 'port', label: 'a', ports: [], position: { x: 120, y: 132 } },
      { id: 'u', kind: 'instance', label: 'u', ports: [], position: { x: 360, y: 240 } }
    ]);

    expect(rerouted.modules.top.nodes).toEqual({
      a: { x: 120, y: 132, fixed: true },
      u: { x: 360, y: 240, fixed: true },
      old: { x: 1, y: 2, fixed: true, stale: true }
    });
    expect(rerouted.modules.top.edges).toBeUndefined();
    expect(rerouted.modules.top.viewport).toEqual({ x: 4, y: 5, zoom: 1.25 });
  });

  it('uses shared net keys for ordinary, literal, and cut stub edges', () => {
    expect(edgeNetKey({ id: 'e', source: 'n1', sourcePort: 'out', target: 'n2' } as any)).toBe('n1:out');
    expect(edgeNetKey({ id: 'lit', source: 'literal:1', sourcePort: 'out', target: 'n2' } as any)).toBe('literal:1');
    expect(edgeNetKey({
      id: 'stub',
      source: 'cut-label:n1:out:sink:e',
      sourcePort: 'cut',
      target: 'n2',
      metadata: { cutStub: { netKey: 'n1:out', role: 'sink', originalEdgeId: 'e' } }
    })).toBe('n1:out');
  });

  it('generates default cut labels from source endpoint context', () => {
    const module = fanoutGraph.modules.top;
    expect(defaultNetCutLabel(module.edges[0], module, { nodes: {} })).toBe('clk');

    const instanceModule = {
      ...module,
      nodes: [
        {
          id: 'u_alu',
          kind: 'instance' as const,
          label: 'u_alu',
          ports: [{ id: 'result', name: 'result', direction: 'output' as const }]
        }
      ],
      edges: [
        { id: 'result-y', source: 'u_alu', sourcePort: 'result', target: 'y' }
      ]
    };
    expect(defaultNetCutLabel(instanceModule.edges[0], instanceModule, { nodes: {} })).toBe('u_alu.result');

    const anonymousModule = {
      ...module,
      nodes: [
        { id: 'comb:1', kind: 'comb' as const, label: 'assign', ports: [{ id: 'out', name: 'out', direction: 'output' as const }] }
      ],
      edges: [
        { id: 'comb-y', source: 'comb:1', sourcePort: 'out', target: 'y' }
      ]
    };
    expect(defaultNetCutLabel(anonymousModule.edges[0], anonymousModule, {
      nodes: {},
      netCuts: {
        'old:out': { label: 'NET_1', source: { nodeId: 'old', portId: 'out' } }
      }
    })).toBe('NET_2');
  });

  it('adds, renames, removes, and reroutes net cuts without discarding the cut state', () => {
    const module = fanoutGraph.modules.top;
    const positioned: PositionedNode[] = [
      { ...module.nodes[0], position: { x: 0, y: 12 } },
      { ...module.nodes[1], position: { x: 240, y: 0 } },
      { ...module.nodes[2], position: { x: 240, y: 96 } }
    ];

    const cut = mergeNetCut({ version: 1, modules: {} }, 'top', module.edges[0], module, positioned);

    expect(cut.modules.top.nodes.clk).toEqual({ x: 0, y: 12, fixed: true });
    expect(cut.modules.top.netCuts?.['clk:p']).toEqual({
      label: 'clk',
      source: { nodeId: 'clk', portId: 'p' }
    });

    const duplicateCut = mergeNetCut(cut, 'top', module.edges[0], module, positioned);
    expect(duplicateCut).toBe(cut);

    const renamed = renameCutNet(cut, 'top', 'clk:p', ' data_clk ');
    expect(renamed.modules.top.netCuts?.['clk:p'].label).toBe('data_clk');
    expect(renameCutNet(renamed, 'top', 'clk:p', '   ')).toBe(renamed);

    const withSyntheticLayouts: SavedLayout = {
      version: 1,
      modules: {
        top: {
          ...renamed.modules.top,
          nodes: {
            ...renamed.modules.top.nodes,
            'cut-label:clk:p:source': { x: 24, y: 12, fixed: true },
            'cut-label:clk:p:sink:e-clk-u1': { x: 180, y: 12, fixed: true }
          },
          edges: {
            'cut-stub:clk:p:source': { routePoints: [{ x: 0, y: 0 }] },
            'cut-stub:clk:p:sink:e-clk-u1': { routePoints: [{ x: 1, y: 1 }] },
            'e-clk-u1': { routePoints: [{ x: 2, y: 2 }] }
          }
        }
      }
    };

    const removed = removeNetCut(withSyntheticLayouts, 'top', 'clk:p');
    expect(removed.modules.top.netCuts).toBeUndefined();
    expect(removed.modules.top.nodes['cut-label:clk:p:source']).toBeUndefined();
    expect(removed.modules.top.edges?.['cut-stub:clk:p:source']).toBeUndefined();
    expect(removed.modules.top.edges?.['e-clk-u1']).toEqual({ routePoints: [{ x: 2, y: 2 }] });

    const rerouted = mergeRerouteLayout(renamed, 'top', positioned);
    expect(rerouted.modules.top.netCuts).toEqual(renamed.modules.top.netCuts);
    expect(rerouted.modules.top.edges).toBeUndefined();
  });

  it('projects active fanout cuts into source and sink label stubs', async () => {
    const layout: SavedLayout = {
      version: 1,
      modules: {
        top: {
          nodes: {
            clk: { x: 0, y: 12, fixed: true },
            u1: { x: 240, y: 0, fixed: true },
            u2: { x: 240, y: 96, fixed: true }
          },
          netCuts: {
            'clk:p': { label: 'clk', source: { nodeId: 'clk', portId: 'p' } }
          }
        }
      }
    };

    const view = await buildViewModel(fanoutGraph, 'top', layout);
    const edgeIds = view.edges.map((edge) => edge.id);
    expect(edgeIds).not.toContain('e-clk-u1');
    expect(edgeIds).not.toContain('e-clk-u2');
    expect(view.nodes.filter((node) => node.kind === 'netLabel').map((node) => node.id).sort()).toEqual([
      'cut-label:clk:p:sink:e-clk-u1',
      'cut-label:clk:p:sink:e-clk-u2',
      'cut-label:clk:p:source'
    ]);

    const stubs = view.edges.filter((edge) => edge.metadata?.cutStub);
    expect(stubs).toHaveLength(3);
    expect(stubs.every((edge) => edge.metadata?.forceStraight === true)).toBe(true);
    expect(stubs.every((edge) => edgeNetKey(edge) === 'clk:p')).toBe(true);
    expect(stubs.find((edge) => edge.metadata?.cutStub?.role === 'source')?.target).toBe('cut-label:clk:p:source');
    expect(stubs.filter((edge) => edge.metadata?.cutStub?.role === 'sink').map((edge) => edge.source).sort()).toEqual([
      'cut-label:clk:p:sink:e-clk-u1',
      'cut-label:clk:p:sink:e-clk-u2'
    ]);
  });

  it('uses ELK routes for ordinary feedback edges so wires wrap around default node boxes', async () => {
    const feedbackGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            {
              id: 'latch',
              kind: 'latch',
              label: 'next_r',
              ports: [
                { id: 'q', name: 'Q', direction: 'output' },
                { id: 'd', name: 'D', direction: 'input' }
              ]
            },
            {
              id: 'mux',
              kind: 'mux',
              label: 'if en',
              ports: [
                { id: 'sel', name: 'sel', direction: 'input' },
                { id: 'true', name: 'true', direction: 'input' },
                { id: 'out', name: 'out', direction: 'output' }
              ]
            }
          ],
          edges: [
            { id: 'feedback', source: 'latch', sourcePort: 'q', target: 'mux', targetPort: 'true' },
            { id: 'mux-latch', source: 'mux', sourcePort: 'out', target: 'latch', targetPort: 'd' }
          ]
        }
      }
    };

    const view = await buildViewModel(feedbackGraph, 'top', { version: 1, modules: {} });
    const route = view.edges.find((edge) => edge.id === 'feedback')?.routePoints;
    const latch = view.nodes.find((node) => node.id === 'latch')!;
    const mux = view.nodes.find((node) => node.id === 'mux')!;
    const latchBottom = latch.position.y + diagramNodeDimensions(latch).height;
    const muxBottom = mux.position.y + diagramNodeDimensions(mux).height;

    expect(route).toBeDefined();
    expect(route!.length).toBeGreaterThanOrEqual(4);
    expect(route![0]).toEqual({
      x: latch.position.x + diagramNodeDimensions(latch).width + diagramSizing.edgeLeadLength,
      y: latch.position.y + diagramSizing.nodeHeaderHeight + diagramSizing.gridSize / 2
    });
    expect(route![route!.length - 1]).toEqual({
      x: mux.position.x - diagramSizing.edgeLeadLength,
      y: mux.position.y + diagramSizing.gridSize * 2
    });
    expect(Math.max(...route!.map((point) => point.y))).toBeGreaterThanOrEqual(Math.max(latchBottom, muxBottom));
  });

  it('routes register reset edges to the rendered one-grid bottom lead endpoint', async () => {
    const resetGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            { id: 'rst', kind: 'port', label: 'rst', ports: [{ id: 'rst', name: 'rst', direction: 'input' }] },
            {
              id: 'reg',
              kind: 'register',
              label: 'q',
              ports: [
                { id: 'd', name: 'D', direction: 'input' },
                { id: 'clk', name: 'clk', direction: 'input' },
                { id: 'reset', name: 'rst', direction: 'input' },
                { id: 'q', name: 'Q', direction: 'output' }
              ],
              metadata: { clockSignal: 'clk', resetSignal: 'rst' }
            }
          ],
          edges: [
            { id: 'rst-reg', source: 'rst', sourcePort: 'rst', target: 'reg', targetPort: 'reset' }
          ]
        }
      }
    };

    const view = await buildViewModel(resetGraph, 'top', { version: 1, modules: {} });
    const route = view.edges.find((edge) => edge.id === 'rst-reg')?.routePoints;
    const rst = view.nodes.find((node) => node.id === 'rst')!;
    const reg = view.nodes.find((node) => node.id === 'reg')!;
    const regDims = diagramNodeDimensions(reg);

    expect(route).toBeDefined();
    expect(route![0]).toEqual({
      x: rst.position.x + diagramNodeDimensions(rst).width,
      y: rst.position.y + diagramSizing.portHeight / 2
    });
    expect(route![route!.length - 1]).toEqual({
      x: reg.position.x + regDims.width / 2,
      y: 108
    });
  });

  it('aligns simple input ports with the rendered input row of standard nodes', async () => {
    const simpleGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            {
              id: 'comb',
              kind: 'comb',
              label: '',
              ports: [
                { id: 'out', name: 'o', direction: 'output' },
                { id: 'in', name: 'i', direction: 'input' }
              ]
            },
            { id: 'i', kind: 'port', label: 'i', ports: [{ id: 'i', name: 'i', direction: 'input' }] },
            { id: 'o', kind: 'port', label: 'o', ports: [{ id: 'o', name: 'o', direction: 'output' }] }
          ],
          edges: [
            { id: 'i-comb', source: 'i', sourcePort: 'i', target: 'comb', targetPort: 'in' },
            { id: 'comb-o', source: 'comb', sourcePort: 'out', target: 'o', targetPort: 'o' }
          ]
        }
      }
    };

    const view = await buildViewModel(simpleGraph, 'top', { version: 1, modules: {} });
    const input = view.nodes.find((node) => node.id === 'i')!;
    const output = view.nodes.find((node) => node.id === 'o')!;
    const comb = view.nodes.find((node) => node.id === 'comb')!;

    expect(renderedPortCenterY(input)).toBe(renderedNodeInputCenterY(comb, 0));
    expect(renderedPortCenterY(output)).toBe(renderedNodeInputCenterY(comb, 0));
  });

  it('lets ELK distribute simple leaf ports feeding multiple standard-node inputs', async () => {
    const multiInputGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            {
              id: 'comb',
              kind: 'comb',
              label: '',
              ports: [
                { id: 'out', name: 'o', direction: 'output' },
                { id: 'a', name: 'a', direction: 'input' },
                { id: 'b', name: 'b', direction: 'input' }
              ]
            },
            { id: 'a', kind: 'port', label: 'a', ports: [{ id: 'a', name: 'a', direction: 'input' }] },
            { id: 'b', kind: 'port', label: 'b', ports: [{ id: 'b', name: 'b', direction: 'input' }] }
          ],
          edges: [
            { id: 'a-comb', source: 'a', sourcePort: 'a', target: 'comb', targetPort: 'a' },
            { id: 'b-comb', source: 'b', sourcePort: 'b', target: 'comb', targetPort: 'b' }
          ]
        }
      }
    };

    const view = await buildViewModel(multiInputGraph, 'top', { version: 1, modules: {} });
    const a = view.nodes.find((node) => node.id === 'a')!;
    const b = view.nodes.find((node) => node.id === 'b')!;
    const comb = view.nodes.find((node) => node.id === 'comb')!;

    expect(renderedNodeInputCenterY(comb, 1) - renderedNodeInputCenterY(comb, 0)).toBe(diagramSizing.gridSize);
    expect(Math.abs(renderedPortCenterY(b) - renderedPortCenterY(a))).toBeGreaterThanOrEqual(diagramSizing.gridSize * 2);
  });

  it('lets ELK distribute simple leaf ports feeding multiple mux side inputs', async () => {
    const muxGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            {
              id: 'mux',
              kind: 'mux',
              label: 'case sel',
              ports: [
                { id: 'sel', name: 'sel', direction: 'input' },
                { id: 'a', name: 'a', direction: 'input' },
                { id: 'b', name: 'b', direction: 'input' },
                { id: 'out', name: 'y', direction: 'output' }
              ]
            },
            { id: 'a', kind: 'port', label: 'a', ports: [{ id: 'a', name: 'a', direction: 'input' }] },
            { id: 'b', kind: 'port', label: 'b', ports: [{ id: 'b', name: 'b', direction: 'input' }] }
          ],
          edges: [
            { id: 'a-mux', source: 'a', sourcePort: 'a', target: 'mux', targetPort: 'a' },
            { id: 'b-mux', source: 'b', sourcePort: 'b', target: 'mux', targetPort: 'b' }
          ]
        }
      }
    };

    const view = await buildViewModel(muxGraph, 'top', { version: 1, modules: {} });
    const a = view.nodes.find((node) => node.id === 'a')!;
    const b = view.nodes.find((node) => node.id === 'b')!;
    const mux = view.nodes.find((node) => node.id === 'mux')!;

    expect(renderedMuxSideInputCenterY(mux, 1, 2) - renderedMuxSideInputCenterY(mux, 0, 2)).toBe(diagramSizing.gridSize);
    expect(Math.abs(renderedPortCenterY(b) - renderedPortCenterY(a))).toBeGreaterThanOrEqual(diagramSizing.gridSize * 2);
  });

  it('uses fixed grid-aligned ALU port centers for routing', async () => {
    const aluGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            {
              id: 'alu',
              kind: 'alu',
              label: '',
              metadata: { operation: '+' },
              ports: [
                { id: 'lhs', name: 'lhs', direction: 'input' },
                { id: 'rhs', name: 'rhs', direction: 'input' },
                { id: 'out', name: 'y', direction: 'output' }
              ]
            },
            { id: 'a', kind: 'port', label: 'a', ports: [{ id: 'a', name: 'a', direction: 'input' }] },
            { id: 'b', kind: 'port', label: 'b', ports: [{ id: 'b', name: 'b', direction: 'input' }] },
            { id: 'y', kind: 'port', label: 'y', ports: [{ id: 'y', name: 'y', direction: 'output' }] }
          ],
          edges: [
            { id: 'a-alu', source: 'a', sourcePort: 'a', target: 'alu', targetPort: 'lhs' },
            { id: 'b-alu', source: 'b', sourcePort: 'b', target: 'alu', targetPort: 'rhs' },
            { id: 'alu-y', source: 'alu', sourcePort: 'out', target: 'y', targetPort: 'y' }
          ]
        }
      }
    };

    const view = await buildViewModel(aluGraph, 'top', { version: 1, modules: {} });
    const alu = view.nodes.find((node) => node.id === 'alu')!;
    const lhsRoute = view.edges.find((edge) => edge.id === 'a-alu')?.routePoints;
    const rhsRoute = view.edges.find((edge) => edge.id === 'b-alu')?.routePoints;
    const outRoute = view.edges.find((edge) => edge.id === 'alu-y')?.routePoints;

    expect(renderedAluInputCenterY(alu, 0) % diagramSizing.gridSize).toBe(0);
    expect(renderedAluInputCenterY(alu, 1) - renderedAluInputCenterY(alu, 0)).toBe(diagramSizing.gridSize * 2);
    expect(lhsRoute?.[lhsRoute.length - 1]).toEqual({
      x: alu.position.x - diagramSizing.edgeLeadLength,
      y: renderedAluInputCenterY(alu, 0)
    });
    expect(rhsRoute?.[rhsRoute.length - 1]).toEqual({
      x: alu.position.x - diagramSizing.edgeLeadLength,
      y: renderedAluInputCenterY(alu, 1)
    });
    expect(outRoute?.[0]).toEqual({
      x: alu.position.x + diagramNodeDimensions(alu).width + diagramSizing.edgeLeadLength,
      y: alu.position.y + diagramNodeDimensions(alu).height / 2
    });
  });

  it('aligns literal nodes with their output ports for direct assignments', async () => {
    const literalGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            { id: 'literal', kind: 'literal', label: "8'h42", ports: [{ id: 'y', name: 'y', direction: 'output' }] },
            { id: 'y', kind: 'port', label: 'y', ports: [{ id: 'y', name: 'y', direction: 'output' }] }
          ],
          edges: [
            { id: 'literal-y', source: 'literal', sourcePort: 'y', target: 'y', targetPort: 'y' }
          ]
        }
      }
    };

    const view = await buildViewModel(literalGraph, 'top', { version: 1, modules: {} });
    const literal = view.nodes.find((node) => node.id === 'literal')!;
    const y = view.nodes.find((node) => node.id === 'y')!;

    expect(literal.position.y + diagramNodeDimensions(literal).height / 2).toBe(renderedPortCenterY(y));
  });

  it('aligns compact replication nodes with literal inputs and output ports', async () => {
    const replicationGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            { id: 'literal', kind: 'literal', label: "1'b1", ports: [{ id: 'out', name: "1'b1", direction: 'output' }] },
            {
              id: 'rep',
              kind: 'replicate',
              label: 'x4',
              ports: [
                { id: 'in', name: 'in', direction: 'input' },
                { id: 'out', name: 'fill_ones', direction: 'output' }
              ]
            },
            { id: 'fill', kind: 'port', label: 'fill_ones', ports: [{ id: 'fill', name: 'fill_ones', direction: 'output' }] }
          ],
          edges: [
            { id: 'literal-rep', source: 'literal', sourcePort: 'out', target: 'rep', targetPort: 'in' },
            { id: 'rep-fill', source: 'rep', sourcePort: 'out', target: 'fill', targetPort: 'fill' }
          ]
        }
      }
    };

    const view = await buildViewModel(replicationGraph, 'top', { version: 1, modules: {} });
    const literal = view.nodes.find((node) => node.id === 'literal')!;
    const rep = view.nodes.find((node) => node.id === 'rep')!;
    const fill = view.nodes.find((node) => node.id === 'fill')!;
    const replicateCenterY = rep.position.y + diagramNodeDimensions(rep).height / 2;

    expect(literal.position.y + diagramNodeDimensions(literal).height / 2).toBe(replicateCenterY);
    expect(renderedPortCenterY(fill)).toBe(replicateCenterY);
  });

  it('aligns bus breakout output ports with their rendered tap rows', async () => {
    const busGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            {
              id: 'bus',
              kind: 'bus',
              label: 'instr',
              ports: [
                { id: 'in', name: 'instr', direction: 'input' },
                { id: 'opcode', name: 'instr[6:0]', direction: 'output' },
                { id: 'flag', name: 'instr[30]', direction: 'output' }
              ]
            },
            { id: 'instr', kind: 'port', label: 'instr', ports: [{ id: 'instr', name: 'instr', direction: 'input' }] },
            { id: 'opcode', kind: 'port', label: 'opcode', ports: [{ id: 'opcode', name: 'opcode', direction: 'output' }] },
            { id: 'flag', kind: 'port', label: 'flag', ports: [{ id: 'flag', name: 'flag', direction: 'output' }] }
          ],
          edges: [
            { id: 'instr-bus', source: 'instr', sourcePort: 'instr', target: 'bus', targetPort: 'in' },
            { id: 'bus-opcode', source: 'bus', sourcePort: 'opcode', target: 'opcode', targetPort: 'opcode' },
            { id: 'bus-flag', source: 'bus', sourcePort: 'flag', target: 'flag', targetPort: 'flag' }
          ]
        }
      }
    };

    const view = await buildViewModel(busGraph, 'top', { version: 1, modules: {} });
    const bus = view.nodes.find((node) => node.id === 'bus')!;
    const opcode = view.nodes.find((node) => node.id === 'opcode')!;
    const flag = view.nodes.find((node) => node.id === 'flag')!;

    expect(renderedPortCenterY(opcode)).toBe(renderedBusTapCenterY(bus, 0));
    expect(renderedPortCenterY(flag)).toBe(renderedBusTapCenterY(bus, 1));
  });

  it('routes non-fixed seeded layouts against final ELK node positions', async () => {
    const seededGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            {
              id: 'comb',
              kind: 'comb',
              label: '',
              ports: [
                { id: 'out', name: 'decoded', direction: 'output' },
                { id: 'a', name: 'a', direction: 'input' },
                { id: 'b', name: 'b', direction: 'input' }
              ]
            },
            { id: 'a', kind: 'port', label: 'a', ports: [{ id: 'a', name: 'a', direction: 'input' }] },
            { id: 'b', kind: 'port', label: 'b', ports: [{ id: 'b', name: 'b', direction: 'input' }] },
            { id: 'decoded', kind: 'port', label: 'decoded', ports: [{ id: 'decoded', name: 'decoded', direction: 'output' }] }
          ],
          edges: [
            { id: 'a-comb', source: 'a', sourcePort: 'a', target: 'comb', targetPort: 'a' },
            { id: 'b-comb', source: 'b', sourcePort: 'b', target: 'comb', targetPort: 'b' },
            { id: 'comb-decoded', source: 'comb', sourcePort: 'out', target: 'decoded', targetPort: 'decoded' }
          ]
        }
      }
    };
    const seededLayout: SavedLayout = {
      version: 1,
      modules: {
        top: {
          nodes: {
            comb: { x: 240, y: 96 },
            a: { x: 48, y: 96 },
            b: { x: 48, y: 144 },
            decoded: { x: 480, y: 96 }
          }
        }
      }
    };

    const view = await buildViewModel(seededGraph, 'top', seededLayout);
    const a = view.nodes.find((node) => node.id === 'a')!;
    const comb = view.nodes.find((node) => node.id === 'comb')!;
    const edge = view.edges.find((candidate) => candidate.id === 'a-comb')!;
    const targetLead = edge.routePoints?.[edge.routePoints.length - 1];
    const beforeTargetLead = edge.routePoints?.[edge.routePoints.length - 2];

    expect(edge.routePoints?.[0]).toMatchObject({
      x: a.position.x + diagramNodeDimensions(a).width + diagramSizing.edgeLeadLength,
      y: renderedPortCenterY(a)
    });
    expect(targetLead).toEqual({
      x: comb.position.x - diagramSizing.edgeLeadLength,
      y: renderedNodeInputCenterY(comb, 0)
    });
    expect(beforeTargetLead?.y).toBe(targetLead?.y);
    expect(beforeTargetLead?.x).toBeLessThan(targetLead!.x);
  });

  it('preserves explicit seeded positions for existing nodes when new nodes appear later', async () => {
    const initialView = await buildViewModel(graph, 'top', { version: 1, modules: {} });
    initialView.nodes.forEach(n => n.fixed = true);
    const seeded = mergeNodePositions({ version: 1, modules: {} }, 'top', initialView.nodes);
    const expandedGraph: DesignGraph = {
      ...graph,
      modules: {
        top: {
          ...graph.modules.top,
          nodes: [
            ...graph.modules.top.nodes,
            { id: 'new', kind: 'mux', label: 'new', ports: [] }
          ]
        }
      }
    };

    const expandedView = await buildViewModel(expandedGraph, 'top', seeded);

    expect(expandedView.nodes.find((node) => node.id === 'a')?.position).toEqual({ x: seeded.modules.top.nodes.a.x, y: seeded.modules.top.nodes.a.y });
    expect(expandedView.nodes.find((node) => node.id === 'u')?.position).toEqual({ x: seeded.modules.top.nodes.u.x, y: seeded.modules.top.nodes.u.y });
    expect(expandedView.nodes.find((node) => node.id === 'new')?.position).toBeDefined();
  });

  it('places renamed connected nodes with graph context instead of near the origin', async () => {
    const connectedGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            { id: 'input', kind: 'port', label: 'input', ports: [] },
            { id: 'old_reg', kind: 'register', label: 'old_reg', ports: [] },
            { id: 'sink', kind: 'instance', label: 'sink', ports: [] }
          ],
          edges: [
            { id: 'input-new', source: 'input', target: 'new_reg' },
            { id: 'new-sink', source: 'new_reg', target: 'sink' }
          ]
        }
      }
    };
    const layout: SavedLayout = {
      version: 1,
      modules: {
        top: {
          nodes: {
            input: { x: 500, y: 500, fixed: true },
            sink: { x: 900, y: 500, fixed: true },
            old_reg: { x: 700, y: 500, stale: true, fixed: true }
          }
        }
      }
    };
    connectedGraph.modules.top.nodes[1] = { id: 'new_reg', kind: 'register', label: 'new_reg', ports: [] };

    const view = await buildViewModel(connectedGraph, 'top', layout);
    const newReg = view.nodes.find((node) => node.id === 'new_reg');

    expect(view.nodes.find((node) => node.id === 'input')?.position).toEqual({ x: 504, y: 492 });
    expect(view.nodes.find((node) => node.id === 'sink')?.position).toEqual({ x: 912, y: 504 });
    expect(newReg?.position.x).toBeGreaterThan(100);
    expect(newReg?.position.y).toBeGreaterThanOrEqual(0);
  });

  it('keeps a renamed register in the ELK layer between its input and output ports', async () => {
    const before: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            { id: 'port:top:clk', kind: 'port', label: 'clk', ports: [{ id: 'clk', name: 'clk', direction: 'input' }] },
            { id: 'port:top:d', kind: 'port', label: 'd', ports: [{ id: 'd', name: 'd', direction: 'input' }] },
            { id: 'port:top:q', kind: 'port', label: 'q', ports: [{ id: 'q', name: 'q', direction: 'output' }] },
            {
              id: 'reg:top:q',
              kind: 'register',
              label: 'q',
              ports: [
                { id: 'd', name: 'D', direction: 'input' },
                { id: 'clk', name: 'clk', direction: 'input' },
                { id: 'q', name: 'Q', direction: 'output' }
              ],
              metadata: { clockSignal: 'clk' }
            }
          ],
          edges: [
            { id: 'd-q', source: 'port:top:d', sourcePort: 'd', target: 'reg:top:q', targetPort: 'd' },
            { id: 'clk-q', source: 'port:top:clk', sourcePort: 'clk', target: 'reg:top:q', targetPort: 'clk' },
            { id: 'q-out', source: 'reg:top:q', sourcePort: 'q', target: 'port:top:q', targetPort: 'q' }
          ]
        }
      }
    };
    const initialView = await buildViewModel(before, 'top', { version: 1, modules: {} });
    const seededLayout = mergeNodePositions({ version: 1, modules: {} }, 'top', initialView.nodes);
    const after: DesignGraph = {
      ...before,
      modules: {
        top: {
          ...before.modules.top,
          nodes: before.modules.top.nodes.map((node) => {
            if (node.id === 'port:top:q') {
              return { ...node, id: 'port:top:q_new', label: 'q_new', ports: [{ id: 'q_new', name: 'q_new', direction: 'output' }] };
            }
            if (node.id === 'reg:top:q') {
              return { ...node, id: 'reg:top:q_new', label: 'q_new' };
            }
            return node;
          }),
          edges: [
            { id: 'd-q-new', source: 'port:top:d', sourcePort: 'd', target: 'reg:top:q_new', targetPort: 'd' },
            { id: 'clk-q-new', source: 'port:top:clk', sourcePort: 'clk', target: 'reg:top:q_new', targetPort: 'clk' },
            { id: 'q-new-out', source: 'reg:top:q_new', sourcePort: 'q', target: 'port:top:q_new', targetPort: 'q_new' }
          ]
        }
      }
    };

    const view = await buildViewModel(after, 'top', seededLayout);
    const d = view.nodes.find((node) => node.id === 'port:top:d')!;
    const qNew = view.nodes.find((node) => node.id === 'port:top:q_new')!;
    const reg = view.nodes.find((node) => node.id === 'reg:top:q_new')!;

    expect(reg.position.x).toBeGreaterThan(d.position.x);
    expect(reg.position.x).toBeLessThan(qNew.position.x);
    expect(reg.position.x).toBeGreaterThanOrEqual(diagramSizing.gridSize * 10);
  });

  it('keeps pre-arranged nodes stable when adding and removing a ccc-fed register', async () => {
    const baseGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            { id: 'port:top:ccc', kind: 'port', label: 'ccc', ports: [] },
            { id: 'port:top:clk', kind: 'port', label: 'clk', ports: [] },
            { id: 'reg:top:c_q', kind: 'register', label: 'c_q', ports: [] },
            { id: 'mux:top:y:sel', kind: 'mux', label: 'case sel', ports: [] }
          ],
          edges: [
            { id: 'ccc-cq', source: 'port:top:ccc', target: 'reg:top:c_q' },
            { id: 'clk-cq', source: 'port:top:clk', target: 'reg:top:c_q' }
          ]
        }
      }
    };
    const arrangedLayout: SavedLayout = {
      version: 1,
      modules: {
        top: {
          nodes: {
            'port:top:ccc': { x: 192, y: 732, fixed: true },
            'port:top:clk': { x: 192, y: 564, fixed: true },
            'reg:top:c_q': { x: 528, y: 696, fixed: true },
            'mux:top:y:sel': { x: 528, y: 312, fixed: true }
          }
        }
      }
    };
    const expandedGraph: DesignGraph = {
      ...baseGraph,
      modules: {
        top: {
          ...baseGraph.modules.top,
          nodes: [
            ...baseGraph.modules.top.nodes,
            { id: 'reg:top:cc_q', kind: 'register', label: 'cc_q', ports: [] }
          ],
          edges: [
            ...baseGraph.modules.top.edges,
            { id: 'ccc-ccq', source: 'port:top:ccc', target: 'reg:top:cc_q' },
            { id: 'clk-ccq', source: 'port:top:clk', target: 'reg:top:cc_q' }
          ]
        }
      }
    };

    const expandedView = await buildViewModel(expandedGraph, 'top', arrangedLayout);
    const expandedLayout = mergeNodePositions(arrangedLayout, 'top', expandedView.nodes);
    const collapsedView = await buildViewModel(baseGraph, 'top', expandedLayout);

    for (const [id, expected] of Object.entries(arrangedLayout.modules.top.nodes)) {
      expect(expandedView.nodes.find((node) => node.id === id)?.position).toEqual({ x: expected.x, y: expected.y });
      expect(collapsedView.nodes.find((node) => node.id === id)?.position).toEqual({ x: expected.x, y: expected.y });
    }
    expect(expandedView.nodes.some((node) => node.id === 'reg:top:cc_q')).toBe(true);
    expect(collapsedView.nodes.some((node) => node.id === 'reg:top:cc_q')).toBe(false);
  });

    it('respects port order during auto-layout to avoid wire crossings', async () => {
    // a connects to port0 (top), b connects to port1 (bottom)
    // If ELK respects order, 'a' should be above 'b'.
    const orderedGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            { id: 'p_a', kind: 'port', label: 'a', ports: [{ id: 'out', name: 'out', direction: 'output' }] },
            { id: 'p_b', kind: 'port', label: 'b', ports: [{ id: 'out', name: 'out', direction: 'output' }] },
            { id: 'c', kind: 'comb', label: 'comb', ports: [
              { id: 'in_a', name: 'a', direction: 'input' },
              { id: 'in_b', name: 'b', direction: 'input' }
            ] }
          ],
          edges: [
            { id: 'e_a', source: 'p_a', target: 'c', sourcePort: 'out', targetPort: 'in_a' },
            { id: 'e_b', source: 'p_b', target: 'c', sourcePort: 'out', targetPort: 'in_b' }
          ]
        }
      }
    };

    const view = await buildViewModel(orderedGraph, 'top', { version: 1, modules: {} });
    const posA = view.nodes.find(n => n.id === 'p_a')!.position;
    const posB = view.nodes.find(n => n.id === 'p_b')!.position;

    // 'a' should be above 'b'
    expect(posA.y).toBeLessThan(posB.y);
    });

    it('allows auto-layout to move previously positioned nodes if they are not fixed', async () => {
      const initialGraph: DesignGraph = {
        rootModules: ['top'],
        generatedAt: 'now',
        diagnostics: [],
        modules: {
          top: {
            name: 'top',
            file: 'top.sv',
            ports: [],
            nodes: [
              { id: 'a', kind: 'port', label: 'a', ports: [{ id: 'out', name: 'out', direction: 'input' }] },
              { id: 'y', kind: 'port', label: 'y', ports: [{ id: 'in', name: 'in', direction: 'output' }] }
            ],
            edges: [
              { id: 'a-y', source: 'a', target: 'y', sourcePort: 'out', targetPort: 'in' }
            ]
          }
        }
      };

      const initialView = await buildViewModel(initialGraph, 'top', { version: 1, modules: {} });
      const originalYPos = initialView.nodes.find(n => n.id === 'y')!.position.x;
      const layout = mergeNodePositions({ version: 1, modules: {} }, 'top', initialView.nodes);

      // Node 'a' should NOT be in the layout because it's not fixed
      expect(layout.modules.top.nodes['a']).toBeUndefined();

      const expandedGraph: DesignGraph = {
        ...initialGraph,
        modules: {
          top: {
            ...initialGraph.modules.top,
            nodes: [
              ...initialGraph.modules.top.nodes,
              { id: 'b', kind: 'port', label: 'b', ports: [{ id: 'out', name: 'out', direction: 'output' }] },
              { id: 'c', kind: 'comb', label: 'comb', ports: [
                { id: 'in_a', name: 'in_a', direction: 'input' },
                { id: 'in_b', name: 'in_b', direction: 'input' },
                { id: 'out_y', name: 'out_y', direction: 'output' }
              ] }
            ],
            edges: [
              { id: 'a-c', source: 'a', target: 'c', sourcePort: 'out', targetPort: 'in_a' },
              { id: 'b-c', source: 'b', target: 'c', sourcePort: 'out', targetPort: 'in_b' },
              { id: 'c-y', source: 'c', target: 'y', sourcePort: 'out_y', targetPort: 'in' }
            ]
          }
        }
      };

      const expandedView = await buildViewModel(expandedGraph, 'top', layout);
      const newYPos = expandedView.nodes.find((node) => node.id === 'y')?.position.x;

      expect(newYPos).toBeGreaterThan(originalYPos!);
    });
  it('prevents auto-layout from moving nodes that are explicitly fixed', async () => {
    const initialGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            { id: 'a', kind: 'port', label: 'a', ports: [{ id: 'out', name: 'out', direction: 'input' }] },
            { id: 'y', kind: 'port', label: 'y', ports: [{ id: 'in', name: 'in', direction: 'output' }] }
          ],
          edges: [
            { id: 'a-y', source: 'a', target: 'y', sourcePort: 'out', targetPort: 'in' }
          ]
        }
      }
    };

    const initialView = await buildViewModel(initialGraph, 'top', { version: 1, modules: {} });
    initialView.nodes.find(n => n.id === 'y')!.fixed = true;
    const layout = mergeNodePositions({ version: 1, modules: {} }, 'top', initialView.nodes);

    expect(layout.modules.top.nodes['y'].fixed).toBe(true);
    const originalYPos = layout.modules.top.nodes['y'].x;

    const expandedGraph: DesignGraph = {
      ...initialGraph,
      modules: {
        top: {
          ...initialGraph.modules.top,
          nodes: [
            ...initialGraph.modules.top.nodes,
            { id: 'b', kind: 'port', label: 'b', ports: [{ id: 'out', name: 'out', direction: 'output' }] },
            { id: 'c', kind: 'comb', label: 'comb', ports: [
              { id: 'in_a', name: 'in_a', direction: 'input' },
              { id: 'in_b', name: 'in_b', direction: 'input' },
              { id: 'out_y', name: 'out_y', direction: 'output' }
            ] }
          ],
          edges: [
            { id: 'a-c', source: 'a', target: 'c', sourcePort: 'out', targetPort: 'in_a' },
            { id: 'b-c', source: 'b', target: 'c', sourcePort: 'out', targetPort: 'in_b' },
            { id: 'c-y', source: 'c', target: 'y', sourcePort: 'out_y', targetPort: 'in' }
          ]
        }
      }
    };

    const expandedView = await buildViewModel(expandedGraph, 'top', layout);
    const newYPos = expandedView.nodes.find((node) => node.id === 'y')?.position.x;

    expect(newYPos).toBe(originalYPos!);
  });

  it('gives stacked mux nodes enough bottom margin so backward edges clear the visual back-layer overhang', async () => {
    // The back layer of a stacked node is rendered ARRAY_STACK_LANE_OFFSET (4 px) below the
    // logical node boundary.  ELK routes edges outside ELK-node boundaries; the ELK node
    // bottom = logical_bottom + bottom_margin.  If bottom_margin == 4 == ARRAY_STACK_LANE_OFFSET
    // the route sits exactly on the back-layer skin, producing visible overlap.  We need
    // bottom_margin > ARRAY_STACK_LANE_OFFSET so routes clear the skin entirely.
    const ARRAY_STACK_LANE_OFFSET = 4; // mirror of arrayStackGeometry.ts

    // Topology mirrors array_address_write_enable_register:
    //   inputs → write_en mux → addr mux → array register → outputs
    //   array register Q feeds back to write_en mux.false and addr_mux.default
    const stackedFeedbackGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            {
              id: 'wen_mux',
              kind: 'mux',
              label: 'if write_en',
              ports: [
                { id: 'wen_sel', name: 'sel', direction: 'input' },
                { id: 'wen_true', name: 'true', direction: 'input' },
                { id: 'wen_false', name: 'false', direction: 'input' },
                { id: 'wen_out', name: 'out', direction: 'output' }
              ],
              metadata: { isArrayNode: true }
            },
            {
              id: 'addr_mux',
              kind: 'mux',
              label: 'write address',
              ports: [
                { id: 'addr_sel', name: 'sel', direction: 'input' },
                { id: 'addr_data', name: "2'b0", direction: 'input' },
                { id: 'addr_default', name: 'default', direction: 'input' },
                { id: 'addr_out', name: 'out', direction: 'output' }
              ],
              metadata: { isArrayNode: true }
            },
            {
              id: 'reg',
              kind: 'register',
              label: 'storage',
              ports: [
                { id: 'reg_d', name: 'D', direction: 'input' },
                { id: 'reg_clk', name: 'clk', direction: 'input' },
                { id: 'reg_q', name: 'Q', direction: 'output' }
              ],
              metadata: { isArrayNode: true, clockSignal: 'clk' }
            }
          ],
          edges: [
            { id: 'wen-addr', source: 'wen_mux', sourcePort: 'wen_out', target: 'addr_mux', targetPort: 'addr_data' },
            { id: 'addr-reg', source: 'addr_mux', sourcePort: 'addr_out', target: 'reg', targetPort: 'reg_d' },
            // Backward feedback edges: reg Q drives both mux hold inputs
            { id: 'reg-wen-fb', source: 'reg', sourcePort: 'reg_q', target: 'wen_mux', targetPort: 'wen_false' },
            { id: 'reg-addr-fb', source: 'reg', sourcePort: 'reg_q', target: 'addr_mux', targetPort: 'addr_default' }
          ]
        }
      }
    };

    const view = await buildViewModel(stackedFeedbackGraph, 'top', { version: 1, modules: {} });

    const wenMux = view.nodes.find((n) => n.id === 'wen_mux')!;
    const addrMux = view.nodes.find((n) => n.id === 'addr_mux')!;
    expect(wenMux).toBeDefined();
    expect(addrMux).toBeDefined();

    // Any route point that dips below a stacked mux's logical bottom must also clear the
    // back-layer overhang.  With only 4 px bottom margin the route lands exactly at the
    // back-layer skin; with edgeLeadLength margin it lands well below it.
    for (const edge of view.edges) {
      if (!edge.routePoints) continue;
      for (const point of edge.routePoints) {
        for (const mux of [wenMux, addrMux]) {
          const muxLogicalBottom = mux.position.y + diagramNodeDimensions(mux).height;
          if (point.y > muxLogicalBottom) {
            expect(point.y).toBeGreaterThan(muxLogicalBottom + ARRAY_STACK_LANE_OFFSET);
          }
        }
      }
    }
  });

  it('keeps forward register fanout routes from backtracking through blocks', async () => {
    const stackedFanoutGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            {
              id: 'wen_mux',
              kind: 'mux',
              label: 'if write_en',
              ports: [
                { id: 'sel', name: 'sel', direction: 'input' },
                { id: 'wen_true', name: 'true', direction: 'input' },
                { id: 'wen_false', name: 'false', direction: 'input' },
                { id: 'out', name: 'out', direction: 'output' }
              ],
              metadata: { isArrayNode: true }
            },
            {
              id: 'addr_mux',
              kind: 'mux',
              label: 'write address',
              ports: [
                { id: 'sel', name: 'sel', direction: 'input' },
                { id: 'addr_data', name: "2'b0", direction: 'input' },
                { id: 'addr_default', name: 'default', direction: 'input' },
                { id: 'out', name: 'out', direction: 'output' }
              ],
              metadata: { isArrayNode: true }
            },
            {
              id: 'reg',
              kind: 'register',
              label: 'storage',
              ports: [
                { id: 'd', name: 'D', direction: 'input' },
                { id: 'q', name: 'Q', direction: 'output' },
                { id: 'clk', name: 'clk', direction: 'input' }
              ],
              metadata: { isArrayNode: true, clockSignal: 'clk' }
            },
            {
              id: 'out_data',
              kind: 'port',
              label: 'out_data',
              ports: [{ id: 'out_data', name: 'out_data', direction: 'output' }]
            }
          ],
          edges: [
            { id: 'wen-addr', source: 'wen_mux', sourcePort: 'out', target: 'addr_mux', targetPort: 'addr_data' },
            { id: 'addr-reg', source: 'addr_mux', sourcePort: 'out', target: 'reg', targetPort: 'd' },
            { id: 'reg-out', source: 'reg', sourcePort: 'q', target: 'out_data', targetPort: 'out_data' },
            { id: 'reg-wen-fb', source: 'reg', sourcePort: 'q', target: 'wen_mux', targetPort: 'wen_false' },
            { id: 'reg-addr-fb', source: 'reg', sourcePort: 'q', target: 'addr_mux', targetPort: 'addr_default' }
          ]
        }
      }
    };

    const view = await buildViewModel(stackedFanoutGraph, 'top', {
      version: 1,
      modules: {
        top: {
          nodes: {
            reg: { x: 360, y: 216, fixed: true },
            wen_mux: { x: 768, y: 120, fixed: true },
            addr_mux: { x: 1128, y: 120, fixed: true },
            out_data: { x: 768, y: 252, fixed: true }
          }
        }
      }
    });

    const reg = view.nodes.find((node) => node.id === 'reg')!;
    const wenMux = view.nodes.find((node) => node.id === 'wen_mux')!;
    const outData = view.nodes.find((node) => node.id === 'out_data')!;
    const qLeadX = reg.position.x + diagramNodeDimensions(reg).width + diagramSizing.edgeLeadLength;

    for (const edge of view.edges.filter((candidate) => candidate.source === 'reg')) {
      expect(edge.routePoints).toBeDefined();
      expect(Math.min(...edge.routePoints!.map((point) => point.x))).toBeGreaterThanOrEqual(qLeadX);
    }

    const addrRoute = view.edges.find((edge) => edge.id === 'reg-addr-fb')!.routePoints!;
    expect(routeCrossesNodeInterior(addrRoute, wenMux)).toBe(false);
    expect(routeCrossesNodeInterior(addrRoute, outData)).toBe(false);
    expect(Math.max(...addrRoute.map((point) => point.y))).toBeGreaterThan(outData.position.y + diagramNodeDimensions(outData).height);
  });

  it('keeps vertical select feeds one grid away from neighboring select blocks', async () => {
    const graph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            {
              id: 'wide_expr',
              kind: 'comb',
              label: 'wide expr',
              ports: [
                { id: 'sel_wide', name: 'sel_wide', direction: 'input' },
                { id: 'out', name: 'out', direction: 'output' }
              ]
            },
            {
              id: 'literal8',
              kind: 'literal',
              label: '8',
              ports: [{ id: 'out', name: '8', direction: 'output' }]
            },
            {
              id: 'bit_out',
              kind: 'port',
              label: 'bit_out',
              ports: [{ id: 'bit_out', name: 'bit_out', direction: 'output' }]
            },
            {
              id: 'bus',
              kind: 'port',
              label: 'bus',
              ports: [{ id: 'bus', name: 'bus', direction: 'input' }]
            },
            {
              id: 'byte_out',
              kind: 'port',
              label: 'byte_out',
              ports: [{ id: 'byte_out', name: 'byte_out', direction: 'output' }]
            },
            {
              id: 'sel',
              kind: 'port',
              label: 'sel',
              ports: [{ id: 'sel', name: 'sel', direction: 'input' }]
            },
            {
              id: 'sel_wide',
              kind: 'port',
              label: 'sel_wide',
              ports: [{ id: 'sel_wide', name: 'sel_wide', direction: 'input' }]
            },
            {
              id: 'wide_select',
              kind: 'select',
              label: 'bus[wide]',
              ports: [
                { id: 'sel', name: 'sel', direction: 'input', label: 's' },
                { id: 'width', name: 'width', direction: 'input', label: 'w' },
                { id: 'in', name: 'in', direction: 'input' },
                { id: 'out', name: 'out', direction: 'output' }
              ]
            },
            {
              id: 'bit_select',
              kind: 'select',
              label: 'bus[sel]',
              ports: [
                { id: 'sel', name: 'sel', direction: 'input', label: 's' },
                { id: 'in', name: 'in', direction: 'input' },
                { id: 'out', name: 'out', direction: 'output' }
              ]
            }
          ],
          edges: [
            { id: 'wide-expr-select', source: 'wide_expr', sourcePort: 'out', target: 'wide_select', targetPort: 'sel' },
            { id: 'literal-width', source: 'literal8', sourcePort: 'out', target: 'wide_select', targetPort: 'width' },
            { id: 'bus-bit', source: 'bus', sourcePort: 'bus', target: 'bit_select', targetPort: 'in' },
            { id: 'bus-wide', source: 'bus', sourcePort: 'bus', target: 'wide_select', targetPort: 'in' },
            { id: 'sel-bit', source: 'sel', sourcePort: 'sel', target: 'bit_select', targetPort: 'sel' },
            { id: 'sel-wide-expr', source: 'sel_wide', sourcePort: 'sel_wide', target: 'wide_expr', targetPort: 'sel_wide' },
            { id: 'bit-out', source: 'bit_select', sourcePort: 'out', target: 'bit_out', targetPort: 'bit_out' },
            { id: 'byte-out', source: 'wide_select', sourcePort: 'out', target: 'byte_out', targetPort: 'byte_out' }
          ]
        }
      }
    };

    const view = await buildViewModel(graph, 'top', { version: 1, modules: {} });

    const route = view.edges.find((edge) => edge.id === 'sel-bit')!.routePoints!;
    const sel = view.nodes.find((node) => node.id === 'sel')!;
    const upperSelect = view.nodes.find((node) => node.id === 'wide_select')!;
    const upperClearanceBottom = upperSelect.position.y + diagramNodeDimensions(upperSelect).height + diagramSizing.gridSize;

    expect(sel.position.y + diagramSizing.portHeight / 2).toBe(upperClearanceBottom);
    expect(route).toHaveLength(3);
    expect(route[0].y).toBe(upperClearanceBottom);
    expect(route[1].y).toBe(upperClearanceBottom);
    expect(route.some((point) => point.y >= upperClearanceBottom)).toBe(true);
    for (let i = 0; i < route.length - 1; i++) {
      expect(
        segmentCrossesNodeInterior(route[i], route[i + 1], upperSelect, diagramSizing.gridSize),
        `upper select clearance hit on segment ${JSON.stringify(route[i])} -> ${JSON.stringify(route[i + 1])}`
      ).toBe(false);
    }
  });

  it('keeps separate source lanes for multiple interface top ports', async () => {
    const graph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            {
              id: 'request_bus',
              kind: 'interface',
              label: 'request_bus',
              ports: [
                { id: 'in:clk', name: 'clk', direction: 'input' },
                { id: 'in:rst_n', name: 'rst_n', direction: 'input' },
                { id: 'in:requester', name: 'requester', direction: 'input', width: 'interface', preferredSide: 'left' },
                { id: 'in:arbiter', name: 'arbiter', direction: 'input', width: 'interface', preferredSide: 'left' }
              ]
            },
            {
              id: 'clk',
              kind: 'port',
              label: 'clk',
              ports: [{ id: 'port:clk', name: 'clk', direction: 'input' }]
            },
            {
              id: 'rst_n',
              kind: 'port',
              label: 'rst_n',
              ports: [{ id: 'port:rst_n', name: 'rst_n', direction: 'input' }]
            },
            {
              id: 'requester',
              kind: 'instance',
              label: 'u_requester',
              ports: [{ id: 'bus', name: 'bus', direction: 'output', width: 'interface' }]
            },
            {
              id: 'arbiter',
              kind: 'instance',
              label: 'u_arbiter',
              ports: [{ id: 'bus', name: 'bus', direction: 'output', width: 'interface' }]
            }
          ],
          edges: [
            { id: 'clk-bus', source: 'clk', sourcePort: 'port:clk', target: 'request_bus', targetPort: 'in:clk' },
            { id: 'rst-bus', source: 'rst_n', sourcePort: 'port:rst_n', target: 'request_bus', targetPort: 'in:rst_n' },
            { id: 'requester-bus', source: 'requester', sourcePort: 'bus', target: 'request_bus', targetPort: 'in:requester' },
            { id: 'arbiter-bus', source: 'arbiter', sourcePort: 'bus', target: 'request_bus', targetPort: 'in:arbiter' }
          ]
        }
      }
    };

    const view = await buildViewModel(graph, 'top', { version: 1, modules: {} });

    const clk = view.nodes.find((node) => node.id === 'clk')!;
    const rst = view.nodes.find((node) => node.id === 'rst_n')!;
    const rstRoute = view.edges.find((edge) => edge.id === 'rst-bus')!.routePoints!;
    const clkCenterY = renderedPortCenterY(clk);
    const rstCenterY = renderedPortCenterY(rst);

    expect(rstCenterY).toBeLessThan(clkCenterY);
    expect(rstRoute).toHaveLength(3);
    expect(rstRoute[0].y).toBe(rstCenterY);
    expect(rstRoute[1].y).toBe(rstCenterY);
    expect(rstRoute[0].y).toBeLessThan(clkCenterY);
  });

  it('keeps stacked feedback lanes one grid away from endpoint blocks after the lead stubs', async () => {
    const graph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            {
              id: 'addr_mux',
              kind: 'mux',
              label: 'storage_addr',
              ports: [
                { id: 'sel', name: 'sel', direction: 'input' },
                { id: 'data', name: "2'b0", direction: 'input' },
                { id: 'hold', name: 'default', direction: 'input' },
                { id: 'out', name: 'out', direction: 'output' }
              ],
              metadata: { isArrayNode: true }
            },
            {
              id: 'reg',
              kind: 'register',
              label: 'storage',
              ports: [
                { id: 'd', name: 'D', direction: 'input' },
                { id: 'q', name: 'Q', direction: 'output' },
                { id: 'clk', name: 'clk', direction: 'input' }
              ],
              metadata: { isArrayNode: true, clockSignal: 'clk' }
            },
            { id: 'address', kind: 'port', label: 'address', ports: [{ id: 'address', name: 'address', direction: 'input' }] },
            { id: 'clk', kind: 'port', label: 'clk', ports: [{ id: 'clk', name: 'clk', direction: 'input' }] },
            { id: 'in_data', kind: 'port', label: 'in_data', ports: [{ id: 'in_data', name: 'in_data', direction: 'input' }] },
            { id: 'out_data', kind: 'port', label: 'out_data', ports: [{ id: 'out_data', name: 'out_data', direction: 'output' }] }
          ],
          edges: [
            { id: 'addr-reg', source: 'addr_mux', sourcePort: 'out', target: 'reg', targetPort: 'd' },
            { id: 'address-addr', source: 'address', sourcePort: 'address', target: 'addr_mux', targetPort: 'sel' },
            { id: 'clk-reg', source: 'clk', sourcePort: 'clk', target: 'reg', targetPort: 'clk' },
            { id: 'data-addr', source: 'in_data', sourcePort: 'in_data', target: 'addr_mux', targetPort: 'data' },
            { id: 'reg-addr-fb', source: 'reg', sourcePort: 'q', target: 'addr_mux', targetPort: 'hold' },
            { id: 'reg-out', source: 'reg', sourcePort: 'q', target: 'out_data', targetPort: 'out_data' }
          ]
        }
      }
    };

    const view = await buildViewModel(graph, 'top', {
      version: 1,
      modules: {
        top: {
          nodes: {
            addr_mux: { x: 408, y: 120, fixed: true },
            reg: { x: 768, y: 120, fixed: true },
            address: { x: 24, y: 36, fixed: true },
            clk: { x: 432, y: 36, fixed: true },
            in_data: { x: 24, y: 156, fixed: true },
            out_data: { x: 1176, y: 156, fixed: true }
          }
        }
      }
    });

    const route = view.edges.find((edge) => edge.id === 'reg-addr-fb')!.routePoints!;
    const endpoints = [
      view.nodes.find((node) => node.id === 'addr_mux')!,
      view.nodes.find((node) => node.id === 'reg')!
    ];

    for (let i = 1; i < route.length - 2; i++) {
      for (const endpoint of endpoints) {
        expect(
          segmentCrossesNodeInterior(route[i], route[i + 1], endpoint, diagramSizing.gridSize),
          `${endpoint.id} clearance hit on segment ${JSON.stringify(route[i])} -> ${JSON.stringify(route[i + 1])}`
        ).toBe(false);
      }
    }
  });

  it('keeps source-side fanout stems off the source lead', async () => {
    const fanoutGraph: DesignGraph = {
      rootModules: ['top'],
      generatedAt: 'now',
      diagnostics: [],
      modules: {
        top: {
          name: 'top',
          file: 'top.sv',
          ports: [],
          nodes: [
            { id: 'data', kind: 'port', label: 'data', ports: [{ id: 'data', name: 'data', direction: 'input' }] },
            {
              id: 'upper',
              kind: 'loop',
              label: 'loop',
              ports: [
                { id: 'in', name: 'in', direction: 'input' },
                { id: 'out', name: 'out', direction: 'output' }
              ]
            },
            {
              id: 'lower',
              kind: 'loop',
              label: 'loop',
              ports: [
                { id: 'in', name: 'in', direction: 'input' },
                { id: 'out', name: 'out', direction: 'output' }
              ]
            }
          ],
          edges: [
            { id: 'data-upper', source: 'data', sourcePort: 'data', target: 'upper', targetPort: 'in' },
            { id: 'data-lower', source: 'data', sourcePort: 'data', target: 'lower', targetPort: 'in' }
          ]
        }
      }
    };

    const view = await buildViewModel(fanoutGraph, 'top', {
      version: 1,
      modules: {
        top: {
          nodes: {
            data: { x: 24, y: 36, fixed: true },
            upper: { x: 408, y: 24, fixed: true },
            lower: { x: 408, y: 144, fixed: true }
          }
        }
      }
    });

    const source = view.nodes.find((node) => node.id === 'data')!;
    const route = view.edges.find((edge) => edge.id === 'data-lower')!.routePoints!;
    const sourceLeadX = source.position.x + diagramNodeDimensions(source).width + diagramSizing.edgeLeadLength;

    expect(route[0].x).toBe(sourceLeadX);
    expect(route[1].x).toBeGreaterThan(sourceLeadX);
    expect(route.some((point) => point.x === sourceLeadX && point.y !== route[0].y)).toBe(false);
  });
});
