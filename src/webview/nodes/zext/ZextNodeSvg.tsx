import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing } from '../../../diagram/constants';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import { arrayStackLayersFor, arrayStackSkinLayersFor } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import type { DiagramPort } from '../../../ir/types';

// A width adapter: narrow on the input side, full height on the output side,
// with a "0" glyph marking the zero-filled high bits.
export function ZextNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const stackWide = isArray && nodeStackIsWide(node);
  const stackLayers = arrayStackLayersFor(stackWide);
  const skinLayers = arrayStackSkinLayersFor(stackWide);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const arrayConnectionThick = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).find(c => c.portId === portId && c.role === role)?.thick ?? false;
  const inputs = node.ports.filter((p: DiagramPort) => p.direction !== 'output');
  const outputs = node.ports.filter((p: DiagramPort) => p.direction === 'output');
  const midY = height / 2;
  const narrowHalf = Math.min(height, diagramSizing.gridSize) / 4;

  const path = [
    `M 0 ${midY - narrowHalf}`,
    `L ${width} 0`,
    `L ${width} ${height}`,
    `L 0 ${midY + narrowHalf}`,
    `Z`
  ].join(' ');

  const contentShiftX = isArray ? stackLayers.front.dx : 0;
  const contentShiftY = isArray ? stackLayers.front.dy : 0;
  const bodyTransform = isArray
    ? `translate(${stackLayers.front.dx}, ${stackLayers.front.dy})`
    : undefined;

  return (
    <>
      {isArray && skinLayers.filter(layer => layer.id !== 'front').map(layer => (
        <path
          key={layer.id}
          className={`svsch-node-shape hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          d={path}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}
      <path
        className={`svsch-node-shape hdl-node-zext node-skin-body${isArray ? ' hdl-node-array-layer hdl-node-array-front svsch-array-layer-front' : ''}`}
        transform={bodyTransform}
        d={path}
      />

      <text
        className="svsch-alu-operation"
        x={Math.round(width * 0.6 + contentShiftX)}
        y={Math.round(midY + contentShiftY)}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={12}
        fontWeight={700}
      >
        0
      </text>

      {/* Array stack leads */}
      {isArray && inputs[0] && hasArrayConnection(inputs[0].id, 'target') && (
        <SvgArrayStackLeads wide={stackWide} thick={arrayConnectionThick(inputs[0].id, 'target')} side="left" width={width} y={midY} trimSink />
      )}
      {isArray && outputs[0] && hasArrayConnection(outputs[0].id, 'source') && (
        <SvgArrayStackLeads wide={stackWide} thick={arrayConnectionThick(outputs[0].id, 'source')} side="right" width={width} y={midY} />
      )}
      {!isArray && <path className="node-skin-selection" d={path} style={{ strokeLinejoin: 'round' }} />}
    </>
  );
}
