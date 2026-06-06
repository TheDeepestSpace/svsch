import type { DesignGraph, DesignModule, DiagramEdge, DiagramNode, DiagramViewModel, PositionedNode } from '../ir/types';
import { nodeIsArrayNode, registerClockSignal, registerResetSignal, structRole } from '../ir/nodeMetadata';
import { edgeNetKey, endpointKey } from '../ir/edgeNet';
import type { SavedLayout, SavedModuleLayout, SavedNetCut } from '../storage/layoutStore';
import { diagramSizing } from '../diagram/constants';
import { diagramNodeDimensions, instanceParameterRows, inverterGeometryWidth } from '../diagram/nodeSizing';
import {
  interfaceSidePortCenters,
  interfaceTopHatHeight,
  interfaceTopHatTop,
  interfaceTopPortX
} from '../diagram/interfaceGeometry';

interface AutoLayoutResult {
  positions: Map<string, { x: number; y: number }>;
  routes: Map<string, Array<{ x: number; y: number }>>;
}

export type ElkPortSide = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

interface ElkDiagramNode {
  id: string;
  width: number;
  height: number;
  ports: Array<{
    id: string;
    width: number;
    height: number;
    x?: number;
    y?: number;
    layoutOptions: Record<string, string>;
    properties: Record<string, string>;
  }>;
  layoutOptions: Record<string, string>;
  properties: Record<string, string>;
  layoutOffset: { x: number; y: number };
}

export async function buildViewModel(graph: DesignGraph, moduleName: string, layout: SavedLayout): Promise<DiagramViewModel> {
  const designModule = graph.modules[moduleName] ?? graph.modules[graph.rootModules[0]];
  if (!designModule) {
    return {
      moduleName,
      nodes: [],
      edges: [],
      diagnostics: graph.diagnostics
    };
  }

  const moduleLayout = layout.modules[designModule.name] ?? { nodes: {} };
  const activeCuts = activeNetCuts(designModule, moduleLayout);
  const activeCutKeys = new Set(activeCuts.keys());
  const routedDesignEdges = designModule.edges.filter((edge) => !activeCutKeys.has(edgeNetKey(edge)));
  const elkLayout = await autoLayoutMissingNodes(designModule.nodes, routedDesignEdges, moduleLayout);
  const positioned = designModule.nodes.map((node, index): PositionedNode => {
    const saved = moduleLayout.nodes[node.id];
    const elk = elkLayout.positions.get(node.id);
    const fallback = defaultPosition(index, node.kind);

    const position = (saved?.fixed) 
      ? { x: saved.x, y: saved.y }
      : (elk ?? (saved ? { x: saved.x, y: saved.y } : fallback));

    return {
      ...node,
      fixed: saved?.fixed,
      position: snapPosition(position, node.kind, structRole(node))
    };
  });

  const cutProjection = buildNetCutProjection(designModule, moduleLayout, activeCuts, positioned);

  return {
    moduleName: designModule.name,
    parameters: designModule.parameters,
    nodes: [...positioned, ...cutProjection.nodes],
    edges: [
      ...routedDesignEdges.map((edge) => ({
        ...edge,
        waypoint: moduleLayout.edges?.[edge.id]?.waypoint,
        routePoints: moduleLayout.edges?.[edge.id]?.routePoints ?? elkLayout.routes.get(edge.id)
      })),
      ...cutProjection.edges
    ],
    diagnostics: graph.diagnostics
  };
}

interface ActiveNetCut {
  cut: SavedNetCut;
  edges: DiagramEdge[];
}

function activeNetCuts(designModule: DesignModule, moduleLayout: SavedModuleLayout): Map<string, ActiveNetCut> {
  const active = new Map<string, ActiveNetCut>();

  for (const [netKey, cut] of Object.entries(moduleLayout.netCuts ?? {})) {
    const sourceNode = designModule.nodes.find((node) => node.id === cut.source.nodeId);
    if (!sourceNode || (cut.source.portId && !sourceNode.ports.some((port) => port.id === cut.source.portId || port.name === cut.source.portId))) {
      continue;
    }

    const edges = designModule.edges.filter((edge) => (
      edgeNetKey(edge) === netKey
      && edge.source === cut.source.nodeId
      && edge.sourcePort === cut.source.portId
    ));
    if (edges.length > 0) {
      active.set(netKey, { cut, edges });
    }
  }

  return active;
}

function buildNetCutProjection(
  designModule: DesignModule,
  moduleLayout: SavedModuleLayout,
  activeCuts: Map<string, ActiveNetCut>,
  positionedNodes: PositionedNode[]
): { nodes: PositionedNode[]; edges: DiagramEdge[] } {
  const nodes: PositionedNode[] = [];
  const edges: DiagramEdge[] = [];
  const nodesById = new Map<string, DiagramNode>(positionedNodes.map((node) => [node.id, node]));
  const nodePositions = new Map(positionedNodes.map((node) => [node.id, node.position]));

  for (const [netKey, { cut, edges: cutEdges }] of activeCuts) {
    const sortedCutEdges = [...cutEdges].sort((a, b) => a.id.localeCompare(b.id));
    const firstEdge = sortedCutEdges[0];
    if (!firstEdge) {
      continue;
    }

    const sourceLead = renderedLeadPoint(cut.source.nodeId, cut.source.portId, nodesById, nodePositions);
    if (!sourceLead) {
      continue;
    }

    const sourceNode = nodesById.get(cut.source.nodeId);
    const isSourceStacked = sourceNode ? nodeIsArrayNode(sourceNode) : false;

    const sourceLabelId = cutLabelNodeId(netKey, 'source');
    const sourceHandleSide = oppositeHandleSide(elkSideToHandleSide(sourceLead.side));
    const sourceLabelNode = makeCutLabelNode(
      sourceLabelId,
      cut.label,
      designModule.name,
      {
        netKey,
        role: 'source',
        align: 'end',
        originalEdgeId: firstEdge.id,
        handleSide: sourceHandleSide,
        edgeStyle: cutLabelEdgeStyle(firstEdge),
        isSourceStacked
      },
      moduleLayout,
      labelPositionForHandlePoint(sourceLead.point, sourceHandleSide, cut.label)
    );
    nodes.push(sourceLabelNode);

    edges.push(makeCutStubEdge({
      id: cutStubEdgeId(netKey, 'source'),
      template: firstEdge,
      source: cut.source.nodeId,
      sourcePort: cut.source.portId,
      target: sourceLabelId,
      targetPort: 'cut',
      netKey,
      role: 'source',
      originalEdgeId: firstEdge.id,
      moduleLayout
    }));

    for (const edge of sortedCutEdges) {
      const targetLead = renderedLeadPoint(edge.target, edge.targetPort, nodesById, nodePositions);
      if (!targetLead) {
        continue;
      }

      const sinkLabelId = cutLabelNodeId(netKey, 'sink', edge.id);
      const sinkHandleSide = oppositeHandleSide(elkSideToHandleSide(targetLead.side));
      const sinkLabelNode = makeCutLabelNode(
        sinkLabelId,
        cut.label,
        designModule.name,
        {
          netKey,
          role: 'sink',
          align: 'start',
          originalEdgeId: edge.id,
          handleSide: sinkHandleSide,
          edgeStyle: cutLabelEdgeStyle(edge),
          isSourceStacked
        },
        moduleLayout,
        labelPositionForHandlePoint(targetLead.point, sinkHandleSide, cut.label)
      );
      nodes.push(sinkLabelNode);

      edges.push(makeCutStubEdge({
        id: cutStubEdgeId(netKey, 'sink', edge.id),
        template: edge,
        source: sinkLabelId,
        sourcePort: 'cut',
        target: edge.target,
        targetPort: edge.targetPort,
        netKey,
        role: 'sink',
        originalEdgeId: edge.id,
        moduleLayout
      }));
    }
  }

  return { nodes, edges };
}

function cutLabelNodeId(netKey: string, role: 'source' | 'sink', edgeId?: string): string {
  return role === 'source'
    ? `cut-label:${netKey}:source`
    : `cut-label:${netKey}:sink:${edgeId ?? ''}`;
}

function cutStubEdgeId(netKey: string, role: 'source' | 'sink', edgeId?: string): string {
  return role === 'source'
    ? `cut-stub:${netKey}:source`
    : `cut-stub:${netKey}:sink:${edgeId ?? ''}`;
}

function cutLabelEdgeStyle(edge: DiagramEdge): NonNullable<NonNullable<DiagramNode['metadata']>['cutNet']>['edgeStyle'] | undefined {
  const aggregate = edge.metadata?.aggregate;
  const isStacked = edge.isStacked === true;
  if (!aggregate && !isStacked) {
    return undefined;
  }
  return {
    ...(aggregate ? { aggregate } : {}),
    ...(isStacked ? { isStacked } : {})
  };
}

function makeCutLabelNode(
  id: string,
  label: string,
  moduleName: string,
  cutNet: NonNullable<DiagramNode['metadata']>['cutNet'],
  moduleLayout: SavedModuleLayout,
  fallbackPosition: { x: number; y: number }
): PositionedNode {
  const saved = moduleLayout.nodes[id];
  const position = saved
    ? { x: saved.x, y: saved.y }
    : fallbackPosition;

  return {
    id,
    kind: 'netLabel',
    label,
    parentModule: moduleName,
    ports: [
      {
        id: 'cut',
        name: 'cut',
        direction: cutNet?.role === 'source' ? 'input' : 'output'
      }
    ],
    metadata: { cutNet },
    position,
    fixed: saved?.fixed
  };
}

function makeCutStubEdge({
  id,
  template,
  source,
  sourcePort,
  target,
  targetPort,
  netKey,
  role,
  originalEdgeId,
  moduleLayout
}: {
  id: string;
  template: DiagramEdge;
  source: string;
  sourcePort?: string;
  target: string;
  targetPort?: string;
  netKey: string;
  role: 'source' | 'sink';
  originalEdgeId?: string;
  moduleLayout: SavedModuleLayout;
}): DiagramEdge {
  return {
    id,
    source,
    target,
    sourcePort,
    targetPort,
    signal: template.signal,
    width: template.width,
    isStacked: template.isStacked,
    sourceRange: template.sourceRange,
    metadata: {
      ...(template.metadata ?? {}),
      forceStraight: true,
      cutStub: {
        netKey,
        role,
        originalEdgeId
      }
    },
    routePoints: moduleLayout.edges?.[id]?.routePoints
  };
}

export function elkSideToHandleSide(side: ElkPortSide): 'left' | 'right' | 'top' | 'bottom' {
  if (side === 'WEST') return 'left';
  if (side === 'EAST') return 'right';
  if (side === 'NORTH') return 'top';
  return 'bottom';
}

function oppositeHandleSide(side: 'left' | 'right' | 'top' | 'bottom'): 'left' | 'right' | 'top' | 'bottom' {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  if (side === 'top') return 'bottom';
  return 'top';
}

function labelPositionForHandlePoint(
  point: { x: number; y: number },
  handleSide: 'left' | 'right' | 'top' | 'bottom',
  label: string
): { x: number; y: number } {
  const dimensions = diagramNodeDimensions({
    id: 'label',
    kind: 'netLabel',
    label,
    ports: []
  });

  if (handleSide === 'left') {
    return { x: point.x, y: point.y - dimensions.height / 2 };
  }
  if (handleSide === 'right') {
    return { x: point.x - dimensions.width, y: point.y - dimensions.height / 2 };
  }
  if (handleSide === 'top') {
    return { x: point.x - dimensions.width / 2, y: point.y };
  }
  return { x: point.x - dimensions.width / 2, y: point.y - dimensions.height };
}

async function autoLayoutMissingNodes(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  moduleLayout: SavedModuleLayout
): Promise<AutoLayoutResult> {
  const positions = new Map<string, { x: number; y: number }>();
  const routes = new Map<string, Array<{ x: number; y: number }>>();
  const routePositions = new Map<string, { x: number; y: number }>();
  const missingIds = new Set(nodes.filter((node) => !moduleLayout.nodes[node.id]).map((node) => node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodes.length === 0) {
    return { positions, routes };
  }

  try {
    const elkModule = await import('elkjs/lib/elk.bundled.js');
    const Elk = elkModule.default;
    const elk = new Elk();
    const graph = await elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': diagramSizing.sameLayerNodeSeparation.toString(),
        'elk.layered.spacing.nodeNodeBetweenLayers': diagramSizing.minNodeSeparation.toString(),
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.interactive': 'true',
        'elk.layered.crossingMinimization.semiInteractive': 'true',
        'elk.layered.concentrateEdges': 'true',
        'elk.layered.improveHyperedgeRoutes': 'true',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.spacing.edgeNode': diagramSizing.gridSize.toString(),
        'elk.padding': `[top=${diagramSizing.gridSize}, left=${diagramSizing.gridSize}, bottom=${diagramSizing.gridSize}, right=${diagramSizing.gridSize}]`
      },
      children: nodes.map((node) => {
        const { layoutOffset, ...elkNode } = elkNodeForDiagramNode(node, true);
        const saved = moduleLayout.nodes[node.id];
        return {
          ...elkNode,
          properties: {
            ...elkNode.properties,
            ...(saved?.fixed
              ? {
                'org.eclipse.elk.position': 'FIXED'
              }
              : {})
          },
          layoutOptions: {
            ...elkNode.layoutOptions,
            ...(saved?.fixed
              ? {
                'elk.position': 'FIXED',
                'org.eclipse.elk.position': 'FIXED'
              }
              : {})
          },
          ...(saved
            ? {
              x: saved.x - layoutOffset.x,
              y: saved.y - layoutOffset.y
            }
            : {})
        };
      }),
      edges: buildNodePlacementElkEdges(edges, nodeIds)
    });

    for (const child of graph.children ?? []) {
      if (child.id && child.x !== undefined && child.y !== undefined) {
        const node = nodes.find((n) => n.id === child.id);
        const offset = node ? elkNodeForDiagramNode(node, true).layoutOffset : { x: 0, y: 0 };
        positions.set(child.id, snapPosition({ x: child.x + offset.x, y: child.y + offset.y }, node?.kind, node ? structRole(node) : undefined));
      }
    }
    alignSimpleLeafNodes(nodes, edges, positions, moduleLayout);
    enforceMinimumBlockGaps(nodes, positions, moduleLayout);
    alignSimpleLeafNodes(nodes, edges, positions, moduleLayout);

    const routeLayoutOptions = {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.interactive': 'true',
      'elk.layered.concentrateEdges': 'true',
      'elk.layered.improveHyperedgeRoutes': 'true',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.spacing.nodeNode': diagramSizing.sameLayerNodeSeparation.toString(),
      'elk.layered.spacing.nodeNodeBetweenLayers': diagramSizing.minNodeSeparation.toString(),
      'elk.layered.spacing.edgeNode': diagramSizing.gridSize.toString(),
      'elk.layered.spacing.edgeEdge': (diagramSizing.gridSize / 2).toString(),
      'elk.spacing.portPort': (diagramSizing.gridSize / 2).toString(),
      'elk.padding': `[top=${diagramSizing.gridSize}, left=${diagramSizing.gridSize}, bottom=${diagramSizing.gridSize}, right=${diagramSizing.gridSize}]`
    };
    const routeChildren = nodes.map((node, index) => {
      const graphChild = graph.children?.find((child) => child.id === node.id);
      const saved = moduleLayout.nodes[node.id];
      const fallback = defaultPosition(index, node.kind);
      const position = saved?.fixed
        ? { x: saved.x, y: saved.y }
        : positions.get(node.id) ?? (saved ? { x: saved.x, y: saved.y } : undefined) ?? (graphChild?.x !== undefined && graphChild.y !== undefined
          ? { x: graphChild.x, y: graphChild.y }
          : fallback);
      routePositions.set(node.id, position);
      const { layoutOffset, ...elkNode } = elkNodeForDiagramNode(node, true);
      return {
        ...elkNode,
        x: position.x - layoutOffset.x,
        y: position.y - layoutOffset.y,
        properties: {
          ...elkNode.properties,
          'org.eclipse.elk.position': 'FIXED'
        },
        layoutOptions: {
          ...elkNode.layoutOptions,
          'elk.position': 'FIXED',
          'org.eclipse.elk.position': 'FIXED'
        }
      };
    });

    let routeGraph;
    try {
      routeGraph = await elk.layout({
        id: 'root',
        layoutOptions: routeLayoutOptions,
        children: routeChildren,
        edges: buildRoutingElkEdges(edges, nodeIds)
      });
    } catch {
      // Hyperedge routing can fail in FIXED-position mode for some fan-out topologies
      // (e.g. a register Q port feeding multiple stacked mux inputs that ELK reversed
      // into forward edges). Retry with individual edges so each edge still gets a route.
      routeGraph = await elk.layout({
        id: 'root',
        layoutOptions: routeLayoutOptions,
        children: routeChildren,
        edges: buildNodePlacementElkEdges(edges, nodeIds)
      });
    }

    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const projectedRoutes = projectElkRoutes(routeGraph.edges ?? [], edges);
    for (const [edgeId, route] of projectedRoutes) {
      if (!moduleLayout.edges?.[edgeId]?.routePoints) {
        const edge = edges.find((candidate) => candidate.id === edgeId);
        routes.set(edgeId, edge ? routeWithRenderedLeads(edge, route, nodesById, routePositions) : route);
      }
    }
    for (const edge of edges) {
      if (!moduleLayout.edges?.[edge.id]?.routePoints && !routes.has(edge.id)) {
        const route = directRenderedLeadRoute(edge, nodesById, routePositions);
        if (route) {
          routes.set(edge.id, route);
        }
      }
    }
    repairSourceStems(edges, routes, nodesById, routePositions);
  } catch {
    return { positions, routes };
  }

  return { positions, routes };
}

function elkNodeForDiagramNode(node: DiagramNode, includeLeadMargins = false): ElkDiagramNode {
  const { width, height } = diagramNodeDimensions(node);
  const grid = diagramSizing.gridSize;
  const role = structRole(node);
  const visiblePorts = node.kind === 'interface'
    ? node.ports.filter((port) => port.width !== 'interface' || role === 'modport' || port.preferredSide || port.id.endsWith(':left') || port.id.endsWith(':right'))
    : node.ports;
  const inputs = visiblePorts.filter((port) => port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown');
  const outputs = visiblePorts.filter((port) => port.direction === 'output');

  const portGeometry = visiblePorts.map((port, index) => {
    let side: ElkPortSide = port.direction === 'output' ? 'EAST' : 'WEST';
    if (node.kind === 'port') {
      side = port.direction === 'output' ? 'WEST' : 'EAST';
    }

    let portX = side === 'WEST' ? 0 : width;
    let portY = height / 2;

    if (node.kind === 'register') {
      const clockSignal = registerClockSignal(node);
      const resetSignal = registerResetSignal(node);
      const inputs = node.ports.filter((p) => p.direction === 'input' || p.direction === 'inout' || p.direction === 'unknown');
      const isReset = port.name === 'R' || port.name === resetSignal;
      const isClock = port.name === clockSignal || (!isReset && port.name !== 'D' && port.name !== 'Q' && port.name !== 'RV' && inputs.indexOf(port) === 1);
      const isRv = port.name === 'RV';

      if (port.name === 'D') {
        portY = diagramSizing.nodeHeaderHeight + grid / 2;
      } else if (port.name === 'Q') {
        portY = diagramSizing.nodeHeaderHeight + grid / 2;
      } else if (isClock) {
        portY = diagramSizing.nodeHeaderHeight + grid + grid / 2;
      } else if (isRv) {
        portY = diagramSizing.nodeHeaderHeight + grid * 2 + grid / 2;
      } else if (isReset) {
        side = 'SOUTH';
        portX = width / 2;
        portY = height;
      }
    } else if (node.kind === 'mux') {
      const inputs = node.ports.filter(p => p.direction !== 'output');
      const isSelect = port.id === inputs[0]?.id;
      if (isSelect) {
        side = 'NORTH';
        portX = width / 2;
        portY = diagramSizing.gridSize;
      } else if (port.direction === 'output') {
        portY = height / 2;
      } else {
        const sideInputIndex = inputs.indexOf(port) - 1;
        const heightUnits = Math.max(1, Math.round(height / grid));
        const startUnit = Math.max(1, Math.ceil((heightUnits - (inputs.length - 1) + 1) / 2));
        portY = grid * (startUnit + sideInputIndex);
      }
    } else if (node.kind === 'select') {
      const allInputs = node.ports.filter(p => p.direction !== 'output');
      const topPorts = allInputs.filter((p) => p.name === 's' || p.name === 'sel' || p.name === 'width');
      const portIndex = topPorts.indexOf(port);
      if (portIndex >= 0) {
        side = 'NORTH';
        portX = width * (portIndex + 1) / (topPorts.length + 1);
        portY = diagramSizing.gridSize;
      } else if (port.direction === 'output') {
        portY = height / 2;
      } else {
        const sideInputIndex = allInputs.filter(p => !topPorts.some(tp => tp.id === p.id)).indexOf(port);
        portY = height / 2;
      }
    } else if (node.kind === 'alu') {
      if (port.direction === 'output') {
        side = 'EAST';
        portX = width;
        portY = height / 2;
      } else {
        side = 'WEST';
        portX = 0;
        const inputIndex = Math.max(0, inputs.indexOf(port));
        portY = inputIndex === 0 ? grid : grid * 3;
      }
    } else if (node.kind === 'inverter') {
      if (port.direction === 'output') {
        side = 'EAST';
        portX = inverterGeometryWidth();
      } else {
        side = 'WEST';
        portX = 0;
      }
      portY = height / 2;
    } else if (node.kind === 'port' || (node.kind === 'interface' && role === 'port')) {
      portY = height / 2;
    } else if (node.kind === 'bus' || node.kind === 'struct' || node.kind === 'interface') {
      const isInterfaceModport = node.kind === 'interface' && role === 'modport';
      const isInterfaceInstance = node.kind === 'interface' && role !== 'modport' && role !== 'port';
      const shiftY = isInterfaceInstance ? grid * 3 + grid / 2 : 0;
      const bottomPortsOnSide = isInterfaceInstance ? visiblePorts.filter(p => p.direction === 'output' && p.width !== 'interface') : [];
      const bottomHatHeight = isInterfaceInstance ? interfaceTopHatHeight(bottomPortsOnSide.length > 0) : 0;
      const unshiftedHeight = Math.max(grid, height - shiftY);

      if (isInterfaceInstance && port.direction === 'input' && port.width !== 'interface') {
        side = 'NORTH';
        const topPorts = visiblePorts.filter(p => p.direction === 'input' && p.width !== 'interface');
        const portIndex = topPorts.indexOf(port);
        portX = interfaceTopPortX(width, topPorts.length, portIndex, Math.max(topPorts.length, bottomPortsOnSide.length));
        portY = 0;
      } else if (isInterfaceInstance && port.direction === 'output' && port.width !== 'interface') {
        side = 'SOUTH';
        const portIndex = bottomPortsOnSide.indexOf(port);
        const topPorts = visiblePorts.filter(p => p.direction === 'input' && p.width !== 'interface');
        portX = interfaceTopPortX(width, bottomPortsOnSide.length, portIndex, Math.max(topPorts.length, bottomPortsOnSide.length));
        portY = height;
      } else {
        const sidePorts = isInterfaceInstance
          ? visiblePorts.filter(p => p.width === 'interface' || (p.direction !== 'input' && p.direction !== 'output'))
          : visiblePorts;
        const sideInputs = sidePorts.filter((p) => p.direction === 'input' || p.direction === 'inout' || p.direction === 'unknown');
        const sideOutputs = sidePorts.filter((p) => p.direction === 'output');

        const isComposition = node.kind === 'struct'
          ? role === 'composition'
          : node.kind === 'interface'
            ? false
            : inputs.length > 1;
        const isArrayComposition = node.kind === 'bus' && isComposition && node.metadata?.aggregateKind === 'array';
        const isArrayBreakout = node.kind === 'bus' && !isComposition && node.metadata?.aggregateKind === 'array';

        if (isInterfaceModport && port.width === 'interface') {
           const isModuleInterfaceModport = node.label !== node.metadata?.typeName;
           if (isModuleInterfaceModport) {
             side = 'NORTH';
             portX = width / 2;
             portY = 0;
           } else {
             side = port.direction === 'output' ? 'EAST' : 'WEST';
             portX = side === 'EAST' ? width : 0;
             portY = height / 2;
           }
        } else if (isInterfaceInstance && port.width === 'interface') {
           const pref = port.preferredSide;
           side = pref === 'left' ? 'WEST' : 'EAST';
           portX = side === 'EAST' ? width : 0;
           const sidePortsOnSide = visiblePorts.filter(p => p.width === 'interface' || (p.direction !== 'input' && p.direction !== 'output'));
           const centers = interfaceSidePortCenters(sidePortsOnSide, unshiftedHeight, interfaceTopHatHeight(visiblePorts.some(p => p.direction === 'input' && p.width !== 'interface')), bottomHatHeight);
           portY = (centers.get(port.id) ?? unshiftedHeight / 2) + shiftY;
        } else {
          const taps = isInterfaceModport ? sidePorts.filter(p => p.width !== 'interface') : node.kind === 'interface' ? [...sideInputs, ...sideOutputs] : isComposition ? inputs : outputs;
          const singlePort = isComposition ? outputs[0] : inputs[0];
          const tapIndex = taps.indexOf(port);
          if (isInterfaceModport) {
            const pref = port.preferredSide;
            if (pref) {
               side = pref === 'left' ? 'WEST' : 'EAST';
            } else {
               side = port.direction === 'output' ? 'EAST' : 'WEST';
            }
            portX = side === 'EAST' ? width : 0;
          }
          
          if (port.id === singlePort?.id) {
            if (isArrayComposition) {
              side = 'EAST';
              portX = width - grid * 1.5;
            } else if (isArrayBreakout) {
              side = 'WEST';
              portX = 0;
            }
          }
          
          if (tapIndex >= 0) {
            portY = isInterfaceInstance
              ? (interfaceSidePortCenters(sidePorts, unshiftedHeight, interfaceTopHatHeight(visiblePorts.some(p => p.direction === 'input' && p.width !== 'interface')), bottomHatHeight).get(port.id) ?? unshiftedHeight / 2) + shiftY
              : grid * (tapIndex * 2 + (isInterfaceModport ? 2 : 1));
          } else if (!isInterfaceModport && port.id === singlePort?.id) {
            if (isArrayComposition || isArrayBreakout) {
              const lastTapCenter = grid * ((taps.length - 1) * 2 + 1);
              portY = lastTapCenter + grid;
            } else {
              portY = grid; // firstTapCenter
            }
          } else {
            portY = height / 2;
          }
        }
      }
    } else if (node.kind === 'literal' || node.kind === 'replicate') {
      portY = height / 2;
    } else {
      const sidePorts = port.direction === 'output' ? outputs : inputs;
      portY = genericNodePortTop(node) + grid * Math.max(0, sidePorts.indexOf(port)) + grid / 2;
    }

    return {
      id: endpointId(node.id, port.id),
      side,
      leadLength: includeLeadMargins ? elkLeadLengthForPort(side, port.id) : 0,
      index,
      x: portX,
      y: portY
    };
  });

  const arrayLayerPad = nodeIsArrayNode(node) ? 4 : 0;
  const margins = portGeometry.reduce((current, port) => {
    if (port.side === 'WEST') {
      current.left = Math.max(current.left, port.leadLength);
    } else if (port.side === 'EAST') {
      current.right = Math.max(current.right, port.leadLength);
    } else if (port.side === 'NORTH') {
      current.top = Math.max(current.top, port.leadLength);
    } else if (port.side === 'SOUTH') {
      current.bottom = Math.max(current.bottom, port.leadLength);
    }
    return current;
  }, { left: arrayLayerPad, right: arrayLayerPad, top: arrayLayerPad, bottom: arrayLayerPad });

  const ports = portGeometry.map((port) => {
    const leadX = port.side === 'WEST'
      ? -port.leadLength
      : port.side === 'EAST'
        ? port.leadLength
        : 0;
    const leadY = port.side === 'NORTH'
      ? -port.leadLength
      : port.side === 'SOUTH'
        ? port.leadLength
        : 0;

    return {
      id: port.id,
      width: 1,
      height: 1,
      x: margins.left + port.x + leadX,
      y: margins.top + port.y + leadY,
      layoutOptions: {
        'elk.port.side': port.side,
        'elk.port.index': port.index.toString(),
        'org.eclipse.elk.port.side': port.side,
        'org.eclipse.elk.port.index': port.index.toString()
      },
      properties: {
        'org.eclipse.elk.port.side': port.side,
        'org.eclipse.elk.port.index': port.index.toString()
      }
    };
  });

  return {
    id: node.id,
    width: width + margins.left + margins.right,
    height: height + margins.top + margins.bottom,
    ports,
    layoutOptions: {
      'elk.portConstraints': 'FIXED_POS',
      'org.eclipse.elk.portConstraints': 'FIXED_POS'
    },
    properties: {
      'org.eclipse.elk.portConstraints': 'FIXED_POS'
    },
    layoutOffset: { x: margins.left, y: margins.top }
  };
}

function elkLeadLengthForPort(side: ElkPortSide, portId?: string): number {
  if (side === 'NORTH' || side === 'SOUTH') {
    return portId === 'reset' ? diagramSizing.gridSize : diagramSizing.gridSize * 2;
  }
  return diagramSizing.edgeLeadLength;
}

function alignSimpleLeafNodes(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  positions: Map<string, { x: number; y: number }>,
  moduleLayout: SavedModuleLayout
): void {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    if (moduleLayout.nodes[node.id]?.fixed || node.kind !== 'port') {
      continue;
    }

    const connected = edges.filter((edge) => edge.source === node.id || edge.target === node.id);
    if (connected.length !== 1) {
      continue;
    }

    const edge = connected[0];
    const isSource = edge.source === node.id;
    const peer = nodesById.get(isSource ? edge.target : edge.source);
    if (!peer || peer.kind === 'port' || peer.kind === 'register' || peer.kind === 'latch') {
      continue;
    }

    const peerPortId = isSource ? edge.targetPort : edge.sourcePort;
    if (!canAlignSimpleLeafToPeer(peer, peerPortId)) {
      continue;
    }

    const nodePosition = positions.get(node.id);
    const peerPosition = positions.get(peer.id);
    if (!nodePosition || !peerPosition) {
      continue;
    }

    const ownPortId = isSource ? edge.sourcePort : edge.targetPort;
    const ownOffset = renderedPortOffset(node, ownPortId);
    const peerOffset = renderedPortOffset(peer, peerPortId);
    if (!ownOffset || !peerOffset) {
      continue;
    }

    const peerElkNode = elkNodeForDiagramNode(peer, false);
    const peerElkPort = peerElkNode.ports.find((candidate) => candidate.id === endpointId(peer.id, peerPortId));
    const peerSide = peerElkPort?.properties['org.eclipse.elk.port.side'];
    if ((peerSide === 'NORTH' || peerSide === 'SOUTH') && node.kind === 'port') {
      const ownElkNode = elkNodeForDiagramNode(node, false);
      const ownElkPort = ownElkNode.ports.find((candidate) => candidate.id === endpointId(node.id, ownPortId));
      const ownSide = ownElkPort?.properties['org.eclipse.elk.port.side'];
      const ownLeadOffset = ownSide === 'EAST'
        ? diagramSizing.edgeLeadLength
        : ownSide === 'WEST'
          ? -diagramSizing.edgeLeadLength
          : 0;
      const sameSidePorts = peerElkNode.ports.filter((candidate) => candidate.properties['org.eclipse.elk.port.side'] === peerSide);
      const sideIndex = Math.max(0, sameSidePorts.findIndex((candidate) => candidate.id === peerElkPort?.id));
      const verticalGap = diagramSizing.gridSize * (peerSide === 'NORTH' ? 3 + sideIndex * 2 : 2 + sideIndex * 2);
      positions.set(node.id, {
        x: snapToGrid(peerPosition.x + peerOffset.x - ownOffset.x - ownLeadOffset),
        y: snapToGrid(
          peerSide === 'NORTH'
            ? peerPosition.y - ownOffset.y - verticalGap
            : peerPosition.y + peerOffset.y + verticalGap,
          node.kind
        )
      });
      continue;
    }

    positions.set(node.id, {
      ...nodePosition,
      y: snapToGrid(peerPosition.y + peerOffset.y - ownOffset.y, node.kind)
    });
  }
}

function canAlignSimpleLeafToPeer(node: DiagramNode, portId?: string): boolean {
  const elkNode = elkNodeForDiagramNode(node, false);
  const port = elkNode.ports.find((candidate) => candidate.id === endpointId(node.id, portId));
  const side = port?.properties['org.eclipse.elk.port.side'] as ElkPortSide | undefined;
  if (!side || (side !== 'WEST' && side !== 'EAST')) {
    return false;
  }

  return elkNode.ports.filter((candidate) => candidate.properties['org.eclipse.elk.port.side'] === side).length === 1;
}

function enforceMinimumBlockGaps(
  nodes: DiagramNode[],
  positions: Map<string, { x: number; y: number }>,
  moduleLayout: SavedModuleLayout
): void {
  const blocks = nodes.filter((node) => isBlockSpacingNode(node) && !moduleLayout.nodes[node.id]?.fixed);
  const dimensions = new Map(blocks.map((node) => [node.id, diagramNodeDimensions(node)]));
  const minGap = diagramSizing.gridSize;

  for (let pass = 0; pass < blocks.length; pass++) {
    let moved = false;
    const ordered = [...blocks].sort((a, b) => (positions.get(a.id)?.y ?? 0) - (positions.get(b.id)?.y ?? 0));

    for (let i = 1; i < ordered.length; i++) {
      const node = ordered[i];
      const pos = positions.get(node.id);
      const size = dimensions.get(node.id);
      if (!pos || !size) continue;

      let requiredY = pos.y;
      for (let j = 0; j < i; j++) {
        const previous = ordered[j];
        const prevPos = positions.get(previous.id);
        const prevSize = dimensions.get(previous.id);
        if (!prevPos || !prevSize || !horizontallyOverlaps(pos, size, prevPos, prevSize)) continue;

        const gap = requiredY - (prevPos.y + prevSize.height);
        if (gap < minGap) {
          requiredY = prevPos.y + prevSize.height + minGap;
        }
      }

      if (requiredY > pos.y) {
        positions.set(node.id, { ...pos, y: snapToGrid(requiredY, node.kind, structRole(node)) });
        moved = true;
      }
    }

    if (!moved) break;
  }
}

function isBlockSpacingNode(node: DiagramNode): boolean {
  return node.kind !== 'port' && node.kind !== 'literal' && node.kind !== 'replicate';
}

function horizontallyOverlaps(
  aPos: { x: number; y: number },
  aSize: { width: number; height: number },
  bPos: { x: number; y: number },
  bSize: { width: number; height: number }
): boolean {
  return aPos.x < bPos.x + bSize.width && bPos.x < aPos.x + aSize.width;
}

function genericNodePortTop(node: DiagramNode): number {
  return diagramSizing.nodeHeaderHeight + diagramSizing.gridSize * instanceParameterRows(node);
}

export function renderedPortGeometry(
  node: DiagramNode,
  portId?: string,
  includeLeadMargins = false
): { offset: { x: number; y: number }; side: ElkPortSide } | undefined {
  const elkNode = elkNodeForDiagramNode(node, includeLeadMargins);
  const port = elkNode.ports.find((candidate) => candidate.id === endpointId(node.id, portId));
  if (!port || port.x === undefined || port.y === undefined) {
    return undefined;
  }
  return {
    offset: {
      x: port.x - elkNode.layoutOffset.x,
      y: port.y - elkNode.layoutOffset.y
    },
    side: (port.properties['org.eclipse.elk.port.side'] ?? 'EAST') as ElkPortSide
  };
}

export function renderedPortOffset(node: DiagramNode, portId?: string): { x: number; y: number } | undefined {
  const elkNode = elkNodeForDiagramNode(node, false);
  const port = elkNode.ports.find((candidate) => candidate.id === endpointId(node.id, portId));
  if (!port || port.x === undefined || port.y === undefined) {
    return undefined;
  }
  return { x: port.x, y: port.y };
}

function routeWithRenderedLeads(
  edge: DiagramEdge,
  route: Array<{ x: number; y: number }>,
  nodesById: Map<string, DiagramNode>,
  nodePositions: Map<string, { x: number; y: number }>
): Array<{ x: number; y: number }> {
  const sourceLead = renderedLeadPoint(edge.source, edge.sourcePort, nodesById, nodePositions);
  const targetLead = renderedLeadPoint(edge.target, edge.targetPort, nodesById, nodePositions);
  if (!sourceLead || !targetLead) {
    return route;
  }

  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  const isSimpleVerticalFeed = (
    (sourceNode?.kind === 'port' && (targetLead.side === 'NORTH' || targetLead.side === 'SOUTH'))
    || (targetNode?.kind === 'port' && (sourceLead.side === 'NORTH' || sourceLead.side === 'SOUTH'))
  );
  if (isSimpleVerticalFeed) {
    const sourceHandle = renderedLeadPoint(edge.source, edge.sourcePort, nodesById, nodePositions, false);
    const targetHandle = renderedLeadPoint(edge.target, edge.targetPort, nodesById, nodePositions, false);
    if (sourceHandle && targetHandle) {
      return directLeadRoute(insetVerticalBoundaryLead(sourceHandle, sourceNode?.kind === 'port'), insetVerticalBoundaryLead(targetHandle, targetNode?.kind === 'port'));
    }
  }

  const internal = route.slice(1, -1);
  if (internal.length === 0) {
    return repairForwardHorizontalRoute(
      directLeadRoute(sourceLead, targetLead),
      sourceLead,
      targetLead,
      nodesById,
      nodePositions
    );
  }

  const points = [sourceLead.point];
  const first = internal[0];
  const sourceConnector = leadExtensionConnector(sourceLead.point, first, sourceLead.side);
  if (sourceConnector) {
    points.push(sourceConnector);
  }
  points.push(...internal);

  const last = internal[internal.length - 1];
  const targetConnector = leadExtensionConnector(targetLead.point, last, targetLead.side);
  if (targetConnector) {
    points.push(targetConnector);
  }
  points.push(targetLead.point);

  return repairForwardHorizontalRoute(
    removeRedundantRoutePoints(makeOrthogonalRoute(points)),
    sourceLead,
    targetLead,
    nodesById,
    nodePositions
  );
}

function insetVerticalBoundaryLead(
  lead: { point: { x: number; y: number }; side: ElkPortSide },
  isPortNode: boolean
): { point: { x: number; y: number }; side: ElkPortSide } {
  if (isPortNode || (lead.side !== 'NORTH' && lead.side !== 'SOUTH')) {
    return lead;
  }

  return {
    ...lead,
    point: {
      x: lead.point.x,
      y: lead.point.y + (lead.side === 'NORTH' ? diagramSizing.gridSize / 2 : -diagramSizing.gridSize / 2)
    }
  };
}

function directRenderedLeadRoute(
  edge: DiagramEdge,
  nodesById: Map<string, DiagramNode>,
  nodePositions: Map<string, { x: number; y: number }>
): Array<{ x: number; y: number }> | undefined {
  const sourceLead = renderedLeadPoint(edge.source, edge.sourcePort, nodesById, nodePositions);
  const targetLead = renderedLeadPoint(edge.target, edge.targetPort, nodesById, nodePositions);
  if (!sourceLead || !targetLead) {
    return undefined;
  }
  return directLeadRoute(sourceLead, targetLead);
}

function directLeadRoute(
  sourceLead: { point: { x: number; y: number }; side: ElkPortSide },
  targetLead: { point: { x: number; y: number }; side: ElkPortSide }
): Array<{ x: number; y: number }> {
  const sourceSideIsHorizontal = sourceLead.side === 'EAST' || sourceLead.side === 'WEST';
  const targetSideIsHorizontal = targetLead.side === 'EAST' || targetLead.side === 'WEST';
  if (sourceSideIsHorizontal && targetSideIsHorizontal && sourceLead.point.y !== targetLead.point.y) {
    const midX = snapToGrid((sourceLead.point.x + targetLead.point.x) / 2);
    return removeRedundantRoutePoints(makeOrthogonalRoute([
      sourceLead.point,
      { x: midX, y: sourceLead.point.y },
      { x: midX, y: targetLead.point.y },
      targetLead.point
    ]));
  }

  const sourceSideIsVertical = sourceLead.side === 'NORTH' || sourceLead.side === 'SOUTH';
  const targetSideIsVertical = targetLead.side === 'NORTH' || targetLead.side === 'SOUTH';
  if (sourceSideIsVertical && targetSideIsVertical && sourceLead.point.x !== targetLead.point.x) {
    const midY = snapToGrid((sourceLead.point.y + targetLead.point.y) / 2);
    return removeRedundantRoutePoints(makeOrthogonalRoute([
      sourceLead.point,
      { x: sourceLead.point.x, y: midY },
      { x: targetLead.point.x, y: midY },
      targetLead.point
    ]));
  }

  return removeRedundantRoutePoints(makeOrthogonalRoute([sourceLead.point, targetLead.point]));
}

function repairForwardHorizontalRoute(
  route: Array<{ x: number; y: number }>,
  sourceLead: { point: { x: number; y: number }; side: ElkPortSide },
  targetLead: { point: { x: number; y: number }; side: ElkPortSide },
  nodesById: Map<string, DiagramNode>,
  nodePositions: Map<string, { x: number; y: number }>
): Array<{ x: number; y: number }> {
  const direction = forwardHorizontalDirection(sourceLead, targetLead);
  if (!direction) {
    return route;
  }

  if (!routeIntersectsNodeInterior(route, nodesById, nodePositions)) {
    return route;
  }

  const candidates = forwardHorizontalCandidates(sourceLead.point, targetLead.point, direction, nodesById, nodePositions);
  return candidates.find((candidate) => !routeIntersectsNodeInterior(candidate, nodesById, nodePositions)) ?? route;
}

function repairSourceStems(
  edges: DiagramEdge[],
  routes: Map<string, Array<{ x: number; y: number }>>,
  nodesById: Map<string, DiagramNode>,
  nodePositions: Map<string, { x: number; y: number }>
): void {
  for (const edge of edges) {
    const route = routes.get(edge.id);
    const sourceLead = renderedLeadPoint(edge.source, edge.sourcePort, nodesById, nodePositions);
    const targetLead = renderedLeadPoint(edge.target, edge.targetPort, nodesById, nodePositions);
    if (!route || !sourceLead || !targetLead) {
      continue;
    }

    const repaired = repairSourceStem(route, sourceLead, targetLead, nodesById, nodePositions);
    if (repaired) {
      routes.set(edge.id, repaired);
    }
  }
}

function repairSourceStem(
  route: Array<{ x: number; y: number }>,
  sourceLead: { point: { x: number; y: number }; side: ElkPortSide },
  targetLead: { point: { x: number; y: number }; side: ElkPortSide },
  nodesById: Map<string, DiagramNode>,
  nodePositions: Map<string, { x: number; y: number }>
): Array<{ x: number; y: number }> | undefined {
  const direction = forwardHorizontalDirection(sourceLead, targetLead);
  if (!direction || route.length < 3) {
    return undefined;
  }

  const source = sourceLead.point;
  if (!pointsEqual(route[0], source)) {
    return undefined;
  }

  const deduped = removeConsecutiveDuplicatePoints(route);
  if (deduped.length < 3 || !pointsEqual(deduped[0], source)) {
    return undefined;
  }

  const first = deduped[1];
  if (first.x !== source.x || first.y === source.y) {
    return undefined;
  }

  const stemX = source.x + direction * diagramSizing.gridSize * 2;
  if ((direction > 0 && stemX >= targetLead.point.x) || (direction < 0 && stemX <= targetLead.point.x)) {
    return undefined;
  }

  const candidate = removeRedundantRoutePoints(makeOrthogonalRoute([
    source,
    { x: stemX, y: source.y },
    ...deduped.slice(1).map((point) => point.x === source.x ? { ...point, x: stemX } : point)
  ]));

  return routeIntersectsNodeInterior(candidate, nodesById, nodePositions) ? undefined : candidate;
}

function forwardHorizontalDirection(
  sourceLead: { point: { x: number; y: number }; side: ElkPortSide },
  targetLead: { point: { x: number; y: number }; side: ElkPortSide }
): 1 | -1 | undefined {
  if (sourceLead.side === 'EAST' && targetLead.side === 'WEST' && sourceLead.point.x < targetLead.point.x) {
    return 1;
  }
  if (sourceLead.side === 'WEST' && targetLead.side === 'EAST' && sourceLead.point.x > targetLead.point.x) {
    return -1;
  }
  return undefined;
}

function forwardHorizontalCandidates(
  source: { x: number; y: number },
  target: { x: number; y: number },
  direction: 1 | -1,
  nodesById: Map<string, DiagramNode>,
  nodePositions: Map<string, { x: number; y: number }>
): Array<Array<{ x: number; y: number }>> {
  const candidateXs = uniqueNumbers([
    target.x,
    snapToGrid((source.x + target.x) / 2),
    source.x
  ]);
  const doglegs = candidateXs.map((x) => removeRedundantRoutePoints(makeOrthogonalRoute([
    source,
    { x, y: source.y },
    { x, y: target.y },
    target
  ])));

  const minX = Math.min(source.x, target.x);
  const maxX = Math.max(source.x, target.x);
  const obstacles = routeObstacles(nodesById, nodePositions)
    .filter((rect) => rect.x < maxX && rect.x + rect.width > minX);
  if (obstacles.length === 0) {
    return doglegs;
  }

  const turnX = source.x + direction * diagramSizing.gridSize;
  const laneYs = uniqueNumbers([
    snapToGrid(Math.max(...obstacles.map((rect) => rect.y + rect.height)) + diagramSizing.gridSize),
    snapToGrid(Math.min(...obstacles.map((rect) => rect.y)) - diagramSizing.gridSize)
  ]);
  const laneRoutes = laneYs
    .map((laneY) => removeRedundantRoutePoints(makeOrthogonalRoute([
      source,
      { x: turnX, y: source.y },
      { x: turnX, y: laneY },
      { x: target.x, y: laneY },
      target
    ])))
    .sort((a, b) => routeManhattanLength(a) - routeManhattanLength(b));

  return [...doglegs, ...laneRoutes];
}

function routeManhattanLength(route: Array<{ x: number; y: number }>): number {
  return route.slice(0, -1).reduce((total, point, index) => {
    const next = route[index + 1];
    return total + Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
  }, 0);
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values));
}

function routeIntersectsNodeInterior(
  route: Array<{ x: number; y: number }>,
  nodesById: Map<string, DiagramNode>,
  nodePositions: Map<string, { x: number; y: number }>
): boolean {
  const obstacles = routeObstacles(nodesById, nodePositions);
  return route.slice(0, -1).some((point, index) => {
    const next = route[index + 1];
    return obstacles.some((rect) => segmentIntersectsRectInterior(point, next, rect));
  });
}

function routeObstacles(
  nodesById: Map<string, DiagramNode>,
  nodePositions: Map<string, { x: number; y: number }>
): Array<{ x: number; y: number; width: number; height: number }> {
  const obstacles: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const [nodeId, node] of nodesById) {
    const position = nodePositions.get(nodeId);
    if (!position) {
      continue;
    }
    const dimensions = diagramNodeDimensions(node);
    obstacles.push({ ...position, ...dimensions });
  }
  return obstacles;
}

function segmentIntersectsRectInterior(
  start: { x: number; y: number },
  end: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  const epsilon = 0.5;
  if (start.y === end.y) {
    const y = start.y;
    if (y <= rect.y + epsilon || y >= rect.y + rect.height - epsilon) {
      return false;
    }
    return Math.min(start.x, end.x) < rect.x + rect.width - epsilon
      && Math.max(start.x, end.x) > rect.x + epsilon;
  }
  if (start.x === end.x) {
    const x = start.x;
    if (x <= rect.x + epsilon || x >= rect.x + rect.width - epsilon) {
      return false;
    }
    return Math.min(start.y, end.y) < rect.y + rect.height - epsilon
      && Math.max(start.y, end.y) > rect.y + epsilon;
  }
  return false;
}

export function renderedLeadPoint(
  nodeId: string,
  portId: string | undefined,
  nodesById: Map<string, DiagramNode>,
  nodePositions: Map<string, { x: number; y: number }>,
  includeLeadMargins = true
): { point: { x: number; y: number }; side: ElkPortSide } | undefined {
  const node = nodesById.get(nodeId);
  const position = nodePositions.get(nodeId);
  if (!node || !position) {
    return undefined;
  }

  const elkNode = elkNodeForDiagramNode(node, includeLeadMargins);
  const port = elkNode.ports.find((candidate) => candidate.id === endpointId(nodeId, portId));
  if (!port || port.x === undefined || port.y === undefined) {
    return undefined;
  }

  const side = (port.properties['org.eclipse.elk.port.side'] ?? 'EAST') as ElkPortSide;
  return {
    point: {
      x: position.x - elkNode.layoutOffset.x + port.x,
      y: position.y - elkNode.layoutOffset.y + port.y
    },
    side
  };
}

function leadExtensionConnector(
  lead: { x: number; y: number },
  next: { x: number; y: number },
  side: ElkPortSide
): { x: number; y: number } | undefined {
  if (side === 'EAST' || side === 'WEST') {
    if (lead.y === next.y) {
      return undefined;
    }
    const direction = side === 'EAST' ? 1 : -1;
    const nextIsOutward = direction > 0 ? next.x > lead.x : next.x < lead.x;
    return {
      x: nextIsOutward ? next.x : lead.x + direction * diagramSizing.gridSize,
      y: lead.y
    };
  }
  if (lead.x === next.x) {
    return undefined;
  }
  const direction = side === 'SOUTH' ? 1 : -1;
  const nextIsOutward = direction > 0 ? next.y > lead.y : next.y < lead.y;
  return {
    x: lead.x,
    y: nextIsOutward ? next.y : lead.y + direction * diagramSizing.gridSize
  };
}

function makeOrthogonalRoute(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length < 2) {
    return points;
  }

  const orthogonal = [{ ...points[0] }];
  for (const point of points.slice(1)) {
    const previous = orthogonal[orthogonal.length - 1];
    if (previous.x === point.x || previous.y === point.y) {
      orthogonal.push({ ...point });
    } else {
      orthogonal.push({ x: point.x, y: previous.y }, { ...point });
    }
  }
  return orthogonal;
}

function removeRedundantRoutePoints(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  return removeConsecutiveDuplicatePoints(points).filter((point, index, deduped) => {
    if (index === 0 || index === deduped.length - 1) {
      return true;
    }
    const previous = deduped[index - 1];
    const next = deduped[index + 1];
    return !(previous.x === point.x && point.x === next.x) && !(previous.y === point.y && point.y === next.y);
  });
}

function endpointId(nodeId: string, portId?: string): string {
  return endpointKey(nodeId, portId);
}

function netKey(edge: DiagramEdge): string {
  return edgeNetKey(edge);
}

function buildNodePlacementElkEdges(edges: DiagramEdge[], nodeIds: Set<string>): Array<{ id: string; sources: string[]; targets: string[] }> {
  return edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      sources: [endpointId(edge.source, edge.sourcePort)],
      targets: [endpointId(edge.target, edge.targetPort)]
    }));
}

function buildRoutingElkEdges(edges: DiagramEdge[], nodeIds: Set<string>): Array<{ id: string; sources: string[]; targets: string[] }> {
  const validEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const byNet = new Map<string, DiagramEdge[]>();
  for (const edge of validEdges) {
    const netEdges = byNet.get(netKey(edge)) ?? [];
    netEdges.push(edge);
    byNet.set(netKey(edge), netEdges);
  }

  const elkEdges: Array<{ id: string; sources: string[]; targets: string[] }> = [];
  for (const [key, netEdges] of byNet) {
    if (netEdges.length > 1) {
      elkEdges.push({
        id: `net:${key}`,
        sources: [endpointId(netEdges[0].source, netEdges[0].sourcePort)],
        targets: netEdges.map((edge) => endpointId(edge.target, edge.targetPort))
      });
    } else {
      const edge = netEdges[0];
      elkEdges.push({
        id: edge.id,
        sources: [endpointId(edge.source, edge.sourcePort)],
        targets: [endpointId(edge.target, edge.targetPort)]
      });
    }
  }
  return elkEdges;
}

type ElkEdgeWithSections = {
  id?: string;
  sources?: string[];
  targets?: string[];
  sections?: Array<{
    id?: string;
    startPoint?: { x: number; y: number };
    endPoint?: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
    incomingShape?: string;
    outgoingShape?: string;
    incomingSections?: string[];
    outgoingSections?: string[];
  }>;
};

function sectionPoints(section: NonNullable<ElkEdgeWithSections['sections']>[number]): Array<{ x: number; y: number }> {
  if (!section.startPoint || !section.endPoint) {
    return [];
  }
  return [
    section.startPoint,
    ...(section.bendPoints ?? []),
    section.endPoint
  ].map((point) => ({
    x: snapToGrid(point.x),
    y: snapToGrid(point.y)
  }));
}

function stitchSections(
  sections: NonNullable<ElkEdgeWithSections['sections']>,
  sourceEndpoint: string,
  targetEndpoint: string
): Array<{ x: number; y: number }> | undefined {
  const byId = new Map(sections.filter((section) => section.id).map((section) => [section.id!, section]));
  const targetSections = sections.filter((section) => section.outgoingShape === targetEndpoint);

  for (const targetSection of targetSections) {
    const chain = [targetSection];
    let current = targetSection;
    const seen = new Set<string>();

    while (current.incomingShape !== sourceEndpoint && current.incomingSections?.length) {
      const previousId = current.incomingSections[0];
      if (!previousId || seen.has(previousId)) {
        break;
      }
      seen.add(previousId);
      const previous = byId.get(previousId);
      if (!previous) {
        break;
      }
      chain.unshift(previous);
      current = previous;
    }

    if (chain[0].incomingShape !== sourceEndpoint) {
      continue;
    }

    const stitched: Array<{ x: number; y: number }> = [];
    for (const section of chain) {
      const points = sectionPoints(section);
      if (points.length === 0) {
        continue;
      }
      if (stitched.length > 0) {
        points.shift();
      }
      stitched.push(...points);
    }

    if (stitched.length >= 2) {
      return removeConsecutiveDuplicatePoints(stitched);
    }
  }

  return undefined;
}

function removeConsecutiveDuplicatePoints(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  return points.filter((point, index) => {
    if (index === 0) {
      return true;
    }
    const previous = points[index - 1];
    return !pointsEqual(previous, point);
  });
}

function pointsEqual(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

export function projectElkRoutes(
  elkEdges: ElkEdgeWithSections[],
  diagramEdges: DiagramEdge[]
): Map<string, Array<{ x: number; y: number }>> {
  const byNet = new Map<string, DiagramEdge[]>();
  for (const edge of diagramEdges) {
    const netEdges = byNet.get(netKey(edge)) ?? [];
    netEdges.push(edge);
    byNet.set(netKey(edge), netEdges);
  }

  const routes = new Map<string, Array<{ x: number; y: number }>>();
  for (const elkEdge of elkEdges) {
    if (!elkEdge.id || !elkEdge.sections?.length) {
      continue;
    }

    const candidates = elkEdge.id.startsWith('net:')
      ? byNet.get(elkEdge.id.slice('net:'.length)) ?? []
      : diagramEdges.filter((edge) => edge.id === elkEdge.id);

    for (const edge of candidates) {
      const source = endpointId(edge.source, edge.sourcePort);
      const target = endpointId(edge.target, edge.targetPort);
      const route = stitchSections(elkEdge.sections, source, target);
      if (route && route.length >= 2) {
        routes.set(edge.id, route);
      }
    }
  }
  return routes;
}

export function defaultNetCutLabel(edge: DiagramEdge, designModule: DesignModule, moduleLayout: SavedModuleLayout): string {
  const sourceNode = designModule.nodes.find((node) => node.id === edge.source);
  const sourcePort = sourceNode ? sourcePortForEdge(sourceNode, edge) : undefined;
  const sourcePortLabel = cleanVisualLabel(sourcePort?.label ?? sourcePort?.name ?? edge.sourcePort);

  if (sourceNode?.kind === 'port' && sourcePortLabel) {
    return sourcePortLabel;
  }

  if (sourceNode?.kind === 'instance') {
    const instanceLabel = cleanVisualLabel(sourceNode.label);
    if (instanceLabel && sourcePortLabel) {
      return `${instanceLabel}.${sourcePortLabel}`;
    }
  }

  if (sourceNode?.kind === 'register' || sourceNode?.kind === 'latch') {
    const label = cleanVisualLabel(sourceNode.label) ?? cleanVisualLabel(sourcePort?.connectedSignal);
    if (label) {
      return label;
    }
  }

  if (sourceNode?.kind === 'bus' || sourceNode?.kind === 'struct' || sourceNode?.kind === 'interface') {
    const label = cleanVisualLabel(edge.signal) ?? cleanVisualLabel(sourcePort?.connectedSignal) ?? cleanVisualLabel(sourceNode.label);
    if (label) {
      return label;
    }
  }

  return allocateNetLabel(moduleLayout);
}

export function mergeNetCut(
  layout: SavedLayout,
  moduleName: string,
  edge: DiagramEdge,
  designModule: DesignModule,
  nodes: PositionedNode[]
): SavedLayout {
  const netKey = edgeNetKey(edge);
  const existing = layout.modules[moduleName] ?? { nodes: {} };
  if (existing.netCuts?.[netKey]) {
    return layout;
  }

  const frozenNodes = nodes.map((node) => ({
    ...node,
    fixed: true
  }));
  const next = mergeNodePositions(layout, moduleName, frozenNodes);
  const nextModule = next.modules[moduleName] ?? { nodes: {} };
  next.modules[moduleName] = {
    ...nextModule,
    netCuts: {
      ...(nextModule.netCuts ?? {}),
      [netKey]: {
        label: defaultNetCutLabel(edge, designModule, nextModule),
        source: {
          nodeId: edge.source,
          ...(edge.sourcePort ? { portId: edge.sourcePort } : {})
        }
      }
    }
  };

  return next;
}

export function renameCutNet(layout: SavedLayout, moduleName: string, netKey: string, label: string): SavedLayout {
  const trimmed = label.trim();
  if (!trimmed) {
    return layout;
  }

  const existing = layout.modules[moduleName];
  const cut = existing?.netCuts?.[netKey];
  if (!existing || !cut) {
    return layout;
  }

  return {
    version: 1,
    modules: {
      ...layout.modules,
      [moduleName]: {
        ...existing,
        netCuts: {
          ...(existing.netCuts ?? {}),
          [netKey]: {
            ...cut,
            label: trimmed
          }
        }
      }
    }
  };
}

export function removeNetCut(layout: SavedLayout, moduleName: string, netKey: string): SavedLayout {
  const existing = layout.modules[moduleName];
  if (!existing?.netCuts?.[netKey]) {
    return layout;
  }

  const netCuts = { ...(existing.netCuts ?? {}) };
  delete netCuts[netKey];

  const sourceLabelId = cutLabelNodeId(netKey, 'source');
  const sinkLabelPrefix = cutLabelNodeId(netKey, 'sink');
  const sourceStubId = cutStubEdgeId(netKey, 'source');
  const sinkStubPrefix = cutStubEdgeId(netKey, 'sink');

  const nodes = Object.fromEntries(Object.entries(existing.nodes).filter(([id]) => (
    id !== sourceLabelId && !id.startsWith(sinkLabelPrefix)
  )));
  const edges = existing.edges
    ? Object.fromEntries(Object.entries(existing.edges).filter(([id]) => (
      id !== sourceStubId && !id.startsWith(sinkStubPrefix)
    )))
    : undefined;

  return {
    version: 1,
    modules: {
      ...layout.modules,
      [moduleName]: {
        ...existing,
        nodes,
        ...(Object.keys(netCuts).length > 0 ? { netCuts } : { netCuts: undefined }),
        ...(edges && Object.keys(edges).length > 0 ? { edges } : { edges: undefined })
      }
    }
  };
}

function sourcePortForEdge(node: DiagramNode, edge: DiagramEdge): DiagramNode['ports'][number] | undefined {
  return node.ports.find((port) => port.id === edge.sourcePort)
    ?? node.ports.find((port) => port.name === edge.sourcePort)
    ?? node.ports.find((port) => port.direction === 'output')
    ?? node.ports[0];
}

function cleanVisualLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function allocateNetLabel(moduleLayout: SavedModuleLayout): string {
  const used = new Set(Object.values(moduleLayout.netCuts ?? {}).map((cut) => cut.label.trim()));
  for (let index = 1; ; index += 1) {
    const candidate = `NET_${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

export function mergeNodePositions(layout: SavedLayout, moduleName: string, nodes: PositionedNode[]): SavedLayout {
  const next: SavedLayout = {
    version: 1,
    modules: { ...layout.modules }
  };
  const existing: SavedModuleLayout = next.modules[moduleName] ?? { nodes: {} };
  const activeIds = new Set(nodes.map((node) => node.id));
  const mergedNodes: SavedModuleLayout['nodes'] = {};

  for (const [id, value] of Object.entries(existing.nodes)) {
    if (!activeIds.has(id) && value.fixed) {
      mergedNodes[id] = { ...value, stale: true };
    }
  }

  for (const node of nodes) {
    const isFixed = node.fixed || existing.nodes[node.id]?.fixed;
    if (isFixed) {
      mergedNodes[node.id] = {
        ...snapPosition(node.position, node.kind, structRole(node)),
        fixed: true
      };
    }
  }

  next.modules[moduleName] = {
    ...existing,
    nodes: mergedNodes
  };
  return next;
}

export function mergeRerouteLayout(layout: SavedLayout, moduleName: string, nodes: PositionedNode[]): SavedLayout {
  const fixedNodes = nodes.map((node) => ({
    ...node,
    fixed: true
  }));
  const next = mergeNodePositions(layout, moduleName, fixedNodes);
  const existing = next.modules[moduleName] ?? { nodes: {} };
  const { edges: _edges, ...withoutEdges } = existing;

  next.modules[moduleName] = withoutEdges;
  return next;
}

export function mergeRerouteSingleEdge(layout: SavedLayout, moduleName: string, edgeId: string, nodes: PositionedNode[]): SavedLayout {
  const fixedNodes = nodes.map((node) => ({
    ...node,
    fixed: true
  }));
  const next = mergeNodePositions(layout, moduleName, fixedNodes);
  const existing = next.modules[moduleName] ?? { nodes: {} };
  const { [edgeId]: _removed, ...remainingEdges } = existing.edges ?? {};

  next.modules[moduleName] = {
    ...existing,
    edges: Object.keys(remainingEdges).length > 0 ? remainingEdges : undefined
  };
  return next;
}

export function mergeEdgeWaypoint(
  layout: SavedLayout,
  moduleName: string,
  edgeId: string,
  waypoint: { x: number; y: number }
): SavedLayout {
  const next: SavedLayout = {
    version: 1,
    modules: { ...layout.modules }
  };
  const existing: SavedModuleLayout = next.modules[moduleName] ?? { nodes: {} };
  next.modules[moduleName] = {
    ...existing,
    edges: {
      ...(existing.edges ?? {}),
      [edgeId]: {
        waypoint: {
          x: Math.round(waypoint.x),
          y: Math.round(waypoint.y)
        }
      }
    }
  };
  return next;
}

export function mergeEdgeRoutePoints(
  layout: SavedLayout,
  moduleName: string,
  edgeId: string,
  routePoints: Array<{ x: number; y: number }>
): SavedLayout {
  const next: SavedLayout = {
    version: 1,
    modules: { ...layout.modules }
  };
  const existing: SavedModuleLayout = next.modules[moduleName] ?? { nodes: {} };
  next.modules[moduleName] = {
    ...existing,
    edges: {
      ...(existing.edges ?? {}),
      [edgeId]: {
        routePoints: routePoints.map((point) => ({
          x: Math.round(point.x),
          y: Math.round(point.y)
        }))
      }
    }
  };
  return next;
}

function defaultPosition(index: number, kind: string): { x: number; y: number } {
  const column = kind === 'port' ? 0 : 1 + (index % 3);
  const row = Math.floor(index / 3);
  return {
    x: column * diagramSizing.columnGap,
    y: row * diagramSizing.rowGap + (kind === 'port' ? 0 : diagramSizing.nodeHeight / 2)
  };
}

export const diagramNodeSize = {
  width: diagramSizing.nodeWidth,
  height: diagramSizing.nodeHeight,
  gridSize: diagramSizing.gridSize
};

function snapToGrid(value: number, kind?: string, role?: string): number {
  const grid = diagramSizing.gridSize;
  // port/literal nodes snap to half-grid (same formula as the webview snap formula).
  const isHalfGrid = kind === 'port' || kind === 'literal' || (kind === 'interface' && role === 'port');
  if (isHalfGrid) {
    return Math.round((value - grid / 2) / grid) * grid + grid / 2;
  }
  return Math.round(value / grid) * grid;
}

function snapPosition(position: { x: number; y: number }, kind?: string, role?: string): { x: number; y: number } {
  return {
    x: snapToGrid(position.x),
    y: snapToGrid(position.y, kind, role)
  };
}
