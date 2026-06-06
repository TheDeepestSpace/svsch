import { diagramSizing } from './constants';

export function muxInputPortCenterY(index: number, count: number, height: number): number {
  const grid = diagramSizing.gridSize;
  const heightUnits = Math.max(1, Math.round(height / grid));
  const startUnit = Math.max(1, Math.ceil((heightUnits - count + 1) / 2));
  return grid * (startUnit + index);
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
