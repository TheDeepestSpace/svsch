import { diagramSizing } from '../diagram/constants';

export const ARRAY_STACK_LANE_OFFSET = 4;
/** Multi-bit array stacks spread wider (0.25 grid) so the thicker lines keep clear gaps. */
export const ARRAY_STACK_WIDE_LANE_OFFSET = diagramSizing.gridSize * 0.25;

export interface ArrayStackLayer {
  id: ArrayStackLayerId;
  dx: number;
  dy: number;
  trimUnits: number;
}

export const ARRAY_STACK_LAYERS = {
  front: {
    id: 'front',
    dx: -ARRAY_STACK_LANE_OFFSET,
    dy: -ARRAY_STACK_LANE_OFFSET,
    trimUnits: 1 / 8,
  },
  middle: { id: 'middle', dx: 0, dy: 0, trimUnits: 1 / 4 },
  back: { id: 'back', dx: ARRAY_STACK_LANE_OFFSET, dy: ARRAY_STACK_LANE_OFFSET, trimUnits: 3 / 8 },
} as const;

export type ArrayStackLayerId = keyof typeof ARRAY_STACK_LAYERS;

export function arrayStackScale(wide: boolean): number {
  return wide ? ARRAY_STACK_WIDE_LANE_OFFSET / ARRAY_STACK_LANE_OFFSET : 1;
}

function scaledLayer(layer: ArrayStackLayer, wide: boolean): ArrayStackLayer {
  if (!wide) return layer;
  const scale = arrayStackScale(true);
  return {
    ...layer,
    dx: layer.dx * scale,
    dy: layer.dy * scale,
    trimUnits: layer.trimUnits * scale,
  };
}

export function arrayStackLayer(layerId: ArrayStackLayerId, wide: boolean): ArrayStackLayer {
  return scaledLayer(ARRAY_STACK_LAYERS[layerId], wide);
}

export function arrayStackLayersFor(wide: boolean): Record<ArrayStackLayerId, ArrayStackLayer> {
  return {
    front: arrayStackLayer('front', wide),
    middle: arrayStackLayer('middle', wide),
    back: arrayStackLayer('back', wide),
  };
}

export const ARRAY_STACK_LEAD_LAYERS = [
  ARRAY_STACK_LAYERS.front,
  ARRAY_STACK_LAYERS.middle,
  ARRAY_STACK_LAYERS.back,
] as const;

export const ARRAY_STACK_SKIN_LAYERS = [
  ARRAY_STACK_LAYERS.back,
  ARRAY_STACK_LAYERS.middle,
  ARRAY_STACK_LAYERS.front,
] as const;

export function arrayStackLeadLayersFor(wide: boolean): ArrayStackLayer[] {
  return ARRAY_STACK_LEAD_LAYERS.map((layer) => scaledLayer(layer, wide));
}

export function arrayStackSkinLayersFor(wide: boolean): ArrayStackLayer[] {
  return ARRAY_STACK_SKIN_LAYERS.map((layer) => scaledLayer(layer, wide));
}

export function arrayStackLayerTrim(layerId: ArrayStackLayerId, wide = false): number {
  return diagramSizing.gridSize * arrayStackLayer(layerId, wide).trimUnits;
}

export type ArrayStackSide = 'left' | 'right' | 'top' | 'bottom';

const ARRAY_STACK_MIRROR_LAYER: Record<ArrayStackLayerId, ArrayStackLayerId> = {
  front: 'back',
  middle: 'middle',
  back: 'front',
};

/**
 * Trim (lead length / wire setback) for a layer's junction on a given node side.
 *
 * A lane's junction with its routed wire must land OUTSIDE every sibling
 * layer's skin, or the skins (painted after the edge layer) slice visibly
 * across the wire. The clearance each lane needs depends on which layer is
 * outermost on that side: on left/top the front layer (dx/dy = -offset) is
 * outermost, so the natural front<middle<back trims already clear; on
 * right/bottom the ordering inverts — the front lane must cross the middle
 * and back skins to exit — so the trims are mirrored (front↔back) to keep
 * every junction just past the outermost skin edge, exactly symmetric with
 * the opposite side.
 */
export function arrayStackLayerSideTrim(
  layerId: ArrayStackLayerId,
  side: ArrayStackSide,
  wide = false,
): number {
  const effectiveLayer =
    side === 'right' || side === 'bottom' ? ARRAY_STACK_MIRROR_LAYER[layerId] : layerId;
  return arrayStackLayerTrim(effectiveLayer, wide);
}
