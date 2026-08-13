import { diagramSizing } from './constants';
import { measureText, nodeTitle, snappedWidth, type NodeSizingStrategy } from './nodeSizingCommon';

export const replicateSizing: NodeSizingStrategy = {
  height: () => diagramSizing.gridSize * 2,
  width: (node) => snappedWidth(
    diagramSizing.gridSize * 2,
    measureText(nodeTitle(node)) + 8
  )
};
