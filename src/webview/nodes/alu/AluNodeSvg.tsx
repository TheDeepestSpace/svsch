import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing } from '../../../diagram/constants';
import { nodeOperation } from '../../../ir/nodeMetadata';
import type { DiagramPort } from '../../../ir/types';

export function AluNodeSvg({ node, width, height }: NodeSvgProps): React.ReactElement {
  const g = diagramSizing.gridSize;
  const inputs: DiagramPort[] = node.ports.filter(
    (p: DiagramPort) => p.direction === 'input' || p.direction === 'inout' || p.direction === 'unknown'
  );

  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = (height - rightSideHeight) / 2;
  const rightBottom = rightTop + rightSideHeight;
  const notchX = width / 4;
  const midY = height / 2;
  const slope = rightTop / width;
  const deltaY = slope * notchX;
  const notchTopY = midY - deltaY;
  const notchBottomY = midY + deltaY;

  const path = [
    `M 0 0`,
    `L ${width} ${rightTop}`,
    `V ${rightBottom}`,
    `L 0 ${height}`,
    `V ${notchBottomY}`,
    `L ${notchX} ${midY}`,
    `L 0 ${notchTopY}`,
    `Z`
  ].join(' ');

  // Input port centers: top = (index === 0 ? g : g*3) - g/2, center = top + g/2
  const inputYs = [g * 1, g * 3];

  return (
    <>
      <path className="svsch-node-shape hdl-node-alu node-skin-body" d={path} />

      {inputs.slice(0, 2).map((port: DiagramPort, index: number) => (
        <text
          key={port.id}
          className="svsch-port-label"
          x={notchX + g * 0.5}
          y={inputYs[index]}
          dominantBaseline="middle"
        >
          {port.label ?? port.name}
        </text>
      ))}

      <text
        className="svsch-alu-operation"
        x={width * 0.65}
        y={midY}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={18}
        fontWeight={700}
      >
        {nodeOperation(node) ?? '+'}
      </text>
    </>
  );
}
