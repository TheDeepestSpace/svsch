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
 * edge. That spacing only fits within the body's existing height for small
 * port counts (2, 3); larger counts fall back to the tighter, centered
 * `muxInputPortCenterY` spacing rather than growing the body further.
 */
export function gateInputPortCenterY(index: number, count: number, height: number): number {
  const grid = diagramSizing.gridSize;
  const spreadCenterY = (i: number): number => grid * (1 + 2 * i);
  const fits = spreadCenterY(count - 1) + grid <= height;
  return fits ? spreadCenterY(index) : muxInputPortCenterY(index, count, height);
}

export function muxTopPortSkinEdgeY(index: number, count: number, height: number): number {
  const xFraction = (index + 1) / (count + 1);
  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = (height - rightSideHeight) / 2;
  return rightTop * xFraction;
}

export function muxTopPortLabelOffsetY(index: number, count: number, height: number): number {
  return Math.max(0, muxTopPortSkinEdgeY(index, count, height) - diagramSizing.gridSize) + 8;
}

export function muxTopPortLeadLengthY(index: number, count: number, height: number): number {
  return Math.max(0, muxTopPortSkinEdgeY(index, count, height) - diagramSizing.gridSize);
}
