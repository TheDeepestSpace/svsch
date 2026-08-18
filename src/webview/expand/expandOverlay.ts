import type { Edge } from '@xyflow/react';
import type { DiagramEdge, DiagramPort, PositionedGenerateRegion, PositionedNode } from '../../ir/types';
import type { HdlFlowNode } from '../nodes/types';
import type { RouteChange } from '../orthogonal';
import { isExpandNamespacedId, type SpliceResult } from './splice';

export { isExpandNamespacedId };

// Spliced boundary/internal nodes render above edges (matching every other
// block node's zIndex in main.tsx's BLOCK_NODE_Z_INDEX) so an edge routed
// through a boundary port's handle passes visually *underneath* its label
// rather than striking through it — mirrors how any ordinary node's ports
// already occlude the wires terminating on them. The dimmed instance "ghost"
// (see applyActiveSplices) sits below edges instead, purely as a translucent
// backdrop that never competes with real content for paint order.
const SPLICE_NODE_Z_INDEX = 2;
const EXPAND_GHOST_Z_INDEX = 0;

/** CSS class marking an expanded instance's own node as a dimmed backdrop — see applyActiveSplices. */
export const EXPAND_GHOST_CLASS = 'hdl-node-expand-ghost';

/** One currently-expanded instance's live overlay state, cached independently of the server-driven `view` so it survives unrelated view refreshes (see main.tsx's spliceMapRef). */
export interface ActiveSplice extends SpliceResult {
  namespace: string;
  /** Id this splice's instance node has *in the current flow `nodes` array* — the plain instance id at the top level, or the enclosing splice's namespaced id for a nested Expand. */
  flowInstanceId: string;
  parentModuleName: string;
  instanceId: string;
  childModuleName: string;
  topLevel: boolean;
  /** The instance's position at the moment this splice's node positions were computed — diffed against its current position on every reattachment to rigidly translate the whole splice if the instance has since moved. */
  anchorInstancePosition: { x: number; y: number };
}

function toFlowNode(node: PositionedNode, moduleName: string): HdlFlowNode {
  return {
    id: node.id,
    type: 'hdl',
    position: node.position,
    zIndex: SPLICE_NODE_Z_INDEX,
    data: { node, moduleName, arrayConnections: [] }
  };
}

function toFlowEdge(edge: DiagramEdge, moduleName: string, onRouteChange: (changes: RouteChange[], commit: boolean) => void): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourcePort,
    targetHandle: edge.targetPort,
    label: edge.label,
    type: 'svsch',
    data: {
      waypoint: edge.waypoint,
      routePoints: edge.routePoints,
      onRouteChange,
      edge,
      moduleName,
      isNetLeader: true,
      netEdgeIds: [edge.id]
    }
  } as Edge;
}

// Turns an expanded instance's own flow node into a dimmed backdrop rather
// than dropping it: still the real node (parameters, port labels, outline
// and all — nothing about its own rendering changes) and still draggable/
// selectable (dragging it is exactly what re-anchors the splice above via
// applyActiveSplices's dx/dy translation, and selecting it is what surfaces
// the "Collapse" control in NodeSelectionToolbar), just faded behind
// everything else so its outline still reads as "this is a module instance"
// without competing with the unfolded content on top of it.
function dimAsExpandGhost(node: HdlFlowNode): HdlFlowNode {
  return {
    ...node,
    zIndex: EXPAND_GHOST_Z_INDEX,
    className: [node.className, EXPAND_GHOST_CLASS].filter(Boolean).join(' ')
  };
}

function portNameById(ports: DiagramPort[]): Map<string, string> {
  return new Map(ports.map((port) => [port.id, port.name]));
}

/**
 * Merges every active "Expand" splice on top of an already-built base
 * nodes/edges/regions set: dims each expanded instance's own node into a
 * translucent backdrop (still its full self — parameters, port labels,
 * outline — just faded and pushed behind everything else, see
 * EXPAND_GHOST_CLASS/EXPAND_GHOST_Z_INDEX), splices in its boundary+internal
 * nodes/edges, rewires whichever base edges used to terminate on the
 * instance so they land on the matching boundary node instead (clearing
 * their route so it re-derives from the new geometry — see splice.ts's
 * module doc for why no explicit route is needed at all), and appends the
 * splice's region (reusing the exact same `regions` array/overlay/drag-sync
 * GenerateRegionOverlay already provides — see
 * PositionedGenerateRegion.expandedInstance in ir/types.ts for why).
 *
 * Applied both (a) every time a fresh server `view` rebuilds the base
 * arrays, so already-expanded instances stay expanded across unrelated
 * round-trips, and (b) once immediately when a new splice first arrives.
 */
export function applyActiveSplices(
  baseNodes: HdlFlowNode[],
  baseEdges: Edge[],
  baseRegions: PositionedGenerateRegion[],
  splices: Map<string, ActiveSplice>,
  moduleName: string,
  onRouteChange: (changes: RouteChange[], commit: boolean) => void
): { nodes: HdlFlowNode[]; edges: Edge[]; regions: PositionedGenerateRegion[] } {
  if (splices.size === 0) {
    return { nodes: baseNodes, edges: baseEdges, regions: baseRegions };
  }

  // Shallowest first: a nested splice's own instance node only exists in
  // `nodes` once its parent splice's content has already been merged in.
  const ordered = [...splices.values()].sort(
    (a, b) => a.namespace.split('::').length - b.namespace.split('::').length
  );

  let nodes = baseNodes;
  let edges = baseEdges;
  const extraRegions: PositionedGenerateRegion[] = [];

  for (const splice of ordered) {
    const instanceNode = nodes.find((node) => node.id === splice.flowInstanceId);
    if (!instanceNode) {
      // Instance no longer present in this view (e.g. the design changed
      // underneath it). Leave the splice cached in case it reappears rather
      // than silently discarding a user's expanded state.
      continue;
    }

    const dx = instanceNode.position.x - splice.anchorInstancePosition.x;
    const dy = instanceNode.position.y - splice.anchorInstancePosition.y;
    const translatedNodes = dx === 0 && dy === 0
      ? splice.nodes
      : splice.nodes.map((node) => ({ ...node, position: { x: node.position.x + dx, y: node.position.y + dy } }));
    const region = dx === 0 && dy === 0
      ? splice.region
      : { ...splice.region, bounds: { ...splice.region.bounds, x: splice.region.bounds.x + dx, y: splice.region.bounds.y + dy } };

    const boundaryIdByPortName = splice.boundaryNodeIdByChildPortName;
    const instancePortNames = portNameById(instanceNode.data.node.ports);

    edges = edges.map((edge) => {
      const sourceMatches = edge.source === splice.flowInstanceId;
      const targetMatches = edge.target === splice.flowInstanceId;
      if (!sourceMatches && !targetMatches) return edge;
      const handleId = sourceMatches ? edge.sourceHandle : edge.targetHandle;
      const portName = handleId ? instancePortNames.get(handleId) : undefined;
      const boundaryId = portName ? boundaryIdByPortName.get(portName) : undefined;
      if (!boundaryId) return edge;
      return {
        ...edge,
        source: sourceMatches ? boundaryId : edge.source,
        target: targetMatches ? boundaryId : edge.target,
        sourceHandle: sourceMatches ? 'outer' : edge.sourceHandle,
        targetHandle: targetMatches ? 'outer' : edge.targetHandle,
        data: { ...edge.data, routePoints: undefined, waypoint: undefined }
      };
    });

    nodes = [
      ...nodes.map((node) => (node.id === splice.flowInstanceId ? dimAsExpandGhost(node) : node)),
      ...translatedNodes.map((n) => toFlowNode(n, moduleName))
    ];
    edges = [...edges, ...splice.edges.map((edge) => toFlowEdge(edge, moduleName, onRouteChange))];
    extraRegions.push(region);
  }

  return { nodes, edges, regions: [...baseRegions, ...extraRegions] };
}

/**
 * Re-syncs every cached splice's `nodes`/`region`/`anchorInstancePosition`
 * from the live flow state after a drag/resize commit, so (a) a later
 * unrelated view refresh reattaches the user's manual adjustments instead of
 * quietly reverting to stale ELK-time positions, and (b) `applyActiveSplices`
 * doesn't re-translate an already-translated splice a second time — updating
 * `anchorInstancePosition` to the instance's current position here is what
 * makes the next reattachment's dx/dy come out zero for content that hasn't
 * moved relative to its instance since this sync. Mutates `splices` in place
 * (it's a ref, not React state).
 */
export function syncSpliceCache(
  splices: Map<string, ActiveSplice>,
  nodes: HdlFlowNode[],
  regions: PositionedGenerateRegion[]
): void {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const regionsById = new Map(regions.map((region) => [region.id, region]));
  for (const [namespace, splice] of splices) {
    const region = regionsById.get(splice.region.id);
    const instanceNode = nodesById.get(splice.flowInstanceId);
    if (!region || !instanceNode) continue;
    const updatedNodes: PositionedNode[] = [];
    for (const node of splice.nodes) {
      const flowNode = nodesById.get(node.id);
      if (!flowNode) continue;
      updatedNodes.push({ ...flowNode.data.node, position: flowNode.position });
    }
    splices.set(namespace, {
      ...splice,
      region,
      nodes: updatedNodes,
      anchorInstancePosition: { ...instanceNode.position }
    });
  }
}

/** Removes a splice and every splice nested inside it (namespace-prefix match), returning the removed set's flow-instance ids so callers can e.g. re-select the collapsed instance. */
export function removeSpliceAndDescendants(splices: Map<string, ActiveSplice>, namespace: string): void {
  for (const key of [...splices.keys()]) {
    if (key === namespace || key.startsWith(`${namespace}::`)) {
      splices.delete(key);
    }
  }
}
