import type { DiagramNode } from '../ir/types';
import { diagramSizing, nodeHeightForPortRows } from './constants';
import {
  instanceParameterRows,
  measureText,
  nodeTitle,
  sideLabelWidth,
  snappedWidth,
  type NodeSizingStrategy,
} from './nodeSizingCommon';

// Fallback for kinds without their own strategy — instance, latch, loop, and
// anything unrecognized render as a plain labeled box.

function instanceParameterWidth(node: DiagramNode): number {
  if (node.kind !== 'instance') return 0;
  const params = node.instanceParameters ?? node.metadata?.instanceParameters ?? [];
  return Math.max(0, ...params.map((param) => measureText(`${param.name}=${param.value ?? ''}`)));
}

export const defaultSizing: NodeSizingStrategy = {
  height: (node, ctx) => {
    const baseHeight = nodeHeightForPortRows(ctx.portRows);
    const parameterRows = instanceParameterRows(node);
    return parameterRows > 0 ? baseHeight + diagramSizing.gridSize * parameterRows : baseHeight;
  },
  width: (node, ctx) =>
    snappedWidth(
      diagramSizing.nodeWidth,
      Math.max(
        measureText(nodeTitle(node)),
        instanceParameterWidth(node),
        sideLabelWidth(node, ctx.sideInputs) + sideLabelWidth(node, ctx.outputs),
      ) +
        diagramSizing.nodeHorizontalPadding * 2,
    ),
};
