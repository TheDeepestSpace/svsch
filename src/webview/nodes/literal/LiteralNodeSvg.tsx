import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { normalizeWidth } from '../../../diagram/constants';
import { ARRAY_STACK_SKIN_LAYERS } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import type { DiagramPort } from '../../../ir/types';

export function LiteralNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const outputs: DiagramPort[] = node.ports.filter((p: DiagramPort) => p.direction === 'output');
  const outputPort = outputs[0];
  const portWidth = normalizeWidth(outputPort?.widthExpression ?? outputPort?.width);
  const displayLabel = portWidth ? `${node.label} ${portWidth}` : node.label;

  return (
    <>
      {isArray && ARRAY_STACK_SKIN_LAYERS.map(layer => (
        <rect
          key={layer.id}
          className={`svsch-node-shape svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          width={width} height={height} rx={4}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}
      <rect className="svsch-node-shape hdl-node-literal" width={width} height={height} rx={4} />
      <text className="svsch-node-title" x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle">
        {displayLabel}
      </text>

      {/* Array stack leads */}
      {isArray && outputs.map((port: DiagramPort) =>
        hasArrayConnection(port.id, 'source') ? (
          <SvgArrayStackLeads key={port.id} side="right" width={width} y={height / 2} />
        ) : null
      )}
    </>
  );
}
