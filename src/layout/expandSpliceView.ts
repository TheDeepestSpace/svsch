import type {
  DesignGraph,
  DiagramViewModel,
  PositionedGenerateRegion,
  PositionedNode,
} from '../ir/types';
import type { SavedLayout } from '../storage/layoutStore';
import { diagramSizing } from '../diagram/constants';
import { instanceParameterRows, resolvedNodeDimensions } from '../diagram/nodeSizing';
import { nodeIsArrayNode } from '../ir/nodeMetadata';
import { buildExpandSpliceLayout } from './expandLayout';
import { buildViewModel } from './mergeLayout';
import { spliceExpandedInstance, type SpliceResult } from '../webview/expand/splice';

function translateRegion(
  region: PositionedGenerateRegion,
  dx: number,
  dy: number,
): PositionedGenerateRegion {
  return {
    ...region,
    bounds: { ...region.bounds, x: region.bounds.x + dx, y: region.bounds.y + dy },
  };
}

function translateSplice(result: SpliceResult, dx: number, dy: number): SpliceResult {
  if (dx === 0 && dy === 0) return result;
  return {
    ...result,
    region: translateRegion(result.region, dx, dy),
    nodes: result.nodes.map((node) => ({
      ...node,
      position: { x: node.position.x + dx, y: node.position.y + dy },
    })),
    edges: result.edges.map((edge) => ({
      ...edge,
      waypoint: edge.waypoint ? { x: edge.waypoint.x + dx, y: edge.waypoint.y + dy } : undefined,
      routePoints: edge.routePoints?.map((point) => ({
        x: point.x + dx,
        y: point.y + dy,
      })),
    })),
    nestedRegions: result.nestedRegions?.map((region) => translateRegion(region, dx, dy)),
  };
}

/**
 * Server-side counterpart of the webview's `applyActiveSplices`
 * (webview/expand/expandOverlay.ts): merges every top-level "Expand"ed
 * instance (see `SavedModuleLayout.expanded`) into a plain `DiagramViewModel`
 * rather than React Flow state, so non-interactive consumers — today, SVG
 * export (`svsch render`) — see the same spliced boundary-port/internal
 * content the live webview canvas does instead of just the flat collapsed
 * instance box (see issue #248).
 *
 * Recursion happens one level down, not here: each spliced child's content
 * comes from `buildExpandSpliceLayout`, which takes the child's standalone
 * view *with the child's own `SavedModuleLayout.expanded` applied* (via this
 * very function), so a sub-diagram mirrors the child module's own diagram —
 * expansions included, to any depth. `ancestorModules` carries the module
 * names already being expanded up the chain so a recursive instantiation
 * stays collapsed instead of looping (see buildExpandSpliceLayout).
 */
export async function applyExpandedInstances(input: {
  graph: DesignGraph;
  layout: SavedLayout;
  view: DiagramViewModel;
  ancestorModules?: ReadonlySet<string>;
}): Promise<DiagramViewModel> {
  const { graph, layout, view } = input;
  const expandedFlags = layout.modules[view.moduleName]?.expanded ?? {};
  const instanceIds = Object.keys(expandedFlags).filter((id) => expandedFlags[id]);
  if (instanceIds.length === 0) {
    return view;
  }

  const grid = diagramSizing.gridSize;
  const prepared: Array<{
    instanceId: string;
    anchor: { x: number; y: number };
    result: SpliceResult;
  }> = [];
  const expandedSizes: Record<string, { width: number; height: number }> = {};

  for (const instanceId of instanceIds) {
    const instanceNode = view.nodes.find((node) => node.id === instanceId);
    if (!instanceNode || instanceNode.kind !== 'instance' || nodeIsArrayNode(instanceNode)) {
      continue;
    }
    const childModuleName = instanceNode.moduleName;
    if (!childModuleName) {
      continue;
    }
    // A module that appears among its own expand ancestors (recursive
    // instantiation) stays collapsed — no degraded fallback splice either.
    if (input.ancestorModules?.has(childModuleName)) {
      continue;
    }
    const childModule = graph.modules[childModuleName];
    if (!childModule) {
      continue;
    }

    const instanceSize = resolvedNodeDimensions(instanceNode);
    const instanceParamRows = instanceParameterRows(instanceNode);

    let hostLayout;
    try {
      hostLayout = await buildExpandSpliceLayout({
        graph,
        layout,
        childModuleName,
        instanceId,
        instancePorts: instanceNode.ports,
        instanceSize,
        instanceParamRows,
        ancestorModules: input.ancestorModules,
      });
    } catch {
      hostLayout = undefined;
    }

    const spliceResult = await spliceExpandedInstance({
      namespace: instanceId,
      parentRegionId: undefined,
      parentModuleName: view.moduleName,
      instanceId,
      instanceLabel: instanceNode.label,
      instancePosition: instanceNode.position,
      instanceSize,
      instanceParamRows,
      instancePorts: instanceNode.ports,
      childModule,
      hostLayout,
    });

    prepared.push({
      instanceId,
      anchor: { ...instanceNode.position },
      result: spliceResult,
    });
    expandedSizes[instanceId] = {
      width: Math.ceil(spliceResult.expandedSize.width / grid),
      height: Math.ceil(spliceResult.expandedSize.height / grid),
    };
  }

  if (prepared.length === 0) {
    return view;
  }

  // `buildViewModel` originally produced `view` while every instance still
  // had its collapsed footprint. Re-run the outer placement/routing pass
  // with the computed frame sizes before splicing: otherwise a route that
  // touches another expanded instance (and therefore gets rewired below)
  // can retain a path straight through this frame. This is the non-live
  // counterpart of DiagramPanel.expandedFrameSizesByModule.
  const routedView = await buildViewModel(graph, view.moduleName, layout, {
    elkSizeOverrides: expandedSizes,
  });
  let nodes = [...routedView.nodes];
  let edges = [...routedView.edges];
  const regions = [...(routedView.generateRegions ?? [])];

  for (const preparedSplice of prepared) {
    const { instanceId } = preparedSplice;
    const instanceNode = nodes.find((node) => node.id === instanceId);
    if (!instanceNode || instanceNode.kind !== 'instance') continue;
    const spliceResult = translateSplice(
      preparedSplice.result,
      instanceNode.position.x - preparedSplice.anchor.x,
      instanceNode.position.y - preparedSplice.anchor.y,
    );

    const portNameByHandle = new Map(instanceNode.ports.map((port) => [port.id, port.name]));
    edges = edges.map((edge) => {
      const sourceMatches = edge.source === instanceId;
      const targetMatches = edge.target === instanceId;
      if (!sourceMatches && !targetMatches) return edge;
      const handleId = sourceMatches ? edge.sourcePort : edge.targetPort;
      const portName = handleId ? portNameByHandle.get(handleId) : undefined;
      const boundaryId = portName
        ? spliceResult.boundaryNodeIdByChildPortName.get(portName)
        : undefined;
      if (!boundaryId) return edge;
      return {
        ...edge,
        source: sourceMatches ? boundaryId : edge.source,
        target: targetMatches ? boundaryId : edge.target,
        sourcePort: sourceMatches ? 'outer' : edge.sourcePort,
        targetPort: targetMatches ? 'outer' : edge.targetPort,
      };
    });

    nodes = nodes.map((node): PositionedNode => {
      if (node.id !== instanceId) return node;
      return {
        ...node,
        sizeOverride: {
          width: Math.ceil(spliceResult.expandedSize.width / grid),
          height: Math.ceil(spliceResult.expandedSize.height / grid),
        },
        metadata: { ...node.metadata, expandGhost: { insets: spliceResult.contentInsets } },
      };
    });

    nodes = [...nodes, ...spliceResult.nodes];
    edges = [...edges, ...spliceResult.edges];
    regions.push(spliceResult.region, ...(spliceResult.nestedRegions ?? []));
  }

  return { ...routedView, nodes, edges, generateRegions: regions };
}
