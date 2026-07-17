import { describe, expect, it } from 'vitest';
import { buildViewModel, defaultNetCutLabel, enforceMinimumBlockGaps, mergeEdgeRoutePoints, mergeEdgeWaypoint, mergeNetCut, mergeNodePositions, mergeRegionBounds, mergeRerouteLayout, removeNetCut, renameCutNet } from '../../src/layout/mergeLayout';
import { diagramSizing, ioPortCenterOffset, muxHeightForPortRows, nodeHeightForPortRows, nodePortCenterOffset } from '../../src/diagram/constants';
import { diagramNodeDimensions } from '../../src/diagram/nodeSizing';
import { edgeNetKey } from '../../src/ir/edgeNet';
import type { DesignGraph, DiagramNode, PositionedNode } from '../../src/ir/types';
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
  const dimensions = diagramNodeDimensions(node);
  const epsilon = 0.5;

  return route.slice(0, -1).some((point, index) => {
    const next = route[index + 1];
    if (point.y === next.y) {
      return point.y > node.position.y + epsilon
        && point.y < node.position.y + dimensions.height - epsilon
        && Math.min(point.x, next.x) < node.position.x + dimensions.width - epsilon
        && Math.max(point.x, next.x) > node.position.x + epsilon;
    }
    if (point.x === next.x) {
      return point.x > node.position.x + epsilon
        && point.x < node.position.x + dimensions.width - epsilon
        && Math.min(point.y, next.y) < node.position.y + dimensions.height - epsilon
        && Math.max(point.y, next.y) > node.position.y + epsilon;
    }
    return false;
  });
}

function boundsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function hasShortInitialStair(points: Array<{ x: number; y: number }>): boolean {
  if (points.length < 5) return false;
  const [source, first, second, third, fourth] = points;
  return first.y === source.y
    && second.x === first.x
    && third.y === second.y
    && fourth.x === third.x
    && second.y !== source.y
    && Math.abs(third.x - first.x) <= diagramSizing.gridSize * 2;
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

  it('preserves a full grid gap between literals after snapping', () => {
    const literals: DiagramNode[] = [
      { id: 'start', kind: 'literal', label: 'START', ports: [] },
      { id: 'busy', kind: 'literal', label: 'BUSY', ports: [] }
    ];
    const positions = new Map([
      ['start', { x: 504, y: 36 }],
      ['busy', { x: 504, y: 60 }]
    ]);

    enforceMinimumBlockGaps(literals, positions, { nodes: {} });
    const ordered = literals
      .map((node) => ({ ...node, position: positions.get(node.id)! }))
      .sort((a, b) => a.position.y - b.position.y);

    expect(ordered[1].position.y - (ordered[0].position.y + diagramNodeDimensions(ordered[0]).height))
      .toBeGreaterThanOrEqual(diagramSizing.gridSize);
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

  it('preserves moved node positions when route points are persisted afterward', async () => {
    const moved = mergeNodePositions({ version: 1, modules: {} }, 'top', [
      { id: 'a', kind: 'port', label: 'a', ports: [], position: { x: 120, y: 132 }, fixed: true },
      { id: 'u', kind: 'instance', label: 'u', ports: [], position: { x: 360, y: 240 }, fixed: true }
    ]);
    const routed = mergeEdgeRoutePoints(moved, 'top', 'e-a-u', [
      { x: 168, y: 144 },
      { x: 264, y: 144 }
    ]);
    const view = await buildViewModel(graph, 'top', routed);

    expect(routed.modules.top.nodes).toEqual({
      a: { x: 120, y: 132, fixed: true },
      u: { x: 360, y: 240, fixed: true }
    });
    expect(view.nodes.find((node) => node.id === 'a')?.position).toEqual({ x: 120, y: 132 });
    expect(view.nodes.find((node) => node.id === 'u')?.position).toEqual({ x: 360, y: 240 });
    expect(view.edges.find((edge) => edge.id === 'e-a-u')?.routePoints).toEqual([
      { x: 168, y: 144 },
      { x: 264, y: 144 }
    ]);
  });

  it('computes generate region bounds around owned nodes with one-grid inset', async () => {
    const layout: SavedLayout = {
      version: 1,
      modules: {
        top: {
          nodes: {
            u: { x: 240, y: 120, fixed: true }
          }
        }
      }
    };
    const graphWithRegion: DesignGraph = {
      ...graph,
      modules: {
        top: {
          ...graph.modules.top,
          nodes: [{ id: 'u', kind: 'instance', label: 'u', ports: [] }],
          edges: [],
          generateRegions: [{
            id: 'r0',
            kind: 'case',
            label: 'MODE == 0 (g_case_0)',
            condition: 'MODE == 0',
            blockLabel: 'g_case_0',
            siblingGroupId: 'case:1',
            nodeIds: ['u']
          }]
        }
      }
    };

    const view = await buildViewModel(graphWithRegion, 'top', layout);
    const node = view.nodes.find((candidate) => candidate.id === 'u')!;
    const region = view.generateRegions?.[0]!;
    const size = diagramNodeDimensions(node);

    expect(region.blockLabel).toBe('g_case_0');
    expect(region.bounds.x).toBeLessThanOrEqual(node.position.x - diagramSizing.gridSize);
    expect(region.bounds.y).toBeLessThanOrEqual(node.position.y - diagramSizing.gridSize);
    expect(region.bounds.x + region.bounds.width).toBeGreaterThanOrEqual(node.position.x + size.width + diagramSizing.gridSize);
    expect(region.bounds.y + region.bounds.height).toBeGreaterThanOrEqual(node.position.y + size.height + diagramSizing.gridSize);
  });

  it('keeps saved generate region bounds from shrinking automatically', async () => {
    const layout: SavedLayout = {
      version: 1,
      modules: {
        top: {
          nodes: {
            u: { x: 240, y: 120, fixed: true }
          },
          regions: {
            r0: { x: 96, y: 48, width: 480, height: 360, fixed: true }
          }
        }
      }
    };
    const graphWithRegion: DesignGraph = {
      ...graph,
      modules: {
        top: {
          ...graph.modules.top,
          nodes: [{ id: 'u', kind: 'instance', label: 'u', ports: [] }],
          edges: [],
          generateRegions: [{
            id: 'r0',
            kind: 'if',
            label: 'if (ENABLE)',
            condition: 'ENABLE',
            siblingGroupId: 'if:1',
            nodeIds: ['u']
          }]
        }
      }
    };

    const view = await buildViewModel(graphWithRegion, 'top', layout);

    expect(view.generateRegions?.[0].bounds).toEqual({ x: 96, y: 48, width: 480, height: 360 });
    expect(view.generateRegions?.[0].fixed).toBe(true);
  });

  it('persists fixed generate region bounds and marks removed fixed regions stale', () => {
    const merged = mergeRegionBounds({
      version: 1,
      modules: {
        top: {
          nodes: {},
          regions: {
            old: { x: 1, y: 2, width: 3, height: 4, fixed: true }
          }
        }
      }
    }, 'top', [{
      id: 'r0',
      kind: 'case',
      label: 'MODE == 0',
      bounds: { x: 24.4, y: 48.5, width: 191.8, height: 96.2 },
      nodeIds: [],
      fixed: true
    }]);

    expect(merged.modules.top.regions?.old).toEqual({ x: 1, y: 2, width: 3, height: 4, fixed: true, stale: true });
    expect(merged.modules.top.regions?.r0).toEqual({ x: 24, y: 49, width: 192, height: 96, fixed: true });
  });

  it('places nested empty generate regions inside their parent placeholder', async () => {
    const graphWithRegions: DesignGraph = {
      ...graph,
      modules: {
        top: {
          ...graph.modules.top,
          nodes: [],
          edges: [],
          generateRegions: [
            {
              id: 'outer',
              kind: 'if',
              label: 'if (ENABLE) (g_if_on)',
              condition: 'ENABLE',
              blockLabel: 'g_if_on',
              siblingGroupId: 'if:1',
              nodeIds: []
            },
            {
              id: 'inner',
              kind: 'case',
              label: 'MODE == 0 (g_case_0)',
              condition: 'MODE == 0',
              blockLabel: 'g_case_0',
              parentRegionId: 'outer',
              siblingGroupId: 'case:1',
              nodeIds: []
            }
          ]
        }
      }
    };

    const view = await buildViewModel(graphWithRegions, 'top', { version: 1, modules: {} });
    const outer = view.generateRegions?.find((region) => region.id === 'outer')!;
    const inner = view.generateRegions?.find((region) => region.id === 'inner')!;

    expect(inner.bounds.x).toBeGreaterThan(outer.bounds.x);
    expect(inner.bounds.y).toBeGreaterThan(outer.bounds.y);
    expect(inner.bounds.x + inner.bounds.width).toBeLessThanOrEqual(outer.bounds.x + outer.bounds.width);
    expect(inner.bounds.y + inner.bounds.height).toBeLessThanOrEqual(outer.bounds.y + outer.bounds.height);
  });

  it('uses ELK compound regions to keep generate arm siblings separated during auto-layout', async () => {
    const graphWithCaseRegions: DesignGraph = {
      ...graph,
      modules: {
        top: {
          ...graph.modules.top,
          nodes: [
            { id: 'a', kind: 'port', label: 'a', ports: [{ id: 'p', name: 'a', direction: 'input' }] },
            { id: 'b', kind: 'port', label: 'b', ports: [{ id: 'p', name: 'b', direction: 'input' }] },
            { id: 'c', kind: 'port', label: 'c', ports: [{ id: 'p', name: 'c', direction: 'input' }] },
            { id: 'u0', kind: 'instance', label: 'u0', ports: [{ id: 'a', name: 'a', direction: 'input' }, { id: 'y', name: 'y', direction: 'output' }] },
            { id: 'u1', kind: 'instance', label: 'u1', ports: [{ id: 'a', name: 'a', direction: 'input' }, { id: 'y', name: 'y', direction: 'output' }] },
            { id: 'ud', kind: 'instance', label: 'ud', ports: [{ id: 'a', name: 'a', direction: 'input' }, { id: 'y', name: 'y', direction: 'output' }] },
            { id: 'y', kind: 'port', label: 'y', ports: [{ id: 'p', name: 'y', direction: 'output' }] }
          ],
          edges: [
            { id: 'e-a-u0', source: 'a', sourcePort: 'p', target: 'u0', targetPort: 'a', signal: 'w0' },
            { id: 'e-u0-y', source: 'u0', sourcePort: 'y', target: 'y', targetPort: 'p', signal: 'w' },
            { id: 'e-b-u1', source: 'b', sourcePort: 'p', target: 'u1', targetPort: 'a', signal: 'w1' },
            { id: 'e-u1-y', source: 'u1', sourcePort: 'y', target: 'y', targetPort: 'p', signal: 'w' },
            { id: 'e-c-ud', source: 'c', sourcePort: 'p', target: 'ud', targetPort: 'a', signal: 'wd' },
            { id: 'e-ud-y', source: 'ud', sourcePort: 'y', target: 'y', targetPort: 'p', signal: 'w' }
          ],
          generateRegions: [
            {
              id: 'r0',
              kind: 'case',
              label: 'g_case_0 /* MODE == 0 */',
              blockLabel: 'g_case_0',
              caseValue: 'MODE == 0',
              siblingGroupId: 'case:1',
              armIndex: 0,
              nodeIds: ['u0']
            },
            {
              id: 'r1',
              kind: 'case',
              label: 'g_case_1 /* MODE == 1 */',
              blockLabel: 'g_case_1',
              caseValue: 'MODE == 1',
              siblingGroupId: 'case:1',
              armIndex: 1,
              nodeIds: ['u1']
            },
            {
              id: 'rd',
              kind: 'case-default',
              label: 'g_case_default /* default */',
              blockLabel: 'g_case_default',
              caseValue: 'default',
              siblingGroupId: 'case:1',
              armIndex: 2,
              nodeIds: ['ud']
            }
          ]
        }
      }
    };

    const view = await buildViewModel(graphWithCaseRegions, 'top', { version: 1, modules: {} });
    const regions = [...view.generateRegions!].sort((a, b) => (a.armIndex ?? 0) - (b.armIndex ?? 0));

    expect(regions.map((region) => region.blockLabel)).toEqual(['g_case_0', 'g_case_1', 'g_case_default']);
    expect(regions[0].bounds.y).toBeLessThan(regions[1].bounds.y);
    expect(regions[1].bounds.y).toBeLessThan(regions[2].bounds.y);
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        expect(boundsOverlap(regions[i].bounds, regions[j].bounds)).toBe(false);
      }
    }

    for (const region of regions) {
      const node = view.nodes.find((candidate) => candidate.id === region.nodeIds[0])!;
      const size = diagramNodeDimensions(node);
      const padding = {
        left: node.position.x - region.bounds.x,
        top: node.position.y - region.bounds.y,
        right: region.bounds.x + region.bounds.width - node.position.x - size.width,
        bottom: region.bounds.y + region.bounds.height - node.position.y - size.height
      };
      expect(padding.left).toBeGreaterThanOrEqual(diagramSizing.gridSize);
      expect(padding.right).toBe(padding.left);
      expect(padding.top).toBe(padding.left);
      expect(padding.bottom).toBe(padding.left);
    }

    const defaultArmRoute = view.edges.find((edge) => edge.id === 'e-ud-y')?.routePoints ?? [];
    expect(hasShortInitialStair(defaultArmRoute)).toBe(false);
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
