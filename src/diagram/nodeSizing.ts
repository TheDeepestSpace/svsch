import type { DiagramNode } from '../ir/types';
import {
  gateBodyOperation,
  gateIsNegated,
  nodeArrayDimension,
  nodeIsArrayNode,
  nodeTypeName,
  nodeWidth,
  registerClockSignal,
  registerResetSignal,
  structRole,
} from '../ir/nodeMetadata';
import {
  combHeightForPortRows,
  diagramSizing,
  gateHeightForInputCount,
  literalHeightForPortRows,
  muxHeightForPortRows,
  nodeHeightForPortRows,
  normalizeWidth,
  snapUpToEvenGrid,
  snapUpToGrid,
} from './constants';
import { selectPortLabel } from './selectLabels';
import { isBusComposition } from './busGeometry';
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

export interface DiagramNodeDimensions {
  width: number;
  height: number;
}

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
  const topInputCount =
    node.kind === 'mux'
      ? 1
      : node.kind === 'select'
        ? inputs.filter((port) => port.name === 's' || port.name === 'sel' || port.name === 'width')
            .length
        : 0;
  const sideInputs = topInputCount > 0 ? inputs.slice(topInputCount) : inputs;
  const portRows = Math.max(sideInputs.length, outputs.length);

  const height = nodeHeightForKind(node, inputs.length, outputs.length, portRows);
  return {
    width: nodeWidthForKind(node, sideInputs, outputs, topPorts, bottomPorts),
    height,
  };
}

function nodeHeightForKind(
  node: DiagramNode,
  inputsCount: number,
  outputsCount: number,
  portRows: number,
): number {
  if (node.kind === 'netLabel') {
    return diagramSizing.gridSize * 2;
  }

  if (node.kind === 'port') {
    return diagramSizing.portHeight;
  }

  if (node.kind === 'interface' || node.kind === 'bus' || node.kind === 'struct') {
    const role = structRole(node);
    if (node.kind === 'interface' && role === 'port') {
      return diagramSizing.portHeight;
    }

    const isInterfaceInstance = node.kind === 'interface' && role !== 'modport' && role !== 'port';
    // Taps set the real height: composition taps are the inputs, breakout taps
    // the outputs, and array aggregates need one extra row for the diagonal
    // single-port exit below the last tap.
    const tapRows =
      node.kind === 'interface' ? 0 : isBusComposition(node, role) ? inputsCount : outputsCount;
    const arrayExtraRow = node.kind === 'bus' && node.metadata?.aggregateKind === 'array' ? 1 : 0;
    const height =
      node.kind === 'interface' && role === 'port'
        ? diagramSizing.gridSize
        : node.kind === 'interface' && role === 'modport'
          ? diagramSizing.gridSize * Math.max(4, (inputsCount + outputsCount) * 2 + 1)
          : isInterfaceInstance
            ? interfaceInstanceContentHeight(node)
            : Math.max(
                nodeHeightForPortRows(Math.max(inputsCount, outputsCount)),
                diagramSizing.gridSize * Math.max(2, tapRows * 2 + arrayExtraRow),
              );
    return height + (isInterfaceInstance ? diagramSizing.interfaceInstanceShiftY : 0);
  }

  if (node.kind === 'mux' || node.kind === 'select') {
    return muxHeightForPortRows(portRows);
  }

  if (node.kind === 'alu' || node.kind === 'comparator') {
    return muxHeightForPortRows(2);
  }

  if (node.kind === 'gate') {
    return gateHeightForInputCount(portRows);
  }

  if (node.kind === 'inverter' || node.kind === 'zext') {
    return diagramSizing.gridSize * 2;
  }

  if (node.kind === 'register') {
    return nodeHeightForPortRows(Math.max(2, outputsCount, registerVisibleInputRows(node)));
  }

  if (node.kind === 'comb') {
    return combHeightForPortRows(portRows);
  }

  if (node.kind === 'replicate') {
    return diagramSizing.gridSize * 2;
  }

  if (node.kind === 'literal') {
    return literalHeightForPortRows();
  }

  const baseHeight = nodeHeightForPortRows(portRows);
  const parameterRows = instanceParameterRows(node);
  if (parameterRows > 0) {
    return baseHeight + diagramSizing.gridSize * parameterRows;
  }
  return baseHeight;
}

// Interface instance boxes wrap their content exactly: one grid of entry
// corridor above the hat (mirrored in distributedInterfaceSideCenters), the
// side-notch rows, and the bottom hat flush with the box bottom.
function interfaceInstanceContentHeight(node: DiagramNode): number {
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
  const maxSideRows = Math.max(ordered.left.length, ordered.right.length);
  const sideSpan = grid * Math.max(1, maxSideRows * 2 - 1);
  const content =
    grid +
    interfaceTopHatHeight(topPorts.length > 0) +
    sideSpan +
    interfaceTopHatHeight(bottomPorts.length > 0);
  return Math.max(grid * 3, content);
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

/** Radius of a gate's negated-output bubble (NAND/NOR/XNOR) — matches the inverter's bubble. */
export const gateBubbleRadius = diagramSizing.gridSize / 6;
export const gateBubbleGap = 2;
/** Horizontal gap reserved for XOR/XNOR's extra back curve, left of the OR-shaped body. */
export const gateXorGap = 5;

/** Body width a gate needs: base AND/OR/XOR body, plus room for the XOR back-curve and/or
 * negation bubble. */
export function gateGeometryWidth(isXor: boolean, negated: boolean): number {
  const base = diagramSizing.gridSize * 3;
  const xorExtra = isXor ? gateXorGap : 0;
  const bubbleExtra = negated ? gateBubbleGap + gateBubbleRadius * 2 : 0;
  return base + xorExtra + bubbleExtra;
}

function registerVisibleInputRows(node: DiagramNode): number {
  const clockSignal = registerClockSignal(node);
  const resetSignal = registerResetSignal(node);
  const inputs = node.ports.filter(isInputSidePort);
  const dPort = inputs.find((port) => port.name === 'D') ?? inputs[0];
  const clockPort =
    inputs.find((port) => port.name === clockSignal) ??
    inputs.find((port) => port.name !== 'D' && port.name !== resetSignal);
  const resetPort = resetSignal ? inputs.find((port) => port.name === resetSignal) : undefined;
  const rvPort = inputs.find((port) => port.name === 'RV');
  const reservedPortIds = new Set(
    [dPort?.id, clockPort?.id, resetPort?.id, rvPort?.id].filter(Boolean),
  );
  const extraInputs = inputs.filter((port) => !reservedPortIds.has(port.id));
  return Math.max(2, extraInputs.length + (rvPort ? 3 : 2));
}

function nodeWidthForKind(
  node: DiagramNode,
  sideInputs: DiagramNode['ports'],
  outputs: DiagramNode['ports'],
  topPorts: DiagramNode['ports'] = [],
  bottomPorts: DiagramNode['ports'] = [],
): number {
  const title = nodeTitle(node);
  const showPortTypes = node.kind !== 'instance';
  const portLabels = visiblePortLabels(node, sideInputs, outputs, showPortTypes);
  const longestPortLabel = Math.max(0, ...portLabels.map(measureText));
  const titleWidth = measureText(title);
  const instanceParameterWidth =
    node.kind === 'instance'
      ? Math.max(
          0,
          ...(node.instanceParameters ?? node.metadata?.instanceParameters ?? []).map((param) =>
            measureText(`${param.name}=${param.value ?? ''}`),
          ),
        )
      : 0;

  const topLabelWidth =
    topPorts.length > 0
      ? (topPorts.length * 2 - 1) * diagramSizing.gridSize +
        Math.max(...topPorts.map((p) => measureText(p.label ?? p.name)))
      : 0;
  const bottomLabelWidth =
    bottomPorts.length > 0
      ? (bottomPorts.length * 2 - 1) * diagramSizing.gridSize +
        Math.max(...bottomPorts.map((p) => measureText(p.label ?? p.name)))
      : 0;
  if (node.kind === 'netLabel') {
    return snappedWidth(
      diagramSizing.gridSize * 4,
      measureText(node.label) + diagramSizing.gridSize / 2,
    );
  }

  if (node.kind === 'port') {
    return snappedWidth(
      diagramSizing.portWidth,
      measureText(portNodeLabel(node)) +
        diagramSizing.portNoseLength +
        diagramSizing.portHorizontalPadding,
    );
  }

  if (node.kind === 'mux' || node.kind === 'select') {
    const isSelect = node.kind === 'select';
    const inputLabelWidth = Math.max(
      0,
      ...sideInputs.map((port) =>
        measureText(
          isSelect ? selectPortLabel(node, port) : portLabel(port, true, showPortTypes, !isSelect),
        ),
      ),
    );
    const outputLabelWidth = Math.max(
      0,
      ...outputs
        .slice(0, 1)
        .map((port) =>
          measureText(
            isSelect
              ? selectPortLabel(node, port)
              : portLabel(port, true, showPortTypes, !isSelect),
          ),
        ),
    );
    const labelBasedWidth = inputLabelWidth + outputLabelWidth + diagramSizing.muxHorizontalPadding;

    // When there are many inputs the mux is tall, the slanted top/bottom edges cut into the label
    // area. Use the binding gap — the smaller of the top clearance and the distance from the last
    // port's centre to the mux bottom — so both the first label top and the last port connection
    // point stay inside the trapezoid. labelRightEdge adds 2px for .svsch-port-type-suffix margin.
    // Constraint: width >= rightTop * labelRightEdge / bindingGap
    let slopeMinWidth = 0;
    if (!isSelect && sideInputs.length > 0 && inputLabelWidth > 0) {
      const portRows = Math.max(sideInputs.length, outputs.length);
      const height = muxHeightForPortRows(portRows);
      const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
      const rightTop = (height - rightSideHeight) / 2;
      if (rightTop > 0) {
        const grid = diagramSizing.gridSize;
        const heightUnits = height / grid;
        const startUnit = Math.max(1, Math.ceil((heightUnits - sideInputs.length + 1) / 2));
        const topGap = grid * startUnit - grid / 2;
        const bottomCenterGap = height - grid * (startUnit + sideInputs.length - 1);
        const bindingGap = Math.min(topGap, bottomCenterGap);
        if (bindingGap > 0) {
          const cssTypeSuffixMargin = 2;
          const labelRightEdge =
            diagramSizing.muxHorizontalPadding / 2 + inputLabelWidth + cssTypeSuffixMargin;
          slopeMinWidth = (rightTop * labelRightEdge) / bindingGap;
        }
      }
    }

    return snappedWidth(
      diagramSizing.muxWidth,
      Math.max(labelBasedWidth, slopeMinWidth),
      snapUpToEvenGrid,
    );
  }

  if (node.kind === 'alu' || node.kind === 'comparator') {
    return snappedWidth(diagramSizing.muxWidth, diagramSizing.gridSize * 3, snapUpToEvenGrid);
  }

  if (node.kind === 'gate') {
    const bodyOp = gateBodyOperation(node);
    return snappedWidth(
      diagramSizing.muxWidth,
      gateGeometryWidth(bodyOp === 'xor', gateIsNegated(node)),
      snapUpToEvenGrid,
    );
  }

  if (node.kind === 'inverter') {
    return snapUpToEvenGrid(inverterGeometryWidth());
  }

  if (node.kind === 'zext') {
    return snappedWidth(diagramSizing.gridSize * 2, titleWidth + 8, snapUpToEvenGrid);
  }

  if (node.kind === 'register') {
    return snappedWidth(
      diagramSizing.registerWidth,
      Math.max(titleWidth, measureText('D') + measureText('Q') + diagramSizing.gridSize) +
        diagramSizing.nodeHorizontalPadding * 2,
      snapUpToEvenGrid,
    );
  }

  if (node.kind === 'comb') {
    return diagramSizing.nodeWidth;
  }

  if (node.kind === 'replicate') {
    return snappedWidth(diagramSizing.gridSize * 2, titleWidth + 8);
  }

  if (node.kind === 'literal') {
    return snappedWidth(diagramSizing.literalMinWidth, titleWidth + 8);
  }

  if (node.kind === 'bus' || node.kind === 'struct' || node.kind === 'interface') {
    const role = structRole(node);
    if (node.kind === 'interface' && role === 'port') {
      return snappedWidth(
        diagramSizing.portWidth,
        measureText(portNodeLabel(node)) +
          diagramSizing.portNoseLength * 2 +
          diagramSizing.portHorizontalPadding,
      );
    }

    const isCenteredInterfaceInstance = node.kind === 'interface' && role !== 'modport';
    const isModport = node.kind === 'interface' && role === 'modport';

    let interfaceInstanceTitleWidth = 0;
    if (isCenteredInterfaceInstance) {
      const typeName = nodeTypeName(node);
      interfaceInstanceTitleWidth = measureText(node.label + (typeName ? ` ${typeName}` : ''));
    }

    const capPortCount = Math.max(topPorts.length, bottomPorts.length);
    const tbPortNeededWidth =
      capPortCount > 0
        ? Math.max(diagramSizing.gridSize * 4, capPortCount * diagramSizing.gridSize * 3)
        : 0;

    // Ensure at least 2 grid widths of clearance on each side of the hat/labels
    const tbClearance = capPortCount > 0 ? diagramSizing.gridSize * 4 : 0;
    const tbWidthNeeded =
      Math.max(tbPortNeededWidth, topLabelWidth, bottomLabelWidth) + tbClearance;

    // Bus/struct nodes keep the pipe flush with the single-port side, so they
    // don't need the 2-grid stub area interfaces reserve. Array breakouts keep
    // one grid for the diagonal stack exit next to the pipe.
    const isArrayBreakoutBus =
      node.kind === 'bus' &&
      node.metadata?.aggregateKind === 'array' &&
      !isBusComposition(node, role);
    const singleSideInset =
      node.kind === 'interface' ? 0 : diagramSizing.gridSize * (isArrayBreakoutBus ? 1 : 2);

    return snappedWidth(
      diagramSizing.nodeWidth - singleSideInset,
      Math.max(
        tbWidthNeeded,
        interfaceInstanceTitleWidth + diagramSizing.nodeHorizontalPadding * 2,
        longestPortLabel +
          diagramSizing.gridSize * 3 -
          singleSideInset +
          diagramSizing.nodeHorizontalPadding,
      ),
      isCenteredInterfaceInstance || isModport ? snapUpToEvenGrid : snapUpToGrid,
    );
  }

  return snappedWidth(
    diagramSizing.nodeWidth,
    Math.max(
      titleWidth,
      instanceParameterWidth,
      sideLabelWidth(node, sideInputs) + sideLabelWidth(node, outputs),
    ) +
      diagramSizing.nodeHorizontalPadding * 2,
  );
}

function sideLabelWidth(node: DiagramNode, ports: DiagramNode['ports']): number {
  const showPortTypes = node.kind !== 'instance';
  return Math.max(
    0,
    ...ports.map((port) =>
      measureText(portLabel(port, true, showPortTypes, node.kind === 'instance')),
    ),
  );
}

function visiblePortLabels(
  node: DiagramNode,
  sideInputs: DiagramNode['ports'],
  outputs: DiagramNode['ports'],
  showPortTypes: boolean,
): string[] {
  if (
    node.kind === 'comb' ||
    node.kind === 'inverter' ||
    node.kind === 'loop' ||
    node.kind === 'gate' ||
    node.kind === 'zext'
  ) {
    return [];
  }

  if (node.kind === 'alu' || node.kind === 'comparator') {
    return outputs.map((port) => portLabel(port, true, showPortTypes));
  }

  if (node.kind === 'replicate') {
    return [];
  }

  if (node.kind === 'mux' || node.kind === 'select') {
    const isSelect = node.kind === 'select';
    return [
      ...sideInputs.map((port) =>
        isSelect ? selectPortLabel(node, port) : portLabel(port, true, showPortTypes, !isSelect),
      ),
      ...outputs
        .slice(0, 1)
        .map((port) =>
          isSelect ? selectPortLabel(node, port) : portLabel(port, true, showPortTypes, !isSelect),
        ),
    ];
  }

  if (node.kind === 'register') {
    return ['D', 'Q', 'R'];
  }

  if (node.kind === 'bus' || node.kind === 'struct' || node.kind === 'interface') {
    const role = structRole(node);
    const taps =
      node.kind === 'interface' && role === 'modport'
        ? node.ports
        : node.kind === 'struct'
          ? role === 'composition'
            ? sideInputs
            : outputs
          : node.kind === 'interface'
            ? [...sideInputs, ...outputs]
            : sideInputs.length > 1
              ? sideInputs
              : outputs;
    return taps.map((port) => portLabel(port, false, showPortTypes));
  }

  return [...sideInputs, ...outputs].map((port) =>
    portLabel(port, true, showPortTypes, node.kind === 'instance'),
  );
}

function nodeTitle(node: DiagramNode): string {
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

function portNodeLabel(node: DiagramNode): string {
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

function portLabel(
  port: DiagramNode['ports'][number],
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

function measureText(text: string): number {
  return text.length * diagramSizing.textWidth;
}

function snappedWidth(minWidth: number, neededWidth: number, snap = snapUpToGrid): number {
  return Math.max(minWidth, snap(neededWidth));
}
