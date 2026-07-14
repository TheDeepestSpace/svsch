import { diagramSizing } from '../diagram/constants';
import type { DiagramNode } from '../ir/types';

export const ROUTING_OBSTACLE_MARGIN = diagramSizing.gridSize / 2;

export interface RoutingObstacleMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function routingObstacleMargins(
  node: DiagramNode,
  portSides: Array<string | undefined>
): RoutingObstacleMargins {
  const vertical = {
    top: portSides.includes('NORTH') ? 0 : ROUTING_OBSTACLE_MARGIN,
    bottom: portSides.includes('SOUTH') ? 0 : ROUTING_OBSTACLE_MARGIN
  };

  if (node.kind === 'literal') {
    return {
      left: diagramSizing.gridSize,
      right: 0,
      ...vertical
    };
  }

  if (node.kind !== 'port') {
    return { left: 0, right: 0, ...vertical };
  }

  // A terminal's lead already reserves the connection side. Keep one full
  // grid clear behind the port so returning feedback routes do not hug it.
  return {
    left: portSides.includes('EAST') ? diagramSizing.gridSize : 0,
    right: portSides.includes('WEST') ? diagramSizing.gridSize : 0,
    ...vertical
  };
}

export function routingVerticalMargins(
  node: DiagramNode,
  portSides: Array<string | undefined>
): { top: number; bottom: number } {
  const { top, bottom } = routingObstacleMargins(node, portSides);
  return { top, bottom };
}
