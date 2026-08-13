import type { DiagramNode } from '../ir/types';
import { nodeTypeName, structRole } from '../ir/nodeMetadata';
import { diagramSizing, nodeHeightForPortRows, snapUpToEvenGrid, snapUpToGrid } from './constants';
import { isBusComposition } from './busGeometry';
import { interfaceTopHatHeight, orderedInterfaceSidePorts } from './interfaceGeometry';
import { measureText, portLabel, portNodeLabel, snappedWidth, type NodeSizingContext, type NodeSizingStrategy } from './nodeSizingCommon';

// Bus, struct, and interface all render through the shared "pipe + taps"
// base (interface instances are the one standalone shape within that set —
// see issue #172's Shape A/B writeup) so they share one sizing strategy.

// Interface instance boxes wrap their content exactly: one grid of entry
// corridor above the hat (mirrored in distributedInterfaceSideCenters), the
// side-notch rows, and the bottom hat flush with the box bottom.
function interfaceInstanceContentHeight(node: DiagramNode): number {
  const grid = diagramSizing.gridSize;
  const visible = node.ports.filter((port) => port.width !== 'interface' || port.preferredSide || port.id.endsWith(':left') || port.id.endsWith(':right'));
  const topPorts = visible.filter((port) => port.direction === 'input' && port.width !== 'interface');
  const bottomPorts = visible.filter((port) => port.direction === 'output' && port.width !== 'interface');
  const sidePorts = visible.filter((port) => port.width === 'interface' || (port.direction !== 'input' && port.direction !== 'output'));
  const ordered = orderedInterfaceSidePorts(sidePorts);
  const maxSideRows = Math.max(ordered.left.length, ordered.right.length);
  const sideSpan = grid * Math.max(1, maxSideRows * 2 - 1);
  const content = grid
    + interfaceTopHatHeight(topPorts.length > 0)
    + sideSpan
    + interfaceTopHatHeight(bottomPorts.length > 0);
  return Math.max(grid * 3, content);
}

function aggregateHeight(node: DiagramNode, ctx: NodeSizingContext): number {
  const role = structRole(node);
  if (node.kind === 'interface' && role === 'port') {
    return diagramSizing.portHeight;
  }

  const isInterfaceInstance = node.kind === 'interface' && role !== 'modport';
  // Taps set the real height: composition taps are the inputs, breakout taps
  // the outputs, and array aggregates need one extra row for the diagonal
  // single-port exit below the last tap.
  const tapRows = node.kind === 'interface' ? 0 : (isBusComposition(node, role) ? ctx.inputsCount : ctx.outputsCount);
  const arrayExtraRow = node.kind === 'bus' && node.metadata?.aggregateKind === 'array' ? 1 : 0;
  const height = node.kind === 'interface' && role === 'modport'
    ? diagramSizing.gridSize * Math.max(4, (ctx.inputsCount + ctx.outputsCount) * 2 + 1)
    : isInterfaceInstance
      ? interfaceInstanceContentHeight(node)
      : Math.max(
        nodeHeightForPortRows(Math.max(ctx.inputsCount, ctx.outputsCount)),
        diagramSizing.gridSize * Math.max(2, tapRows * 2 + arrayExtraRow)
      );
  return height + (isInterfaceInstance ? diagramSizing.interfaceInstanceShiftY : 0);
}

function tapLabels(node: DiagramNode, ctx: NodeSizingContext): string[] {
  const role = structRole(node);
  const taps = node.kind === 'interface' && role === 'modport'
    ? node.ports
    : node.kind === 'struct'
      ? (role === 'composition' ? ctx.sideInputs : ctx.outputs)
      : node.kind === 'interface'
        ? [...ctx.sideInputs, ...ctx.outputs]
        : (ctx.sideInputs.length > 1 ? ctx.sideInputs : ctx.outputs);
  return taps.map((port) => portLabel(port, false, true));
}

function aggregateWidth(node: DiagramNode, ctx: NodeSizingContext): number {
  const role = structRole(node);
  if (node.kind === 'interface' && role === 'port') {
    return snappedWidth(
      diagramSizing.portWidth,
      measureText(portNodeLabel(node)) + diagramSizing.portNoseLength * 2 + diagramSizing.portHorizontalPadding
    );
  }

  const isCenteredInterfaceInstance = node.kind === 'interface' && role !== 'modport';
  const isModport = node.kind === 'interface' && role === 'modport';

  let interfaceInstanceTitleWidth = 0;
  if (isCenteredInterfaceInstance) {
    const typeName = nodeTypeName(node);
    interfaceInstanceTitleWidth = measureText(node.label + (typeName ? ` ${typeName}` : ''));
  }

  const topLabelWidth = ctx.topPorts.length > 0
    ? (ctx.topPorts.length * 2 - 1) * diagramSizing.gridSize + Math.max(...ctx.topPorts.map((p) => measureText(p.label ?? p.name)))
    : 0;
  const bottomLabelWidth = ctx.bottomPorts.length > 0
    ? (ctx.bottomPorts.length * 2 - 1) * diagramSizing.gridSize + Math.max(...ctx.bottomPorts.map((p) => measureText(p.label ?? p.name)))
    : 0;

  const capPortCount = Math.max(ctx.topPorts.length, ctx.bottomPorts.length);
  const tbPortNeededWidth = capPortCount > 0
    ? Math.max(diagramSizing.gridSize * 4, capPortCount * diagramSizing.gridSize * 3)
    : 0;

  // Ensure at least 2 grid widths of clearance on each side of the hat/labels
  const tbClearance = capPortCount > 0 ? diagramSizing.gridSize * 4 : 0;
  const tbWidthNeeded = Math.max(tbPortNeededWidth, topLabelWidth, bottomLabelWidth) + tbClearance;

  // Bus/struct nodes keep the pipe flush with the single-port side, so they
  // don't need the 2-grid stub area interfaces reserve. Array breakouts keep
  // one grid for the diagonal stack exit next to the pipe.
  const isArrayBreakoutBus = node.kind === 'bus' && node.metadata?.aggregateKind === 'array' && !isBusComposition(node, role);
  const singleSideInset = node.kind === 'interface' ? 0 : diagramSizing.gridSize * (isArrayBreakoutBus ? 1 : 2);

  const longestPortLabel = Math.max(0, ...tapLabels(node, ctx).map(measureText));

  return snappedWidth(
    diagramSizing.nodeWidth - singleSideInset,
    Math.max(
      tbWidthNeeded,
      interfaceInstanceTitleWidth + diagramSizing.nodeHorizontalPadding * 2,
      longestPortLabel + diagramSizing.gridSize * 3 - singleSideInset + diagramSizing.nodeHorizontalPadding
    ),
    (isCenteredInterfaceInstance || isModport) ? snapUpToEvenGrid : snapUpToGrid
  );
}

export const aggregateSizing: NodeSizingStrategy = {
  height: aggregateHeight,
  width: aggregateWidth
};
