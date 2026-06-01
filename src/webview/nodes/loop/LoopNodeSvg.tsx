import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';

export function LoopNodeSvg({ node: _node, width, height }: NodeSvgProps): React.ReactElement {
  return (
    <>
      <rect className="svsch-node-shape hdl-node-loop" width={width} height={height} rx={4} />
      <text className="svsch-node-kind" x={width / 2} y={8} textAnchor="middle" dominantBaseline="middle">
        LOOP
      </text>
    </>
  );
}
