import { diagramSizing } from './constants';

export function muxInputPortCenterY(index: number, count: number, height: number): number {
  const grid = diagramSizing.gridSize;
  const heightUnits = Math.max(1, Math.round(height / grid));
  const startUnit = Math.max(1, Math.ceil((heightUnits - count + 1) / 2));
  return grid * (startUnit + index);
}

/**
 * Gate input ports fan out one full grid line apart (matching the ALU's
 * fixed two-port layout), inset by one grid unit from the body's top/bottom
 * edge. `gateHeightForInputCount` sizes the body to always fit this spacing,
 * for any input count.
 */
export function gateInputPortCenterY(index: number, count: number, height: number): number {
  const grid = diagramSizing.gridSize;
  const spreadCenterY = (i: number): number => grid * (1 + 2 * i);
  const fits = spreadCenterY(count - 1) + grid <= height;
  return fits ? spreadCenterY(index) : muxInputPortCenterY(index, count, height);
}

/**
 * Y of the trapezoid's top-right vertex — shared by mux/select/alu skins,
 * whose right edge slopes in from the full height.
 */
export function muxRightTopY(height: number): number {
  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  return (height - rightSideHeight) / 2;
}

export function muxTopPortSkinEdgeY(index: number, count: number, height: number): number {
  const xFraction = (index + 1) / (count + 1);
  return muxRightTopY(height) * xFraction;
}

export function muxTopPortLabelOffsetY(index: number, count: number, height: number): number {
  return Math.max(0, muxTopPortSkinEdgeY(index, count, height) - diagramSizing.gridSize) + 8;
}

export function muxTopPortLeadLengthY(index: number, count: number, height: number): number {
  return Math.max(0, muxTopPortSkinEdgeY(index, count, height) - diagramSizing.gridSize);
}
