import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing, nodePortCenterOffset } from '../../../diagram/constants';
import { instanceParameterRows } from '../../../diagram/nodeSizing';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { ARRAY_STACK_SKIN_LAYERS } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import type { DiagramPort, InstanceParameter } from '../../../ir/types';

export function InstanceNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const g = diagramSizing.gridSize;
  const inputs: DiagramPort[] = node.ports.filter(
    (p: DiagramPort) => p.direction === 'input' || p.direction === 'inout' || p.direction === 'unknown'
  );
  const outputs: DiagramPort[] = node.ports.filter((p: DiagramPort) => p.direction === 'output');

  const instanceParameters: InstanceParameter[] =
    node.kind === 'instance'
      ? (node.instanceParameters ?? node.metadata?.instanceParameters ?? [])
      : [];
  const paramRows = instanceParameterRows(node);

  // Module name shown as kind label, instance label as title
  const kindLabel =
    node.kind === 'instance' && node.instanceOf ? node.instanceOf : node.label;

  return (
    <>
      {isArray && ARRAY_STACK_SKIN_LAYERS.map(layer => (
        <rect
          key={layer.id}
          className={`svsch-node-shape hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          width={width} height={height}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}
      <rect className="svsch-node-shape" width={width} height={height} />
      <text className="svsch-node-kind" x={12} y={14} textAnchor="start" dominantBaseline="middle">
        {kindLabel}
      </text>
      <text className="svsch-node-title" x={12} y={26} textAnchor="start" dominantBaseline="middle">
        {node.label}
      </text>

      {instanceParameters.map((param: InstanceParameter, i: number) => (
        <text
          key={param.name ?? i}
          className="svsch-instance-param"
          x={width / 2}
          y={diagramSizing.nodeHeaderHeight + g * i + g * 0.3}
          textAnchor="middle"
          dominantBaseline="hanging"
          fontSize={10}
        >
          {param.name}{param.value ? `=${param.value}` : ''}
        </text>
      ))}

      {inputs.map((port: DiagramPort, i: number) => (
        <text
          key={port.id}
          className="svsch-port-label"
          x={g * 0.75}
          y={nodePortCenterOffset(i + paramRows)}
          dominantBaseline="middle"
        >
          {port.label ?? port.name}
        </text>
      ))}

      {outputs.map((port: DiagramPort, i: number) => (
        <text
          key={port.id}
          className="svsch-port-label"
          x={width - g * 0.75}
          y={nodePortCenterOffset(i + paramRows)}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {port.label ?? port.name}
        </text>
      ))}

      {/* Array stack leads */}
      {isArray && inputs.map((port: DiagramPort, i: number) =>
        hasArrayConnection(port.id, 'target') ? (
          <SvgArrayStackLeads
            key={`lead-${port.id}`}
            side="left"
            width={width}
            y={nodePortCenterOffset(i + paramRows)}
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
            y={nodePortCenterOffset(i + paramRows)}
          />
        ) : null
      )}
    </>
  );
}
