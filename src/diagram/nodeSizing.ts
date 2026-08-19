import type { DiagramNode } from '../ir/types';
import { structRole, nodeArrayDimension, nodeIsArrayNode } from '../ir/nodeMetadata';
import { diagramSizing } from './constants';
import {
  distributedInterfaceSideCenters,
  interfaceSkinPath,
  interfaceTopHatHeight,
  orderedInterfaceSidePorts,
  portSkinDirection,
  portSkinTopRightVertex,
} from './interfaceGeometry';
import { muxRightTopY } from './muxGeometry';
import { isInputSidePort } from './portDirection';
import { netLabelSizing } from './netLabelSizing';
import { portSizing } from './portSizing';
import { aggregateSizing } from './aggregateSizing';
import { muxSizing } from './muxSizing';
import { aluSizing } from './aluSizing';
import { inverterSizing } from './inverterSizing';
import { registerSizing } from './registerSizing';
import { combSizing } from './combSizing';
import { replicateSizing } from './replicateSizing';
import { literalSizing } from './literalSizing';
import { gateSizing } from './gateSizing';
import { defaultSizing } from './defaultSizing';
import { inverterGeometryWidth } from './nodeSizingCommon';
import type {
  DiagramNodeDimensions,
  NodeSizingContext,
  NodeSizingStrategy,
} from './nodeSizingCommon';

export type { DiagramNodeDimensions } from './nodeSizingCommon';
export { instanceParameterRows, inverterGeometryWidth } from './nodeSizingCommon';
export { gateBubbleGap, gateBubbleRadius, gateXorGap, gateGeometryWidth } from './gateSizing';

// One strategy object per kind, each owning its own height/width formula —
// see the individual `*Sizing.ts` modules alongside this file. Kinds without
// an entry (instance, latch, loop, unknown, ...) fall back to defaultSizing,
// mirroring the instance/unknown catch-all in HdlNode.tsx.
const sizingStrategies: Partial<Record<DiagramNode['kind'], NodeSizingStrategy>> = {
  netLabel: netLabelSizing,
  port: portSizing,
  bus: aggregateSizing,
  struct: aggregateSizing,
  interface: aggregateSizing,
  mux: muxSizing,
  select: muxSizing,
  alu: aluSizing,
  inverter: inverterSizing,
  gate: gateSizing,
  register: registerSizing,
  comb: combSizing,
  replicate: replicateSizing,
  literal: literalSizing,
};

/**
 * The size a node actually renders/occupies at: the canonical auto-fit size
 * (diagramNodeDimensions), grown per axis to fit a manual resize override if
 * one is saved. Never shrinks below canonical, even if the override is
 * stale (e.g. canonical grew after the override was saved) — see
 * `sizeOverride` on BaseDiagramNode. Every consumer that needs a node's true
 * on-screen/routing footprint (ELK sizing, obstacle bounds, region
 * auto-grow, collision checks) should use this instead of
 * diagramNodeDimensions; diagramNodeDimensions itself stays the pure
 * canonical calculation, since resize logic needs that as its grow-only
 * floor independent of any current override.
 */
export function resolvedNodeDimensions(node: DiagramNode): DiagramNodeDimensions {
  const canonical = diagramNodeDimensions(node);
  const override = node.sizeOverride;
  if (!override) return canonical;
  const grid = diagramSizing.gridSize;
  return {
    width: Math.max(canonical.width, override.width * grid),
    height: Math.max(canonical.height, override.height * grid),
  };
}

export interface NodeOutlineVertex {
  x: number;
  y: number;
}

export interface NodeWarningIconCenter {
  x: number;
  y: number;
}

const arrayBadgeFontSize = 10;
const arrayBadgeStartOffset = 3;
const monospaceCharacterWidth = 0.62;

/**
 * The node outline's right-most vertex (ties broken by smallest y, i.e. the
 * top-most of the right-most points). Rectangular skins have it at the
 * bbox corner; mux/select/alu slope their right edge in from the top, so
 * their true corner sits below y=0; the inverter's true corner is its output
 * bubble, offset from the bbox and vertically centred; port skins (and
 * interface ports, which reuse the port skin) come to a nose point or a
 * vertical edge short of the top-right corner.
 */
export function nodeOutlineTopRightVertex(
  node: DiagramNode,
  width: number,
  height: number,
): NodeOutlineVertex {
  if (node.kind === 'mux' || node.kind === 'select' || node.kind === 'alu') {
    return { x: width, y: muxRightTopY(height) };
  }
  if (node.kind === 'inverter') {
    return { x: inverterGeometryWidth(), y: height / 2 };
  }
  if (node.kind === 'port' || (node.kind === 'interface' && structRole(node) === 'port')) {
    return portSkinTopRightVertex(portSkinDirection(node.ports[0]), width, height);
  }
  if (node.kind === 'interface' && structRole(node) !== 'modport') {
    return interfaceInstanceTopRightVertex(node, width, height);
  }
  return { x: width, y: 0 };
}

/**
 * Centers the warning half a grid outside the outline. Array dimension badges
 * occupy that same top-right space on the skins that render them, so those
 * warnings move far enough right to clear the complete badge text.
 */
export function nodeWarningIconCenter(
  node: DiagramNode,
  width: number,
  height: number,
): NodeWarningIconCenter {
  const vertex = nodeOutlineTopRightVertex(node, width, height);
  const halfGrid = diagramSizing.gridSize / 2;
  let x = vertex.x + halfGrid;
  const arrayDimension = renderedArrayDimensionBadge(node);

  if (arrayDimension) {
    const badgeRight =
      width +
      arrayBadgeStartOffset +
      arrayDimension.length * arrayBadgeFontSize * monospaceCharacterWidth;
    x = Math.max(x, badgeRight + halfGrid);
  }

  return { x, y: vertex.y - halfGrid };
}

function renderedArrayDimensionBadge(node: DiagramNode): string | undefined {
  if (!nodeIsArrayNode(node)) return undefined;
  const dimension = nodeArrayDimension(node);
  if (!dimension) return undefined;

  if (node.kind === 'port' || (node.kind === 'interface' && structRole(node) === 'port')) {
    return dimension;
  }
  if (
    node.kind === 'register' ||
    node.kind === 'latch' ||
    node.kind === 'replicate' ||
    node.kind === 'literal'
  ) {
    return dimension;
  }
  if (node.kind === 'instance' || node.kind === 'module' || node.kind === 'unknown') {
    return dimension;
  }
  return undefined;
}

// Mirrors the port/side-notch geometry BusNodeSvg feeds into interfaceSkinPath,
// so the warning icon lands on the chevron outline's actual right-most vertex
// instead of the (possibly notch-shorted or hat-narrowed) bbox corner.
function interfaceInstanceTopRightVertex(
  node: DiagramNode,
  width: number,
  height: number,
): NodeOutlineVertex {
  const grid = diagramSizing.gridSize;
  const visible = node.ports.filter(
    (port) =>
      port.width !== 'interface' ||
      port.preferredSide ||
      port.id.endsWith(':left') ||
      port.id.endsWith(':right'),
  );
  const topPorts = visible.filter(
    (port) => port.direction === 'input' && port.width !== 'interface',
  );
  const bottomPorts = visible.filter(
    (port) => port.direction === 'output' && port.width !== 'interface',
  );
  const sidePorts = visible.filter(
    (port) =>
      port.width === 'interface' || (port.direction !== 'input' && port.direction !== 'output'),
  );
  const ordered = orderedInterfaceSidePorts(sidePorts);
  const topHatH = interfaceTopHatHeight(topPorts.length > 0);
  const bottomHatH = interfaceTopHatHeight(bottomPorts.length > 0);
  const shiftY = diagramSizing.interfaceInstanceShiftY;
  const unshiftedH = Math.max(grid, height - shiftY);
  const leftCenters = distributedInterfaceSideCenters(
    ordered.left.length,
    unshiftedH,
    topHatH,
    bottomHatH,
  ).map((c) => c + shiftY);
  const rightCenters = distributedInterfaceSideCenters(
    ordered.right.length,
    unshiftedH,
    topHatH,
    bottomHatH,
  ).map((c) => c + shiftY);

  return interfaceSkinPath({
    width,
    height,
    leftCenters,
    rightCenters,
    topPortCount: topPorts.length,
    bottomPortCount: bottomPorts.length,
  }).topRightVertex;
}

export function diagramNodeDimensions(node: DiagramNode): DiagramNodeDimensions {
  const ctx = nodeSizingContext(node);
  const strategy = sizingStrategies[node.kind] ?? defaultSizing;
  return {
    width: strategy.width(node, ctx),
    height: strategy.height(node, ctx),
  };
}

function nodeSizingContext(node: DiagramNode): NodeSizingContext {
  const role = structRole(node);
  const isInterfaceInstance = node.kind === 'interface' && role !== 'modport' && role !== 'port';
  const visiblePorts =
    node.kind === 'interface'
      ? node.ports.filter(
          (port) =>
            port.width !== 'interface' ||
            port.preferredSide ||
            port.id.endsWith(':left') ||
            port.id.endsWith(':right'),
        )
      : node.ports;

  const topPorts = isInterfaceInstance
    ? visiblePorts.filter((p) => p.direction === 'input' && p.width !== 'interface')
    : [];
  const bottomPorts = isInterfaceInstance
    ? visiblePorts.filter((p) => p.direction === 'output' && p.width !== 'interface')
    : [];
  const sidePorts = isInterfaceInstance
    ? visiblePorts.filter(
        (p) => p.width === 'interface' || (p.direction !== 'input' && p.direction !== 'output'),
      )
    : visiblePorts;

  const inputs = sidePorts.filter(isInputSidePort);
  const outputs = sidePorts.filter((port) => port.direction === 'output');

  // Mux/select reserve their first N inputs as a top row (select lines); the
  // rest sit in the side rows every kind's port-row math is based on.
  const topInputCount =
    node.kind === 'mux'
      ? 1
      : node.kind === 'select'
        ? inputs.filter((port) => port.name === 's' || port.name === 'sel' || port.name === 'width')
            .length
        : 0;
  const sideInputs = topInputCount > 0 ? inputs.slice(topInputCount) : inputs;
  const portRows = Math.max(sideInputs.length, outputs.length);

  return {
    sideInputs,
    outputs,
    topPorts,
    bottomPorts,
    inputsCount: inputs.length,
    outputsCount: outputs.length,
    portRows,
  };
}
