import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { nodePortCenterOffset } from '../../../diagram/constants';
import { instanceParameterRows } from '../../../diagram/nodeSizing';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { ARRAY_STACK_LAYERS, ARRAY_STACK_SKIN_LAYERS } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import type { DiagramPort } from '../../../ir/types';

export function LoopNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const inputs: DiagramPort[] = node.ports.filter(
    (p: DiagramPort) => p.direction === 'input' || p.direction === 'inout' || p.direction === 'unknown'
  );
  const outputs: DiagramPort[] = node.ports.filter((p: DiagramPort) => p.direction === 'output');
  const paramRows = instanceParameterRows(node);
  const contentShiftX = isArray ? ARRAY_STACK_LAYERS.front.dx : 0;
  const contentShiftY = isArray ? ARRAY_STACK_LAYERS.front.dy : 0;
  const shapeTransform = isArray
    ? `translate(${ARRAY_STACK_LAYERS.front.dx}, ${ARRAY_STACK_LAYERS.front.dy})`
    : undefined;

  return (
    <>
      {isArray && ARRAY_STACK_SKIN_LAYERS.filter(layer => layer.id !== 'front').map(layer => (
        <rect
          key={layer.id}
          className={`svsch-node-shape hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          width={width} height={height}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}
      <rect
        className={`svsch-node-shape${isArray ? ' hdl-node-array-layer hdl-node-array-front svsch-array-layer-front' : ''}`}
        transform={shapeTransform}
        width={width}
        height={height}
      />
      <text className="svsch-node-kind" x={Math.round(12 + contentShiftX)} y={Math.round(14 + contentShiftY)} textAnchor="start" dominantBaseline="middle">
        LOOP
      </text>

      {/* Array stack leads */}
      {isArray && inputs.map((port: DiagramPort, i: number) =>
        hasArrayConnection(port.id, 'target') ? (
          <SvgArrayStackLeads
            key={`lead-${port.id}`}
            side="left"
            width={width}
            y={Math.round(nodePortCenterOffset(i + paramRows))}
            trimSink
          />
        ) : null
      )}
      {isArray && outputs.map((port: DiagramPort, i: number) =>
        hasArrayConnection(port.id, 'source') ? (
          <SvgArrayStackLeads
            key={`lead-${port.id}`}
            side="right"
            width={width}
            y={Math.round(nodePortCenterOffset(i + paramRows))}
          />
        ) : null
      )}
    </>
  );
}
