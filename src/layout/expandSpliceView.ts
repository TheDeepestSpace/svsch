import type { DesignGraph, DiagramViewModel, PositionedNode } from '../ir/types';
import type { SavedLayout } from '../storage/layoutStore';
import { diagramSizing } from '../diagram/constants';
import { instanceParameterRows, resolvedNodeDimensions } from '../diagram/nodeSizing';
import { nodeIsArrayNode } from '../ir/nodeMetadata';
import { buildExpandSpliceLayout } from './expandLayout';
import { spliceExpandedInstance } from '../webview/expand/splice';

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

  let nodes = [...view.nodes];
  let edges = [...view.edges];
  const regions = [...(view.generateRegions ?? [])];
  const grid = diagramSizing.gridSize;

  for (const instanceId of instanceIds) {
    const instanceNode = nodes.find((node) => node.id === instanceId);
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
        waypoint: undefined,
        routePoints: undefined,
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
    regions.push(spliceResult.region);
  }

  return { ...view, nodes, edges, generateRegions: regions };
}
