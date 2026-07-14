import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { nodePortCenterOffset } from '../../../diagram/constants';
import { instanceParameterRows } from '../../../diagram/nodeSizing';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import { arrayStackLayersFor, arrayStackSkinLayersFor } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import type { DiagramPort } from '../../../ir/types';

export function CombNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const stackWide = isArray && nodeStackIsWide(node);
  const stackLayers = arrayStackLayersFor(stackWide);
  const skinLayers = arrayStackSkinLayersFor(stackWide);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const inputs: DiagramPort[] = node.ports.filter(
    (p: DiagramPort) => p.direction === 'input' || p.direction === 'inout' || p.direction === 'unknown'
  );
  const outputs: DiagramPort[] = node.ports.filter((p: DiagramPort) => p.direction === 'output');
  const paramRows = instanceParameterRows(node);
  const contentShiftX = isArray ? stackLayers.front.dx : 0;
  const contentShiftY = isArray ? stackLayers.front.dy : 0;
  const shapeTransform = isArray
    ? `translate(${stackLayers.front.dx}, ${stackLayers.front.dy})`
    : undefined;

  return (
    <>
      {isArray && skinLayers.filter(layer => layer.id !== 'front').map(layer => (
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
        COMBINATIONAL
      </text>

      {/* Array stack leads */}
      {isArray && inputs.map((port: DiagramPort, i: number) =>
        hasArrayConnection(port.id, 'target') ? (
          <SvgArrayStackLeads
            wide={stackWide}
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
            wide={stackWide}
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
