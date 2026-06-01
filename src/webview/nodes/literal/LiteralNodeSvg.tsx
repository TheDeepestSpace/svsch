import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';

export function LiteralNodeSvg({ node, width, height }: NodeSvgProps): React.ReactElement {
  return (
    <>
      <rect className="svsch-node-shape hdl-node-literal" width={width} height={height} rx={4} />
      <text className="svsch-node-title" x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle">
        {node.label}
      </text>
    </>
  );
}
