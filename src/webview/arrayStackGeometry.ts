import { diagramSizing } from '../diagram/constants';

export const ARRAY_STACK_LANE_OFFSET = 4;
export const ARRAY_STACK_LEAD_EDGE_GAP = 1.5;

export const ARRAY_STACK_LAYERS = {
  front: { id: 'front', dx: -ARRAY_STACK_LANE_OFFSET, dy: -ARRAY_STACK_LANE_OFFSET, trimUnits: 1 / 8 },
  middle: { id: 'middle', dx: 0, dy: 0, trimUnits: 1 / 4 },
  back: { id: 'back', dx: ARRAY_STACK_LANE_OFFSET, dy: ARRAY_STACK_LANE_OFFSET, trimUnits: 3 / 8 }
} as const;

export type ArrayStackLayerId = keyof typeof ARRAY_STACK_LAYERS;

export const ARRAY_STACK_LEAD_LAYERS = [
  ARRAY_STACK_LAYERS.front,
  ARRAY_STACK_LAYERS.middle,
  ARRAY_STACK_LAYERS.back
] as const;

export const ARRAY_STACK_SKIN_LAYERS = [
  ARRAY_STACK_LAYERS.back,
  ARRAY_STACK_LAYERS.middle,
  ARRAY_STACK_LAYERS.front
] as const;

export function arrayStackLayerTrim(layerId: ArrayStackLayerId): number {
  return diagramSizing.gridSize * ARRAY_STACK_LAYERS[layerId].trimUnits;
}
