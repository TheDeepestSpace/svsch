import type {
  DesignModule,
  DiagramEdge,
  DiagramNode,
  DiagramPort,
  PositionedGenerateRegion,
  PositionedNode
} from '../../ir/types';
import { diagramSizing, nodePortCenterOffset } from '../../diagram/constants';
import { diagramNodeDimensions, resolvedNodeDimensions } from '../../diagram/nodeSizing';
import { isInputSidePort } from '../../diagram/portDirection';

// Mirrors SavedNodeLayout / SavedExpandedInstanceLayout in
// src/storage/layoutStore.ts (not imported directly — that file imports
// `node:fs`/`node:path` and lives outside the webview tsconfig project,
// which has no Node types configured; see ExpandInstancePayload in
// main.tsx for the same reason applied to diagramPanel.ts). Extension-host
// code (diagramPanel.ts) round-trips these as plain JSON over postMessage,
// so keeping the two declarations in sync by hand is the cost of that
// boundary — same tradeoff GraphMessage/StatusMessage already accept.
export interface SavedNodeLayout {
  x: number;
  y: number;
  stale?: boolean;
  fixed?: boolean;
  width?: number;
  height?: number;
}

export interface SavedExpandedInstanceLayout {
  childModuleName: string;
  nodes: Record<string, SavedNodeLayout>;
  bounds?: { x: number; y: number; width: number; height: number };
  fixed?: boolean;
  instanceOrigin?: { x: number; y: number };
}

/**
 * "Expand instance in place" (issue #232) splices a child module's own graph
 * into the parent module's canvas, in the webview, entirely client-side (see
 * the issue's decision 2 — the frontend already has the child module's IR,
 * the same data `openModule` uses, and re-running the extractor/backend for
 * a purely-visual in-canvas unfold would be unnecessary round-tripping).
 *
 * This module is deliberately framework-free (no React, no vscode API) so
 * the splicing/layout math is unit-testable in isolation — main.tsx owns
 * turning the result into React Flow nodes/edges and wiring it into the
 * existing generate-region drag-sync machinery (see webview/main.tsx's
 * `regions` state, which this reuses via `kind: 'expand'`).
 */

export const EXPAND_ID_PREFIX = 'expand:';
const EXPAND_NS_SEP = '::';

/** Extends a (possibly already-nested) expand namespace with one more instance id — see `spliceExpandedInstance`'s `namespace` param for nested/recursive Expand. */
export function childNamespace(namespace: string, instanceId: string): string {
  return namespace ? `${namespace}${EXPAND_NS_SEP}${instanceId}` : instanceId;
}

/** A namespaced id for a node/edge spliced in under the given expand namespace, built from the child module's own local id for that node/edge. */
export function namespacedId(namespace: string, localId: string): string {
  return `${EXPAND_ID_PREFIX}${namespace}${EXPAND_NS_SEP}${localId}`;
}

export function isExpandNamespacedId(id: string): boolean {
  return id.startsWith(EXPAND_ID_PREFIX);
}

export function expandRegionId(namespace: string): string {
  return `${EXPAND_ID_PREFIX}region${EXPAND_NS_SEP}${namespace}`;
}

export interface SpliceInput {
  /** Unique path of instance ids down to (and including) the instance being expanded — e.g. "u0" or "u0::u1" for an expand nested inside another expand. */
  namespace: string;
  /** Id (within `namespace`'s immediate parent scope) of the region this splice's frame should nest under, if any — the parent module's own generate region, or an enclosing expand region. Undefined at the top level. */
  parentRegionId?: string;
  /**
   * Name of the module whose own node graph directly contains `instanceId` —
   * the real open module for a top-level Expand, or the enclosing splice's
   * `childModule.name` for a nested one (expand-of-an-expanded-instance).
   * This is also the `moduleName` key `requestExpandInstance` /
   * `saveExpandedInstanceLayout` persist under, so nested snapshots stay
   * scoped to their own instance rather than the top-level module.
   */
  parentModuleName: string;
  instanceId: string;
  instanceLabel: string;
  instancePosition: { x: number; y: number };
  instanceSize: { width: number; height: number };
  instanceParamRows: number;
  instancePorts: DiagramPort[];
  childModule: DesignModule;
  savedLayout?: SavedExpandedInstanceLayout;
}

export interface SpliceResult {
  region: PositionedGenerateRegion;
  nodes: PositionedNode[];
  edges: DiagramEdge[];
  /** child-module-local node id -> namespaced boundary node id, for rewiring the parent's edges that used to terminate on the instance itself. */
  boundaryNodeIdByChildPortName: Map<string, string>;
  /** Snapshot suitable for persisting via `saveExpandedInstanceLayout` (keyed by the child module's own local node ids, not namespaced). */
  toSavedLayout(nodes: PositionedNode[], bounds: PositionedGenerateRegion['bounds'], fixed: boolean, instanceOrigin: { x: number; y: number }): SavedExpandedInstanceLayout;
}

const REGION_INSET = diagramSizing.gridSize * 2;
const REGION_MIN_WIDTH = diagramSizing.gridSize * 8;
const REGION_MIN_HEIGHT = diagramSizing.gridSize * 5;
const BOUNDARY_COLUMN_GAP = diagramSizing.gridSize * 3;

async function loadElk(): Promise<any> {
  const elkModule = await import('elkjs/lib/elk.bundled.js');
  const Elk = (elkModule as any).default;
  return new Elk();
}

function snap(value: number): number {
  return Math.round(value / diagramSizing.gridSize) * diagramSizing.gridSize;
}

function unionBounds(rects: Array<{ x: number; y: number; width: number; height: number }>): { x: number; y: number; width: number; height: number } | undefined {
  if (rects.length === 0) return undefined;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Runs the child module's non-port nodes through elkjs (bundled — pure JS,
 * no wasm/worker, safe inside the webview's CSP sandbox) purely for relative
 * node *placement*. Edge routing is intentionally not requested from ELK
 * (and no route points are computed here at all): every edge OrthogonalEdge
 * renders already anchors its first/last drawn point to the real, live
 * React Flow handle position regardless of `routePoints` (see
 * `points = [{sourceX,sourceY}, ...officialPoints, {targetX,targetY}]` in
 * OrthogonalEdge.tsx) and falls back to a sensible default orthogonal path
 * when no explicit route is supplied — the same fallback already used for a
 * freshly-cut net before its route is chosen. Reusing that existing fallback
 * here means the spliced content never carries stale absolute-coordinate
 * routes computed for a different context.
 */
async function layoutInternalNodes(childModule: DesignModule): Promise<Map<string, { x: number; y: number }>> {
  const positions = new Map<string, { x: number; y: number }>();
  if (childModule.nodes.length === 0) return positions;

  try {
    const elk = await loadElk();
    const elkNodes = childModule.nodes.map((node) => {
      const size = resolvedNodeDimensions(node);
      return { id: node.id, width: size.width, height: size.height };
    });
    const nodeIds = new Set(childModule.nodes.map((n) => n.id));
    const elkEdges = childModule.edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] }));

    const graph = await elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': diagramSizing.sameLayerNodeSeparation.toString(),
        'elk.spacing.componentComponent': diagramSizing.sameLayerNodeSeparation.toString(),
        'elk.layered.spacing.nodeNodeBetweenLayers': diagramSizing.minNodeSeparation.toString(),
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.padding': `[top=${diagramSizing.gridSize}, left=${diagramSizing.gridSize}, bottom=${diagramSizing.gridSize}, right=${diagramSizing.gridSize}]`
      },
      children: elkNodes,
      edges: elkEdges
    });

    for (const child of graph.children ?? []) {
      if (child.id && child.x !== undefined && child.y !== undefined) {
        positions.set(child.id, { x: snap(child.x), y: snap(child.y) });
      }
    }
  } catch {
    // Fall through with whatever (possibly empty) positions were collected —
    // the caller assigns a simple grid fallback to anything still missing,
    // the same defensive posture autoLayoutMissingNodes takes server-side.
  }
  return positions;
}

export async function spliceExpandedInstance(input: SpliceInput): Promise<SpliceResult> {
  const { namespace, childModule, instancePorts, instancePosition, instanceSize, instanceParamRows } = input;

  const childPortNodesByName = new Map<string, DiagramNode>();
  for (const node of childModule.nodes) {
    if (node.kind !== 'port') continue;
    const name = node.ports[0]?.name ?? node.label;
    childPortNodesByName.set(name, node);
  }

  const inputs = instancePorts.filter(isInputSidePort);
  const outputs = instancePorts.filter((port) => port.direction === 'output');

  const boundaryNodes: PositionedNode[] = [];
  const boundaryNodeIdByChildPortName = new Map<string, string>();

  const placeBoundaryColumn = (ports: DiagramPort[], side: 'left' | 'right') => {
    ports.forEach((port, index) => {
      const childPortNode = childPortNodesByName.get(port.name);
      if (!childPortNode) return; // defensive: instance/module port lists should always agree by name

      const anchorX = side === 'left' ? instancePosition.x : instancePosition.x + instanceSize.width;
      const anchorY = instancePosition.y + nodePortCenterOffset(index + instanceParamRows);

      const boundaryNode: DiagramNode = {
        id: childPortNode.id,
        kind: 'boundaryPort',
        label: port.label ?? port.name,
        ports: [port],
        source: childPortNode.source,
        metadata: {
          boundaryPort: {
            instanceId: input.instanceId,
            childModuleName: childModule.name,
            childPortId: childPortNode.id,
            outerSide: side
          }
        }
      };
      const { width, height } = diagramNodeDimensions(boundaryNode);
      const position = side === 'left'
        ? { x: anchorX, y: anchorY - height / 2 }
        : { x: anchorX - width, y: anchorY - height / 2 };

      const namespacedNodeId = namespacedId(namespace, childPortNode.id);
      boundaryNodes.push({ ...boundaryNode, id: namespacedNodeId, position });
      boundaryNodeIdByChildPortName.set(port.name, namespacedNodeId);
    });
  };

  placeBoundaryColumn(inputs, 'left');
  placeBoundaryColumn(outputs, 'right');

  const internalNodes = childModule.nodes.filter((node) => node.kind !== 'port');

  const savedCoversAllNodes = input.savedLayout !== undefined
    && internalNodes.every((node) => input.savedLayout!.nodes[node.id] !== undefined);

  let internalPositions: Map<string, { x: number; y: number }>;
  if (savedCoversAllNodes && input.savedLayout) {
    const origin = input.savedLayout.instanceOrigin ?? instancePosition;
    const dx = instancePosition.x - origin.x;
    const dy = instancePosition.y - origin.y;
    internalPositions = new Map(internalNodes.map((node) => {
      const saved = input.savedLayout!.nodes[node.id];
      return [node.id, { x: saved.x + dx, y: saved.y + dy }];
    }));
  } else {
    const elkPositions = await layoutInternalNodes(childModule);
    const elkRects = internalNodes
      .map((node) => {
        const pos = elkPositions.get(node.id);
        if (!pos) return undefined;
        const size = resolvedNodeDimensions(node);
        return { x: pos.x, y: pos.y, width: size.width, height: size.height };
      })
      .filter((rect): rect is { x: number; y: number; width: number; height: number } => rect !== undefined);
    const elkBounds = unionBounds(elkRects) ?? { x: 0, y: 0, width: 0, height: 0 };

    const leftAnchorX = instancePosition.x;
    const avgAnchorY = boundaryNodes.length > 0
      ? boundaryNodes.reduce((sum, n) => sum + n.position.y + diagramNodeDimensions(n).height / 2, 0) / boundaryNodes.length
      : instancePosition.y + instanceSize.height / 2;

    const translateX = leftAnchorX + instanceSize.width + BOUNDARY_COLUMN_GAP - elkBounds.x;
    const translateY = avgAnchorY - (elkBounds.y + elkBounds.height / 2);

    // Fallback for any node ELK didn't return a position for (most commonly
    // every node at once, if the dynamic import of elkjs itself failed —
    // see layoutInternalNodes's catch) — stack diagonally by index rather
    // than collapsing every missing node onto the same point.
    internalPositions = new Map(internalNodes.map((node, index) => {
      const pos = elkPositions.get(node.id) ?? { x: index * diagramSizing.gridSize * 4, y: index * diagramSizing.gridSize * 4 };
      return [node.id, { x: snap(pos.x + translateX), y: snap(pos.y + translateY) }];
    }));
  }

  const internalPositionedNodes: PositionedNode[] = internalNodes.map((node) => ({
    ...node,
    id: namespacedId(namespace, node.id),
    position: internalPositions.get(node.id) ?? { x: instancePosition.x, y: instancePosition.y }
  }));

  const allNodes = [...boundaryNodes, ...internalPositionedNodes];

  const rewritePortEndpoint = (nodeId: string, portId: string | undefined): { nodeId: string; portId: string | undefined } => {
    const portNode = childModule.nodes.find((n) => n.id === nodeId && n.kind === 'port');
    if (!portNode) {
      return { nodeId: namespacedId(namespace, nodeId), portId };
    }
    const namespacedBoundaryId = namespacedId(namespace, portNode.id);
    return { nodeId: namespacedBoundaryId, portId: 'inner' };
  };

  const edges: DiagramEdge[] = childModule.edges.map((edge) => {
    const src = rewritePortEndpoint(edge.source, edge.sourcePort);
    const tgt = rewritePortEndpoint(edge.target, edge.targetPort);
    return {
      ...edge,
      id: namespacedId(namespace, edge.id),
      source: src.nodeId,
      target: tgt.nodeId,
      sourcePort: src.portId,
      targetPort: tgt.portId,
      waypoint: undefined,
      routePoints: undefined
    };
  });

  const padded = allNodes.map((node) => {
    const size = resolvedNodeDimensions(node);
    return { x: node.position.x - REGION_INSET, y: node.position.y - REGION_INSET, width: size.width + REGION_INSET * 2, height: size.height + REGION_INSET * 2 };
  });
  const content = unionBounds(padded) ?? {
    x: instancePosition.x,
    y: instancePosition.y,
    width: Math.max(REGION_MIN_WIDTH, instanceSize.width),
    height: Math.max(REGION_MIN_HEIGHT, instanceSize.height)
  };
  const bounds = {
    x: snap(content.x),
    y: snap(content.y),
    width: Math.max(REGION_MIN_WIDTH, snap(content.width)),
    height: Math.max(REGION_MIN_HEIGHT, snap(content.height))
  };

  const region: PositionedGenerateRegion = {
    id: expandRegionId(namespace),
    kind: 'expand',
    label: `${input.instanceLabel} : ${childModule.name}`,
    parentRegionId: input.parentRegionId,
    nodeIds: allNodes.map((n) => n.id),
    bounds,
    fixed: input.savedLayout?.fixed,
    expandedInstance: {
      instanceId: input.instanceId,
      childModuleName: childModule.name,
      parentModuleName: input.parentModuleName
    }
  };

  return {
    region,
    nodes: allNodes,
    edges,
    boundaryNodeIdByChildPortName,
    toSavedLayout(nodes, saveBounds, fixed, instanceOrigin) {
      const nodesById: Record<string, SavedNodeLayout> = {};
      for (const node of nodes) {
        const localId = node.id.startsWith(namespacedId(namespace, '')) ? node.id.slice(namespacedId(namespace, '').length) : undefined;
        if (localId === undefined) continue;
        // Only the child module's own internal (non-port) nodes are saved —
        // boundary nodes are re-derived from the instance's current ports
        // every time, never persisted themselves.
        if (!internalNodes.some((n) => n.id === localId)) continue;
        nodesById[localId] = { x: node.position.x, y: node.position.y, fixed: true };
      }
      return {
        childModuleName: childModule.name,
        nodes: nodesById,
        bounds: saveBounds,
        fixed,
        instanceOrigin
      };
    }
  };
}
