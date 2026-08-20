import type { DesignGraph, DiagramEdge, DiagramPort, PositionedNode } from '../ir/types';
import type { SavedLayout } from '../storage/layoutStore';
import { diagramSizing } from '../diagram/constants';
import { resolvedNodeDimensions } from '../diagram/nodeSizing';
import {
  boundaryColumnPad,
  buildBoundaryColumns,
  EXPAND_CONTENT_INSET,
  expandTopPad,
  expandedFrameSize,
  placeBoundaryEntries,
  unionBounds,
  type ExpandSpliceLayout,
} from '../webview/expand/splice';
import { buildViewModel, renderedLeadPoint } from './mergeLayout';
import {
  routeDiagramWithLibavoid,
  type RoutingLeadPoint,
  type RoutingLeadResolver,
} from './libavoidRouter';

/**
 * Builds the frame-local layout for "Expand instance in place" (issue #232)
 * the way a reader would draw it by hand (see the review discussion on PR
 * #233): take the child module's *normal standalone* place-and-route result —
 * the exact `buildViewModel` pipeline `openModule` renders with, ELK
 * placement plus libavoid routing plus any saved standalone arrangement the
 * user already made — then drop its port nodes, translate the remaining
 * design into the expanded node's body, and ask libavoid to wire the
 * boundary ports up to the placed content. The expanded diagram therefore
 * looks exactly like the standalone module diagram, give or take the port
 * columns being replaced by boundary labels on the frame border.
 *
 * Everything returned is in frame-local coordinates (the expanded node's
 * top-left corner is (0, 0)) with child-module-local ids — the webview's
 * spliceExpandedInstance translates to canvas space and namespaces the ids
 * (see ExpandSpliceLayout in webview/expand/splice.ts).
 *
 * Returns undefined when the child module has no diagram at all — the
 * webview then falls back to its own ELK-only placement.
 */
export async function buildExpandSpliceLayout(input: {
  graph: DesignGraph;
  layout: SavedLayout;
  childModuleName: string;
  instanceId: string;
  instancePorts: DiagramPort[];
  instanceSize: { width: number; height: number };
  instanceParamRows: number;
}): Promise<ExpandSpliceLayout | undefined> {
  const { graph, layout, childModuleName, instanceId, instancePorts } = input;
  const childModule = graph.modules[childModuleName];
  if (!childModule) return undefined;

  // 1. The child's own standalone place-and-route — including synthetic
  //    standalone-view content the raw IR doesn't carry (cut-net labels and
  //    their stub edges), so the unfolded diagram reads exactly like the
  //    module opened on its own.
  const childView = await buildViewModel(graph, childModuleName, layout);
  if (childView.nodes.length === 0) return undefined;

  const portNodeIds = new Set(
    childView.nodes.filter((node) => node.kind === 'port').map((node) => node.id),
  );
  const internalNodes = childView.nodes.filter((node) => !portNodeIds.has(node.id));
  const internalEdges = childView.edges.filter(
    (edge) => !portNodeIds.has(edge.source) && !portNodeIds.has(edge.target),
  );
  const boundaryEdges = childView.edges.filter(
    (edge) => portNodeIds.has(edge.source) || portNodeIds.has(edge.target),
  );

  // 2. Drop the ports, keep the design: translate the standalone content so
  //    its bounding box (nodes plus every kept internal route, so no wire
  //    detour pokes past the frame padding) lands one label column in from
  //    the left border and just below the header/parameter rows.
  const { inputColumn, outputColumn } = buildBoundaryColumns(
    childModule,
    instancePorts,
    instanceId,
  );
  const padLeft = boundaryColumnPad(inputColumn);
  const padRight = boundaryColumnPad(outputColumn);
  const padTop = expandTopPad(input.instanceParamRows);

  const contentRects = [
    ...internalNodes.map((node) => {
      const size = resolvedNodeDimensions(node);
      return { x: node.position.x, y: node.position.y, width: size.width, height: size.height };
    }),
    ...internalEdges.flatMap(
      (edge) =>
        edge.routePoints?.map((point) => ({ x: point.x, y: point.y, width: 0, height: 0 })) ?? [],
    ),
  ];
  const standaloneBounds = unionBounds(contentRects) ?? { x: 0, y: 0, width: 0, height: 0 };
  const dx = padLeft - standaloneBounds.x;
  const dy = padTop - standaloneBounds.y;
  const translatePoint = (point: { x: number; y: number }) => ({
    x: point.x + dx,
    y: point.y + dy,
  });

  const placedInternalNodes: PositionedNode[] = internalNodes.map((node) => ({
    ...node,
    position: translatePoint(node.position),
  }));
  const placedInternalEdges: DiagramEdge[] = internalEdges.map((edge) => ({
    ...edge,
    waypoint: edge.waypoint ? translatePoint(edge.waypoint) : undefined,
    routePoints: edge.routePoints?.map(translatePoint),
  }));

  // 3. Place the design into the outer node: the frame grows around the
  //    translated content (grow-only against the instance's pre-expand
  //    size), and the boundary ports land on its border at the instance's
  //    own port rows.
  const expandedSize = expandedFrameSize({
    instanceSize: input.instanceSize,
    padLeft,
    padRight,
    content: {
      x: padLeft,
      y: padTop,
      width: standaloneBounds.width,
      height: standaloneBounds.height,
    },
  });

  const placedBoundary = placeBoundaryEntries(
    [...inputColumn, ...outputColumn],
    { x: 0, y: 0 },
    expandedSize.width,
    input.instanceParamRows,
  );
  const boundaryNodes: PositionedNode[] = placedBoundary.map(({ entry, position }) => ({
    ...entry.node,
    position,
  }));

  // 4. Tell libavoid to wire up the ports: every edge that used to touch a
  //    dropped port node is retargeted at the matching boundary node's inner
  //    handle and re-routed against the placed content — the boundary node
  //    ids are the child's own port-node ids, so only the port id changes.
  const rewrittenBoundaryEdges: DiagramEdge[] = boundaryEdges.map((edge) => ({
    ...edge,
    sourcePort: portNodeIds.has(edge.source) ? 'inner' : edge.sourcePort,
    targetPort: portNodeIds.has(edge.target) ? 'inner' : edge.targetPort,
    waypoint: undefined,
    routePoints: undefined,
  }));

  const boundaryIds = new Set(boundaryNodes.map((node) => node.id));
  // The routing view of a boundary node exposes exactly one pin, named after
  // the 'inner' handle the rewritten edges terminate on (the outer handle
  // faces the parent diagram — never routed here).
  const routingBoundaryNodes: PositionedNode[] = boundaryNodes.map((node) => ({
    ...node,
    ports: node.ports.map((port) => ({ ...port, id: 'inner' })),
  }));
  const routingContentNodes = [...placedInternalNodes, ...routingBoundaryNodes];
  const routingNodes = [...routingContentNodes, ...frameWallNodes(expandedSize)];
  const routingNodesById = new Map(routingContentNodes.map((node) => [node.id, node]));
  const routingNodePositions = new Map(routingContentNodes.map((node) => [node.id, node.position]));

  const resolveLead: RoutingLeadResolver = (nodeId, portId, includeLeadMargins, role) => {
    const node = routingNodesById.get(nodeId);
    if (node && boundaryIds.has(nodeId)) {
      return boundaryInnerLead(node, includeLeadMargins);
    }
    return renderedLeadPoint(
      nodeId,
      portId,
      routingNodesById,
      routingNodePositions,
      includeLeadMargins,
      role,
    );
  };

  const routed = await routeDiagramWithLibavoid(routingNodes, rewrittenBoundaryEdges, resolveLead);
  const routedBoundaryEdges = rewrittenBoundaryEdges.map((edge) => ({
    ...edge,
    // A rejected route stays undefined — the webview's OrthogonalEdge then
    // derives its usual default path, same as any freshly-cut net.
    routePoints: routed.routes.get(edge.id),
  }));

  return {
    nodes: [...boundaryNodes, ...placedInternalNodes],
    edges: [...routedBoundaryEdges, ...placedInternalEdges],
    expandedSize,
  };
}

/**
 * The inner-handle lead of a boundary-port node: the handle sits centered on
 * the node's inner edge (see BoundaryPortNode's inner Handle), facing into
 * the frame; with margins it reserves one grid past the handle, the same
 * clearance a netLabel's lead reserves (see elkNodeForDiagramNode's
 * leadOverride) and the same lead length OrthogonalEdge re-derives when it
 * renders the route.
 */
function boundaryInnerLead(node: PositionedNode, includeLeadMargins: boolean): RoutingLeadPoint {
  const size = resolvedNodeDimensions(node);
  const outerSide = node.metadata?.boundaryPort?.outerSide ?? 'left';
  const innerFacesEast = outerSide === 'left';
  const lead = includeLeadMargins ? diagramSizing.gridSize : 0;
  return {
    point: {
      x: node.position.x + (innerFacesEast ? size.width + lead : -lead),
      y: node.position.y + size.height / 2,
    },
    side: innerFacesEast ? 'EAST' : 'WEST',
  };
}

/**
 * Four obstacle "walls" hugging the outside of the expanded frame, so
 * libavoid can only wire the boundary ports up *through the frame's
 * interior* — without them the router happily swings a stub around the
 * outside of the border, which the webview's clamp-to-frame would then
 * smash flat onto the border line. Each wall is placed by its resolved
 * (grow-only) size so any canonical-minimum bloat always extends *away*
 * from the frame, and the walls overlap at the corners so no diagonal
 * gap remains.
 */
function frameWallNodes(expandedSize: { width: number; height: number }): PositionedNode[] {
  const grid = diagramSizing.gridSize;
  const overshoot = EXPAND_CONTENT_INSET;
  const wall = (
    id: string,
    requested: { width: number; height: number },
    place: (resolved: { width: number; height: number }) => { x: number; y: number },
  ): PositionedNode => {
    const node: PositionedNode = {
      id: `expand-frame-wall:${id}`,
      kind: 'bus',
      label: '',
      ports: [],
      sizeOverride: { width: requested.width / grid, height: requested.height / grid },
      position: { x: 0, y: 0 },
    };
    return { ...node, position: place(resolvedNodeDimensions(node)) };
  };
  const sideHeight = expandedSize.height + overshoot * 2;
  const spanWidth = expandedSize.width + overshoot * 2;
  return [
    wall('left', { width: grid, height: sideHeight }, (resolved) => ({
      x: -resolved.width,
      y: -overshoot,
    })),
    wall('right', { width: grid, height: sideHeight }, () => ({
      x: expandedSize.width,
      y: -overshoot,
    })),
    wall('top', { width: spanWidth, height: grid }, (resolved) => ({
      x: -overshoot,
      y: -resolved.height,
    })),
    wall('bottom', { width: spanWidth, height: grid }, () => ({
      x: -overshoot,
      y: expandedSize.height,
    })),
  ];
}
