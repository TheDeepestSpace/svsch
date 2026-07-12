import { diagramNodeDimensions } from '../diagram/nodeSizing';
import { edgeNetKey } from '../ir/edgeNet';
import { nodeIsArrayNode } from '../ir/nodeMetadata';
import type { DiagramEdge, DiagramNode, PositionedNode } from '../ir/types';
import { normalizeRoutePoints } from '../webview/orthogonal/logic';
import { HdlPosition } from '../webview/orthogonal/types';
import { ROUTING_OBSTACLE_MARGIN, routingVerticalMargins } from './routingObstacleGeometry';

const SHAPE_BUFFER_DISTANCE = 4;

export type RoutingPortSide = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

export interface RoutingLeadPoint {
  point: { x: number; y: number };
  side: RoutingPortSide;
}

export type RoutingLeadResolver = (
  nodeId: string,
  portId: string | undefined,
  includeLeadMargins: boolean
) => RoutingLeadPoint | undefined;

export interface LibavoidRoutingResult {
  routes: Map<string, Array<{ x: number; y: number }>>;
  rejectedNets: Map<string, string>;
}

export function selectLibavoidRoutesAgainstFallbacks(
  edges: DiagramEdge[],
  candidates: Map<string, Array<{ x: number; y: number }>>,
  fallbacks: Map<string, Array<{ x: number; y: number }>>
): Map<string, Array<{ x: number; y: number }>> {
  const selected = new Map(candidates);
  let changed = true;
  while (changed) {
    changed = false;
    const rejectedNets = new Set<string>();
    for (const edge of edges) {
      const route = selected.get(edge.id);
      if (!route) continue;
      const net = edgeNetKey(edge);
      for (const other of edges) {
        if (other.id === edge.id || edgeNetKey(other) === net) continue;
        const otherRoute = selected.get(other.id) ?? fallbacks.get(other.id);
        if (otherRoute && routesHaveCollinearOverlap(route, otherRoute)) {
          rejectedNets.add(net);
          break;
        }
      }
    }
    if (rejectedNets.size > 0) {
      for (const edge of edges) {
        if (rejectedNets.has(edgeNetKey(edge)) && selected.delete(edge.id)) changed = true;
      }
    }
  }
  return selected;
}

interface LibavoidNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ports: Array<{
    id: string;
    x: number;
    y: number;
    side: RoutingPortSide;
  }>;
}

interface LibavoidEdge {
  edge: DiagramEdge;
  sourcePort: string;
  targetPort: string;
}

interface FanoutPlan {
  trunkConnectorId: string;
  branches: Array<{ edgeId: string; connectorId: string }>;
}

let avoidRuntimePromise: Promise<any> | undefined;
let routingQueue: Promise<void> = Promise.resolve();

export function setLibavoidRuntimeForTests(runtime: any): void {
  avoidRuntimePromise = Promise.resolve(runtime);
}

export async function routeDiagramWithLibavoid(
  nodes: PositionedNode[],
  edges: DiagramEdge[],
  resolveLead: RoutingLeadResolver
): Promise<LibavoidRoutingResult> {
  const result = routingQueue.then(() => routeDiagramWithLibavoidExclusive(nodes, edges, resolveLead));
  routingQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function routeDiagramWithLibavoidExclusive(
  nodes: PositionedNode[],
  edges: DiagramEdge[],
  resolveLead: RoutingLeadResolver
): Promise<LibavoidRoutingResult> {
  const empty = { routes: new Map<string, Array<{ x: number; y: number }>>(), rejectedNets: new Map<string, string>() };
  if (nodes.length === 0 || edges.length === 0) return empty;

  try {
    const Avoid = await loadAvoidRuntime();
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const libavoidNodes = nodes.map((node) => libavoidNodeForDiagramNode(node, resolveLead));
    const libavoidEdges = edges.flatMap((edge): LibavoidEdge[] => {
      const sourcePort = resolvedPortId(edge.source, edge.sourcePort, nodesById);
      const targetPort = resolvedPortId(edge.target, edge.targetPort, nodesById);
      return sourcePort && targetPort ? [{ edge, sourcePort, targetPort }] : [];
    });
    const rawRoutes = routeRaw(Avoid, libavoidNodes, libavoidEdges);
    return validateRoutes(nodes, libavoidEdges, rawRoutes, resolveLead);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      routes: empty.routes,
      rejectedNets: new Map(edges.map((edge) => [edgeNetKey(edge), `router unavailable: ${reason}`]))
    };
  }
}

async function loadAvoidRuntime(): Promise<any> {
  avoidRuntimePromise ??= (async () => {
    // Keep native import() intact when the extension is compiled to CommonJS.
    const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const module = await nativeImport('libavoid-js');
    await module.AvoidLib.load();
    return module.AvoidLib.getInstance();
  })();
  return avoidRuntimePromise;
}

function libavoidNodeForDiagramNode(node: PositionedNode, resolveLead: RoutingLeadResolver): LibavoidNode {
  const size = diagramNodeDimensions(node);
  const leads = node.ports.map((port) => resolveLead(node.id, port.id, true));
  const leadPoints = leads.flatMap((lead) => lead ? [lead.point] : []);
  const margins = routingVerticalMargins(node, leads.map((lead) => lead?.side));
  const left = Math.min(node.position.x, ...leadPoints.map((point) => point.x));
  const right = Math.max(node.position.x + size.width, ...leadPoints.map((point) => point.x));
  const top = Math.min(node.position.y, ...leadPoints.map((point) => point.y)) - margins.top;
  const bottom = Math.max(node.position.y + size.height, ...leadPoints.map((point) => point.y)) + margins.bottom;

  return {
    id: node.id,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    ports: node.ports.map((port, index) => {
      const lead = leads[index];
      const point = lead?.point ?? {
        x: node.position.x + size.width / 2,
        y: node.position.y + size.height / 2
      };
      return {
        id: libavoidPortId(node.id, port.id),
        x: point.x - left,
        y: point.y - top,
        side: lead?.side ?? 'EAST'
      };
    })
  };
}

function routeRaw(
  Avoid: any,
  nodes: LibavoidNode[],
  edges: LibavoidEdge[]
): Map<string, Array<{ x: number; y: number }>> {
  const router = new Avoid.Router(Avoid.OrthogonalRouting);
  const shapes = new Map<string, any>();
  const pinClasses = new Map<string, number>();
  const connectors = new Map<string, any>();
  const fanoutPlans: FanoutPlan[] = [];

  try {
    router.setRoutingParameter(Avoid.shapeBufferDistance, SHAPE_BUFFER_DISTANCE);
    router.setRoutingParameter(Avoid.idealNudgingDistance, ROUTING_OBSTACLE_MARGIN);
    router.setRoutingParameter(Avoid.segmentPenalty, 10);
    router.setRoutingParameter(Avoid.crossingPenalty, 200);
    router.setRoutingParameter(Avoid.portDirectionPenalty, 100);
    router.setRoutingOption(Avoid.nudgeOrthogonalSegmentsConnectedToShapes, false);
    router.setRoutingOption(Avoid.nudgeOrthogonalTouchingColinearSegments, true);
    router.setRoutingOption(Avoid.nudgeSharedPathsWithCommonEndPoint, true);
    router.setRoutingOption(Avoid.performUnifyingNudgingPreprocessingStep, true);
    router.setRoutingOption(Avoid.penaliseOrthogonalSharedPathsAtConnEnds, false);
    router.setRoutingOption(Avoid.improveHyperedgeRoutesMovingJunctions, true);

    for (const node of nodes) {
      const rectangle = new Avoid.Rectangle(
        new Avoid.Point(node.x, node.y),
        new Avoid.Point(node.x + node.width, node.y + node.height)
      );
      const shape = new Avoid.ShapeRef(router, rectangle);
      shapes.set(node.id, shape);

      let classId = 2;
      for (const port of node.ports) {
        pinClasses.set(port.id, classId);
        const pin = new Avoid.ShapeConnectionPin(
          shape,
          classId,
          clamp01(port.x / node.width),
          clamp01(port.y / node.height),
          true,
          0,
          connectionDirection(port.side)
        );
        pin.setExclusive(false);
        classId += 1;
      }
    }

    const addConnector = (id: string, sourceEnd: any, targetEnd: any): void => {
      const connector = new Avoid.ConnRef(router, sourceEnd, targetEnd);
      connector.setRoutingType(Avoid.ConnType_Orthogonal);
      connector.setHateCrossings(true);
      connectors.set(id, connector);
    };

    const addDirectEdge = ({ edge, sourcePort, targetPort }: LibavoidEdge): void => {
      const sourceShape = shapes.get(edge.source);
      const targetShape = shapes.get(edge.target);
      const sourceClass = pinClasses.get(sourcePort);
      const targetClass = pinClasses.get(targetPort);
      if (!sourceShape || !targetShape || sourceClass === undefined || targetClass === undefined) return;
      addConnector(edge.id, new Avoid.ConnEnd(sourceShape, sourceClass), new Avoid.ConnEnd(targetShape, targetClass));
    };

    const groups = new Map<string, LibavoidEdge[]>();
    for (const edge of edges) {
      const key = edgeNetKey(edge.edge);
      groups.set(key, [...(groups.get(key) ?? []), edge]);
    }

    for (const [netKey, group] of groups) {
      if (group.length < 2) {
        group.forEach(addDirectEdge);
        continue;
      }
      if (typeof Avoid.JunctionRef !== 'function') {
        throw new Error('libavoid runtime does not expose JunctionRef');
      }

      const first = group[0];
      const sourceShape = shapes.get(first.edge.source);
      const sourceClass = pinClasses.get(first.sourcePort);
      const sourceNode = nodes.find((node) => node.id === first.edge.source);
      const sourcePort = sourceNode?.ports.find((port) => port.id === first.sourcePort);
      if (!sourceShape || sourceClass === undefined || !sourceNode || !sourcePort) {
        group.forEach(addDirectEdge);
        continue;
      }

      const position = fanoutJunctionPosition(sourceNode, sourcePort);
      const junctionPoint = new Avoid.Point(position.x, position.y);
      const junction = new Avoid.JunctionRef(router, junctionPoint);
      const trunkConnectorId = `fanout:${netKey}:trunk`;
      addConnector(
        trunkConnectorId,
        new Avoid.ConnEnd(sourceShape, sourceClass),
        connEndForJunction(Avoid, junction, junctionPoint)
      );

      const branches: FanoutPlan['branches'] = [];
      for (const item of group) {
        const targetShape = shapes.get(item.edge.target);
        const targetClass = pinClasses.get(item.targetPort);
        if (!targetShape || targetClass === undefined) continue;
        const connectorId = `fanout:${netKey}:branch:${item.edge.id}`;
        addConnector(
          connectorId,
          connEndForJunction(Avoid, junction, junctionPoint),
          new Avoid.ConnEnd(targetShape, targetClass)
        );
        branches.push({ edgeId: item.edge.id, connectorId });
      }
      fanoutPlans.push({ trunkConnectorId, branches });
    }

    router.processTransaction();

    const connectorRoutes = new Map<string, Array<{ x: number; y: number }>>();
    for (const [id, connector] of connectors) {
      const polyline = connector.displayRoute();
      const points: Array<{ x: number; y: number }> = [];
      for (let index = 0; index < polyline.size(); index += 1) {
        const point = polyline.get_ps(index);
        points.push(roundPoint(point));
      }
      connectorRoutes.set(id, points);
    }

    const routes = new Map<string, Array<{ x: number; y: number }>>();
    for (const item of edges) {
      const direct = connectorRoutes.get(item.edge.id);
      if (direct) routes.set(item.edge.id, direct);
    }
    for (const plan of fanoutPlans) {
      const trunk = connectorRoutes.get(plan.trunkConnectorId);
      if (!trunk) continue;
      for (const branch of plan.branches) {
        const branchRoute = connectorRoutes.get(branch.connectorId);
        if (branchRoute) routes.set(branch.edgeId, removeConsecutiveDuplicates([...trunk, ...branchRoute]));
      }
    }
    return routes;
  } finally {
    router.__destroy__?.();
  }
}

function validateRoutes(
  nodes: PositionedNode[],
  edges: LibavoidEdge[],
  rawRoutes: Map<string, Array<{ x: number; y: number }>>,
  resolveLead: RoutingLeadResolver
): LibavoidRoutingResult {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const candidates = new Map<string, Array<{ x: number; y: number }>>();
  const rejectedNets = new Map<string, string>();

  for (const item of edges) {
    const netKey = edgeNetKey(item.edge);
    const raw = rawRoutes.get(item.edge.id);
    const sourceLead = resolveLead(item.edge.source, item.edge.sourcePort, true);
    const targetLead = resolveLead(item.edge.target, item.edge.targetPort, true);
    if (!raw || !sourceLead || !targetLead) {
      rejectedNets.set(netKey, 'missing route or endpoint');
      continue;
    }

    const stitched = removeConsecutiveDuplicates([sourceLead.point, ...raw, targetLead.point].map(roundPoint));
    if (!routeIsOrthogonal(stitched)) {
      rejectedNets.set(netKey, 'non-orthogonal raw route');
      continue;
    }

    const normalized = normalizeRenderedRoute(item.edge, stitched, nodesById, resolveLead);
    const rejection = validateNormalizedRoute(item, normalized, nodes, resolveLead);
    if (rejection) rejectedNets.set(netKey, rejection);
    else candidates.set(item.edge.id, normalized);
  }

  rejectOverlappingNets(edges, candidates, rejectedNets);

  const routes = new Map<string, Array<{ x: number; y: number }>>();
  for (const item of edges) {
    const netKey = edgeNetKey(item.edge);
    const route = candidates.get(item.edge.id);
    if (route && !rejectedNets.has(netKey)) routes.set(item.edge.id, route);
  }
  return { routes, rejectedNets };
}

function rejectOverlappingNets(
  edges: LibavoidEdge[],
  routes: Map<string, Array<{ x: number; y: number }>>,
  rejectedNets: Map<string, string>
): void {
  for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
    const left = edges[leftIndex];
    const leftNet = edgeNetKey(left.edge);
    const leftRoute = routes.get(left.edge.id);
    if (!leftRoute) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex += 1) {
      const right = edges[rightIndex];
      const rightNet = edgeNetKey(right.edge);
      const rightRoute = routes.get(right.edge.id);
      if (!rightRoute || leftNet === rightNet || !routesHaveCollinearOverlap(leftRoute, rightRoute)) continue;
      rejectedNets.set(leftNet, `overlaps net ${rightNet}`);
      rejectedNets.set(rightNet, `overlaps net ${leftNet}`);
    }
  }
}

function routesHaveCollinearOverlap(
  left: Array<{ x: number; y: number }>,
  right: Array<{ x: number; y: number }>
): boolean {
  for (let leftIndex = 1; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex < right.length; rightIndex += 1) {
      if (segmentsHaveCollinearOverlap(
        left[leftIndex - 1], left[leftIndex], right[rightIndex - 1], right[rightIndex]
      )) return true;
    }
  }
  return false;
}

function segmentsHaveCollinearOverlap(
  aStart: { x: number; y: number },
  aEnd: { x: number; y: number },
  bStart: { x: number; y: number },
  bEnd: { x: number; y: number }
): boolean {
  const aHorizontal = aStart.y === aEnd.y;
  const bHorizontal = bStart.y === bEnd.y;
  if (aHorizontal !== bHorizontal) return false;
  if (aHorizontal) {
    if (aStart.y !== bStart.y) return false;
    return Math.min(Math.max(aStart.x, aEnd.x), Math.max(bStart.x, bEnd.x))
      - Math.max(Math.min(aStart.x, aEnd.x), Math.min(bStart.x, bEnd.x)) > 0.5;
  }
  if (aStart.x !== bStart.x) return false;
  return Math.min(Math.max(aStart.y, aEnd.y), Math.max(bStart.y, bEnd.y))
    - Math.max(Math.min(aStart.y, aEnd.y), Math.min(bStart.y, bEnd.y)) > 0.5;
}

function normalizeRenderedRoute(
  edge: DiagramEdge,
  route: Array<{ x: number; y: number }>,
  nodesById: Map<string, DiagramNode>,
  resolveLead: RoutingLeadResolver
): Array<{ x: number; y: number }> {
  const sourceHandle = resolveLead(edge.source, edge.sourcePort, false);
  const targetHandle = resolveLead(edge.target, edge.targetPort, false);
  if (!sourceHandle || !targetHandle) return route;
  return normalizeRoutePoints(
    { routePoints: route },
    sourceHandle.point.x,
    sourceHandle.point.y,
    targetHandle.point.x,
    targetHandle.point.y,
    handlePosition(sourceHandle.side),
    handlePosition(targetHandle.side),
    edge.sourcePort,
    edge.targetPort,
    true,
    nodesById.get(edge.source),
    nodesById.get(edge.target)
  );
}

function validateNormalizedRoute(
  item: LibavoidEdge,
  route: Array<{ x: number; y: number }>,
  nodes: PositionedNode[],
  resolveLead: RoutingLeadResolver
): string | undefined {
  if (!routeIsOrthogonal(route)) return 'non-orthogonal normalized route';

  for (const node of nodes) {
    const bounds = renderedNodeBounds(node);
    if (routeIntersectsRectInterior(route, bounds)) return `intersects node ${node.id}`;
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const sourcePort = item.edge.sourcePort ?? nodesById.get(item.edge.source)?.ports[0]?.id;
  const targetPort = item.edge.targetPort ?? nodesById.get(item.edge.target)?.ports[0]?.id;
  for (const node of nodes) {
    for (const port of node.ports) {
      if (
        (node.id === item.edge.source && port.id === sourcePort)
        || (node.id === item.edge.target && port.id === targetPort)
      ) continue;
      const handle = resolveLead(node.id, port.id, false);
      const lead = resolveLead(node.id, port.id, true);
      if (handle && lead && routeIntersectsSegment(route, handle.point, lead.point)) {
        return `intersects port ${node.id}:${port.id}`;
      }
    }
  }
  return undefined;
}

function renderedNodeBounds(node: PositionedNode): { x: number; y: number; width: number; height: number } {
  const size = diagramNodeDimensions(node);
  const stackPad = nodeIsArrayNode(node) ? 4 : 0;
  return {
    x: node.position.x - stackPad,
    y: node.position.y - stackPad,
    width: size.width + stackPad * 2,
    height: size.height + stackPad * 2
  };
}

function routeIntersectsRectInterior(
  points: Array<{ x: number; y: number }>,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  return points.slice(1).some((point, index) => (
    segmentIntersectsRectInterior(points[index], point, rect)
  ));
}

function segmentIntersectsRectInterior(
  start: { x: number; y: number },
  end: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  if (start.y === end.y) {
    return start.y > top && start.y < bottom
      && Math.max(start.x, end.x) > left
      && Math.min(start.x, end.x) < right;
  }
  if (start.x === end.x) {
    return start.x > left && start.x < right
      && Math.max(start.y, end.y) > top
      && Math.min(start.y, end.y) < bottom;
  }
  return true;
}

function routeIntersectsSegment(
  points: Array<{ x: number; y: number }>,
  segmentStart: { x: number; y: number },
  segmentEnd: { x: number; y: number }
): boolean {
  return points.slice(1).some((point, index) => orthogonalSegmentsIntersect(
    points[index], point, segmentStart, segmentEnd
  ));
}

function orthogonalSegmentsIntersect(
  aStart: { x: number; y: number },
  aEnd: { x: number; y: number },
  bStart: { x: number; y: number },
  bEnd: { x: number; y: number }
): boolean {
  const aHorizontal = aStart.y === aEnd.y;
  const bHorizontal = bStart.y === bEnd.y;
  if (aHorizontal && bHorizontal) {
    return aStart.y === bStart.y
      && Math.max(Math.min(aStart.x, aEnd.x), Math.min(bStart.x, bEnd.x))
        <= Math.min(Math.max(aStart.x, aEnd.x), Math.max(bStart.x, bEnd.x));
  }
  if (!aHorizontal && !bHorizontal) {
    return aStart.x === bStart.x
      && Math.max(Math.min(aStart.y, aEnd.y), Math.min(bStart.y, bEnd.y))
        <= Math.min(Math.max(aStart.y, aEnd.y), Math.max(bStart.y, bEnd.y));
  }
  const horizontalStart = aHorizontal ? aStart : bStart;
  const horizontalEnd = aHorizontal ? aEnd : bEnd;
  const verticalStart = aHorizontal ? bStart : aStart;
  const verticalEnd = aHorizontal ? bEnd : aEnd;
  return verticalStart.x >= Math.min(horizontalStart.x, horizontalEnd.x)
    && verticalStart.x <= Math.max(horizontalStart.x, horizontalEnd.x)
    && horizontalStart.y >= Math.min(verticalStart.y, verticalEnd.y)
    && horizontalStart.y <= Math.max(verticalStart.y, verticalEnd.y);
}

function fanoutJunctionPosition(node: LibavoidNode, port: LibavoidNode['ports'][number]): { x: number; y: number } {
  const point = { x: node.x + port.x, y: node.y + port.y };
  if (port.side === 'NORTH') point.y -= ROUTING_OBSTACLE_MARGIN * 2;
  else if (port.side === 'SOUTH') point.y += ROUTING_OBSTACLE_MARGIN * 2;
  else if (port.side === 'WEST') point.x -= ROUTING_OBSTACLE_MARGIN * 2;
  else point.x += ROUTING_OBSTACLE_MARGIN * 2;
  return point;
}

function connEndForJunction(Avoid: any, junction: any, position: any): any {
  return new Avoid.ConnEnd(position).createConnEndFromJunctionRef(junction);
}

function resolvedPortId(
  nodeId: string,
  portId: string | undefined,
  nodesById: Map<string, DiagramNode>
): string | undefined {
  const resolved = portId ?? nodesById.get(nodeId)?.ports[0]?.id;
  return resolved ? libavoidPortId(nodeId, resolved) : undefined;
}

function libavoidPortId(nodeId: string, portId: string): string {
  return `${nodeId}::${portId}`;
}

function connectionDirection(side: RoutingPortSide): number {
  // Top and bottom leads end on a node boundary before their rendered stem.
  // Allow a route to arrive tangentially along that boundary as well as from
  // outside, while still forbidding it from entering through the node body.
  if (side === 'NORTH') return 1 | 4 | 8;
  if (side === 'SOUTH') return 2 | 4 | 8;
  if (side === 'WEST') return 4;
  return 8;
}

function handlePosition(side: RoutingPortSide): HdlPosition {
  if (side === 'NORTH') return HdlPosition.Top;
  if (side === 'SOUTH') return HdlPosition.Bottom;
  if (side === 'WEST') return HdlPosition.Left;
  return HdlPosition.Right;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 };
}

function removeConsecutiveDuplicates(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || point.x !== previous.x || point.y !== previous.y;
  });
}

function routeIsOrthogonal(points: Array<{ x: number; y: number }>): boolean {
  return points.slice(1).every((point, index) => (
    point.x === points[index].x || point.y === points[index].y
  ));
}
