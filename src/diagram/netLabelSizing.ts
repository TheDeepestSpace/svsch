import { diagramSizing } from './constants';
import { measureText, snappedWidth, type NodeSizingStrategy } from './nodeSizingCommon';

export const netLabelSizing: NodeSizingStrategy = {
  height: () => diagramSizing.gridSize * 2,
  width: (node) => snappedWidth(
    diagramSizing.gridSize * 4,
    measureText(node.label) + diagramSizing.gridSize / 2
  )
};
