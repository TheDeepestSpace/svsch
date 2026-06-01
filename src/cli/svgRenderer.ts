import type { DiagramEdge, DiagramNode, DiagramPort, DiagramViewModel, PositionedNode } from '../ir/types';
import { diagramSizing, normalizeWidth } from '../diagram/constants';
import { diagramNodeDimensions } from '../diagram/nodeSizing';
import { portSkinPath, interfaceSkinPath, interfaceTopHatHeight, interfaceTopPortX, orderedInterfaceSidePorts, distributedInterfaceSideCenters } from '../diagram/interfaceGeometry';
import { selectPortLabel } from '../diagram/selectLabels';
import { nodeIsArrayNode, nodeOperation, nodeTypeName, registerClockSignal, registerResetActiveLow, registerResetSignal, repeatExpression, structFields, structRole } from '../ir/nodeMetadata';
import { edgeNetKey } from '../ir/edgeNet';
import { elkSideToHandleSide, renderedPortGeometry } from '../layout/mergeLayout';
import { HdlPosition } from '../webview/orthogonal/types';
import { makeOrthogonal, normalizeRoutePoints } from '../webview/orthogonal/logic';
import { pathFromPoints, type OrthogonalPoint } from '../core/pathUtils';
import { ARRAY_STACK_LAYERS } from '../webview/arrayStackGeometry';
import { themeCss, type SvgThemeName } from './theme';
import reactFlowCss from '@xyflow/react/dist/style.css?raw';
import extensionCss from '../webview/styles.css?raw';

export interface SvgRendererOptions {
  theme?: SvgThemeName;
  padding?: number;
}

interface RectBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface RenderedEdge {
  edge: DiagramEdge;
  points: OrthogonalPoint[];
  path: string;
}

const DEFAULT_PADDING = diagramSizing.gridSize * 2;

export function renderSvg(view: DiagramViewModel, options: SvgRendererOptions = {}): string {
  const theme = options.theme ?? 'dark';
  const padding = options.padding ?? DEFAULT_PADDING;
  const nodesById = new Map(view.nodes.map((node) => [node.id, node]));
  const renderedEdges = view.edges
    .map((edge) => renderEdgeGeometry(edge, nodesById))
    .filter((edge): edge is RenderedEdge => edge !== undefined);
  const bounds = diagramBounds(view.nodes, renderedEdges, padding);
  const width = Math.max(diagramSizing.gridSize * 8, Math.ceil(bounds.maxX - bounds.minX));
  const height = Math.max(diagramSizing.gridSize * 6, Math.ceil(bounds.maxY - bounds.minY));
  const offsetX = -bounds.minX;
  const offsetY = -bounds.minY;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="svsch-diagram" role="img" aria-label="${escapeXml(view.moduleName)} diagram">`,
    renderDefs(),
    '<style>',
    reactFlowCss,
    extensionCss,
    themeCss(theme),
    svgBridgeCss(),
    '</style>',
    `<g transform="translate(${formatNumber(offsetX)} ${formatNumber(offsetY)})">`,
    '<g class="svsch-edges">',
    ...renderedEdges.map(renderEdge),
    '</g>',
    '<g class="svsch-nodes">',
    ...view.nodes.map((node) => renderNode(node)),
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
    '    <line class="svsch-interface-stripe" x1="0" y1="0" x2="0" y2="10" />',
    '  </pattern>',
    '</defs>'
  ].join('\n');
}

// Thin SVG bridge — only covers what HTML CSS can't do for SVG elements.
// Edge styling, interface stripes, stacked edges, etc. are already correct
// in styles.css and apply directly to SVG paths.
function svgBridgeCss(): string {
  return `
/* ── No background on the root SVG element ───────────────── */
.svsch-diagram { background: none; }
/* ── Node shapes: HTML background/box-shadow → SVG fill/stroke ── */
.svsch-node-shape {
  fill: var(--vscode-editorWidget-background);
  stroke: var(--vscode-editor-foreground);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.svsch-node-array-shadow {
  fill: transparent;
  stroke: currentColor;
  stroke-width: 1.15;
  opacity: 0.42;
}
/* Per-kind stroke mirrors each node kind's box-shadow colour in the webview */
.hdl-node-instance .svsch-node-shape,
.hdl-node-module .svsch-node-shape   { stroke: var(--vscode-charts-blue); }
.hdl-node-register .svsch-node-shape { stroke: var(--vscode-charts-green); }
.hdl-node-comb .svsch-node-shape     { stroke: var(--vscode-charts-red); }
.hdl-node-loop .svsch-node-shape     { stroke: var(--vscode-charts-purple); }
.hdl-bus-node .svsch-node-shape,
.hdl-struct-node .svsch-node-shape   { stroke: var(--vscode-descriptionForeground); }
.hdl-node-port .svsch-node-shape     { stroke: var(--vscode-charts-yellow); }
.hdl-node-literal .svsch-node-shape  { fill: var(--vscode-editor-background); stroke: var(--vscode-editor-foreground); }
.hdl-node-replicate .svsch-node-shape { fill: var(--vscode-editor-background); stroke: var(--vscode-charts-red); }
/* Shaped nodes: fill mirrors webview node-skin-body colours */
.hdl-node-mux .svsch-node-shape,
.hdl-node-select .svsch-node-shape {
  fill: var(--svsch-mux-fill);
  stroke: var(--vscode-charts-purple);
}
.hdl-node-alu .svsch-node-shape {
  fill: var(--svsch-alu-fill);
  stroke: var(--vscode-charts-orange);
}
.hdl-node-inverter .svsch-node-shape {
  fill: var(--vscode-editor-background);
  stroke: var(--vscode-editor-foreground);
}
.hdl-interface-node .svsch-node-shape {
  fill: var(--svsch-interface-fill);
  stroke: var(--svsch-interface-stroke);
}
/* Port skin arrow shapes */
.svsch-port-skin {
  fill: var(--svsch-port-skin-fill);
  stroke: var(--svsch-port-skin-stroke);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.hdl-interface-node .svsch-port-skin {
  fill: var(--svsch-interface-port-fill);
  stroke: var(--vscode-charts-blue);
}
/* ── Text: CSS color does not apply to SVG text elements; use fill ─ */
.svsch-node-title {
  fill: var(--vscode-editor-foreground);
  font-family: var(--vscode-editor-font-family, "Consolas", "Courier New", monospace);
  font-size: 14px;
  font-weight: 600;
  dominant-baseline: middle;
}
.svsch-node-kind {
  fill: var(--vscode-descriptionForeground);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  dominant-baseline: middle;
}
.svsch-port-label,
.svsch-edge-label,
.svsch-net-label {
  fill: var(--vscode-descriptionForeground);
  font-family: var(--vscode-editor-font-family, "Consolas", "Courier New", monospace);
  font-size: 10px;
  dominant-baseline: middle;
}
/* ── Port connection dots (SVG-only elements, no HTML equivalent) ── */
.svsch-port-dot {
  fill: var(--svsch-port-fill);
  stroke: var(--svsch-port-border);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
/* ── Edge label pill (SVG rect, no HTML equivalent) ───── */
.svsch-label-box {
  fill: var(--svsch-label-background);
  stroke: var(--svsch-label-border);
  stroke-width: 1;
}
`.trim();
}

function renderEdgeGeometry(edge: DiagramEdge, nodesById: Map<string, PositionedNode>): RenderedEdge | undefined {
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  if (!source || !target) {
    return undefined;
  }

  const sourcePort = renderedPortGeometry(source, edge.sourcePort);
  const targetPort = renderedPortGeometry(target, edge.targetPort);
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
  const officialPoints = normalizeRoutePoints(
    { routePoints: edge.routePoints, waypoint: edge.waypoint, edge } as any,
    sourcePoint.x,
    sourcePoint.y,
    targetPoint.x,
    targetPoint.y,
    sourcePosition,
    targetPosition,
    edge.sourcePort,
    edge.targetPort
  );
  const points = makeOrthogonal([sourcePoint, ...officialPoints, targetPoint]);
  return { edge, points, path: pathFromPoints(points) };
}

function sideToHdlPosition(side: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'): HdlPosition {
  const handleSide = elkSideToHandleSide(side);
  if (handleSide === 'left') return HdlPosition.Left;
  if (handleSide === 'right') return HdlPosition.Right;
  if (handleSide === 'top') return HdlPosition.Top;
  return HdlPosition.Bottom;
}

function renderEdge(rendered: RenderedEdge): string {
  const { edge, path } = rendered;
  const classes = [
    'svsch-edge',
    edge.metadata?.aggregate === 'struct' ? 'svsch-edge-struct' : '',
    edge.metadata?.aggregate === 'interface' ? 'svsch-edge-interface' : '',
    edge.isStacked ? 'svsch-edge-stacked' : ''
  ].filter(Boolean).join(' ');
  const paths = edge.isStacked
    ? renderStackedEdge(rendered)
    : [
      edge.metadata?.aggregate === 'interface'
        ? `<path class="svsch-edge svsch-edge-interface-bg" d="${escapeAttr(path)}" />`
        : '',
      `<path class="${classes}" data-edge-id="${escapeAttr(edge.id)}" data-net-key="${escapeAttr(edgeNetKey(edge))}" d="${escapeAttr(path)}" />`
    ].filter(Boolean);
  const label = edge.label ? renderEdgeLabel(edge.label, rendered.points) : '';
  return `<g class="svsch-edge-group">${paths.join('\n')}${label}</g>`;
}

function renderStackedEdge(rendered: RenderedEdge): string[] {
  const layers = [
    { className: 'svsch-edge-stacked-back', dx: ARRAY_STACK_LAYERS.back.dx, dy: ARRAY_STACK_LAYERS.back.dy },
    { className: 'svsch-edge-stacked', dx: ARRAY_STACK_LAYERS.middle.dx, dy: ARRAY_STACK_LAYERS.middle.dy },
    { className: 'svsch-edge-stacked-front', dx: ARRAY_STACK_LAYERS.front.dx, dy: ARRAY_STACK_LAYERS.front.dy }
  ];
  const aggregateClass = rendered.edge.metadata?.aggregate === 'struct'
    ? ' svsch-edge-struct'
    : rendered.edge.metadata?.aggregate === 'interface'
      ? ' svsch-edge-interface'
      : '';
  return layers.map((layer) => {
    const points = rendered.points.map((point) => ({ x: point.x + layer.dx, y: point.y + layer.dy }));
    return `<path class="svsch-edge ${layer.className}${aggregateClass}" data-edge-id="${escapeAttr(rendered.edge.id)}" d="${escapeAttr(pathFromPoints(points))}" />`;
  });
}

function renderEdgeLabel(label: string, points: OrthogonalPoint[]): string {
  const point = points[Math.floor(points.length / 2)] ?? { x: 0, y: 0 };
  const width = Math.max(48, label.length * 7 + 12);
  return [
    `<rect class="svsch-label-box" x="${formatNumber(point.x - width / 2)}" y="${formatNumber(point.y - 11)}" width="${formatNumber(width)}" height="22" rx="3" />`,
    `<text class="svsch-edge-label" x="${formatNumber(point.x)}" y="${formatNumber(point.y)}" text-anchor="middle">${escapeXml(label)}</text>`
  ].join('\n');
}

function renderNode(node: PositionedNode): string {
  const { width, height } = diagramNodeDimensions(node);
  const classes = [
    'svsch-node',
    `hdl-node-${node.kind}`,
    node.kind === 'bus' ? 'hdl-bus-node' : '',
    node.kind === 'struct' ? 'hdl-struct-node' : '',
    node.kind === 'interface' ? 'hdl-interface-node' : '',
    nodeIsArrayNode(node) ? 'hdl-node-array' : ''
  ].filter(Boolean).join(' ');
  const local = [
    renderArrayShadow(node, width, height),
    renderNodeShape(node, width, height),
    renderNodeText(node, width, height),
    renderPorts(node, width, height)
  ].filter(Boolean).join('\n');
  return `<g class="${classes}" data-node-id="${escapeAttr(node.id)}" transform="translate(${formatNumber(node.position.x)} ${formatNumber(node.position.y)})">${local}</g>`;
}

function renderArrayShadow(node: DiagramNode, width: number, height: number): string {
  if (!nodeIsArrayNode(node)) {
    return '';
  }
  if (node.kind === 'mux' || node.kind === 'select') {
    return [
      `<path class="svsch-node-array-shadow" transform="translate(${ARRAY_STACK_LAYERS.back.dx} ${ARRAY_STACK_LAYERS.back.dy})" d="${escapeAttr(muxPath(width, height, node.kind === 'select'))}" />`,
      `<path class="svsch-node-array-shadow" transform="translate(${ARRAY_STACK_LAYERS.front.dx} ${ARRAY_STACK_LAYERS.front.dy})" d="${escapeAttr(muxPath(width, height, node.kind === 'select'))}" />`
    ].join('\n');
  }
  return [
    `<rect class="svsch-node-array-shadow" x="${ARRAY_STACK_LAYERS.back.dx}" y="${ARRAY_STACK_LAYERS.back.dy}" width="${width}" height="${height}" rx="5" />`,
    `<rect class="svsch-node-array-shadow" x="${ARRAY_STACK_LAYERS.front.dx}" y="${ARRAY_STACK_LAYERS.front.dy}" width="${width}" height="${height}" rx="5" />`
  ].join('\n');
}

function renderNodeShape(node: DiagramNode, width: number, height: number): string {
  if (node.kind === 'port' || (node.kind === 'interface' && structRole(node) === 'port')) {
    const port = node.ports[0];
    const isHarness = node.kind === 'interface' || Boolean(port?.typeName && (port.modportName !== undefined || port.typeName.endsWith('_if') || port.typeName.endsWith('if')));
    const direction = isHarness ? 'harness' : port?.direction === 'output' ? 'output' : 'input';
    return `<path class="svsch-node-shape svsch-port-skin" d="${escapeAttr(portSkinPath(direction, width, height, diagramSizing.portSkinHeight, diagramSizing.portNoseLength))}" />`;
  }

  if (node.kind === 'mux' || node.kind === 'select') {
    return `<path class="svsch-node-shape" d="${escapeAttr(muxPath(width, height, node.kind === 'select'))}" />`;
  }

  if (node.kind === 'alu') {
    return `<path class="svsch-node-shape" d="${escapeAttr(aluPath(width, height))}" />`;
  }

  if (node.kind === 'inverter') {
    const g = diagramSizing.gridSize;
    const bubbleRadius = Math.min(g / 4, g / 6);
    const side = height;
    const bodyRight = side * Math.sqrt(3) / 2;
    const bubbleCx = bodyRight + bubbleRadius;
    const midY = height / 2;
    const triTop = midY - side / 2;
    const triBottom = midY + side / 2;
    return [
      `<path class="svsch-node-shape" d="M 0 ${formatNumber(triTop)} L ${formatNumber(bodyRight)} ${formatNumber(midY)} L 0 ${formatNumber(triBottom)} Z" />`,
      `<circle class="svsch-node-shape" cx="${formatNumber(bubbleCx)}" cy="${formatNumber(midY)}" r="${formatNumber(bubbleRadius)}" />`
    ].join('\n');
  }

  if (node.kind === 'interface' && structRole(node) !== 'modport') {
    const skin = interfaceInstanceSkin(node, width, height);
    if (skin) {
      return `<path class="svsch-node-shape" d="${escapeAttr(skin)}" />`;
    }
  }

  return `<rect class="svsch-node-shape" x="0" y="0" width="${formatNumber(width)}" height="${formatNumber(height)}" rx="5" />`;
}

function muxPath(width: number, height: number, isSelect: boolean): string {
  if (isSelect) {
    return `M 0 0 L ${formatNumber(width)} 0 L ${formatNumber(width)} ${formatNumber(height)} L 0 ${formatNumber(height)} Z`;
  }
  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = (height - rightSideHeight) / 2;
  const rightBottom = rightTop + rightSideHeight;
  return `M 0 0 L ${formatNumber(width)} ${formatNumber(rightTop)} V ${formatNumber(rightBottom)} L 0 ${formatNumber(height)} Z`;
}

function aluPath(width: number, height: number): string {
  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = (height - rightSideHeight) / 2;
  const rightBottom = rightTop + rightSideHeight;
  const notchX = width / 4;
  const midY = height / 2;
  const slope = rightTop / width;
  const deltaY = slope * notchX;
  return [
    `M 0 0`,
    `L ${formatNumber(width)} ${formatNumber(rightTop)}`,
    `V ${formatNumber(rightBottom)}`,
    `L 0 ${formatNumber(height)}`,
    `V ${formatNumber(midY + deltaY)}`,
    `L ${formatNumber(notchX)} ${formatNumber(midY)}`,
    `L 0 ${formatNumber(midY - deltaY)}`,
    'Z'
  ].join(' ');
}

function interfaceInstanceSkin(node: DiagramNode, width: number, height: number): string | undefined {
  if (node.kind !== 'interface' || structRole(node) === 'modport' || structRole(node) === 'port' || node.id.startsWith('interface_type:')) {
    return undefined;
  }
  const aggregatePorts = node.ports.filter((port) => port.width !== 'interface' || port.preferredSide);
  const topPorts = aggregatePorts.filter((port) => port.direction === 'input' && port.width !== 'interface');
  const bottomPorts = aggregatePorts.filter((port) => port.direction === 'output' && port.width !== 'interface');
  const sidePorts = aggregatePorts.filter((port) => port.width === 'interface' || (port.direction !== 'input' && port.direction !== 'output'));
  const ordered = orderedInterfaceSidePorts(sidePorts);
  const topHatHeight = interfaceTopHatHeight(topPorts.length > 0);
  const bottomHatHeight = interfaceTopHatHeight(bottomPorts.length > 0);
  const shiftY = diagramSizing.gridSize * 3 + diagramSizing.gridSize / 2;
  const unshiftedHeight = Math.max(diagramSizing.gridSize, height - shiftY);
  const leftCenters = distributedInterfaceSideCenters(ordered.left.length, unshiftedHeight, topHatHeight, bottomHatHeight).map((center) => center + shiftY);
  const rightCenters = distributedInterfaceSideCenters(ordered.right.length, unshiftedHeight, topHatHeight, bottomHatHeight).map((center) => center + shiftY);
  return interfaceSkinPath({
    width,
    height,
    leftCenters,
    rightCenters,
    topPortCount: topPorts.length,
    bottomPortCount: bottomPorts.length
  }).path;
}

function renderNodeText(node: DiagramNode, width: number, height: number): string {
  if (node.kind === 'netLabel') {
    return renderNetLabel(node, width, height);
  }
  if (node.kind === 'comb' || node.kind === 'loop') {
    return '';
  }

  if (node.kind === 'alu') {
    return `<text class="svsch-node-title" x="${formatNumber(width / 2)}" y="${formatNumber(height / 2)}" text-anchor="middle">${escapeXml(nodeOperation(node) ?? '+')}</text>`;
  }

  const titleY = node.kind === 'port' || node.kind === 'literal' || node.kind === 'replicate' || node.kind === 'inverter'
    ? height / 2
    : diagramSizing.nodeHeaderHeight / 2;
  const title = node.kind === 'replicate'
    ? repeatLabel(node)
    : nodeTitle(node);
  const kind = node.kind === 'port' ? '' : `<text class="svsch-node-kind" x="${formatNumber(width / 2)}" y="10" text-anchor="middle">${escapeXml(formatNodeKind(node))}</text>`;
  const titleText = `<text class="svsch-node-title" x="${formatNumber(width / 2)}" y="${formatNumber(titleY)}" text-anchor="middle">${escapeXml(title)}</text>`;
  return `${kind}${titleText}`;
}

function renderNetLabel(node: DiagramNode, width: number, height: number): string {
  const cutNet = node.metadata?.cutNet;
  const handleSide = cutNet?.handleSide ?? 'left';
  const midX = width / 2;
  const midY = height / 2;
  const horizontalPath = handleSide === 'top' || handleSide === 'bottom'
    ? cutNet?.align === 'end'
      ? `M ${formatNumber(midX)} ${formatNumber(midY)} H ${formatNumber(width)}`
      : `M 0 ${formatNumber(midY)} H ${formatNumber(midX)}`
    : `M 0 ${formatNumber(midY)} H ${formatNumber(width)}`;
  const verticalPath = handleSide === 'top'
    ? ` M ${formatNumber(midX)} ${formatNumber(midY)} V 0`
    : handleSide === 'bottom'
      ? ` M ${formatNumber(midX)} ${formatNumber(midY)} V ${formatNumber(height)}`
      : '';
  return [
    `<path class="svsch-edge${cutNet?.edgeStyle?.aggregate === 'struct' ? ' svsch-edge-struct' : ''}${cutNet?.edgeStyle?.aggregate === 'interface' ? ' svsch-edge-interface' : ''}" d="${horizontalPath}${verticalPath}" />`,
    `<rect class="svsch-label-box" x="${formatNumber(width * 0.2)}" y="${formatNumber(height * 0.2)}" width="${formatNumber(width * 0.6)}" height="${formatNumber(height * 0.6)}" rx="3" />`,
    `<text class="svsch-net-label" x="${formatNumber(midX)}" y="${formatNumber(midY)}" text-anchor="middle">${escapeXml(node.label)}</text>`
  ].join('\n');
}

function renderPorts(node: DiagramNode, _width: number, _height: number): string {
  if (node.kind === 'netLabel' || node.kind === 'literal' || node.kind === 'replicate' || node.kind === 'inverter' || node.kind === 'alu') {
    return '';
  }

  return node.ports.map((port) => {
    const geometry = renderedPortGeometry(node, port.id);
    if (!geometry) {
      return '';
    }
    const { x, y } = geometry.offset;
    const handleSide = elkSideToHandleSide(geometry.side);
    const label = portLabel(node, port);
    const labelDx = handleSide === 'left' ? 8 : handleSide === 'right' ? -8 : 0;
    const labelDy = handleSide === 'top' ? 13 : handleSide === 'bottom' ? -13 : 0;
    const anchor = handleSide === 'left' ? 'start' : handleSide === 'right' ? 'end' : 'middle';
    return [
      `<circle class="svsch-port-dot" cx="${formatNumber(x)}" cy="${formatNumber(y)}" r="3" />`,
      label ? `<text class="svsch-port-label" x="${formatNumber(x + labelDx)}" y="${formatNumber(y + labelDy)}" text-anchor="${anchor}">${escapeXml(label)}</text>` : ''
    ].join('\n');
  }).join('\n');
}

function nodeTitle(node: DiagramNode): string {
  const typeName = nodeTypeName(node);
  if (node.kind === 'port') {
    const port = node.ports[0];
    const width = normalizeWidth(port?.widthExpression ?? port?.width);
    const suffix = port?.typeName && port.modportName ? `${port.typeName}.${port.modportName}` : port?.typeName || width;
    return suffix ? `${node.label} ${suffix}` : node.label;
  }
  if (node.kind === 'register') {
    const suffix = normalizeWidth(node.ports.find((port) => port.direction === 'output')?.width);
    return suffix ? `${node.label} ${suffix}` : node.label;
  }
  if (node.kind === 'interface' && typeName && structRole(node) !== 'modport') {
    return `${node.label} ${typeName}`;
  }
  return node.label;
}

function repeatLabel(node: DiagramNode): string {
  const repeat = repeatExpression(node);
  return repeat ? `{${repeat}}` : node.label;
}

function portLabel(node: DiagramNode, port: DiagramPort): string {
  if (node.kind === 'port' || (node.kind === 'interface' && structRole(node) === 'port')) {
    return '';
  }
  if (node.kind === 'mux' || node.kind === 'select') {
    return node.kind === 'select' ? selectPortLabel(node, port) : (port.label ?? port.name);
  }
  if (node.kind === 'register') {
    const resetSignal = registerResetSignal(node);
    const clockSignal = registerClockSignal(node);
    if (port.name === clockSignal) return 'CLK';
    if (port.name === resetSignal) return registerResetActiveLow(node) ? 'R\u0305' : 'R';
  }
  const width = normalizeWidth(port.widthExpression ?? port.width);
  const annotation = fieldAnnotation(node, port);
  const suffix = port.typeName ? ' {}' : width ? ` ${width}` : '';
  return `${port.label ?? port.name}${suffix}${annotation ? ` ${annotation}` : ''}`;
}

function fieldAnnotation(node: DiagramNode, port: DiagramPort): string {
  if (node.kind !== 'struct' && node.kind !== 'interface') {
    return '';
  }
  const field = structFields(node).find((candidate) => candidate.name === port.name || candidate.name === port.label);
  return field?.bitRange ?? field?.width ?? field?.typeName ?? '';
}

function formatNodeKind(node: DiagramNode): string {
  if (node.kind === 'alu') return 'ALU';
  if (node.kind === 'comb') return 'COMB';
  if (node.kind === 'mux') return 'MUX';
  if (node.kind === 'select') return 'SELECT';
  if (node.kind === 'register') return 'REGISTER';
  if (node.kind === 'instance') return node.moduleName ?? node.instanceOf ?? 'INSTANCE';
  if (node.kind === 'interface') return structRole(node) === 'modport' ? 'MODPORT' : 'INTERFACE';
  return node.kind.toUpperCase();
}

function diagramBounds(nodes: PositionedNode[], edges: RenderedEdge[], padding: number): RectBounds {
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
  }

  for (const edge of edges) {
    for (const point of edge.points) {
      includeBounds(bounds, point.x, point.y);
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
