import * as fs from 'node:fs';
import * as path from 'node:path';
import { AvoidLib } from 'libavoid-js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runParser } from '../helper';

type Point = { x: number; y: number };

type ElkSection = {
  id?: string;
  startPoint?: Point;
  endPoint?: Point;
  bendPoints?: Point[];
  incomingShape?: string;
  outgoingShape?: string;
  incomingSections?: string[];
  outgoingSections?: string[];
};

type ElkEdge = {
  id?: string;
  sections?: ElkSection[];
};

type ElkNode = {
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string>;
};

const routingTrace = vi.hoisted(() => ({
  avoidCalls: 0,
  elkCalls: [] as Array<{ input: ElkNode; output: ElkNode }>
}));

vi.mock('../../src/layout/libavoidRouter', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/layout/libavoidRouter')>();
  return {
    ...original,
    routeDiagramWithLibavoid: async (...args: Parameters<typeof original.routeDiagramWithLibavoid>) => {
      routingTrace.avoidCalls += 1;
      return original.routeDiagramWithLibavoid(...args);
    }
  };
});

vi.mock('elkjs/lib/elk.bundled.js', async (importOriginal) => {
  const original = await importOriginal<{ default: new () => { layout(graph: ElkNode): Promise<ElkNode> } }>();
  const OriginalElk = original.default;

  class TracedElk {
    private readonly elk = new OriginalElk();

    async layout(graph: ElkNode): Promise<ElkNode> {
      const input = structuredClone(graph);
      const output = await this.elk.layout(graph);
      routingTrace.elkCalls.push({ input, output: structuredClone(output) });
      return output;
    }
  }

  return { ...original, default: TracedElk };
});

function findNode(root: ElkNode, id: string): ElkNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function absoluteNodeGeometry(
  root: ElkNode,
  id: string,
  origin: Point = { x: 0, y: 0 }
): { x: number; y: number; width?: number; height?: number } | undefined {
  const x = origin.x + (root.x ?? 0);
  const y = origin.y + (root.y ?? 0);
  if (root.id === id) {
    return { x, y, width: root.width, height: root.height };
  }
  for (const child of root.children ?? []) {
    const found = absoluteNodeGeometry(child, id, { x, y });
    if (found) return found;
  }
  return undefined;
}

function allEdges(root: ElkNode): ElkEdge[] {
  return [
    ...(root.edges ?? []),
    ...(root.children ?? []).flatMap(allEdges)
  ];
}

function sectionPoints(section: ElkSection): Point[] {
  if (!section.startPoint || !section.endPoint) return [];
  return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
}

describe('compound generate routing trace', () => {
  beforeAll(async () => {
    await AvoidLib.load();
    const { setLibavoidRuntimeForTests } = await import('../../src/layout/libavoidRouter');
    setLibavoidRuntimeForTests(AvoidLib.getInstance());
  });

  beforeEach(() => {
    routingTrace.avoidCalls = 0;
    routingTrace.elkCalls.length = 0;
  });

  it('keeps Libavoid routes with shared collinear segments without ELK fallback routes', async () => {
    const fixture = fs.readFileSync(
      path.join(__dirname, '..', 'fixtures', 'generate_arm_multi_block.sv'),
      'utf8'
    );
    const graph = await runParser('uhdm', 'generate_arm_multi_block.sv', fixture);
    const { buildViewModel, renderedLeadPoint } = await import('../../src/layout/mergeLayout');
    const view = await buildViewModel(graph, 'generate_arm_multi_block_top', { version: 1, modules: {} });

    expect(routingTrace.elkCalls).toHaveLength(2);
    expect(routingTrace.avoidCalls).toBe(1);

    const [placement, routing] = routingTrace.elkCalls;
    expect(routing.input.layoutOptions?.['elk.hierarchyHandling']).toBe('INCLUDE_CHILDREN');

    const otherId = 'instance:generate_arm_multi_block_top:g_if_other.u_other';
    const placementOther = findNode(placement.input, otherId);
    const routingOther = findNode(routing.input, otherId);
    expect(placementOther).toBeDefined();
    expect(routingOther).toBeDefined();
    expect(routingOther!.height! - placementOther!.height!).toBe(24);

    const cToOther = 'edge:port:generate_arm_multi_block_top:c:instance:generate_arm_multi_block_top:g_if_other.u_other:c';
    const otherToY = 'edge:instance:generate_arm_multi_block_top:g_if_other.u_other:port:generate_arm_multi_block_top:y:y';
    const selToMux = 'edge:port:generate_arm_multi_block_top:sel:mux:generate_arm_multi_block_top:g_if_one_y_src:ternary:sel';
    const rawEdges = allEdges(routing.output);
    const finalRoutes = new Map(view.edges.map((edge) => [edge.id, edge.routePoints]));

    // The routing graph is supplied at the already-snapped diagram positions, but
    // layered ELK lays it out again despite the "FIXED" position marker. Its edge
    // sections therefore describe a different geometry than the one we render.
    expect(absoluteNodeGeometry(routing.input, 'port:generate_arm_multi_block_top:c')).toMatchObject({ x: 0, y: 528 });
    expect(absoluteNodeGeometry(routing.output, 'port:generate_arm_multi_block_top:c')).toMatchObject({ x: 24, y: 388 });
    expect(absoluteNodeGeometry(routing.input, 'port:generate_arm_multi_block_top:sel')).toMatchObject({ x: 0, y: 384 });
    expect(absoluteNodeGeometry(routing.output, 'port:generate_arm_multi_block_top:sel')).toMatchObject({ x: 24, y: 456 });
    expect(absoluteNodeGeometry(routing.input, otherId)).toMatchObject({ x: 456, y: 492 });
    expect(absoluteNodeGeometry(routing.output, otherId)).toMatchObject({ x: 491, y: 555 });

    const rawCPoints = rawEdges.find((edge) => edge.id === cToOther)?.sections?.flatMap(sectionPoints) ?? [];
    expect(rawCPoints).toEqual([
      { x: 193, y: 413 },
      { x: 203, y: 413 },
      { x: 203, y: 616 },
      { x: 437, y: 615.5 },
      { x: 490, y: 615.5 }
    ]);
    expect(finalRoutes.get(cToOther)).toEqual([
      { x: 168, y: 552 },
      { x: 456, y: 552 }
    ]);
    expect(finalRoutes.get(otherToY)).toEqual([
      { x: 720, y: 552 },
      { x: 936, y: 552 },
      { x: 936, y: 288 },
      { x: 1032, y: 288 }
    ]);
    expect(finalRoutes.get(selToMux)).toEqual([
      { x: 168, y: 408 },
      { x: 648, y: 408 },
      { x: 648, y: 216 },
      { x: 744, y: 216 }
    ]);

    const nodesById = new Map(view.nodes.map((node) => [node.id, node]));
    const nodePositions = new Map(view.nodes.map((node) => [node.id, node.position]));
    const { routeDiagramWithLibavoid } = await import('../../src/layout/libavoidRouter');
    const avoidResult = await routeDiagramWithLibavoid(
      view.nodes,
      graph.modules.generate_arm_multi_block_top.edges,
      (nodeId, portId, includeLeadMargins) => renderedLeadPoint(
        nodeId,
        portId,
        nodesById,
        nodePositions,
        includeLeadMargins
      )
    );
    expect(routingTrace.avoidCalls).toBe(2);
    expect(avoidResult.routes.get(cToOther)).toEqual([
      { x: 168, y: 552 },
      { x: 456, y: 552 }
    ]);
    expect(avoidResult.routes.get(selToMux)).toEqual(finalRoutes.get(selToMux));
    expect(avoidResult.routes.get(otherToY)).toEqual(finalRoutes.get(otherToY));
    expect(avoidResult.rejectedNets.size).toBe(0);
  });
});
