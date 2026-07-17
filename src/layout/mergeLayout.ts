import type { DesignGraph, DesignModule, DiagramEdge, DiagramNode, DiagramViewModel, GenerateRegion, PositionedGenerateRegion, PositionedNode } from '../ir/types';
import { nodeIsArrayNode, registerClockSignal, registerResetSignal, structRole } from '../ir/nodeMetadata';
import { edgeNetKey, endpointKey } from '../ir/edgeNet';
import type { SavedLayout, SavedModuleLayout, SavedNetCut } from '../storage/layoutStore';
import { diagramSizing } from '../diagram/constants';
import { diagramNodeDimensions, instanceParameterRows, inverterGeometryWidth } from '../diagram/nodeSizing';
import {
  annotateGenerateRegionWarnings,
  findExternalBlockIds,
  GENERATE_REGION_EXTERNAL_BLOCK_WARNING
} from './generateRegionValidation';
import {
  interfaceSidePortCenters,
  interfaceTopHatHeight,
  interfaceTopHatTop,
  interfaceTopPortX
} from '../diagram/interfaceGeometry';
import { routeDiagramWithLibavoid, selectLibavoidRoutesAgainstFallbacks } from './libavoidRouter';
import { routingObstacleMargins } from './routingObstacleGeometry';

interface AutoLayoutResult {
  positions: Map<string, { x: number; y: number }>;
  routes: Map<string, Array<{ x: number; y: number }>>;
  regionBounds: Map<string, RegionBounds>;
}

export type ElkPortSide = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

export interface ElkDiagramNode {
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

interface ElkLayoutNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  ports?: ElkDiagramNode['ports'];
  children?: ElkLayoutNode[];
  layoutOptions?: Record<string, string>;
  properties?: Record<string, string>;
}

export async function buildViewModel(graph: DesignGraph, moduleName: string, layout: SavedLayout): Promise<DiagramViewModel> {
  const designModule = graph.modules[moduleName];
  if (!designModule) {
    return {
      moduleName,
      nodes: [],
      edges: [],
      generateRegions: [],
      diagnostics: graph.diagnostics
    };
  }

  const moduleLayout = layout.modules[designModule.name] ?? { nodes: {} };
  const activeCuts = activeNetCuts(designModule, moduleLayout);
  const activeCutKeys = new Set(activeCuts.keys());
  const routedDesignEdges = designModule.edges.filter((edge) => !activeCutKeys.has(edgeNetKey(edge)));
  const generateRegions = designModule.generateRegions ?? [];
  // The generate-block wrappers are derived from their arms, so keep them out of the ELK /
  // packing layout (arms fall back to roots) and only add their bounds in positionGenerateRegions.
  const armRegions = generateRegions.filter((region) => !region.isGenerateBlock);
  const elkLayout = await autoLayoutMissingNodes(designModule.nodes, routedDesignEdges, moduleLayout, armRegions);
  const initialPositioned = designModule.nodes.map((node, index): PositionedNode => {
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
  const packedGenerateLayout = elkLayout.regionBounds.size > 0
    ? { nodes: initialPositioned, movedNodeIds: new Set<string>() }
    : packGenerateRegionSiblings(armRegions, initialPositioned, moduleLayout);
  const positioned = packedGenerateLayout.nodes;
  const positionedRegions = positionGenerateRegions(generateRegions, positioned, moduleLayout, elkLayout.regionBounds);

  const externalBlockIds = findExternalBlockIds(positionedRegions, positioned);
  const positionedWithWarnings = externalBlockIds.size > 0
    ? positioned.map((node) => (externalBlockIds.has(node.id)
      ? { ...node, invalid: true, warningNote: GENERATE_REGION_EXTERNAL_BLOCK_WARNING }
      : node))
    : positioned;

  const libavoidRoutes = new Map<string, Array<{ x: number; y: number }>>();
  if (generateRegions.length === 0) {
    const nodesById = new Map<string, DiagramNode>(positionedWithWarnings.map((node) => [node.id, node]));
    const nodePositions = new Map(positionedWithWarnings.map((node) => [node.id, node.position]));
    const candidates = routedDesignEdges.filter((edge) => !moduleLayout.edges?.[edge.id]?.routePoints);
    const result = await routeDiagramWithLibavoid(
      positionedWithWarnings,
      candidates,
      (nodeId, portId, includeLeadMargins) => renderedLeadPoint(
        nodeId,
        portId,
        nodesById,
        nodePositions,
        includeLeadMargins
      )
    );
    const selectedRoutes = selectLibavoidRoutesAgainstFallbacks(candidates, result.routes, elkLayout.routes);
    for (const [edgeId, route] of selectedRoutes) libavoidRoutes.set(edgeId, route);
  }

  const cutProjection = buildNetCutProjection(designModule, moduleLayout, activeCuts, positioned);

  return {
    moduleName: designModule.name,
    parameters: designModule.parameters,
    nodes: [...positionedWithWarnings, ...cutProjection.nodes],
    edges: [
      ...routedDesignEdges.map((edge) => ({
        ...edge,
        waypoint: moduleLayout.edges?.[edge.id]?.waypoint,
        routePoints: moduleLayout.edges?.[edge.id]?.routePoints
          ?? libavoidRoutes.get(edge.id)
          ?? (edgeTouchesMovedNode(edge, packedGenerateLayout.movedNodeIds) ? undefined : elkLayout.routes.get(edge.id))
      })),
      ...cutProjection.edges
    ],
    generateRegions: positionedRegions,
    diagnostics: graph.diagnostics
  };
}

interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const REGION_INSET = diagramSizing.gridSize * 2;
const REGION_LABEL_BAND = diagramSizing.gridSize;
const REGION_TOP_INSET = REGION_INSET + REGION_LABEL_BAND;
const REGION_MIN_WIDTH = diagramSizing.gridSize * 8;
const REGION_MIN_HEIGHT = diagramSizing.gridSize * 5;
const REGION_GAP = diagramSizing.gridSize;

function packGenerateRegionSiblings(
  regions: GenerateRegion[],
  positionedNodes: PositionedNode[],
  moduleLayout: SavedModuleLayout
): { nodes: PositionedNode[]; movedNodeIds: Set<string> } {
  if (regions.length === 0) {
    return { nodes: positionedNodes, movedNodeIds: new Set() };
  }

  const nodes = positionedNodes.map((node) => ({ ...node, position: { ...node.position } }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const movedNodeIds = new Set<string>();
  const rootGroups = siblingGroupsByParent(regions);

  for (let pass = 0; pass < regions.length; pass += 1) {
    const positionedRegions = positionGenerateRegions(regions, nodes, moduleLayout);
    const positionedById = new Map(positionedRegions.map((region) => [region.id, region]));
    let shifted = false;

    for (const group of rootGroups) {
      let cursorY: number | undefined;
      for (const region of group) {
        const positioned = positionedById.get(region.id);
        if (!positioned) continue;

        if (cursorY !== undefined && positioned.bounds.y < cursorY && canAutoShiftRegion(region, regions, moduleLayout)) {
          const dy = Math.ceil((cursorY - positioned.bounds.y) / diagramSizing.gridSize) * diagramSizing.gridSize;
          if (dy > 0) {
            for (const nodeId of generateDescendantNodeIds(region, regions)) {
              const node = nodeById.get(nodeId);
              if (!node) continue;
              node.position = {
                x: node.position.x,
                y: snapToGrid(node.position.y + dy, node.kind, structRole(node))
              };
              movedNodeIds.add(node.id);
            }
            shifted = true;
          }
        }

        const shiftedRegion = shifted ? positionGenerateRegions(regions, nodes, moduleLayout).find((candidate) => candidate.id === region.id) : positioned;
        cursorY = Math.max(cursorY ?? Number.NEGATIVE_INFINITY, (shiftedRegion ?? positioned).bounds.y + (shiftedRegion ?? positioned).bounds.height + REGION_GAP);
      }
    }

    if (!shifted) break;
  }

  return { nodes, movedNodeIds };
}

function edgeTouchesMovedNode(edge: DiagramEdge, movedNodeIds: Set<string>): boolean {
  return movedNodeIds.has(edge.source) || movedNodeIds.has(edge.target);
}

function siblingGroupsByParent(regions: GenerateRegion[]): GenerateRegion[][] {
  const byId = new Map(regions.map((region) => [region.id, region]));
  const childrenByParent = new Map<string, GenerateRegion[]>();
  for (const region of [...regions].sort(compareGenerateRegions)) {
    const parent = region.parentRegionId && byId.has(region.parentRegionId) ? region.parentRegionId : '';
    const siblings = childrenByParent.get(parent) ?? [];
    siblings.push(region);
    childrenByParent.set(parent, siblings);
  }

  return Array.from(childrenByParent.values()).flatMap((children) => groupRegionsBySibling(children));
}

function canAutoShiftRegion(region: GenerateRegion, regions: GenerateRegion[], moduleLayout: SavedModuleLayout): boolean {
  if (moduleLayout.regions?.[region.id]?.fixed) return false;
  const nodeIds = generateDescendantNodeIds(region, regions);
  return nodeIds.length > 0 && nodeIds.every((nodeId) => !moduleLayout.nodes[nodeId]?.fixed);
}

function generateDescendantNodeIds(region: GenerateRegion, regions: GenerateRegion[]): string[] {
  const ids = new Set(region.nodeIds ?? []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of regions) {
      if (!candidate.parentRegionId) continue;
      if (ids.size === 0 && candidate.parentRegionId !== region.id) continue;
      let parent: string | undefined = candidate.parentRegionId;
      let isDescendant = parent === region.id;
      while (!isDescendant && parent) {
        const parentRegion = regions.find((item) => item.id === parent);
        parent = parentRegion?.parentRegionId;
        isDescendant = parent === region.id;
      }
      if (!isDescendant) continue;
      for (const nodeId of candidate.nodeIds ?? []) {
        if (!ids.has(nodeId)) {
          ids.add(nodeId);
          changed = true;
        }
      }
    }
  }
  return Array.from(ids);
}

function positionGenerateRegions(
  regions: GenerateRegion[],
  positionedNodes: PositionedNode[],
  moduleLayout: SavedModuleLayout,
  nativeRegionBounds: Map<string, RegionBounds> = new Map()
): PositionedGenerateRegion[] {
  if (regions.length === 0) return [];

  const sorted = [...regions].sort(compareGenerateRegions);
  const byId = new Map(sorted.map((region) => [region.id, region]));
  const childrenByParent = new Map<string, GenerateRegion[]>();
  for (const region of sorted) {
    const key = region.parentRegionId && byId.has(region.parentRegionId) ? region.parentRegionId : '';
    const children = childrenByParent.get(key) ?? [];
    children.push(region);
    childrenByParent.set(key, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort(compareGenerateRegions);
  }

  const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));
  const graphBounds = boundsForPositionedNodes(positionedNodes) ?? {
    x: 0,
    y: 0,
    width: diagramSizing.nodeWidth,
    height: diagramSizing.nodeHeight
  };

  if (nativeRegionBounds.size > 0) {
    const visualRegionBounds = computeVisualGenerateRegionBounds(sorted, childrenByParent, nodeById, graphBounds, nativeRegionBounds, moduleLayout.regions);
    const result = sorted.map((region, index): PositionedGenerateRegion => {
      const nodeIds = region.nodeIds ?? [];
      const fallbackBounds = boundsForRegionNodes(nodeIds, nodeById) ?? snapRegionBounds({
        x: graphBounds.x + graphBounds.width + diagramSizing.columnGap,
        y: graphBounds.y + index * (REGION_MIN_HEIGHT + REGION_GAP),
        width: REGION_MIN_WIDTH,
        height: REGION_MIN_HEIGHT
      });
      const saved = moduleLayout.regions?.[region.id];
      const autoBounds = visualRegionBounds.get(region.id) ?? snapRegionBounds(nativeRegionBounds.get(region.id) ?? fallbackBounds);
      const bounds = saved
        ? expandSavedRegionBounds(saved, autoBounds)
        : autoBounds;
      return {
        ...region,
        nodeIds,
        edgeIds: region.edgeIds,
        bounds,
        fixed: saved?.fixed,
        stale: saved?.stale
      };
    });

    return annotateGenerateRegionWarnings(result, positionedNodes);
  }

  const computed = new Map<string, PositionedGenerateRegion>();
  const rootGroups = groupRegionsBySibling(childrenByParent.get('') ?? []);
  let rootX = snapToGrid(graphBounds.x + graphBounds.width + diagramSizing.columnGap);
  const rootY = snapToGrid(graphBounds.y);

  for (const group of rootGroups) {
    let cursorY = rootY;
    let groupWidth = REGION_MIN_WIDTH;
    for (const region of group) {
      const positioned = layoutRegion(region, rootX, cursorY);
      computed.set(region.id, positioned);
      cursorY = positioned.bounds.y + positioned.bounds.height + REGION_GAP;
      groupWidth = Math.max(groupWidth, positioned.bounds.width);
    }
    rootX += groupWidth + REGION_GAP * 2;
  }

  const result = sorted
    .map((region) => computed.get(region.id))
    .filter((region): region is PositionedGenerateRegion => region !== undefined);

  return annotateGenerateRegionWarnings(result, positionedNodes);

  function layoutRegion(region: GenerateRegion, x: number, y: number): PositionedGenerateRegion {
    const existing = computed.get(region.id);
    if (existing) return existing;

    const nodeIds = region.nodeIds ?? [];
    const tightNodeBounds = tightBoundsForRegionNodes(nodeIds, nodeById);

    // Lay out child regions first — arms position themselves by their own nodes, so a
    // wrapper (no direct nodes) hugs the union of its children rather than a fallback slot.
    const childGroups = groupRegionsBySibling(childrenByParent.get(region.id) ?? []);
    const childRects: RegionBounds[] = [];
    const stackX = (tightNodeBounds?.x ?? x) + REGION_INSET;
    let stackCursorY = (tightNodeBounds?.y ?? y) + REGION_INSET;
    for (const group of childGroups) {
      let groupCursorY = stackCursorY;
      for (const child of group) {
        const childRegion = layoutRegion(child, stackX, groupCursorY);
        computed.set(child.id, childRegion);
        childRects.push(childRegion.bounds);
        groupCursorY = childRegion.bounds.y + childRegion.bounds.height + REGION_GAP;
      }
      stackCursorY = groupCursorY;
    }

    const contentRects: RegionBounds[] = [];
    if (tightNodeBounds) contentRects.push(tightNodeBounds);
    contentRects.push(...childRects);
    const contentBounds: RegionBounds = contentRects.length > 0
      ? expandRegionContentBounds(unionBounds(contentRects))
      : snapRegionBounds({ x, y, width: REGION_MIN_WIDTH, height: REGION_MIN_HEIGHT });

    const saved = moduleLayout.regions?.[region.id];
    const autoBounds = snapRegionBounds(contentBounds);
    const bounds = saved
      ? expandSavedRegionBounds(saved, autoBounds)
      : autoBounds;

    const positioned: PositionedGenerateRegion = {
      ...region,
      nodeIds,
      edgeIds: region.edgeIds,
      bounds,
      fixed: saved?.fixed,
      stale: saved?.stale
    };
    computed.set(region.id, positioned);
    return positioned;
  }
}

function compareGenerateRegions(a: GenerateRegion, b: GenerateRegion): number {
  if ((a.siblingGroupId || a.id) === (b.siblingGroupId || b.id)) {
    const aArm = a.armIndex ?? Number.MAX_SAFE_INTEGER;
    const bArm = b.armIndex ?? Number.MAX_SAFE_INTEGER;
    if (aArm !== bArm) return aArm - bArm;
  }

  const aLine = a.source?.startLine ?? a.bodySource?.startLine ?? Number.MAX_SAFE_INTEGER;
  const bLine = b.source?.startLine ?? b.bodySource?.startLine ?? Number.MAX_SAFE_INTEGER;
  if (aLine !== bLine) return aLine - bLine;
  const aCol = a.source?.startColumn ?? a.bodySource?.startColumn ?? 0;
  const bCol = b.source?.startColumn ?? b.bodySource?.startColumn ?? 0;
  if (aCol !== bCol) return aCol - bCol;
  return (a.armIndex ?? 0) - (b.armIndex ?? 0) || a.id.localeCompare(b.id);
}

function groupRegionsBySibling(regions: GenerateRegion[]): GenerateRegion[][] {
  const groups: GenerateRegion[][] = [];
  const groupById = new Map<string, GenerateRegion[]>();
  for (const region of regions) {
    const key = region.siblingGroupId || region.id;
    let group = groupById.get(key);
    if (!group) {
      group = [];
      groupById.set(key, group);
      groups.push(group);
    }
    group.push(region);
  }
  for (const group of groups) {
    group.sort(compareGenerateRegions);
  }
  return groups;
}

function computeVisualGenerateRegionBounds(
  sortedRegions: GenerateRegion[],
  childrenByParent: Map<string, GenerateRegion[]>,
  nodeById: Map<string, PositionedNode>,
  graphBounds: RegionBounds,
  nativeRegionBounds: Map<string, RegionBounds>,
  savedRegions: SavedModuleLayout['regions']
): Map<string, RegionBounds> {
  const computed = new Map<string, RegionBounds>();

  const compute = (region: GenerateRegion, index: number): RegionBounds => {
    const existing = computed.get(region.id);
    if (existing) return existing;

    const contentBounds: RegionBounds[] = [];
    const nodeBounds = tightBoundsForRegionNodes(region.nodeIds ?? [], nodeById);
    if (nodeBounds) {
      contentBounds.push(nodeBounds);
    }
    for (const child of childrenByParent.get(region.id) ?? []) {
      contentBounds.push(compute(child, index));
    }

    const autoBounds = contentBounds.length > 0
      ? expandRegionContentBounds(unionBounds(contentBounds))
      : snapRegionBounds(nativeRegionBounds.get(region.id) ?? {
        x: graphBounds.x + graphBounds.width + diagramSizing.columnGap,
        y: graphBounds.y + index * (REGION_MIN_HEIGHT + REGION_GAP),
        width: REGION_MIN_WIDTH,
        height: REGION_MIN_HEIGHT
      });
    // Fold in a resized/moved region's saved bounds so a parent (e.g. a generate block)
    // grows to keep surrounding an arm that the user has enlarged past its auto size.
    const saved = savedRegions?.[region.id];
    const bounds = saved ? expandSavedRegionBounds(saved, autoBounds) : autoBounds;
    computed.set(region.id, bounds);
    return bounds;
  };

  sortedRegions.forEach((region, index) => compute(region, index));
  return computed;
}

function boundsForRegionNodes(nodeIds: string[], nodeById: Map<string, PositionedNode>): RegionBounds | undefined {
  const bounds = tightBoundsForRegionNodes(nodeIds, nodeById);
  return bounds ? expandRegionContentBounds(bounds) : undefined;
}

function tightBoundsForRegionNodes(nodeIds: string[], nodeById: Map<string, PositionedNode>): RegionBounds | undefined {
  const bounds: RegionBounds = {
    x: Number.POSITIVE_INFINITY,
    y: Number.POSITIVE_INFINITY,
    width: 0,
    height: 0
  };
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const nodeId of nodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const size = diagramNodeDimensions(node);
    bounds.x = Math.min(bounds.x, node.position.x);
    bounds.y = Math.min(bounds.y, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }

  if (!Number.isFinite(bounds.x)) return undefined;

  return {
    x: bounds.x,
    y: bounds.y,
    width: maxX - bounds.x,
    height: maxY - bounds.y
  };
}

function expandRegionContentBounds(bounds: RegionBounds): RegionBounds {
  return snapRegionBounds({
    x: bounds.x - REGION_INSET,
    y: bounds.y - REGION_INSET,
    width: bounds.width + REGION_INSET * 2,
    height: bounds.height + REGION_INSET * 2
  });
}

function boundsForPositionedNodes(nodes: PositionedNode[]): RegionBounds | undefined {
  if (nodes.length === 0) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const size = diagramNodeDimensions(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function unionBounds(boundsList: RegionBounds[]): RegionBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const bounds of boundsList) {
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function snapRegionBounds(bounds: RegionBounds): RegionBounds {
  const x = Math.floor(bounds.x / diagramSizing.gridSize) * diagramSizing.gridSize;
  const y = Math.floor(bounds.y / diagramSizing.gridSize) * diagramSizing.gridSize;
  const right = Math.ceil((bounds.x + Math.max(REGION_MIN_WIDTH, bounds.width)) / diagramSizing.gridSize) * diagramSizing.gridSize;
  const bottom = Math.ceil((bounds.y + Math.max(REGION_MIN_HEIGHT, bounds.height)) / diagramSizing.gridSize) * diagramSizing.gridSize;
  return {
    x,
    y,
    width: Math.max(REGION_MIN_WIDTH, right - x),
    height: Math.max(REGION_MIN_HEIGHT, bottom - y)
  };
}

function expandSavedRegionBounds(saved: RegionBounds, autoBounds: RegionBounds): RegionBounds {
  const minX = Math.min(saved.x, autoBounds.x);
  const minY = Math.min(saved.y, autoBounds.y);
  const maxX = Math.max(saved.x + saved.width, autoBounds.x + autoBounds.width);
  const maxY = Math.max(saved.y + saved.height, autoBounds.y + autoBounds.height);
  return snapRegionBounds({
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  });
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
  moduleLayout: SavedModuleLayout,
  generateRegions: GenerateRegion[] = []
): Promise<AutoLayoutResult> {
  const positions = new Map<string, { x: number; y: number }>();
  const routes = new Map<string, Array<{ x: number; y: number }>>();
  const regionBounds = new Map<string, RegionBounds>();
  const routePositions = new Map<string, { x: number; y: number }>();
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodes.length === 0 && generateRegions.length === 0) {
    return { positions, routes, regionBounds };
  }

  try {
    const elkModule = await import('elkjs/lib/elk.bundled.js');
    const Elk = elkModule.default;
    const elk = new Elk();
    const useCompoundGenerateLayout = canUseCompoundGenerateLayout(generateRegions, moduleLayout);
    const graph = await elk.layout({
      id: 'root',
      layoutOptions: nodePlacementLayoutOptions(useCompoundGenerateLayout),
      children: useCompoundGenerateLayout
        ? buildGenerateCompoundElkChildren(nodes, generateRegions, moduleLayout, { includeLeadMargins: true })
        : nodes.map((node) => elkNodeForLayout(node, moduleLayout, {
          includeLeadMargins: true,
          useSavedPosition: true
        })),
      edges: buildNodePlacementElkEdges(edges, nodeIds)
    });

    if (useCompoundGenerateLayout) {
      collectElkPositionsAndRegionBounds(graph, nodes, positions, regionBounds);
    } else {
      for (const child of graph.children ?? []) {
        if (child.id && child.x !== undefined && child.y !== undefined) {
          const node = nodes.find((n) => n.id === child.id);
          const offset = node ? elkNodeForDiagramNode(node, true).layoutOffset : { x: 0, y: 0 };
          positions.set(child.id, snapPosition({ x: child.x + offset.x, y: child.y + offset.y }, node?.kind, node ? structRole(node) : undefined));
        }
      }
    }
    alignSimpleLeafNodes(nodes, edges, positions, moduleLayout);
    if (!useCompoundGenerateLayout) {
      enforceMinimumBlockGaps(nodes, positions, moduleLayout);
      alignSimpleLeafNodes(nodes, edges, positions, moduleLayout);
    }

    const fixedRoutePositions = new Map<string, { x: number; y: number }>();
    for (const [index, node] of nodes.entries()) {
      const saved = moduleLayout.nodes[node.id];
      const fallback = defaultPosition(index, node.kind);
      const position = saved?.fixed
        ? { x: saved.x, y: saved.y }
        : positions.get(node.id) ?? (saved ? { x: saved.x, y: saved.y } : undefined) ?? fallback;
      routePositions.set(node.id, position);
      fixedRoutePositions.set(node.id, position);
    }

    const routeLayoutOptions = routingLayoutOptions(useCompoundGenerateLayout);
    const routeChildren = useCompoundGenerateLayout
      ? buildGenerateCompoundElkChildren(nodes, generateRegions, moduleLayout, {
        includeLeadMargins: true,
        includeRoutingObstacleMargins: true,
        forceFixed: true,
        nodePositions: fixedRoutePositions,
        regionBounds
      })
      : nodes.map((node) => elkNodeForLayout(node, moduleLayout, {
        includeLeadMargins: true,
        includeRoutingObstacleMargins: true,
        forceFixed: true,
        nodePositions: fixedRoutePositions
      }));

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
    return { positions, routes, regionBounds };
  }

  return { positions, routes, regionBounds };
}

const GENERATE_REGION_ELK_ID_PREFIX = 'generate-region:';

function generateRegionElkId(regionId: string): string {
  return `${GENERATE_REGION_ELK_ID_PREFIX}${regionId}`;
}

function generateRegionIdFromElkId(elkId: string): string | undefined {
  return elkId.startsWith(GENERATE_REGION_ELK_ID_PREFIX)
    ? elkId.slice(GENERATE_REGION_ELK_ID_PREFIX.length)
    : undefined;
}

function canUseCompoundGenerateLayout(regions: GenerateRegion[], moduleLayout: SavedModuleLayout): boolean {
  if (regions.length === 0) return false;
  if (Object.values(moduleLayout.nodes).some((node) => node.fixed)) return false;
  if (Object.values(moduleLayout.regions ?? {}).some((region) => region.fixed)) return false;
  return true;
}

function nodePlacementLayoutOptions(useCompoundGenerateLayout: boolean): Record<string, string> {
  const rootPaddingTop = useCompoundGenerateLayout ? diagramSizing.gridSize * 3 : diagramSizing.gridSize;
  return {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': diagramSizing.sameLayerNodeSeparation.toString(),
    // Must stay a grid multiple: snapPosition() assumes grid-quantized raw
    // positions, and ELK's default component spacing (20) is not one, which
    // let adjacent disconnected nodes collapse to a 0px gap after snapping.
    'elk.spacing.componentComponent': diagramSizing.sameLayerNodeSeparation.toString(),
    'elk.layered.spacing.nodeNodeBetweenLayers': diagramSizing.minNodeSeparation.toString(),
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.interactive': 'true',
    'elk.layered.crossingMinimization.semiInteractive': 'true',
    'elk.layered.concentrateEdges': 'true',
    'elk.layered.improveHyperedgeRoutes': 'true',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.spacing.edgeNode': diagramSizing.gridSize.toString(),
    'elk.padding': `[top=${rootPaddingTop}, left=${diagramSizing.gridSize}, bottom=${diagramSizing.gridSize}, right=${diagramSizing.gridSize}]`,
    ...(useCompoundGenerateLayout ? compoundGenerateLayoutOptions() : {})
  };
}

function routingLayoutOptions(useCompoundGenerateLayout: boolean): Record<string, string> {
  const rootPaddingTop = useCompoundGenerateLayout ? diagramSizing.gridSize * 3 : diagramSizing.gridSize;
  return {
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
    'elk.padding': `[top=${rootPaddingTop}, left=${diagramSizing.gridSize}, bottom=${diagramSizing.gridSize}, right=${diagramSizing.gridSize}]`,
    ...(useCompoundGenerateLayout ? compoundGenerateLayoutOptions() : {})
  };
}

function compoundGenerateLayoutOptions(): Record<string, string> {
  return {
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
    'elk.layered.mergeHierarchyEdges': 'true'
  };
}

function generateRegionLayoutOptions(forceFixed: boolean): Record<string, string> {
  return {
    'elk.padding': `[top=${REGION_TOP_INSET}, left=${REGION_INSET}, bottom=${REGION_INSET}, right=${REGION_INSET}]`,
    'elk.nodeSize.constraints': 'MINIMUM_SIZE',
    'elk.nodeSize.minimum': `(${REGION_MIN_WIDTH},${REGION_MIN_HEIGHT})`,
    ...(forceFixed
      ? {
        'elk.position': 'FIXED',
        'org.eclipse.elk.position': 'FIXED'
      }
      : {})
  };
}

function generateRegionProperties(forceFixed: boolean): Record<string, string> {
  return forceFixed
    ? { 'org.eclipse.elk.position': 'FIXED' }
    : {};
}

function elkNodeForLayout(
  node: DiagramNode,
  moduleLayout: SavedModuleLayout,
  options: {
    includeLeadMargins: boolean;
    includeRoutingObstacleMargins?: boolean;
    useSavedPosition?: boolean;
    forceFixed?: boolean;
    nodePositions?: Map<string, { x: number; y: number }>;
    parentBounds?: RegionBounds;
  }
): ElkLayoutNode {
  const geometry = options.includeRoutingObstacleMargins
    ? elkRoutingNodeForDiagramNode(node)
    : elkNodeForDiagramNode(node, options.includeLeadMargins);
  const { layoutOffset, ...elkNode } = geometry;
  const saved = moduleLayout.nodes[node.id];
  const position = options.nodePositions?.get(node.id)
    ?? (options.useSavedPosition && saved ? { x: saved.x, y: saved.y } : undefined);
  const forceFixed = options.forceFixed || saved?.fixed === true;
  const parentX = options.parentBounds?.x ?? 0;
  const parentY = options.parentBounds?.y ?? 0;

  return {
    ...elkNode,
    properties: {
      ...elkNode.properties,
      ...(forceFixed
        ? {
          'org.eclipse.elk.position': 'FIXED'
        }
        : {})
    },
    layoutOptions: {
      ...elkNode.layoutOptions,
      ...(forceFixed
        ? {
          'elk.position': 'FIXED',
          'org.eclipse.elk.position': 'FIXED'
        }
        : {})
    },
    ...(position
      ? {
        x: position.x - layoutOffset.x - parentX,
        y: position.y - layoutOffset.y - parentY
      }
      : {})
  };
}

function buildGenerateCompoundElkChildren(
  nodes: DiagramNode[],
  regions: GenerateRegion[],
  moduleLayout: SavedModuleLayout,
  options: {
    includeLeadMargins: boolean;
    includeRoutingObstacleMargins?: boolean;
    forceFixed?: boolean;
    nodePositions?: Map<string, { x: number; y: number }>;
    regionBounds?: Map<string, RegionBounds>;
  }
): ElkLayoutNode[] {
  const sortedRegions = [...regions].sort(compareGenerateRegions);
  const regionById = new Map(sortedRegions.map((region) => [region.id, region]));
  const childrenByParent = new Map<string, GenerateRegion[]>();
  for (const region of sortedRegions) {
    const parent = region.parentRegionId && regionById.has(region.parentRegionId) ? region.parentRegionId : '';
    const children = childrenByParent.get(parent) ?? [];
    children.push(region);
    childrenByParent.set(parent, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort(compareGenerateRegions);
  }

  const nodeOwner = new Map<string, string>();
  for (const node of nodes) {
    const owner = deepestOwningGenerateRegion(node.id, sortedRegions, regionById);
    if (owner) {
      nodeOwner.set(node.id, owner.id);
    }
  }

  const nodesByOwner = new Map<string, DiagramNode[]>();
  const rootNodes: DiagramNode[] = [];
  for (const node of nodes) {
    const ownerId = nodeOwner.get(node.id);
    if (!ownerId) {
      rootNodes.push(node);
      continue;
    }
    const ownedNodes = nodesByOwner.get(ownerId) ?? [];
    ownedNodes.push(node);
    nodesByOwner.set(ownerId, ownedNodes);
  }

  const buildNode = (node: DiagramNode, parentBounds?: RegionBounds): ElkLayoutNode => elkNodeForLayout(node, moduleLayout, {
    includeLeadMargins: options.includeLeadMargins,
    includeRoutingObstacleMargins: options.includeRoutingObstacleMargins,
    forceFixed: options.forceFixed,
    nodePositions: options.nodePositions,
    parentBounds
  });

  const buildRegion = (region: GenerateRegion, parentBounds?: RegionBounds): ElkLayoutNode => {
    const bounds = options.regionBounds?.get(region.id);
    const regionChildren = [
      ...(nodesByOwner.get(region.id) ?? []).map((node) => buildNode(node, bounds)),
      ...(childrenByParent.get(region.id) ?? []).map((child) => buildRegion(child, bounds))
    ];
    const parentX = parentBounds?.x ?? 0;
    const parentY = parentBounds?.y ?? 0;

    return {
      id: generateRegionElkId(region.id),
      width: bounds?.width ?? REGION_MIN_WIDTH,
      height: bounds?.height ?? REGION_MIN_HEIGHT,
      ...(bounds
        ? {
          x: bounds.x - parentX,
          y: bounds.y - parentY
        }
        : {}),
      children: regionChildren,
      layoutOptions: generateRegionLayoutOptions(options.forceFixed === true),
      properties: generateRegionProperties(options.forceFixed === true)
    };
  };

  const sourcePorts = rootNodes.filter(isSourceBoundaryPortNode);
  const sinkPorts = rootNodes.filter(isSinkBoundaryPortNode);
  const middleNodes = rootNodes.filter((node) => !isSourceBoundaryPortNode(node) && !isSinkBoundaryPortNode(node));
  const rootRegions = childrenByParent.get('') ?? [];

  return [
    ...sourcePorts.map((node) => buildNode(node)),
    ...middleNodes.map((node) => buildNode(node)),
    ...rootRegions.map((region) => buildRegion(region)),
    ...sinkPorts.map((node) => buildNode(node))
  ];
}

function deepestOwningGenerateRegion(
  nodeId: string,
  regions: GenerateRegion[],
  regionById: Map<string, GenerateRegion>
): GenerateRegion | undefined {
  const owners = regions.filter((region) => (region.nodeIds ?? []).includes(nodeId));
  if (owners.length === 0) return undefined;
  owners.sort((a, b) => generateRegionDepth(b, regionById) - generateRegionDepth(a, regionById));
  return owners[0];
}

function generateRegionDepth(region: GenerateRegion, regionById: Map<string, GenerateRegion>): number {
  let depth = 0;
  let parent = region.parentRegionId ? regionById.get(region.parentRegionId) : undefined;
  while (parent) {
    depth += 1;
    parent = parent.parentRegionId ? regionById.get(parent.parentRegionId) : undefined;
  }
  return depth;
}

function isSourceBoundaryPortNode(node: DiagramNode): boolean {
  return node.kind === 'port' && node.ports.some((port) => port.direction !== 'output');
}

function isSinkBoundaryPortNode(node: DiagramNode): boolean {
  return node.kind === 'port' && node.ports.length > 0 && node.ports.every((port) => port.direction === 'output');
}

function collectElkPositionsAndRegionBounds(
  graph: ElkLayoutNode,
  nodes: DiagramNode[],
  positions: Map<string, { x: number; y: number }>,
  regionBounds: Map<string, RegionBounds>
): void {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  const visit = (node: ElkLayoutNode, origin: { x: number; y: number }) => {
    const x = origin.x + (node.x ?? 0);
    const y = origin.y + (node.y ?? 0);
    const regionId = generateRegionIdFromElkId(node.id);
    if (regionId) {
      if (node.width !== undefined && node.height !== undefined) {
        regionBounds.set(regionId, snapRegionBounds({
          x,
          y,
          width: node.width,
          height: node.height
        }));
      }
      for (const child of node.children ?? []) {
        visit(child, { x, y });
      }
      return;
    }

    const diagramNode = nodesById.get(node.id);
    if (diagramNode && node.x !== undefined && node.y !== undefined) {
      const offset = elkNodeForDiagramNode(diagramNode, true).layoutOffset;
      positions.set(node.id, snapPosition({ x: x + offset.x, y: y + offset.y }, diagramNode.kind, structRole(diagramNode)));
    }

    for (const child of node.children ?? []) {
      visit(child, { x, y });
    }
  };

  for (const child of graph.children ?? []) {
    visit(child, { x: 0, y: 0 });
  }
}

export function elkNodeForDiagramNode(node: DiagramNode, includeLeadMargins = false): ElkDiagramNode {
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
    let leadOverride: number | undefined;

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
      const shiftY = isInterfaceInstance ? diagramSizing.interfaceInstanceShiftY : 0;
      const bottomPortsOnSide = isInterfaceInstance ? visiblePorts.filter(p => p.direction === 'output' && p.width !== 'interface') : [];
      const bottomHatHeight = isInterfaceInstance ? interfaceTopHatHeight(bottomPortsOnSide.length > 0) : 0;
      const unshiftedHeight = Math.max(grid, height - shiftY);

      if (isInterfaceInstance && port.direction === 'input' && port.width !== 'interface') {
        side = 'NORTH';
        const topPorts = visiblePorts.filter(p => p.direction === 'input' && p.width !== 'interface');
        const portIndex = topPorts.indexOf(port);
        portX = interfaceTopPortX(width, topPorts.length, portIndex, Math.max(topPorts.length, bottomPortsOnSide.length));
        portY = 0;
        // The hat sits below the layout-box top, so the box itself already
        // provides the vertical approach; no extra lead margin above it.
        leadOverride = 0;
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
             leadOverride = grid; // hat stem: keep the boundary one grid above the node
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
              portX = width;
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
      leadLength: includeLeadMargins ? leadOverride ?? elkLeadLengthForPort(side, port.id) : 0,
      index,
      x: portX,
      y: portY
    };
  });

  const arrayLayerPad = nodeIsArrayNode(node) ? 4 : 0;
  // Reserve only the part of each lead that extends past the node outline:
  // ports inset into the node (mux/select top selects, the inverter output
  // bubble) consume part of their lead inside the node, so the ELK box must
  // not also pad for it.
  const margins = portGeometry.reduce((current, port) => {
    if (port.side === 'WEST') {
      current.left = Math.max(current.left, port.leadLength - port.x);
    } else if (port.side === 'EAST') {
      current.right = Math.max(current.right, port.leadLength - (width - port.x));
    } else if (port.side === 'NORTH') {
      current.top = Math.max(current.top, port.leadLength - port.y);
    } else if (port.side === 'SOUTH') {
      current.bottom = Math.max(current.bottom, port.leadLength - (height - port.y));
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

export function elkRoutingNodeForDiagramNode(node: DiagramNode): ElkDiagramNode {
  const elkNode = elkNodeForDiagramNode(node, true);
  const portSides = elkNode.ports.map((port) => (
    port.properties['org.eclipse.elk.port.side']
    ?? port.layoutOptions['elk.port.side']
  ));
  const margins = routingObstacleMargins(node, portSides);

  return {
    ...elkNode,
    width: elkNode.width + margins.left + margins.right,
    height: elkNode.height + margins.top + margins.bottom,
    ports: elkNode.ports.map((port) => ({
      ...port,
      x: port.x === undefined ? undefined : port.x + margins.left,
      y: port.y === undefined ? undefined : port.y + margins.top
    })),
    layoutOffset: {
      x: elkNode.layoutOffset.x + margins.left,
      y: elkNode.layoutOffset.y + margins.top
    }
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

export function enforceMinimumBlockGaps(
  nodes: DiagramNode[],
  positions: Map<string, { x: number; y: number }>,
  moduleLayout: SavedModuleLayout
): void {
  const blocks = nodes.filter((node) => isBlockSpacingNode(node) && !moduleLayout.nodes[node.id]?.fixed);
  const geometries = new Map(blocks.map((node) => {
    const elkNode = elkNodeForDiagramNode(node, true);
    return [node.id, {
      width: elkNode.width,
      height: elkNode.height,
      offset: elkNode.layoutOffset
    }];
  }));
  const minGap = diagramSizing.gridSize;

  const boundsFor = (node: DiagramNode): RegionBounds | undefined => {
    const position = positions.get(node.id);
    const geometry = geometries.get(node.id);
    if (!position || !geometry) return undefined;
    return {
      x: position.x - geometry.offset.x,
      y: position.y - geometry.offset.y,
      width: geometry.width,
      height: geometry.height
    };
  };

  for (let pass = 0; pass < blocks.length; pass++) {
    let moved = false;
    const ordered = [...blocks].sort((a, b) => (boundsFor(a)?.y ?? 0) - (boundsFor(b)?.y ?? 0));

    for (let i = 1; i < ordered.length; i++) {
      const node = ordered[i];
      const pos = positions.get(node.id);
      const geometry = geometries.get(node.id);
      const bounds = boundsFor(node);
      if (!pos || !geometry || !bounds) continue;

      let requiredTop = bounds.y;
      for (let j = 0; j < i; j++) {
        const previous = ordered[j];
        const previousBounds = boundsFor(previous);
        if (!previousBounds || !horizontallyOverlaps(bounds, previousBounds)) continue;

        const gap = requiredTop - (previousBounds.y + previousBounds.height);
        if (gap < minGap) {
          requiredTop = previousBounds.y + previousBounds.height + minGap;
        }
      }

      if (requiredTop > bounds.y) {
        const requiredY = requiredTop + geometry.offset.y;
        positions.set(node.id, { ...pos, y: snapToGridAtOrAfter(requiredY, node.kind, structRole(node)) });
        moved = true;
      }
    }

    if (!moved) break;
  }
}

function isBlockSpacingNode(node: DiagramNode): boolean {
  return node.kind !== 'port' && node.kind !== 'replicate';
}

function horizontallyOverlaps(
  a: { x: number; width: number },
  b: { x: number; width: number }
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width;
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
      const candidate = directLeadRoute(insetVerticalBoundaryLead(sourceHandle, sourceNode?.kind === 'port'), insetVerticalBoundaryLead(targetHandle, targetNode?.kind === 'port'));
      // Only take the shortcut when the drop is monotonic (the wire approaches
      // a NORTH anchor from above / a SOUTH anchor from below) and the direct
      // route doesn't cut through unrelated nodes. Otherwise keep the ELK
      // route, which already avoids the boxes.
      if (
        verticalFeedIsMonotonic(sourceHandle, targetHandle)
        && !routeIntersectsNodeInterior(candidate, nodesById, nodePositions, new Set([edge.source, edge.target]))
      ) {
        return candidate;
      }
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

  const stitched = removeRedundantRoutePoints(makeOrthogonalRoute(points));
  const smoothed = smoothInitialForwardHierarchyStair(stitched, sourceLead, targetLead, nodesById, nodePositions);
  return repairForwardHorizontalRoute(
    smoothed,
    sourceLead,
    targetLead,
    nodesById,
    nodePositions
  );
}

function verticalFeedIsMonotonic(
  sourceHandle: { point: { x: number; y: number }; side: ElkPortSide },
  targetHandle: { point: { x: number; y: number }; side: ElkPortSide }
): boolean {
  for (const [handle, other] of [
    [sourceHandle, targetHandle.point],
    [targetHandle, sourceHandle.point]
  ] as const) {
    if (handle.side === 'NORTH' && other.y > handle.point.y) {
      return false;
    }
    if (handle.side === 'SOUTH' && other.y < handle.point.y) {
      return false;
    }
  }
  return true;
}

function smoothInitialForwardHierarchyStair(
  route: Array<{ x: number; y: number }>,
  sourceLead: { point: { x: number; y: number }; side: ElkPortSide },
  targetLead: { point: { x: number; y: number }; side: ElkPortSide },
  nodesById: Map<string, DiagramNode>,
  nodePositions: Map<string, { x: number; y: number }>
): Array<{ x: number; y: number }> {
  const direction = forwardHorizontalDirection(sourceLead, targetLead);
  if (!direction || route.length < 5 || !pointsEqual(route[0], sourceLead.point)) {
    return route;
  }

  const [source, first, second, third, fourth] = route;
  const isInitialStair = (
    first.y === source.y
    && second.x === first.x
    && third.y === second.y
    && fourth.x === third.x
    && second.y !== source.y
    && ((direction > 0 && third.x > first.x) || (direction < 0 && third.x < first.x))
    && Math.abs(third.x - first.x) <= diagramSizing.gridSize * 2
  );
  if (!isInitialStair) {
    return route;
  }

  const candidate = removeRedundantRoutePoints(makeOrthogonalRoute([
    source,
    { x: third.x, y: source.y },
    ...route.slice(4)
  ]));
  return routeIntersectsNodeInterior(candidate, nodesById, nodePositions) ? route : candidate;
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

  // Mixed sides with a non-monotonic approach: a plain L-corner would reach a
  // NORTH lead from below (or a SOUTH lead from above) and backtrack through
  // the node. Dogleg through an approach corridor one grid outside the lead.
  if (!sourceSideIsVertical && targetSideIsVertical && !verticalFeedIsMonotonic(sourceLead, targetLead)) {
    const corridorY = targetLead.point.y + (targetLead.side === 'NORTH' ? -diagramSizing.gridSize : diagramSizing.gridSize);
    const midX = snapToGrid((sourceLead.point.x + targetLead.point.x) / 2);
    return removeRedundantRoutePoints(makeOrthogonalRoute([
      sourceLead.point,
      { x: midX, y: sourceLead.point.y },
      { x: midX, y: corridorY },
      { x: targetLead.point.x, y: corridorY },
      targetLead.point
    ]));
  }
  if (sourceSideIsVertical && !targetSideIsVertical && !verticalFeedIsMonotonic(sourceLead, targetLead)) {
    const corridorY = sourceLead.point.y + (sourceLead.side === 'NORTH' ? -diagramSizing.gridSize : diagramSizing.gridSize);
    const midX = snapToGrid((sourceLead.point.x + targetLead.point.x) / 2);
    return removeRedundantRoutePoints(makeOrthogonalRoute([
      sourceLead.point,
      { x: sourceLead.point.x, y: corridorY },
      { x: midX, y: corridorY },
      { x: midX, y: targetLead.point.y },
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
  nodePositions: Map<string, { x: number; y: number }>,
  excludeNodeIds?: Set<string>
): boolean {
  const obstacles = routeObstacles(nodesById, nodePositions, excludeNodeIds);
  return route.slice(0, -1).some((point, index) => {
    const next = route[index + 1];
    return obstacles.some((rect) => segmentIntersectsRectInterior(point, next, rect));
  });
}

function routeObstacles(
  nodesById: Map<string, DiagramNode>,
  nodePositions: Map<string, { x: number; y: number }>,
  excludeNodeIds?: Set<string>
): Array<{ x: number; y: number; width: number; height: number }> {
  const obstacles: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const [nodeId, node] of nodesById) {
    const position = nodePositions.get(nodeId);
    if (!position || excludeNodeIds?.has(nodeId)) {
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

export function mergeRegionBounds(layout: SavedLayout, moduleName: string, regions: PositionedGenerateRegion[]): SavedLayout {
  const next: SavedLayout = {
    version: 1,
    modules: { ...layout.modules }
  };
  const existing: SavedModuleLayout = next.modules[moduleName] ?? { nodes: {} };
  const activeIds = new Set(regions.map((region) => region.id));
  const mergedRegions: NonNullable<SavedModuleLayout['regions']> = {};

  for (const [id, value] of Object.entries(existing.regions ?? {})) {
    if (!activeIds.has(id) && value.fixed) {
      mergedRegions[id] = { ...value, stale: true };
    }
  }

  for (const region of regions) {
    if (region.fixed || existing.regions?.[region.id]?.fixed) {
      mergedRegions[region.id] = {
        x: Math.round(region.bounds.x),
        y: Math.round(region.bounds.y),
        width: Math.round(region.bounds.width),
        height: Math.round(region.bounds.height),
        fixed: true
      };
    }
  }

  next.modules[moduleName] = {
    ...existing,
    regions: Object.keys(mergedRegions).length > 0 ? mergedRegions : undefined
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

function snapToGridAtOrAfter(value: number, kind?: string, role?: string): number {
  const snapped = snapToGrid(value, kind, role);
  return snapped < value ? snapped + diagramSizing.gridSize : snapped;
}

function snapPosition(position: { x: number; y: number }, kind?: string, role?: string): { x: number; y: number } {
  return {
    x: snapToGrid(position.x),
    y: snapToGrid(position.y, kind, role)
  };
}
