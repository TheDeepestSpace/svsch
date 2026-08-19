import { diagramSizing, literalHeightForPortRows } from './constants';
import { measureText, nodeTitle, snappedWidth, type NodeSizingStrategy } from './nodeSizingCommon';

export const literalSizing: NodeSizingStrategy = {
  height: () => literalHeightForPortRows(),
  width: (node) => snappedWidth(diagramSizing.literalMinWidth, measureText(nodeTitle(node)) + 8),
};
