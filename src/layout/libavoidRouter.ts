import { resolvedNodeDimensions } from '../diagram/nodeSizing';
import { edgeNetKey } from '../ir/edgeNet';
import { nodeIsArrayNode } from '../ir/nodeMetadata';
import type { DiagramEdge, DiagramNode, PositionedNode } from '../ir/types';
import { ARRAY_STACK_WIDE_LANE_OFFSET } from '../webview/arrayStackGeometry';
import { normalizeRoutePoints } from '../webview/orthogonal/logic';
import { HdlPosition } from '../webview/orthogonal/types';
import { simplifyOrthogonalRoute, type OrthogonalRouteObstacle } from './orthogonalRouteSimplifier';
import { ROUTING_OBSTACLE_MARGIN, routingObstacleMargins } from './routingObstacleGeometry';

const SHAPE_BUFFER_DISTANCE = 4;

export type RoutingPortSide = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

export interface RoutingLeadPoint {
  point: { x: number; y: number };
  side: RoutingPortSide;
}

export type RoutingLeadResolver = (
  nodeId: string,
  portId: string | undefined,
  includeLeadMargins: boolean,
  role?: 'source' | 'target',
) => RoutingLeadPoint | undefined;

export interface LibavoidRoutingResult {
  routes: Map<string, Array<{ x: number; y: number }>>;
  rejectedNets: Map<string, string>;
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
  resolveLead: RoutingLeadResolver,
): Promise<LibavoidRoutingResult> {
  const result = routingQueue.then(() =>
    routeDiagramWithLibavoidExclusive(nodes, edges, resolveLead),
  );
  routingQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function routeDiagramWithLibavoidExclusive(
  nodes: PositionedNode[],
  edges: DiagramEdge[],
  resolveLead: RoutingLeadResolver,
): Promise<LibavoidRoutingResult> {
  const empty = {
    routes: new Map<string, Array<{ x: number; y: number }>>(),
    rejectedNets: new Map<string, string>(),
  };
  if (nodes.length === 0 || edges.length === 0) return empty;

  try {
    const Avoid = await loadAvoidRuntime();
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const libavoidNodes = buildLibavoidNodes(nodes, resolveLead);
    const libavoidEdges = edges.flatMap((edge): LibavoidEdge[] => {
      const sourcePort = resolvedPortId(edge.source, edge.sourcePort, nodesById, 'source');
      const targetPort = resolvedPortId(edge.target, edge.targetPort, nodesById, 'target');
      return sourcePort && targetPort ? [{ edge, sourcePort, targetPort }] : [];
    });
    const rawRoutes = routeRaw(Avoid, libavoidNodes, libavoidEdges);
    let result = validateRoutes(nodes, libavoidNodes, libavoidEdges, rawRoutes, resolveLead);

    // libavoid's orthogonal pass can fail chaotically: iteration order in its
    // visibility graph depends on heap addresses, so the same scene can
    // either route a connector cleanly or silently degrade its endpoint to
    // the shape centre (observed as a rejected straight-line route). A fresh
    // Router over just the rejected nets allocates differently and routes
    // the same geometry fine far more often than not, so retry those nets
    // instead of letting them fall back to a non-avoiding route.
    // The second and third attempts also nudge the shape buffer by a pixel:
    // a slightly different clearance rebuilds the visibility graph with
    // different coordinates, which reliably breaks out of the failing case
    // when heap-order luck alone doesn't.
    const base = SHAPE_BUFFER_DISTANCE;
    for (const buffer of [base, base - 1, base + 1]) {
      if (result.rejectedNets.size === 0) break;
      const retryEdges = libavoidEdges.filter((item) =>
        result.rejectedNets.has(edgeNetKey(item.edge)),
      );
      const retryRoutes = routeRaw(Avoid, libavoidNodes, retryEdges, buffer);
      for (const [edgeId, route] of retryRoutes) rawRoutes.set(edgeId, route);
      result = validateRoutes(nodes, libavoidNodes, libavoidEdges, rawRoutes, resolveLead);
    }
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      routes: empty.routes,
      rejectedNets: new Map(
        edges.map((edge) => [edgeNetKey(edge), `router unavailable: ${reason}`]),
      ),
    };
  }
}

async function loadAvoidRuntime(): Promise<any> {
  avoidRuntimePromise ??= (async () => {
    // Keep native import() intact when the extension is compiled to CommonJS.
    const nativeImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<any>;
    const module = await nativeImport('libavoid-js');
    await module.AvoidLib.load();
    return module.AvoidLib.getInstance();
  })();
  return avoidRuntimePromise;
}

// A boundary inout port is driven on one physical side and read on the
// other (see mergeLayout's endpointId), so it needs two libavoid pins where
// every other port needs exactly one.
function isBoundaryInoutNode(node: PositionedNode): boolean {
  return node.kind === 'port' && node.ports[0]?.direction === 'inout';
}

interface LibavoidNodeDraft {
  id: string;
  /** Node rect grown to its own lead points — the part margins never touch. */
  core: { left: number; top: number; right: number; bottom: number };
  /** core plus routingObstacleMargins — the obstacle rect handed to libavoid. */
  bounds: { left: number; top: number; right: number; bottom: number };
  pins: Array<{ id: string; point: { x: number; y: number }; side: RoutingPortSide }>;
}

function buildLibavoidNodes(
  nodes: PositionedNode[],
  resolveLead: RoutingLeadResolver,
): LibavoidNode[] {
  const drafts = nodes.map((node) => libavoidNodeDraft(node, resolveLead));
  clipMarginsAroundForeignPins(drafts);
  return drafts.map((draft) => ({
    id: draft.id,
    x: draft.bounds.left,
    y: draft.bounds.top,
    width: draft.bounds.right - draft.bounds.left,
    height: draft.bounds.bottom - draft.bounds.top,
    ports: draft.pins.map((pin) => ({
      id: pin.id,
      x: pin.point.x - draft.bounds.left,
      y: pin.point.y - draft.bounds.top,
      side: pin.side,
    })),
  }));
}

function libavoidNodeDraft(
  node: PositionedNode,
  resolveLead: RoutingLeadResolver,
): LibavoidNodeDraft {
  const size = resolvedNodeDimensions(node);
  const dualSided = isBoundaryInoutNode(node);
  type PinSpec = { port: (typeof node.ports)[number]; role: 'source' | 'target' | undefined };
  const pinSpecs = node.ports.flatMap((port): PinSpec[] =>
    dualSided
      ? [
          { port, role: 'target' },
          { port, role: 'source' },
        ]
      : [{ port, role: undefined }],
  );
  const leads = pinSpecs.map(({ port, role }) => resolveLead(node.id, port.id, true, role));
  const leadPoints = leads.flatMap((lead) => (lead ? [lead.point] : []));
  const margins = routingObstacleMargins(
    node,
    leads.map((lead) => lead?.side),
  );
  const core = {
    left: Math.min(node.position.x, ...leadPoints.map((point) => point.x)),
    right: Math.max(node.position.x + size.width, ...leadPoints.map((point) => point.x)),
    top: Math.min(node.position.y, ...leadPoints.map((point) => point.y)),
    bottom: Math.max(node.position.y + size.height, ...leadPoints.map((point) => point.y)),
  };

  return {
    id: node.id,
    core,
    bounds: {
      left: core.left - margins.left,
      right: core.right + margins.right,
      top: core.top - margins.top,
      bottom: core.bottom + margins.bottom,
    },
    pins: pinSpecs.map(({ port, role }, index) => {
      const lead = leads[index];
      return {
        id: libavoidPortId(node.id, port.id, role),
        point: lead?.point ?? {
          x: node.position.x + size.width / 2,
          y: node.position.y + size.height / 2,
        },
        side: lead?.side ?? 'EAST',
      };
    }),
  };
}

/**
 * An obstacle margin that swallows another node's connection pin makes that
 * pin unreachable in libavoid's (buffered) orthogonal visibility graph: the
 * router then silently degrades the connector to a straight line into the
 * shape centre, the raw route fails validation, and the whole net falls back
 * to a much worse non-avoiding route (see mergeLayout's routePoints
 * fallback chain). Cut labels park one grid row away from their port, so
 * their margins routinely reach the neighboring port row — pull the margin
 * back just far enough (buffer + 1) that the foreign pin stays routable.
 * Only the margin band is ever clipped; a pin inside the core rect itself
 * (genuinely overlapping geometry) is left alone.
 */
function clipMarginsAroundForeignPins(drafts: LibavoidNodeDraft[]): void {
  const clearance = SHAPE_BUFFER_DISTANCE + 1;
  for (const draft of drafts) {
    for (const other of drafts) {
      if (other === draft) continue;
      for (const { point } of other.pins) {
        const { core, bounds } = draft;
        const swallowed =
          point.x > bounds.left - SHAPE_BUFFER_DISTANCE &&
          point.x < bounds.right + SHAPE_BUFFER_DISTANCE &&
          point.y > bounds.top - SHAPE_BUFFER_DISTANCE &&
          point.y < bounds.bottom + SHAPE_BUFFER_DISTANCE;
        if (!swallowed) continue;
        if (point.y < core.top) {
          bounds.top = Math.max(bounds.top, Math.min(point.y + clearance, core.top));
        }
        if (point.y > core.bottom) {
          bounds.bottom = Math.min(bounds.bottom, Math.max(point.y - clearance, core.bottom));
        }
        if (point.x < core.left) {
          bounds.left = Math.max(bounds.left, Math.min(point.x + clearance, core.left));
        }
        if (point.x > core.right) {
          bounds.right = Math.min(bounds.right, Math.max(point.x - clearance, core.right));
        }
      }
    }
  }
}

function routeRaw(
  Avoid: any,
  nodes: LibavoidNode[],
  edges: LibavoidEdge[],
  bufferDistance = SHAPE_BUFFER_DISTANCE,
): Map<string, Array<{ x: number; y: number }>> {
  const router = new Avoid.Router(Avoid.OrthogonalRouting);
  const shapes = new Map<string, any>();
  const pinClasses = new Map<string, number>();
  const connectors = new Map<string, any>();
  const fanoutPlans: FanoutPlan[] = [];

  try {
    router.setRoutingParameter(Avoid.shapeBufferDistance, bufferDistance);
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
        new Avoid.Point(node.x + node.width, node.y + node.height),
      );
      const shape = new Avoid.ShapeRef(router, rectangle);
      shapes.set(node.id, shape);

      // A node whose ports share one lead point (e.g. a deduplicated FSM
      // literal with one port per usage) must register that point as ONE
      // pin: several ShapeConnectionPins at the same position corrupt
      // libavoid's visibility graph heap-order-dependently, and the affected
      // connector silently degrades to a straight line into the shape centre.
      let classId = 2;
      const classByPinKey = new Map<string, number>();
      for (const port of node.ports) {
        const pinKey = `${port.x}:${port.y}:${port.side}`;
        const existingClass = classByPinKey.get(pinKey);
        if (existingClass !== undefined) {
          pinClasses.set(port.id, existingClass);
          continue;
        }
        pinClasses.set(port.id, classId);
        classByPinKey.set(pinKey, classId);
        const pin = new Avoid.ShapeConnectionPin(
          shape,
          classId,
          clamp01(port.x / node.width),
          clamp01(port.y / node.height),
          true,
          0,
          connectionDirection(port.side),
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
      if (!sourceShape || !targetShape || sourceClass === undefined || targetClass === undefined)
        return;
      addConnector(
        edge.id,
        new Avoid.ConnEnd(sourceShape, sourceClass),
        new Avoid.ConnEnd(targetShape, targetClass),
      );
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
        connEndForJunction(Avoid, junction, junctionPoint),
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
          new Avoid.ConnEnd(targetShape, targetClass),
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
        if (branchRoute)
          routes.set(branch.edgeId, removeConsecutiveDuplicates([...trunk, ...branchRoute]));
      }
    }
    return routes;
  } finally {
    router.__destroy__?.();
  }
}

function validateRoutes(
  nodes: PositionedNode[],
  libavoidNodes: LibavoidNode[],
  edges: LibavoidEdge[],
  rawRoutes: Map<string, Array<{ x: number; y: number }>>,
  resolveLead: RoutingLeadResolver,
): LibavoidRoutingResult {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const candidates = new Map<string, Array<{ x: number; y: number }>>();
  const rejectedNets = new Map<string, string>();

  for (const item of edges) {
    const netKey = edgeNetKey(item.edge);
    const raw = rawRoutes.get(item.edge.id);
    const sourceLead = resolveLead(item.edge.source, item.edge.sourcePort, true, 'source');
    const targetLead = resolveLead(item.edge.target, item.edge.targetPort, true, 'target');
    if (!raw || !sourceLead || !targetLead) {
      rejectedNets.set(netKey, 'missing route or endpoint');
      continue;
    }

    const stitched = removeConsecutiveDuplicates(
      [sourceLead.point, ...raw, targetLead.point].map(roundPoint),
    );
    if (!routeIsOrthogonal(stitched)) {
      rejectedNets.set(netKey, 'non-orthogonal raw route');
      continue;
    }

    const normalized = normalizeRenderedRoute(item.edge, stitched, nodesById, resolveLead);
    const rejection = validateNormalizedRoute(normalized, nodes);
    if (rejection) rejectedNets.set(netKey, rejection);
    else candidates.set(item.edge.id, normalized);
  }

  const edgeById = new Map(edges.map((item) => [item.edge.id, item]));
  const netSizes = new Map<string, number>();
  for (const item of edges) {
    const netKey = edgeNetKey(item.edge);
    netSizes.set(netKey, (netSizes.get(netKey) ?? 0) + 1);
  }

  for (const item of edges) {
    const netKey = edgeNetKey(item.edge);
    const route = candidates.get(item.edge.id);
    if (!route || rejectedNets.has(netKey) || netSizes.get(netKey) !== 1) continue;

    const peerRoutes = [...candidates.entries()].flatMap(([edgeId, candidate]) => {
      const peer = edgeById.get(edgeId);
      return edgeId !== item.edge.id && peer && !rejectedNets.has(edgeNetKey(peer.edge))
        ? [candidate]
        : [];
    });
    const laneClearance = item.edge.isStacked ? ARRAY_STACK_WIDE_LANE_OFFSET : 0;
    const obstacles = simplificationObstacles(libavoidNodes, SHAPE_BUFFER_DISTANCE + laneClearance);
    const simplified = simplifyOrthogonalRoute(route, obstacles, peerRoutes);
    const rejection = validateNormalizedRoute(simplified, nodes);
    if (rejection) rejectedNets.set(netKey, rejection);
    else candidates.set(item.edge.id, simplified);
  }

  const routes = new Map<string, Array<{ x: number; y: number }>>();
  for (const item of edges) {
    const netKey = edgeNetKey(item.edge);
    const route = candidates.get(item.edge.id);
    if (route && !rejectedNets.has(netKey)) routes.set(item.edge.id, route);
  }
  return { routes, rejectedNets };
}

function simplificationObstacles(
  nodes: LibavoidNode[],
  clearance: number,
): OrthogonalRouteObstacle[] {
  return nodes.map((node) => ({
    x: node.x - clearance,
    y: node.y - clearance,
    width: node.width + clearance * 2,
    height: node.height + clearance * 2,
  }));
}

function normalizeRenderedRoute(
  edge: DiagramEdge,
  route: Array<{ x: number; y: number }>,
  nodesById: Map<string, DiagramNode>,
  resolveLead: RoutingLeadResolver,
): Array<{ x: number; y: number }> {
  const sourceHandle = resolveLead(edge.source, edge.sourcePort, false, 'source');
  const targetHandle = resolveLead(edge.target, edge.targetPort, false, 'target');
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
    nodesById.get(edge.target),
  );
}

function validateNormalizedRoute(
  route: Array<{ x: number; y: number }>,
  nodes: PositionedNode[],
): string | undefined {
  if (!routeIsOrthogonal(route)) return 'non-orthogonal normalized route';

  for (const node of nodes) {
    const bounds = renderedNodeBounds(node);
    if (routeIntersectsRectInterior(route, bounds)) return `intersects node ${node.id}`;
  }

  return undefined;
}

function renderedNodeBounds(node: PositionedNode): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const size = resolvedNodeDimensions(node);
  const stackPad = nodeIsArrayNode(node) ? 4 : 0;
  return {
    x: node.position.x - stackPad,
    y: node.position.y - stackPad,
    width: size.width + stackPad * 2,
    height: size.height + stackPad * 2,
  };
}

function routeIntersectsRectInterior(
  points: Array<{ x: number; y: number }>,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return points
    .slice(1)
    .some((point, index) => segmentIntersectsRectInterior(points[index], point, rect));
}

function segmentIntersectsRectInterior(
  start: { x: number; y: number },
  end: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  if (start.y === end.y) {
    return (
      start.y > top &&
      start.y < bottom &&
      Math.max(start.x, end.x) > left &&
      Math.min(start.x, end.x) < right
    );
  }
  if (start.x === end.x) {
    return (
      start.x > left &&
      start.x < right &&
      Math.max(start.y, end.y) > top &&
      Math.min(start.y, end.y) < bottom
    );
  }
  return true;
}

function fanoutJunctionPosition(
  node: LibavoidNode,
  port: LibavoidNode['ports'][number],
): { x: number; y: number } {
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
  nodesById: Map<string, DiagramNode>,
  role: 'source' | 'target',
): string | undefined {
  const node = nodesById.get(nodeId);
  const resolved = portId ?? node?.ports[0]?.id;
  if (!resolved) return undefined;
  const dualSided = node?.kind === 'port' && node.ports[0]?.direction === 'inout';
  return libavoidPortId(nodeId, resolved, dualSided ? role : undefined);
}

function libavoidPortId(nodeId: string, portId: string, role?: 'source' | 'target'): string {
  return role ? `${nodeId}::${portId}::${role}` : `${nodeId}::${portId}`;
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

function removeConsecutiveDuplicates(
  points: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || point.x !== previous.x || point.y !== previous.y;
  });
}

function routeIsOrthogonal(points: Array<{ x: number; y: number }>): boolean {
  return points
    .slice(1)
    .every((point, index) => point.x === points[index].x || point.y === points[index].y);
}
