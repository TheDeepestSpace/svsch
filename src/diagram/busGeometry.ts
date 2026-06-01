import { diagramSizing } from './constants';
import type { DiagramNode, DiagramPort } from '../ir/types';

export function busTapPortCenterY(index: number, startUnits = 1): number {
  return diagramSizing.gridSize * (index * 2 + startUnits);
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
