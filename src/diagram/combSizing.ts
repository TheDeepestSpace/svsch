import { combHeightForPortRows, diagramSizing } from './constants';
import type { NodeSizingStrategy } from './nodeSizingCommon';

export const combSizing: NodeSizingStrategy = {
  height: (_node, ctx) => combHeightForPortRows(ctx.portRows),
  width: () => diagramSizing.nodeWidth,
};
