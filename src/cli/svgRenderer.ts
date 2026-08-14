import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DiagramEdge, DiagramNode, DiagramPort, DiagramViewModel, PositionedGenerateRegion, PositionedNode } from '../ir/types';
import { compareEdgePaintOrder } from '../diagram/edgePaintOrder';
import { diagramSizing } from '../diagram/constants';
import { diagramNodeDimensions, instanceParameterRows, nodeWarningIconCenter } from '../diagram/nodeSizing';
import { visualHandleGeometry } from '../diagram/visualHandleGeometry';
import { isInputSidePort } from '../diagram/portDirection';
import { nodeIsArrayNode, structRole } from '../ir/nodeMetadata';
import { edgeNetKey } from '../ir/edgeNet';
import { edgeIsThick, nodeStackIsWide } from '../ir/edgeStyle';
import { elkSideToHandleSide, renderedPortGeometry } from '../layout/mergeLayout';
import { HdlPosition } from '../webview/orthogonal/types';
import { avoidFeedbackObstacles, normalizeRoutePoints, pointNearPathStart, type NodeObstacle } from '../webview/orthogonal/logic';
import { findNetJunctions, type NetJunction } from '../webview/orthogonal/netGeometry';
import { pathFromPoints, type OrthogonalPoint } from '../core/pathUtils';
import { arrayStackLayersFor, type ArrayStackLayerId } from '../webview/arrayStackGeometry';
import {
  buildLineJumpRender,
  getEdgeOverlapHints,
  type LineJumpHalo,
  type LineJumpRender,
  type OverlapHint,
  type PolylineEdgeGeometry
} from '../webview/react-flow-line-jumps';
import {
  computeStackedEdgeLayerPoints,
  convergingStackPath,
  promotedStackFanoutPath,
  stableFragmentId,
  stackedLayerEdgeClass,
  stackedLayerGradientStopClass,
  type ConvergingStackPath,
  type PromotedStackFanout
} from '../webview/orthogonal/stackedEdgeGeometry';
import { themeCss, type SvgThemeName } from './theme';
import { RegisterNodeSvg } from '../webview/nodes/register/RegisterNodeSvg';
import { LatchNodeSvg } from '../webview/nodes/latch/LatchNodeSvg';
import { LiteralNodeSvg } from '../webview/nodes/literal/LiteralNodeSvg';
import { ReplicateNodeSvg } from '../webview/nodes/replicate/ReplicateNodeSvg';
import { InverterNodeSvg } from '../webview/nodes/inverter/InverterNodeSvg';
import { PortNodeSvg } from '../webview/nodes/port/PortNodeSvg';
import { CombNodeSvg } from '../webview/nodes/comb/CombNodeSvg';
import { LoopNodeSvg } from '../webview/nodes/loop/LoopNodeSvg';
import { MuxNodeSvg } from '../webview/nodes/mux/MuxNodeSvg';
import { SelectNodeSvg } from '../webview/nodes/mux/SelectNodeSvg';
import { AluNodeSvg } from '../webview/nodes/alu/AluNodeSvg';
import { BusNodeSvg } from '../webview/nodes/bus/BusNodeSvg';
import { InstanceNodeSvg } from '../webview/nodes/instance/InstanceNodeSvg';
import { NetLabelWirePaths } from '../webview/nodes/shared/NetLabelWire';
import { SvgArrayStackLeads } from '../webview/nodes/shared/SvgArrayStackLeads';
import type { ArrayConnection, NodeSvgProps } from '../webview/nodes/shared/NodeSvgProps';

export interface SvgRendererOptions {
  theme?: SvgThemeName;
  padding?: number;
  reactFlowCss?: string;
  extensionCss?: string;
}

interface RectBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface RenderedEdgeBase {
  edge: DiagramEdge;
  points: OrthogonalPoint[];
  targetPosition: HdlPosition;
  sourceHdlPosition: HdlPosition;
  targetHdlPosition: HdlPosition;
  isStructAggregate: boolean;
  isInterfaceAggregate: boolean;
  isThickWire: boolean;
  isStacked: boolean;
  sourceIsArray: boolean;
  targetIsArray: boolean;
  isPromotedStack: boolean;
  isConvergingStack: boolean;
  promotedStackWide: boolean;
  convergingStackWide: boolean;
  isMuxSelectorPromotion: boolean;
  netKey: string;
  geometry: PolylineEdgeGeometry;
  backStackPoints: OrthogonalPoint[];
  middleStackPoints: OrthogonalPoint[];
  frontStackPoints: OrthogonalPoint[];
}

interface RenderedEdge extends RenderedEdgeBase {
  edgeRender: LineJumpRender;
  jumpHalos: LineJumpHalo[];
  overlapHints: OverlapHint[];
  backRender?: LineJumpRender;
  middleRender?: LineJumpRender;
  frontRender?: LineJumpRender;
  promotedFanout?: PromotedStackFanout;
  promotedFanoutGradientId: string;
  convergingStackPaths: ConvergingStackPath[];
  netJunctions: NetJunction[];
  isNetLeader: boolean;
}

const DEFAULT_PADDING = diagramSizing.gridSize * 2;

export function renderSvg(view: DiagramViewModel, options: SvgRendererOptions = {}): string {
  const theme = options.theme ?? 'dark';
  const padding = options.padding ?? DEFAULT_PADDING;
  const nodesById = new Map(view.nodes.map((node) => [node.id, node]));
  const arrayConnectionsByNode = buildArrayConnectionsByNode(view);
  const obstacles = nodeObstacles(view.nodes);
  const baseEdges = [...view.edges]
    .sort(compareEdgePaintOrder)
    .map((edge) => renderEdgeGeometry(edge, nodesById, obstacles))
    .filter((edge): edge is RenderedEdgeBase => edge !== undefined);
  const renderedEdges = attachEdgeRendering(baseEdges);
  const bounds = diagramBounds(view.nodes, renderedEdges, view.generateRegions ?? [], padding);
  const width = Math.max(diagramSizing.gridSize * 8, Math.ceil(bounds.maxX - bounds.minX));
  const height = Math.max(diagramSizing.gridSize * 6, Math.ceil(bounds.maxY - bounds.minY));
  const offsetX = -bounds.minX;
  const offsetY = -bounds.minY;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="svsch-diagram" role="img" aria-label="${escapeXml(view.moduleName)} diagram">`,
    renderDefs(),
    '<style>',
    // CDATA (commented so CSS parsers see harmless comments, not tokens) so
    // a stray unescaped '<' or '>' in embedded CSS — e.g. in a comment, as
    // has happened before — can never make this document invalid XML. A
    // literal ']]>' inside the CSS would still break it, but that's far
    // less likely to occur by accident than a bare angle bracket.
    '/*<![CDATA[*/',
    options.reactFlowCss ?? '',
    options.extensionCss ?? '',
    themeCss(theme),
    svgBridgeCss(),
    '/*]]>*/',
    '</style>',
    `<g transform="translate(${formatNumber(offsetX)} ${formatNumber(offsetY)})">`,
    '<g class="svsch-generate-regions">',
    // Wrappers first so their fill renders behind the arm borders.
    ...[...(view.generateRegions ?? [])]
      .sort((a, b) => (a.isGenerateBlock ? 0 : 1) - (b.isGenerateBlock ? 0 : 1))
      .map(renderGenerateRegion),
    '</g>',
    '<g class="svsch-edges">',
    ...renderedEdges.map(renderEdge),
    '</g>',
    '<g class="svsch-nodes">',
    ...view.nodes.map((node) => renderNode(node, arrayConnectionsByNode.get(node.id) ?? [])),
    '</g>',
    '</g>',
    '</svg>',
    ''
  ].join('\n');
}

function renderDefs(): string {
  return [
    '<defs>',
    '  <linearGradient id="svsch-bus-gradient" x1="0%" y1="0%" x2="100%" y2="0%">',
    '    <stop offset="0%" stop-color="var(--svsch-edge-stacked-back)" />',
    '    <stop offset="50%" stop-color="var(--svsch-edge-stacked-middle)" />',
    '    <stop offset="100%" stop-color="var(--svsch-edge-stacked-front)" />',
    '  </linearGradient>',
    '  <pattern id="svsch-interface-stripes" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">',
    '    <line class="svsch-interface-stripe" x1="5" y1="0" x2="5" y2="10" />',
    '  </pattern>',
    '  <pattern id="svsch-struct-stripes" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">',
    '    <line class="svsch-struct-stripe" x1="5" y1="0" x2="5" y2="10" />',
    '  </pattern>',
    '</defs>'
  ].join('\n');
}

// Export-only bridge: keep the SVG root transparent and fill small gaps where the
// webview CSS targets HTML wrappers rather than the pure exported SVG tree.
export function svgBridgeCss(): string {
  return `
.svsch-diagram { background: none; }
.svsch-net-label {
  fill: var(--vscode-editor-foreground);
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 11px;
  dominant-baseline: middle;
}
/* diagram.css sets a text color on this class for the webview's HTML
   foreignObject span — an SVG text element ignores that for its own fill,
   so the exported SVG needs an explicit fill here or it defaults to black. */
.svsch-edge-label {
  fill: var(--vscode-editor-foreground);
}
.hdl-net-label-alias-marker {
  fill: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
}
.svsch-generate-region-box {
  fill: none;
  stroke: var(--vscode-charts-orange);
  stroke-width: 1.5;
}
.svsch-generate-region.svsch-generate-block .svsch-generate-region-box {
  fill: color-mix(in srgb, var(--vscode-editor-foreground) 16%, transparent);
  stroke: none;
}
.svsch-node-error-outline {
  fill: none;
  stroke: var(--svsch-error-highlight, var(--vscode-charts-red));
  stroke-dasharray: 7 5;
  stroke-width: 2.5;
}
.svsch-node.svsch-node-invalid .node-skin-selection,
.svsch-node.svsch-node-invalid .port-skin-selection,
.svsch-node.svsch-node-invalid .hdl-interface-skin-selection {
  fill: none;
  opacity: 1;
  stroke: var(--svsch-error-highlight, var(--vscode-charts-red));
  stroke-dasharray: 7 5;
  stroke-width: var(--svsch-selection-width, 2.5px);
}
.svsch-generate-region-label,
.svsch-generate-region-warning {
  fill: var(--vscode-editor-foreground);
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 11px;
  dominant-baseline: middle;
}
.svsch-generate-region-warning {
  fill: var(--svsch-error-highlight, var(--vscode-charts-red));
  font-size: 14px;
}
.svsch-node-warning {
  fill: var(--svsch-error-highlight, var(--vscode-charts-red));
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 14px;
  dominant-baseline: middle;
}
.svsch-generate-region-inactive {
  opacity: 0.75;
}
.svsch-generate-region-active .svsch-generate-region-box {
  stroke: var(--vscode-charts-orange);
}
.svsch-generate-region-invalid .svsch-generate-region-box {
  fill: var(--svsch-error-highlight-fill, color-mix(in srgb, var(--vscode-charts-red) 9%, transparent));
  stroke: var(--svsch-error-highlight, var(--vscode-charts-red));
  stroke-dasharray: 7 5;
  stroke-width: 2;
}
.svsch-generate-block.svsch-generate-region-invalid .svsch-generate-region-box {
  fill: var(--svsch-error-highlight-fill, color-mix(in srgb, var(--vscode-charts-red) 9%, transparent));
  stroke: var(--svsch-error-highlight, var(--vscode-charts-red));
  stroke-dasharray: 7 5;
  stroke-width: 2;
}
`.trim();
}

function renderGenerateRegion(region: PositionedGenerateRegion): string {
  const classes = [
    'svsch-generate-region',
    region.isGenerateBlock ? 'svsch-generate-block' : '',
    region.activeState === 'active' ? 'svsch-generate-region-active' : '',
    region.activeState === 'inactive' ? 'svsch-generate-region-inactive' : '',
    region.invalid ? 'svsch-generate-region-invalid' : ''
  ].filter(Boolean).join(' ');
  const labelX = region.bounds.x + 8;
  const labelY = region.bounds.y + 8;
  // 20px out from the top-right corner on both axes, mirroring the webview icon.
  const warningX = region.bounds.x + region.bounds.width + 20;
  const warningY = region.bounds.y - 20;
  return [
    `<g class="${escapeAttr(classes)}" data-region-id="${escapeAttr(region.id)}">`,
    region.warningNote ? `<title>${escapeXml(region.warningNote)}</title>` : '',
    `<rect class="svsch-generate-region-box" x="${formatNumber(region.bounds.x)}" y="${formatNumber(region.bounds.y)}" width="${formatNumber(region.bounds.width)}" height="${formatNumber(region.bounds.height)}" />`,
    `<text class="svsch-generate-region-label" x="${formatNumber(labelX)}" y="${formatNumber(labelY + 9)}">${escapeXml(region.label)}</text>`,
    region.warningNote
      ? `<text class="svsch-generate-region-warning" x="${formatNumber(warningX)}" y="${formatNumber(warningY)}" text-anchor="end">⚠</text>`
      : '',
    '</g>'
  ].filter(Boolean).join('\n');
}

function renderEdgeGeometry(edge: DiagramEdge, nodesById: Map<string, PositionedNode>, obstacles: NodeObstacle[]): RenderedEdgeBase | undefined {
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  if (!source || !target) {
    return undefined;
  }

  const sourcePort = connectionPortGeometry(source, edge.sourcePort, 'source');
  const targetPort = connectionPortGeometry(target, edge.targetPort, 'target');
  if (!sourcePort || !targetPort) {
    return undefined;
  }

  const sourcePoint = {
    x: source.position.x + sourcePort.offset.x,
    y: source.position.y + sourcePort.offset.y
  };
  const targetPoint = {
    x: target.position.x + targetPort.offset.x,
    y: target.position.y + targetPort.offset.y
  };
  const sourcePosition = sideToHdlPosition(sourcePort.side);
  const targetPosition = sideToHdlPosition(targetPort.side);
  const normalizedOfficialPoints = normalizeRoutePoints(
    { routePoints: edge.routePoints, waypoint: edge.waypoint, edge } as any,
    sourcePoint.x,
    sourcePoint.y,
    targetPoint.x,
    targetPoint.y,
    sourcePosition,
    targetPosition,
    edge.sourcePort,
    edge.targetPort,
    true,
    source,
    target
  );
  const officialPoints = edge.metadata?.forceStraight === true || (edge.routePoints && edge.routePoints.length > 0)
    ? normalizedOfficialPoints
    : avoidFeedbackObstacles(normalizedOfficialPoints, obstacles, sourcePosition, targetPosition);
  const points = [{ ...sourcePoint }, ...officialPoints, { ...targetPoint }];
  const forceStraight = edge.metadata?.forceStraight === true;
  const isVertical = Math.abs(sourcePoint.x - targetPoint.x) < 1;
  const targetHdlPosition = forceStraight && isVertical ? HdlPosition.Top : targetPosition;
  const sourceHdlPosition = forceStraight && isVertical ? HdlPosition.Bottom : sourcePosition;
  const sourceInputs = aggregateInputs(source);
  const sourceIsComposition = sourceInputs.length > 1;
  const sourceIsArray = nodeIsArrayNode(source) || (source.kind === 'netLabel' && source.metadata?.cutNet?.isSourceStacked === true);
  const sourceIsArrayComposition = source.kind === 'bus' && sourceIsComposition && source.metadata?.aggregateKind === 'array';
  const targetInputs = aggregateInputs(target);
  const targetIsComposition = targetInputs.length > 1;
  const targetIsArray = nodeIsArrayNode(target) || (target.kind === 'netLabel' && target.metadata?.cutNet?.isSourceStacked === true);
  const targetIsArrayBreakout = target.kind === 'bus' && !targetIsComposition && target.metadata?.aggregateKind === 'array';
  const isStructAggregate = edge.metadata?.aggregate === 'struct';
  const isInterfaceAggregate = edge.metadata?.aggregate === 'interface';
  const isThickWire = edgeIsThick(edge, source, target);
  const isStacked = edge.isStacked === true;
  const isPromotedStack = isStacked && targetIsArray && !sourceIsArray;
  const isConvergingStack = isStacked && sourceIsArray && !targetIsArray;
  const isMuxSelectorPromotion = target.kind === 'mux' && edge.targetPort === 'sel';
  const netKey = edgeNetKey(edge);
  // See the matching comment in OrthogonalEdge.tsx: fork/fanout spacing must
  // track the array-stacked endpoint's own lane offset, not this specific
  // (possibly scalar) edge's thickness.
  const promotedStackWide = nodeStackIsWide(target);
  const convergingStackWide = nodeStackIsWide(source);

  const { back: backStackPoints, middle: middleStackPoints, front: frontStackPoints } = computeStackedEdgeLayerPoints({
    points,
    sourceHdlPosition,
    targetHdlPosition,
    sourceIsArray,
    sourceIsArrayComposition,
    sourceNode: source,
    targetIsArray,
    targetIsArrayBreakout,
    targetNode: target,
    isThickWire
  });

  const geometry: PolylineEdgeGeometry = {
    edgeId: edge.id,
    points,
    sourceId: netKey,
    targetId: `${edge.target}:${edge.targetPort ?? ''}`,
    netKey,
    sourceHandlePoint: sourcePoint,
    targetHandlePoint: targetPoint,
    isStruct: isStructAggregate,
    isInterface: isInterfaceAggregate,
    isThick: isThickWire,
    isStacked: isStacked && !isPromotedStack && !isConvergingStack
  };

  return {
    edge,
    points,
    targetPosition,
    sourceHdlPosition,
    targetHdlPosition,
    isStructAggregate,
    isInterfaceAggregate,
    isThickWire,
    isStacked,
    sourceIsArray,
    targetIsArray,
    isPromotedStack,
    isConvergingStack,
    promotedStackWide,
    convergingStackWide,
    isMuxSelectorPromotion,
    netKey,
    geometry,
    backStackPoints,
    middleStackPoints,
    frontStackPoints
  };
}

function sideToHdlPosition(side: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'): HdlPosition {
  const handleSide = elkSideToHandleSide(side);
  if (handleSide === 'left') return HdlPosition.Left;
  if (handleSide === 'right') return HdlPosition.Right;
  if (handleSide === 'top') return HdlPosition.Top;
  return HdlPosition.Bottom;
}

function connectionPortGeometry(node: PositionedNode, portId: string | undefined, role: 'source' | 'target'): { offset: { x: number; y: number }; side: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' } | undefined {
  if (node.kind === 'netLabel') {
    const { width, height } = diagramNodeDimensions(node);
    const handleSide = node.metadata?.cutNet?.handleSide ?? 'left';
    switch (handleSide) {
      case 'top':    return { offset: { x: width / 2, y: 0 },          side: 'NORTH' };
      case 'bottom': return { offset: { x: width / 2, y: height },      side: 'SOUTH' };
      case 'right':  return { offset: { x: width,     y: height / 2 },  side: 'EAST'  };
      default:       return { offset: { x: 0,          y: height / 2 }, side: 'WEST'  };
    }
  }
  return visualHandleGeometry(node, portId) ?? renderedPortGeometry(node, portId, false, role);
}

function attachEdgeRendering(edges: RenderedEdgeBase[]): RenderedEdge[] {
  const geometries = edges.map((edge) => edge.geometry);
  const netEdgeIdsByNet = buildNetEdgeIdsByNet(edges);

  return edges.map((edge) => {
    const edgeRender = buildLineJumpRender(edge.geometry, geometries);
    const regularStack = edge.isStacked && !edge.isPromotedStack && !edge.isConvergingStack;
    const backRender = regularStack
      ? buildLineJumpRender({ ...edge.geometry, points: edge.backStackPoints, isStacked: false }, geometries)
      : undefined;
    const middleRender = regularStack
      ? buildLineJumpRender({ ...edge.geometry, points: edge.middleStackPoints, isStacked: false }, geometries)
      : undefined;
    const frontRender = regularStack
      ? buildLineJumpRender({ ...edge.geometry, points: edge.frontStackPoints, isStacked: false }, geometries)
      : undefined;
    const jumpHalos = regularStack
      ? [
        ...(backRender?.jumpHalos ?? []),
        ...(middleRender?.jumpHalos ?? []),
        ...(frontRender?.jumpHalos ?? [])
      ]
      : lineJumpHalos(edgeRender);
    const promotedFanout = edge.isPromotedStack
      ? promotedStackFanoutPath(
        edge.points,
        edge.targetPosition,
        diagramSizing.gridSize * (edge.isMuxSelectorPromotion ? 2 : 1),
        edge.promotedStackWide
      )
      : undefined;
    const convergingStackPaths = edge.isConvergingStack
      ? (['back', 'middle', 'front'] as ArrayStackLayerId[])
        .map((layerId) => convergingStackPath(edge.points, layerId, edge.sourceHdlPosition, edge.targetHdlPosition, edge.convergingStackWide))
        .filter((stackPath): stackPath is ConvergingStackPath => stackPath !== undefined)
      : [];
    const netEdgeIds = netEdgeIdsByNet.get(edge.netKey) ?? [];
    const isNetLeader = netEdgeIds[0] === edge.edge.id;
    const netGeometries = geometries.filter((geometry) => netEdgeIds.includes(geometry.edgeId));
    const netJunctions = isNetLeader || edge.isInterfaceAggregate || edge.isStructAggregate ? findNetJunctions(netGeometries) : [];

    return {
      ...edge,
      edgeRender,
      jumpHalos,
      overlapHints: getEdgeOverlapHints(edge.geometry, geometries),
      backRender,
      middleRender,
      frontRender,
      promotedFanout,
      promotedFanoutGradientId: `svsch-stack-fanout-gradient-${stableFragmentId(edge.edge.id)}`,
      convergingStackPaths,
      netJunctions,
      isNetLeader
    };
  });
}

function renderEdge(rendered: RenderedEdge): string {
  const content = [
    ...renderJumpHalos(rendered),
    ...renderEdgePaths(rendered),
    ...renderOverlapHints(rendered),
    ...renderNetJunctions(rendered),
    rendered.edge.label ? renderEdgeLabel(rendered.edge.label, rendered.points, rendered.edge.metadata?.aliasNames, rendered.edge.metadata?.generateActiveState) : ''
  ].filter(Boolean);
  return `<g class="svsch-edge-group" data-edge-id="${escapeAttr(rendered.edge.id)}">${content.join('\n')}</g>`;
}

function renderEdgePaths(rendered: RenderedEdge): string[] {
  if (rendered.isStacked && (rendered.sourceIsArray || rendered.targetIsArray)) {
    const paths: string[] = [];
    if (rendered.isInterfaceAggregate) {
      paths.push(edgePath(rendered, 'svsch-edge svsch-edge-interface-bg', rendered.edgeRender.path, false));
    }
    if (rendered.isStructAggregate) {
      paths.push(edgePath(rendered, 'svsch-edge svsch-edge-struct-bg', rendered.edgeRender.path, false));
    }
    if (!rendered.isPromotedStack && !rendered.isConvergingStack) {
      paths.push(edgePath(rendered, `svsch-edge svsch-edge-stacked-back${rendered.isThickWire ? ' svsch-edge-thick' : ''}`, rendered.backRender?.path ?? pathFromPoints(rendered.backStackPoints)));
    }
    if (rendered.promotedFanout) {
      paths.push(...renderPromotedStackFanout(rendered, rendered.promotedFanout));
    } else if (rendered.convergingStackPaths.length > 0) {
      paths.push(...renderConvergingStackPaths(rendered));
    } else {
      const classes = [
        'svsch-edge',
        rendered.isStacked ? 'svsch-edge-stacked' : '',
        rendered.isStructAggregate ? 'svsch-edge-struct' : '',
        rendered.isInterfaceAggregate ? 'svsch-edge-interface' : '',
        rendered.isThickWire ? 'svsch-edge-thick' : ''
      ].filter(Boolean).join(' ');
      paths.push(edgePath(rendered, classes, rendered.middleRender?.path ?? rendered.edgeRender.path));
    }
    if (!rendered.isPromotedStack && !rendered.isConvergingStack) {
      paths.push(edgePath(rendered, `svsch-edge svsch-edge-stacked-front${rendered.isThickWire ? ' svsch-edge-thick' : ''}`, rendered.frontRender?.path ?? pathFromPoints(rendered.frontStackPoints)));
    }
    return paths;
  }

  return [
    rendered.isInterfaceAggregate
      ? edgePath(rendered, 'svsch-edge svsch-edge-interface-bg', rendered.edgeRender.path, false)
      : '',
    rendered.isStructAggregate
      ? edgePath(rendered, 'svsch-edge svsch-edge-struct-bg', rendered.edgeRender.path, false)
      : '',
    edgePath(
      rendered,
      [
        'svsch-edge',
        rendered.isStructAggregate ? 'svsch-edge-struct' : '',
        rendered.isInterfaceAggregate ? 'svsch-edge-interface' : '',
        rendered.isThickWire ? 'svsch-edge-thick' : ''
      ].filter(Boolean).join(' '),
      rendered.edgeRender.path
    )
  ].filter(Boolean);
}

function renderPromotedStackFanout(rendered: RenderedEdge, fanout: PromotedStackFanout): string[] {
  const gradientId = rendered.promotedFanoutGradientId;
  return [
    [
      '<defs>',
      `<linearGradient id="${escapeAttr(gradientId)}" gradientUnits="userSpaceOnUse" x1="${formatNumber(fanout.barStart.x)}" y1="${formatNumber(fanout.barStart.y)}" x2="${formatNumber(fanout.barEnd.x)}" y2="${formatNumber(fanout.barEnd.y)}">`,
      '<stop offset="0%" class="svsch-stack-gradient-front-stop" />',
      '<stop offset="50%" class="svsch-stack-gradient-middle-stop" />',
      '<stop offset="100%" class="svsch-stack-gradient-back-stop" />',
      '</linearGradient>',
      '</defs>'
    ].join('\n'),
    edgePath(
      rendered,
      [
        'svsch-edge',
        rendered.isStructAggregate ? 'svsch-edge-struct' : '',
        rendered.isInterfaceAggregate ? 'svsch-edge-interface' : '',
        rendered.isThickWire ? 'svsch-edge-thick' : ''
      ].filter(Boolean).join(' '),
      fanout.trunk
    ),
    edgePath(rendered, 'svsch-edge svsch-edge-stacked-breakout', fanout.bar, false, `stroke: url(#${gradientId})`),
    ...fanout.branches.map((branch) => edgePath(
      rendered,
      `svsch-edge svsch-edge-stacked-side svsch-edge-stacked-side-${branch.layerId} ${stackedLayerEdgeClass(branch.layerId)}${rendered.isThickWire ? ' svsch-edge-thick' : ''}`,
      branch.path
    ))
  ];
}

function renderConvergingStackPaths(rendered: RenderedEdge): string[] {
  return [
    [
      '<defs>',
      ...rendered.convergingStackPaths.map((stackPath) => {
        const gradientId = convergingStackGradientId(rendered, stackPath.layerId);
        return [
          `<linearGradient id="${escapeAttr(gradientId)}" gradientUnits="userSpaceOnUse" x1="${formatNumber(stackPath.start.x)}" y1="${formatNumber(stackPath.start.y)}" x2="${formatNumber(stackPath.end.x)}" y2="${formatNumber(stackPath.end.y)}">`,
          `<stop offset="0%" class="${stackedLayerGradientStopClass(stackPath.layerId)}" />`,
          '<stop offset="78%" class="svsch-stack-gradient-regular-stop" />',
          '<stop offset="100%" class="svsch-stack-gradient-regular-stop" />',
          '</linearGradient>'
        ].join('\n');
      }),
      '</defs>'
    ].join('\n'),
    ...rendered.convergingStackPaths.map((stackPath) => edgePath(
      rendered,
      [
        'svsch-edge',
        'svsch-edge-stacked-converge',
        stackedLayerEdgeClass(stackPath.layerId),
        rendered.isStructAggregate ? 'svsch-edge-struct' : '',
        rendered.isInterfaceAggregate ? 'svsch-edge-interface' : '',
        rendered.isThickWire ? 'svsch-edge-thick' : ''
      ].filter(Boolean).join(' '),
      stackPath.path,
      true,
      `stroke: url(#${convergingStackGradientId(rendered, stackPath.layerId)})`
    ))
  ];
}

function renderJumpHalos(rendered: RenderedEdge): string[] {
  return rendered.jumpHalos.map((halo, index) => (
    `<path class="svsch-edge-jump-halo" d="${escapeAttr(halo.path)}" style="stroke-width: ${formatNumber(halo.strokeWidth)}" data-edge-id="${escapeAttr(rendered.edge.id)}" data-jump-index="${index}" />`
  ));
}

function renderOverlapHints(rendered: RenderedEdge): string[] {
  return rendered.overlapHints.map((hint) => (
    `<path class="svsch-edge-overlap-hint" d="${escapeAttr(hint.path)}" data-edge-id="${escapeAttr(rendered.edge.id)}" data-overlap-id="${escapeAttr(hint.id)}" />`
  ));
}

function renderNetJunctions(rendered: RenderedEdge): string[] {
  if (rendered.netJunctions.length === 0) {
    return [];
  }
  const useStackedJunctionDots = rendered.sourceIsArray && rendered.isNetLeader && !rendered.isInterfaceAggregate && !rendered.isStructAggregate;
  return rendered.netJunctions.map((junction) => {
    if (useStackedJunctionDots) {
      return [
        `<g class="svsch-edge-junction-stacked" data-junction-id="${escapeAttr(junction.id)}">`,
        ...(() => { const junctionLayers = arrayStackLayersFor(rendered.isThickWire); return [
          { layer: junctionLayers.front, opacity: 1 },
          { layer: junctionLayers.middle, opacity: 0.75 },
          { layer: junctionLayers.back, opacity: 0.5 }
        ]; })().map(({ layer, opacity }) => (
          `<circle class="svsch-edge-junction svsch-edge-junction-stacked-dot" cx="${formatNumber(junction.x + layer.dx)}" cy="${formatNumber(junction.y + layer.dy)}" r="2.15" style="opacity: ${opacity}" />`
        )),
        '</g>'
      ].join('\n');
    }
    return `<circle class="svsch-edge-junction${rendered.isInterfaceAggregate ? ' svsch-edge-junction-interface' : ''}${rendered.isStructAggregate ? ' svsch-edge-junction-struct' : ''}" cx="${formatNumber(junction.x)}" cy="${formatNumber(junction.y)}" r="${rendered.isInterfaceAggregate || rendered.isStructAggregate ? '6.5' : '4.75'}" data-junction-id="${escapeAttr(junction.id)}" />`;
  });
}

function edgePath(rendered: RenderedEdge, className: string, d: string, includeNetKey = true, style?: string): string {
  const classes = [
    className,
    generateStateClass(rendered.edge.metadata?.generateActiveState, 'generate-edge')
  ].filter(Boolean).join(' ');
  return [
    `<path class="${escapeAttr(classes)}"`,
    `data-edge-id="${escapeAttr(rendered.edge.id)}"`,
    includeNetKey ? `data-net-key="${escapeAttr(rendered.netKey)}"` : '',
    style ? `style="${escapeAttr(style)}"` : '',
    `d="${escapeAttr(d)}"`,
    '/>'
  ].filter(Boolean).join(' ');
}

function generateStateClass(state: string | undefined, prefix: string): string | undefined {
  if (state === 'active') return `${prefix}-active`;
  if (state === 'inactive') return `${prefix}-inactive`;
  return undefined;
}

function buildNetEdgeIdsByNet(edges: RenderedEdgeBase[]): Map<string, string[]> {
  const byNet = new Map<string, string[]>();
  for (const edge of edges) {
    const ids = byNet.get(edge.netKey) ?? [];
    ids.push(edge.edge.id);
    byNet.set(edge.netKey, ids);
  }
  for (const ids of byNet.values()) {
    ids.sort();
  }
  return byNet;
}

function lineJumpHalos(render: LineJumpRender): LineJumpHalo[] {
  if (render.jumpHalos && render.jumpHalos.length > 0) {
    return render.jumpHalos;
  }
  const paths = render.jumpPaths.length > 0 ? render.jumpPaths : jumpHaloPathsFromPath(render.path);
  return paths.map((path) => ({ path, strokeWidth: 12 }));
}

function jumpHaloPathsFromPath(path: string): string[] {
  const halos: string[] = [];
  const pattern = /L (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) Q (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g;
  let match = pattern.exec(path);

  while (match) {
    halos.push(`M ${match[1]} ${match[2]} Q ${match[3]} ${match[4]} ${match[5]} ${match[6]}`);
    match = pattern.exec(path);
  }

  return halos;
}

function convergingStackGradientId(rendered: RenderedEdge, layerId: ArrayStackLayerId): string {
  return `svsch-stack-converge-gradient-${layerId}-${stableFragmentId(rendered.edge.id)}`;
}

function aggregateInputs(node: PositionedNode): DiagramPort[] {
  return node.ports
    .filter(isInputSidePort)
    .filter((port) => port.width !== 'interface');
}

function nodeObstacles(nodes: PositionedNode[]): NodeObstacle[] {
  return nodes.map((node) => {
    const size = diagramNodeDimensions(node);
    return {
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width: size.width,
      height: size.height
    };
  });
}

function renderEdgeLabel(label: string, points: OrthogonalPoint[], aliasNames?: string[], generateActiveState?: string): string {
  const point = pointNearPathStart(points) ?? { x: 0, y: 0 };
  const hasAliases = aliasNames !== undefined && aliasNames.length > 0;
  const aliasMarker = hasAliases
    ? `<tspan class="hdl-net-label-alias-marker" dy="-4">*<title>Also declared as: ${escapeXml(aliasNames!.join(', '))}</title></tspan>`
    : '';
  // Unlike the edge path (dimmed per-<path> via edgePath()'s own class list),
  // this text sits outside that per-path styling, so the same inactive-arm
  // dimming needs to be applied here directly to stay visually consistent
  // with the wire it labels.
  const classes = ['svsch-edge-label', generateStateClass(generateActiveState, 'generate-edge')].filter(Boolean).join(' ');
  // Plain text sitting just above the wire, matching the cut-net label
  // convention (.hdl-net-label-text) — no box/background of its own.
  // Left-anchored at the lead point (matching the webview) rather than
  // centered on it, so the text grows away from the block the wire just
  // left instead of overlapping back into it.
  return `<text class="${escapeAttr(classes)}" x="${formatNumber(point.x)}" y="${formatNumber(point.y - 6)}" text-anchor="start">${escapeXml(label)}${aliasMarker}</text>`;
}

function renderNode(node: PositionedNode): string;
function renderNode(node: PositionedNode, arrayConnections: ArrayConnection[]): string;
function renderNode(node: PositionedNode, arrayConnections: ArrayConnection[] = []): string {
  const { width, height } = diagramNodeDimensions(node);
  if (node.kind === 'netLabel') {
    const cutNet = node.metadata?.cutNet;
    const handleSide = (cutNet?.handleSide ?? 'left') as 'left' | 'right' | 'top' | 'bottom';
    const isInterface = cutNet?.edgeStyle?.aggregate === 'interface';
    const isStruct = cutNet?.edgeStyle?.aggregate === 'struct';
    const isSourceStacked = cutNet?.isSourceStacked ?? false;
    const align = cutNet?.align as 'start' | 'end' | undefined;
    const role = cutNet?.role ?? 'sink';
    const isRenamed = cutNet?.isRenamed === true;
    const midX = width / 2;
    const midY = height / 2;

    // Wire paths — reuses NetLabelWire.tsx's NetLabelWirePaths (single source of truth)
    const wireEl = normalizeJsxNode(NetLabelWirePaths({ handleSide, edgeStyle: cutNet?.edgeStyle, align, isSourceStacked, width, height }));
    const wirePaths = renderToStaticMarkup(React.createElement('svg', null, wireEl)).replace(/^<svg>/, '').replace(/<\/svg>$/, '');

    // Array stack leads
    let leadsHtml = '';
    if (isSourceStacked) {
      const leadsEl = normalizeJsxNode(SvgArrayStackLeads({ side: handleSide, width, y: midY, trimSink: role === 'source', wide: cutNet?.edgeStyle?.thick === true, thick: cutNet?.edgeStyle?.thick === true }));
      leadsHtml = '\n' + renderToStaticMarkup(React.createElement('svg', null, leadsEl)).replace(/^<svg>/, '').replace(/<\/svg>$/, '');
    }

    // Label text above wire — matching webview CSS: align=start → left:0, align=end → right:0
    // CSS: bottom: calc(50% + textGap) → text bottom at midY - textGap
    const textGap = isInterface || isSourceStacked ? 8 : isStruct ? 5 : 2;
    const textY = midY - textGap - 6.5; // 6.5 = half of 13px line-height
    const textPad = 3; // matches CSS padding: 0 3px on .hdl-net-label-text
    const textX = align === 'end' ? width - textPad : textPad;
    const textAnchor = align === 'end' ? 'end' : 'start';
    const textClass = `svsch-net-label${isRenamed ? ' hdl-net-label-text-synthetic' : ''}`;
    const textHtml = `<text class="${escapeAttr(textClass)}" x="${formatNumber(textX)}" y="${formatNumber(textY)}" text-anchor="${textAnchor}" dominant-baseline="middle">${escapeXml(node.label)}</text>`;

    const content = wirePaths + leadsHtml + '\n' + textHtml + nodeErrorOutline(node, width, height) + nodeWarningIcon(node, width, height);
    const classes = [
      'svsch-node',
      'hdl-net-label',
      generateStateClass(node.metadata?.generateActiveState, 'generate-node') ?? '',
      node.invalid ? 'svsch-node-invalid' : ''
    ].filter(Boolean).join(' ');
    return `<g class="${escapeAttr(classes)}" data-node-id="${escapeAttr(node.id)}" data-node-kind="${escapeAttr(node.kind)}" transform="translate(${formatNumber(node.position.x)} ${formatNumber(node.position.y)})">${content}</g>`;
  }

  const classes = nodeWrapperClasses(node);
  const svgClasses = ['hdl-node-svg', node.kind === 'mux' || node.kind === 'select' ? 'mux-skin' : '', node.kind === 'inverter' ? 'inverter-skin' : '']
    .filter(Boolean)
    .join(' ');
  const content = renderNodeComponent(node, width, height, arrayConnections);
  return [
    `<g class="${escapeAttr(classes)}" data-node-id="${escapeAttr(node.id)}" data-node-kind="${escapeAttr(node.kind)}" transform="translate(${formatNumber(node.position.x)} ${formatNumber(node.position.y)})">`,
    `<svg class="${escapeAttr(svgClasses)}" width="${formatNumber(width)}" height="${formatNumber(height)}" aria-hidden="true">`,
    content,
    '</svg>',
    nodeErrorOutline(node, width, height),
    nodeWarningIcon(node, width, height),
    '</g>'
  ].filter(Boolean).join('\n');
}

// Error highlight for a block overlapping an unrelated generate arm. SVG-skinned
// nodes reuse their real selection paths; rectangular nodes get the same
// straddling rectangle used by the webview selection outline.
function nodeErrorOutline(node: PositionedNode, width: number, height: number): string {
  if (!node.invalid) return '';
  if (nodeUsesSvgSelectionOutline(node)) return '';
  return `<rect class="svsch-node-error-outline" x="-1.25" y="-1.25" width="${formatNumber(width + 2.5)}" height="${formatNumber(height + 2.5)}" />`;
}

function nodeWarningIcon(node: PositionedNode, width: number, height: number): string {
  if (!node.warningNote) return '';
  const center = nodeWarningIconCenter(node, width, height);
  return [
    `<g class="svsch-node-warning" aria-label="${escapeAttr(node.warningNote)}">`,
    `<title>${escapeXml(node.warningNote)}</title>`,
    `<text x="${formatNumber(center.x)}" y="${formatNumber(center.y)}" text-anchor="middle">⚠</text>`,
    '</g>'
  ].join('\n');
}

function nodeUsesSvgSelectionOutline(node: PositionedNode): boolean {
  if (nodeIsArrayNode(node)) return false;
  if (node.kind === 'port' || (node.kind === 'interface' && structRole(node) === 'port')) return true;
  if (node.kind === 'mux' || node.kind === 'select' || node.kind === 'alu' || node.kind === 'inverter') return true;
  return node.kind === 'interface' && structRole(node) !== 'modport';
}

function buildArrayConnectionsByNode(view: DiagramViewModel): Map<string, ArrayConnection[]> {
  const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
  const connectionsByNode = new Map<string, ArrayConnection[]>();
  const addConnection = (nodeId: string, connection: ArrayConnection) => {
    const connections = connectionsByNode.get(nodeId) ?? [];
    if (!connections.some((existing) => existing.portId === connection.portId && existing.role === connection.role)) {
      connections.push(connection);
    }
    connectionsByNode.set(nodeId, connections);
  };

  for (const edge of view.edges) {
    if (!edge.isStacked) {
      continue;
    }
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const sourceIsArray = sourceNode ? nodeIsArrayNode(sourceNode) : false;
    const targetIsArray = targetNode ? nodeIsArrayNode(targetNode) : false;
    // Ports synthesized from procedural code (register/mux ports built from
    // always_ff/case blocks) don't always carry a reliable width of their
    // own, so thickness is derived from the edge (both endpoints) rather
    // than the local port alone.
    const thick = edgeIsThick(edge, sourceNode, targetNode);
    if (sourceIsArray) {
      addConnection(edge.source, { portId: edge.sourcePort, role: 'source', thick });
      addConnection(edge.target, { portId: edge.targetPort, role: 'target', thick });
    }
    if (targetIsArray) {
      addConnection(edge.target, { portId: edge.targetPort, role: 'target', thick });
    }
  }

  return connectionsByNode;
}

type NodeSvgComponent = (props: NodeSvgProps) => React.ReactNode;

function renderNodeComponent(node: PositionedNode, width: number, height: number, arrayConnections: ArrayConnection[]): string {
  const Component = nodeSvgComponent(node);
  const rendered = normalizeJsxNode(Component({ node, width, height, arrayConnections }));
  const wrapped = renderToStaticMarkup(React.createElement('svg', null, rendered));
  return wrapped.replace(/^<svg>/, '').replace(/<\/svg>$/, '');
}

function normalizeJsxNode(node: unknown): React.ReactNode {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return null;
  }
  if (typeof node === 'string' || typeof node === 'number' || React.isValidElement(node)) {
    return node as React.ReactNode;
  }
  if (Array.isArray(node)) {
    return node.map((child, index) => ensureReactKey(normalizeJsxNode(child), `svsch-${index}`));
  }
  if (!isPlaywrightJsx(node)) {
    return node as React.ReactNode;
  }

  const props = node.props ?? {};
  const normalizedProps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    normalizedProps[key] = key === 'children' ? normalizeJsxNode(value) : value;
  }

  if (isPlaywrightFragment(node.type)) {
    return React.createElement(React.Fragment, null, normalizedProps.children as React.ReactNode);
  }
  if (typeof node.type === 'function') {
    return normalizeJsxNode(node.type(normalizedProps));
  }

  if (node.key !== undefined) {
    normalizedProps.key = node.key;
  }
  return React.createElement(node.type, normalizedProps);
}

function ensureReactKey(node: React.ReactNode, key: string): React.ReactNode {
  if (Array.isArray(node)) {
    return node.map((child, index) => ensureReactKey(child, `${key}-${index}`));
  }
  if (React.isValidElement(node) && node.key === null) {
    return React.cloneElement(node, { key } as React.Attributes);
  }
  return node;
}

interface PlaywrightJsxNode {
  __pw_type: 'jsx';
  type: string | ((props: Record<string, unknown>) => unknown) | PlaywrightJsxFragment;
  props?: Record<string, unknown>;
  key?: string;
}

interface PlaywrightJsxFragment {
  __pw_jsx_fragment: true;
}

function isPlaywrightJsx(value: unknown): value is PlaywrightJsxNode {
  return typeof value === 'object' && value !== null && (value as { __pw_type?: unknown }).__pw_type === 'jsx';
}

function isPlaywrightFragment(value: unknown): value is PlaywrightJsxFragment {
  return typeof value === 'object' && value !== null && (value as { __pw_jsx_fragment?: unknown }).__pw_jsx_fragment === true;
}

function nodeSvgComponent(node: DiagramNode): NodeSvgComponent {
  if (node.kind === 'register') return RegisterNodeSvg;
  if (node.kind === 'latch') return LatchNodeSvg;
  if (node.kind === 'literal') return LiteralNodeSvg;
  if (node.kind === 'replicate') return ReplicateNodeSvg;
  if (node.kind === 'inverter') return InverterNodeSvg;
  if (node.kind === 'port' || (node.kind === 'interface' && structRole(node) === 'port')) return PortNodeSvg;
  if (node.kind === 'comb') return CombNodeSvg;
  if (node.kind === 'loop') return LoopNodeSvg;
  if (node.kind === 'mux') return MuxNodeSvg;
  if (node.kind === 'select') return SelectNodeSvg;
  if (node.kind === 'alu') return AluNodeSvg;
  if (node.kind === 'bus' || node.kind === 'struct' || node.kind === 'interface') return BusNodeSvg;
  return InstanceNodeSvg;
}

function nodeWrapperClasses(node: PositionedNode): string {
  if (node.kind === 'port' || (node.kind === 'interface' && structRole(node) === 'port')) {
    const port = node.ports[0];
    const direction = port?.direction ?? 'unknown';
    const isInterfacePort = Boolean(
      port?.typeName && port.modportName !== undefined
      || port?.typeName?.endsWith('_if')
      || port?.typeName?.endsWith('if')
    );
    const isSkinnedPort = direction === 'input' || direction === 'output' || direction === 'inout' || isInterfacePort;
    return [
      'svsch-node',
      'hdl-node',
      'hdl-node-port',
      node.kind === 'interface' ? 'hdl-interface-node' : '',
      `hdl-port-${direction}`,
      isSkinnedPort ? 'hdl-port-skinned' : '',
      isInterfacePort ? 'hdl-port-interface' : '',
      nodeIsArrayNode(node) ? 'hdl-node-array' : '',
      generateStateClass(node.metadata?.generateActiveState, 'generate-node') ?? '',
      node.invalid ? 'svsch-node-invalid' : ''
    ].filter(Boolean).join(' ');
  }

  if (node.kind === 'bus' || node.kind === 'struct' || node.kind === 'interface') {
    return busWrapperClasses(node);
  }

  return [
    'svsch-node',
    'hdl-node',
    `hdl-node-${node.kind}`,
    node.kind === 'register' || node.kind === 'latch' ? 'hdl-register-node' : '',
    node.kind === 'instance' && instanceParameterRows(node) > 0 ? 'hdl-node-has-params' : '',
    nodeIsArrayNode(node) ? 'hdl-node-array' : '',
    generateStateClass(node.metadata?.generateActiveState, 'generate-node') ?? '',
    node.invalid ? 'svsch-node-invalid' : ''
  ].filter(Boolean).join(' ');
}

function busWrapperClasses(node: PositionedNode): string {
  const role = structRole(node);
  const isInterface = node.kind === 'interface';
  const isInterfaceModport = isInterface && role === 'modport';
  const isInterfaceInstance = isInterface && role !== 'modport' && role !== 'port' && !node.id.startsWith('interface_type:');
  const aggregatePorts = isInterface
    ? node.ports.filter((port) => port.width !== 'interface' || port.preferredSide)
    : node.ports;
  const sidePorts = isInterfaceInstance
    ? aggregatePorts.filter((port) => port.width === 'interface' || (port.direction !== 'input' && port.direction !== 'output'))
    : aggregatePorts;
  const aggregateInputs = sidePorts.filter(isInputSidePort);
  const isComposition = node.kind === 'struct'
    ? role === 'composition'
    : isInterface
      ? false
      : aggregateInputs.length > 1;
  const isArrayComposition = node.kind === 'bus' && isComposition && node.metadata?.aggregateKind === 'array';
  const isArrayBreakout = node.kind === 'bus' && !isComposition && node.metadata?.aggregateKind === 'array';

  return [
    'svsch-node',
    'hdl-bus-node',
    node.kind === 'struct' ? 'hdl-struct-node' : '',
    isInterface ? 'hdl-interface-node' : '',
    isInterfaceModport ? 'hdl-interface-modport' : '',
    isInterfaceInstance ? 'hdl-interface-instance' : '',
    isComposition ? 'hdl-bus-composition' : 'hdl-bus-breakout',
    isArrayComposition ? 'hdl-bus-array-composition' : '',
    isArrayBreakout ? 'hdl-bus-array-breakout' : '',
    nodeIsArrayNode(node) ? 'hdl-node-array' : '',
    generateStateClass(node.metadata?.generateActiveState, 'generate-node') ?? '',
    node.invalid ? 'svsch-node-invalid' : ''
  ].filter(Boolean).join(' ');
}


function diagramBounds(nodes: PositionedNode[], edges: RenderedEdge[], regions: PositionedGenerateRegion[], padding: number): RectBounds {
  const bounds: RectBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };

  for (const node of nodes) {
    const size = diagramNodeDimensions(node);
    includeBounds(bounds, node.position.x, node.position.y);
    includeBounds(bounds, node.position.x + size.width, node.position.y + size.height);
    if (node.warningNote) {
      includeBounds(bounds, node.position.x + size.width + 24, node.position.y - 24);
    }
  }

  for (const edge of edges) {
    for (const point of edge.points) {
      includeBounds(bounds, point.x, point.y);
    }
  }

  for (const region of regions) {
    includeBounds(bounds, region.bounds.x, region.bounds.y - diagramSizing.gridSize);
    includeBounds(bounds, region.bounds.x + region.bounds.width, region.bounds.y + region.bounds.height);
    if (region.warningNote) {
      // The warning icon sits 20px out from the top-right corner; keep it in frame.
      includeBounds(bounds, region.bounds.x + region.bounds.width + 24, region.bounds.y - 24);
    }
  }

  if (!Number.isFinite(bounds.minX)) {
    bounds.minX = 0;
    bounds.minY = 0;
    bounds.maxX = diagramSizing.nodeWidth;
    bounds.maxY = diagramSizing.nodeHeight;
  }

  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding
  };
}

function includeBounds(bounds: RectBounds, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, '');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeXml(value).replace(/"/g, '&quot;');
}
