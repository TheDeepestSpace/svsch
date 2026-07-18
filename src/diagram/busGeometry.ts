import { diagramSizing } from './constants';
import type { DiagramNode, DiagramPort } from '../ir/types';

export function busTapPortCenterY(index: number, startUnits = 1): number {
  return diagramSizing.gridSize * (index * 2 + startUnits);
}

function pipeCapPivotFromTapCount(tapCount: number, pipeX: number): { x: number; y: number } {
  const g = diagramSizing.gridSize;
  if (tapCount === 0) {
    return { x: pipeX + 2, y: g / 2 - 3 };
  }
  const firstCenter = busTapPortCenterY(0, 1);
  const lastCenter = busTapPortCenterY(tapCount - 1, 1);
  const pipeY = firstCenter - g / 2;
  const pipeH = lastCenter - firstCenter + g;
  return { x: pipeX + 2, y: pipeY + pipeH - 3 };
}

/**
 * Node-local pivot of an array-breakout bus's pipe cap: the small rect
 * (BusNodeSvg's pipeCap) rotated 45° about this point to visually merge the
 * stacked array wires into the pipe. Mirrors BusNodeSvg's own
 * pipeX/pipeY/pipeH/pipeCapCenterX/Y math for the breakout case (pipe
 * flush with the left edge) so edge routing can align onto the same
 * diagonal without duplicating (and risking drift from) that layout.
 */
export function arrayBreakoutPipeCapPivot(node: DiagramNode): { x: number; y: number } {
  const g = diagramSizing.gridSize;
  const tapCount = node.ports.filter((port: DiagramPort) => port.direction === 'output').length;
  return pipeCapPivotFromTapCount(tapCount, g * 0.5 - 3);
}

/**
 * Node-local pivot of an array-composition bus's pipe cap — the mirror of
 * arrayBreakoutPipeCapPivot for the composition case, where the pipe sits
 * flush with the *right* edge (BusNodeSvg's pipeX for isComposition), so
 * unlike the breakout case it depends on the node's rendered width. Callers
 * already compute that via diagramNodeDimensions (importing it here would
 * create a cycle: nodeSizing.ts imports isBusComposition from this module).
 */
export function arrayCompositionPipeCapPivot(node: DiagramNode, width: number): { x: number; y: number } {
  const g = diagramSizing.gridSize;
  const tapCount = node.ports.filter((port: DiagramPort) =>
    port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown'
  ).length;
  return pipeCapPivotFromTapCount(tapCount, width - g * 0.5 - 3);
}

export function isBusComposition(node: DiagramNode, role?: string): boolean {
  if (node.kind === 'struct') return role === 'composition';
  if (node.kind === 'interface') return false;
  // For bus nodes: sidePorts = node.ports (aggregatePorts for non-interface = node.ports)
  const aggregateInputs = node.ports.filter(
    (port: DiagramPort) =>
      port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown'
  );
  return aggregateInputs.length > 1;
}
