import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing } from '../../../diagram/constants';
import { nodeOperation, nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { ARRAY_STACK_SKIN_LAYERS } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import type { DiagramPort } from '../../../ir/types';

export function AluNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
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

  const outputs: DiagramPort[] = node.ports.filter((p: DiagramPort) => p.direction === 'output');

  return (
    <>
      {isArray && ARRAY_STACK_SKIN_LAYERS.map(layer => (
        <path
          key={layer.id}
          className={`svsch-node-shape hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          d={path}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}
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

      {/* Array stack leads */}
      {isArray && inputs.slice(0, 2).map((port: DiagramPort, index: number) =>
        hasArrayConnection(port.id, 'target') ? (
          <SvgArrayStackLeads
            key={`lead-${port.id}`}
            side="left"
            width={width}
            y={inputYs[index]}
            trimSink
          />
        ) : null
      )}
      {isArray && outputs[0] && hasArrayConnection(outputs[0].id, 'source') && (
        <SvgArrayStackLeads side="right" width={width} y={height / 2} />
      )}
      <path className="node-skin-selection" d={path} style={{ strokeLinejoin: 'round' }} />
    </>
  );
}
