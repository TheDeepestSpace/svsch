import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing, nodePortCenterOffset } from '../../../diagram/constants';
import { instanceParameterRows } from '../../../diagram/nodeSizing';
import type { DiagramPort, InstanceParameter } from '../../../ir/types';

export function InstanceNodeSvg({ node, width, height }: NodeSvgProps): React.ReactElement {
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
      <rect className="svsch-node-shape hdl-node-instance" width={width} height={height} rx={4} />
      <text className="svsch-node-kind" x={width / 2} y={8} textAnchor="middle" dominantBaseline="middle">
        {kindLabel}
      </text>
      <text className="svsch-node-title" x={width / 2} y={26} textAnchor="middle" dominantBaseline="middle">
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
    </>
  );
}
