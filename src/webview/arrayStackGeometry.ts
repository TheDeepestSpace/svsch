import { diagramSizing } from '../diagram/constants';

export const ARRAY_STACK_LANE_OFFSET = 4;
/** Multi-bit array stacks spread wider (0.25 grid) so the thicker lines keep clear gaps. */
export const ARRAY_STACK_WIDE_LANE_OFFSET = diagramSizing.gridSize * 0.25;
export const ARRAY_STACK_LEAD_EDGE_GAP = 1.5;

export interface ArrayStackLayer {
  id: ArrayStackLayerId;
  dx: number;
  dy: number;
  trimUnits: number;
}

export const ARRAY_STACK_LAYERS = {
  front: { id: 'front', dx: -ARRAY_STACK_LANE_OFFSET, dy: -ARRAY_STACK_LANE_OFFSET, trimUnits: 1 / 8 },
  middle: { id: 'middle', dx: 0, dy: 0, trimUnits: 1 / 4 },
  back: { id: 'back', dx: ARRAY_STACK_LANE_OFFSET, dy: ARRAY_STACK_LANE_OFFSET, trimUnits: 3 / 8 }
} as const;

export type ArrayStackLayerId = keyof typeof ARRAY_STACK_LAYERS;

export function arrayStackScale(wide: boolean): number {
  return wide ? ARRAY_STACK_WIDE_LANE_OFFSET / ARRAY_STACK_LANE_OFFSET : 1;
}

function scaledLayer(layer: ArrayStackLayer, wide: boolean): ArrayStackLayer {
  if (!wide) return layer;
  const scale = arrayStackScale(true);
  return { ...layer, dx: layer.dx * scale, dy: layer.dy * scale, trimUnits: layer.trimUnits * scale };
}

export function arrayStackLayer(layerId: ArrayStackLayerId, wide: boolean): ArrayStackLayer {
  return scaledLayer(ARRAY_STACK_LAYERS[layerId], wide);
}

export function arrayStackLayersFor(wide: boolean): Record<ArrayStackLayerId, ArrayStackLayer> {
  return {
    front: arrayStackLayer('front', wide),
    middle: arrayStackLayer('middle', wide),
    back: arrayStackLayer('back', wide)
  };
}

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

export function arrayStackLeadLayersFor(wide: boolean): ArrayStackLayer[] {
  return ARRAY_STACK_LEAD_LAYERS.map((layer) => scaledLayer(layer, wide));
}

export function arrayStackSkinLayersFor(wide: boolean): ArrayStackLayer[] {
  return ARRAY_STACK_SKIN_LAYERS.map((layer) => scaledLayer(layer, wide));
}

export function arrayStackLayerTrim(layerId: ArrayStackLayerId, wide = false): number {
  return diagramSizing.gridSize * arrayStackLayer(layerId, wide).trimUnits;
}

export type ArrayStackLeadSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * Sides whose exit direction (+x for right, +y for bottom) points the same way
 * the 'back' layer is already offset. On those sides 'back' is the layer
 * closest to clearing the stack and 'front' is the one lagging behind, which is
 * the reverse of 'left'/'top' (where the exit direction matches 'front's
 * offset). Trim length must track "how far behind this layer is", not layer
 * identity, or the already-leading layer's own trim reinforces its head start
 * instead of the lanes converging.
 */
const REVERSED_LEAD_TRIM_SIDES: ReadonlySet<ArrayStackLeadSide> = new Set(['right', 'bottom']);

function leadTrimLayerId(layerId: ArrayStackLayerId, side: ArrayStackLeadSide): ArrayStackLayerId {
  if (!REVERSED_LEAD_TRIM_SIDES.has(side)) return layerId;
  if (layerId === 'front') return 'back';
  if (layerId === 'back') return 'front';
  return layerId;
}

export interface ArrayStackLeadSegment {
  id: ArrayStackLayerId;
  d: string;
}

export function arrayStackLeadSegments({
  side,
  width,
  y,
  x,
  trimSink = false,
  wide = false
}: {
  side: ArrayStackLeadSide;
  width: number;
  y: number;
  x?: number;
  trimSink?: boolean;
  wide?: boolean;
}): ArrayStackLeadSegment[] {
  return arrayStackLeadLayersFor(wide).map((layer) => {
    const trim = arrayStackLayerTrim(leadTrimLayerId(layer.id, side), wide);
    const shapeX = (side === 'top' || side === 'bottom')
      ? Math.round((x ?? width / 2) + layer.dx)
      : side === 'left'
        ? Math.round(layer.dx)
        : Math.round(width + layer.dx);
    const shapeY = Math.round(y + layer.dy);
    const endY = Math.round(side === 'top' && trimSink
      ? shapeY - ARRAY_STACK_LEAD_EDGE_GAP
      : shapeY);
    const leadX = Math.round((side === 'top' || side === 'bottom')
      ? shapeX
      : side === 'left'
        ? shapeX - trim
        : shapeX + trim);
    const leadY = Math.round(side === 'top'
      ? endY - trim
      : side === 'bottom'
        ? endY + trim
        : shapeY);
    return { id: layer.id, d: `M ${leadX} ${leadY} L ${shapeX} ${endY}` };
  });
}
