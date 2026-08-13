import { diagramSizing, literalHeightForPortRows } from './constants';
import { measureText, nodeTitle, snappedWidth, type NodeSizingStrategy } from './nodeSizingCommon';

export const literalSizing: NodeSizingStrategy = {
  height: (_node, ctx) => literalHeightForPortRows(ctx.portRows),
  width: (node) => snappedWidth(
    diagramSizing.literalMinWidth,
    measureText(nodeTitle(node)) + 8
  )
};
