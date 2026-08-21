import type { DiagramNode, DiagramPort } from '../ir/types';
import { nodeTypeName, nodeWidth } from '../ir/nodeMetadata';
import { diagramSizing, normalizeWidth, snapUpToGrid } from './constants';

export interface DiagramNodeDimensions {
  width: number;
  height: number;
}

/** Ports grouped and counted the way every kind's sizing formula consumes them. */
export interface NodeSizingContext {
  sideInputs: DiagramPort[];
  outputs: DiagramPort[];
  topPorts: DiagramPort[];
  bottomPorts: DiagramPort[];
  inputsCount: number;
  outputsCount: number;
  portRows: number;
}

/** Per-kind sizing formula, keyed off the shared context computed in nodeSizing.ts. */
export interface NodeSizingStrategy {
  height(node: DiagramNode, ctx: NodeSizingContext): number;
  width(node: DiagramNode, ctx: NodeSizingContext): number;
}

export function instanceParameterRows(node: DiagramNode): number {
  if (node.kind !== 'instance') return 0;
  return node.instanceParameters?.length ?? node.metadata?.instanceParameters?.length ?? 0;
}

/** X coordinate of the inverter output handle — right edge of the output bubble. */
export function inverterGeometryWidth(): number {
  const g = diagramSizing.gridSize;
  const bubbleRadius = Math.min(g / 4, g / 6);
  return (g * Math.sqrt(3)) / 2 + 2 + bubbleRadius * 2;
}

export function nodeTitle(node: DiagramNode): string {
  const metadataWidth = normalizeWidth(nodeWidth(node));
  const outputWidth =
    node.kind === 'register' || node.kind === 'latch' || node.kind === 'literal'
      ? normalizeWidth(node.ports.find((port) => port.direction === 'output')?.width)
      : undefined;
  const width = metadataWidth ?? outputWidth;
  const typeName = nodeTypeName(node);
  const base = node.label;
  const suffix = typeName || width;
  return suffix &&
    node.kind !== 'comb' &&
    node.kind !== 'alu' &&
    node.kind !== 'inverter' &&
    node.kind !== 'gate' &&
    node.kind !== 'comparator' &&
    node.kind !== 'zext' &&
    node.kind !== 'bus' &&
    node.kind !== 'struct' &&
    node.kind !== 'interface' &&
    node.kind !== 'replicate'
    ? `${base} ${suffix}`
    : base;
}

export function portNodeLabel(node: DiagramNode): string {
  const port = node.ports[0];
  if (!port) {
    return nodeTitle(node);
  }
  const width = normalizeWidth(port.widthExpression ?? port.width);
  const typeName = port.typeName;
  const suffix =
    typeName && port.modportName ? `${typeName}.${port.modportName}` : typeName || width;
  return suffix ? `${node.label} ${suffix}` : node.label;
}

export function portLabel(
  port: DiagramPort,
  showWidth: boolean,
  showType: boolean = true,
  collapseWidth: boolean = false,
): string {
  const label = port.label ?? port.name;
  const width = normalizeWidth(port.widthExpression ?? port.width);
  const displayWidth = collapseWidth && width ? '[]' : width;
  const isInterface = width === 'interface' || port.modportName !== undefined;
  const isStruct = !isInterface && port.typeName !== undefined;
  const typeName = showType ? port.typeName : undefined;

  let suffix = '';
  if (isInterface || isStruct) {
    suffix = '{}';
  } else if (collapseWidth && showWidth && displayWidth) {
    suffix = displayWidth;
  } else {
    const typeOrWidth = typeName || (showWidth ? displayWidth : undefined);
    if (typeOrWidth) {
      suffix = ` ${typeOrWidth}`;
    }
  }

  return `${label}${suffix}`;
}

export function sideLabelWidth(node: DiagramNode, ports: DiagramPort[]): number {
  const showPortTypes = node.kind !== 'instance';
  return Math.max(
    0,
    ...ports.map((port) =>
      measureText(portLabel(port, true, showPortTypes, node.kind === 'instance')),
    ),
  );
}

export function measureText(text: string): number {
  return text.length * diagramSizing.textWidth;
}

export function snappedWidth(minWidth: number, neededWidth: number, snap = snapUpToGrid): number {
  return Math.max(minWidth, snap(neededWidth));
}
