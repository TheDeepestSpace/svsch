import type { DiagramNode, DiagramPort } from '../ir/types';
import { selectPortLabel } from './selectLabels';
import { diagramSizing, muxHeightForPortRows, snapUpToEvenGrid } from './constants';
import {
  measureText,
  portLabel,
  snappedWidth,
  type NodeSizingContext,
  type NodeSizingStrategy,
} from './nodeSizingCommon';

function muxPortLabel(node: DiagramNode, port: DiagramPort, collapseWidth: boolean): string {
  return node.kind === 'select'
    ? selectPortLabel(node, port)
    : portLabel(port, true, true, collapseWidth);
}

function muxWidth(node: DiagramNode, ctx: NodeSizingContext): number {
  const isSelect = node.kind === 'select';
  const inputLabelWidth = Math.max(
    0,
    ...ctx.sideInputs.map((port) => measureText(muxPortLabel(node, port, !isSelect))),
  );
  const outputLabelWidth = Math.max(
    0,
    ...ctx.outputs.slice(0, 1).map((port) => measureText(muxPortLabel(node, port, !isSelect))),
  );
  const labelBasedWidth = inputLabelWidth + outputLabelWidth + diagramSizing.muxHorizontalPadding;

  // When there are many inputs the mux is tall, the slanted top/bottom edges cut into the label
  // area. Use the binding gap — the smaller of the top clearance and the distance from the last
  // port's centre to the mux bottom — so both the first label top and the last port connection
  // point stay inside the trapezoid. labelRightEdge adds 2px for .svsch-port-type-suffix margin.
  // Constraint: width >= rightTop * labelRightEdge / bindingGap
  let slopeMinWidth = 0;
  if (!isSelect && ctx.sideInputs.length > 0 && inputLabelWidth > 0) {
    const height = muxHeightForPortRows(ctx.portRows);
    const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
    const rightTop = (height - rightSideHeight) / 2;
    if (rightTop > 0) {
      const grid = diagramSizing.gridSize;
      const heightUnits = height / grid;
      const startUnit = Math.max(1, Math.ceil((heightUnits - ctx.sideInputs.length + 1) / 2));
      const topGap = grid * startUnit - grid / 2;
      const bottomCenterGap = height - grid * (startUnit + ctx.sideInputs.length - 1);
      const bindingGap = Math.min(topGap, bottomCenterGap);
      if (bindingGap > 0) {
        const cssTypeSuffixMargin = 2;
        const labelRightEdge =
          diagramSizing.muxHorizontalPadding / 2 + inputLabelWidth + cssTypeSuffixMargin;
        slopeMinWidth = (rightTop * labelRightEdge) / bindingGap;
      }
    }
  }

  return snappedWidth(
    diagramSizing.muxWidth,
    Math.max(labelBasedWidth, slopeMinWidth),
    snapUpToEvenGrid,
  );
}

export const muxSizing: NodeSizingStrategy = {
  height: (_node, ctx) => muxHeightForPortRows(ctx.portRows),
  width: muxWidth,
};
