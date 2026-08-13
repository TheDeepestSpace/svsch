import { diagramSizing, muxHeightForPortRows, snapUpToEvenGrid } from './constants';
import { snappedWidth, type NodeSizingStrategy } from './nodeSizingCommon';

export const aluSizing: NodeSizingStrategy = {
  height: () => muxHeightForPortRows(2),
  width: () => snappedWidth(
    diagramSizing.muxWidth,
    diagramSizing.gridSize * 3,
    snapUpToEvenGrid
  )
};
