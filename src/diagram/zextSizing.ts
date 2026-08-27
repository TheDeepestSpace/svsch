import { diagramSizing, snapUpToEvenGrid } from './constants';
import { measureText, nodeTitle, snappedWidth, type NodeSizingStrategy } from './nodeSizingCommon';

export const zextSizing: NodeSizingStrategy = {
  height: () => diagramSizing.gridSize * 2,
  width: (node) =>
    snappedWidth(diagramSizing.gridSize * 2, measureText(nodeTitle(node)) + 8, snapUpToEvenGrid),
};
