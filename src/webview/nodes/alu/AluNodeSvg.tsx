import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing } from '../../../diagram/constants';
import { muxRightTopY } from '../../../diagram/muxGeometry';
import { nodeOperation, nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import { arrayStackLayersFor, arrayStackSkinLayersFor } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import type { DiagramPort } from '../../../ir/types';

export function AluNodeSvg({
  node,
  width,
  height,
  arrayConnections,
}: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const stackWide = isArray && nodeStackIsWide(node);
  const stackLayers = arrayStackLayersFor(stackWide);
  const skinLayers = arrayStackSkinLayersFor(stackWide);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some((c) => c.portId === portId && c.role === role);
  const arrayConnectionThick = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).find((c) => c.portId === portId && c.role === role)?.thick ?? false;
  const g = diagramSizing.gridSize;
  const inputs: DiagramPort[] = node.ports.filter(
    (p: DiagramPort) =>
      p.direction === 'input' || p.direction === 'inout' || p.direction === 'unknown',
  );

  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = muxRightTopY(height);
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
    `Z`,
  ].join(' ');

  // Input port centers: top = (index === 0 ? g : g*3) - g/2, center = top + g/2
  const inputYs = [g * 1, g * 3];

  const outputs: DiagramPort[] = node.ports.filter((p: DiagramPort) => p.direction === 'output');
  const contentShiftX = isArray ? stackLayers.front.dx : 0;
  const contentShiftY = isArray ? stackLayers.front.dy : 0;
  const bodyTransform = isArray
    ? `translate(${stackLayers.front.dx}, ${stackLayers.front.dy})`
    : undefined;

  return (
    <>
      {isArray &&
        skinLayers
          .filter((layer) => layer.id !== 'front')
          .map((layer) => (
            <path
              key={layer.id}
              className={
                `svsch-node-shape hdl-node-array-layer hdl-node-array-${layer.id} ` +
                `svsch-array-layer-${layer.id}`
              }
              transform={`translate(${layer.dx}, ${layer.dy})`}
              d={path}
              opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
            />
          ))}
      <path
        className={
          `svsch-node-shape hdl-node-alu node-skin-body` +
          `${isArray ? ' hdl-node-array-layer hdl-node-array-front svsch-array-layer-front' : ''}`
        }
        transform={bodyTransform}
        d={path}
      />

      <text
        className="svsch-alu-operation"
        x={Math.round(width * 0.65 + contentShiftX)}
        y={Math.round(midY + contentShiftY)}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={18}
        fontWeight={700}
      >
        {nodeOperation(node) ?? '+'}
      </text>

      {/* Array stack leads */}
      {isArray &&
        inputs
          .slice(0, 2)
          .map((port: DiagramPort, index: number) =>
            hasArrayConnection(port.id, 'target') ? (
              <SvgArrayStackLeads
                wide={stackWide}
                thick={arrayConnectionThick(port.id, 'target')}
                key={`lead-${port.id}`}
                side="left"
                width={width}
                y={inputYs[index]}
                trimSink
              />
            ) : null,
          )}
      {isArray && outputs[0] && hasArrayConnection(outputs[0].id, 'source') && (
        <SvgArrayStackLeads
          wide={stackWide}
          thick={arrayConnectionThick(outputs[0].id, 'source')}
          side="right"
          width={width}
          y={height / 2}
        />
      )}
      {!isArray && (
        <path className="node-skin-selection" d={path} style={{ strokeLinejoin: 'round' }} />
      )}
    </>
  );
}
