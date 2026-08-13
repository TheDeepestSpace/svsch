import type { DiagramNode } from '../ir/types';
import { registerClockSignal, registerResetSignal } from '../ir/nodeMetadata';
import { diagramSizing, nodeHeightForPortRows, snapUpToEvenGrid } from './constants';
import { measureText, nodeTitle, snappedWidth, type NodeSizingStrategy } from './nodeSizingCommon';

function registerVisibleInputRows(node: DiagramNode): number {
  const clockSignal = registerClockSignal(node);
  const resetSignal = registerResetSignal(node);
  const inputs = node.ports.filter((port) => port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown');
  const dPort = inputs.find((port) => port.name === 'D') ?? inputs[0];
  const clockPort = inputs.find((port) => port.name === clockSignal)
    ?? inputs.find((port) => port.name !== 'D' && port.name !== resetSignal);
  const resetPort = resetSignal
    ? inputs.find((port) => port.name === resetSignal)
    : undefined;
  const rvPort = inputs.find((port) => port.name === 'RV');
  const reservedPortIds = new Set([dPort?.id, clockPort?.id, resetPort?.id, rvPort?.id].filter(Boolean));
  const extraInputs = inputs.filter((port) => !reservedPortIds.has(port.id));
  return Math.max(2, extraInputs.length + (rvPort ? 3 : 2));
}

export const registerSizing: NodeSizingStrategy = {
  height: (node, ctx) => nodeHeightForPortRows(Math.max(2, ctx.outputsCount, registerVisibleInputRows(node))),
  width: (node) => snappedWidth(
    diagramSizing.registerWidth,
    Math.max(measureText(nodeTitle(node)), measureText('D') + measureText('Q') + diagramSizing.gridSize) + diagramSizing.nodeHorizontalPadding * 2,
    snapUpToEvenGrid
  )
};
