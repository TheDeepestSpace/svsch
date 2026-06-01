import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing } from '../../../diagram/constants';

export function InverterNodeSvg({ node: _node, width: _width, height }: NodeSvgProps): React.ReactElement {
  const g = diagramSizing.gridSize;
  const side = g;
  const bubbleRadius = Math.min(g / 4, side / 6);
  const bubbleGap = 2;
  const bodyRight = side * Math.sqrt(3) / 2;
  const midY = height / 2;
  const triTop = midY - side / 2;
  const triBottom = midY + side / 2;
  const path = `M 0 ${triTop} L ${bodyRight} ${midY} L 0 ${triBottom} Z`;
  const bubbleCx = bodyRight + bubbleGap + bubbleRadius;

  return (
    <>
      <path className="svsch-node-shape hdl-node-inverter node-skin-body" d={path} />
      <circle className="svsch-node-shape hdl-node-inverter node-skin-body inverter-bubble" cx={bubbleCx} cy={midY} r={bubbleRadius} />
    </>
  );
}
