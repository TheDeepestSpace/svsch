import { gateBodyOperation, gateIsNegated } from '../ir/nodeMetadata';
import { diagramSizing, gateHeightForInputCount, snapUpToEvenGrid } from './constants';
import { snappedWidth, type NodeSizingStrategy } from './nodeSizingCommon';

/** Radius of a gate's negated-output bubble (NAND/NOR/XNOR) — matches the inverter's bubble. */
export const gateBubbleRadius = diagramSizing.gridSize / 6;
export const gateBubbleGap = 2;
/** Horizontal gap reserved for XOR/XNOR's extra back curve, left of the OR-shaped body. */
export const gateXorGap = 5;

/** Body width a gate needs: base AND/OR/XOR body, plus room for the XOR back-curve and/or
 * negation bubble. */
export function gateGeometryWidth(isXor: boolean, negated: boolean): number {
  const base = diagramSizing.gridSize * 3;
  const xorExtra = isXor ? gateXorGap : 0;
  const bubbleExtra = negated ? gateBubbleGap + gateBubbleRadius * 2 : 0;
  return base + xorExtra + bubbleExtra;
}

export const gateSizing: NodeSizingStrategy = {
  height: (_node, ctx) => gateHeightForInputCount(ctx.portRows),
  width: (node) =>
    snappedWidth(
      diagramSizing.muxWidth,
      gateGeometryWidth(gateBodyOperation(node) === 'xor', gateIsNegated(node)),
      snapUpToEvenGrid,
    ),
};
