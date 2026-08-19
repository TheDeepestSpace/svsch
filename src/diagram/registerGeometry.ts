import { diagramSizing } from './constants';

export function registerPortTop(
  role: 'd' | 'q' | 'clock' | 'reset' | 'rv',
  nodeHeight: number,
  _hasReset: boolean,
  _hasRv: boolean,
): number {
  const grid = diagramSizing.gridSize;
  if (role === 'd' || role === 'q') {
    return diagramSizing.nodeHeaderHeight;
  }
  if (role === 'clock') {
    return diagramSizing.nodeHeaderHeight + grid;
  }
  if (role === 'rv') {
    return diagramSizing.nodeHeaderHeight + grid * 2;
  }
  return nodeHeight - grid;
}

export function registerExtraInputPortTop(
  index: number,
  nodeHeight: number,
  hasRv: boolean,
): number {
  const grid = diagramSizing.gridSize;
  const offset = hasRv ? 3 : 2;
  return Math.min(diagramSizing.nodeHeaderHeight + grid * (index + offset), nodeHeight - grid);
}
