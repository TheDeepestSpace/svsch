import { diagramSizing } from './constants';
import { measureText, snappedWidth, type NodeSizingStrategy } from './nodeSizingCommon';

export const boundaryPortSizing: NodeSizingStrategy = {
  height: () => diagramSizing.gridSize * 2,
  width: (node) =>
    snappedWidth(diagramSizing.gridSize * 2, measureText(node.label) + diagramSizing.gridSize),
};
