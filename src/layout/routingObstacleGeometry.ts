import { diagramSizing } from '../diagram/constants';
import type { DiagramNode } from '../ir/types';

export const ROUTING_OBSTACLE_MARGIN = diagramSizing.gridSize / 2;

export function routingVerticalMargins(
  node: DiagramNode,
  portSides: Array<string | undefined>
): { top: number; bottom: number } {
  if (node.kind === 'port' || node.kind === 'literal') {
    return { top: 0, bottom: 0 };
  }
  return {
    top: portSides.includes('NORTH') ? 0 : ROUTING_OBSTACLE_MARGIN,
    bottom: portSides.includes('SOUTH') ? 0 : ROUTING_OBSTACLE_MARGIN
  };
}
