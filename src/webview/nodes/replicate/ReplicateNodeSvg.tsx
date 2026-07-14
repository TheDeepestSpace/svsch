import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import {
  nodeArrayDimension,
  nodeIsArrayNode,
  repeatExpression,
  repeatExpressionSource,
} from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import { arrayStackLayersFor, arrayStackSkinLayersFor } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import type { DiagramPort } from '../../../ir/types';

export function ReplicateNodeSvg({ node, width, height, arrayConnections, onNavigateToSource }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const stackWide = isArray && nodeStackIsWide(node);
  const stackLayers = arrayStackLayersFor(stackWide);
  const skinLayers = arrayStackSkinLayersFor(stackWide);
  const arrayDim = nodeArrayDimension(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const outputs: DiagramPort[] = node.ports.filter((p: DiagramPort) => p.direction === 'output');
  const contentShiftX = isArray ? stackLayers.front.dx : 0;
  const contentShiftY = isArray ? stackLayers.front.dy : 0;
  const shapeTransform = isArray
    ? `translate(${stackLayers.front.dx}, ${stackLayers.front.dy})`
    : undefined;
  const source = repeatExpressionSource(node);
  const expression = repeatExpression(node);
  const symbolicLabel = source && expression && node.label === `x ${expression}`;
  const fontSize = 11;
  const charW = fontSize * 0.62;
  const stopSvgInteraction = (event: React.SyntheticEvent) => {
    if (onNavigateToSource) event.stopPropagation();
  };
  const navigateSvgSource = (event: React.MouseEvent) => {
    if (!source || !onNavigateToSource) return;
    event.stopPropagation();
    onNavigateToSource(source);
  };

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
      <text className="svsch-literal-content svsch-repeat-label" x={Math.round(width / 2 + contentShiftX)} y={Math.round(height / 2 + contentShiftY)} textAnchor="middle" dominantBaseline="middle">
        {symbolicLabel ? (
          <>
            <tspan>x </tspan>
            <tspan
              className="svsch-repeat-label-clickable nodrag nopan"
              onClick={navigateSvgSource}
              onDoubleClick={stopSvgInteraction}
              onMouseDown={stopSvgInteraction}
              onPointerDown={stopSvgInteraction}
            >
              {expression}
            </tspan>
          </>
        ) : node.label}
        {isArray && <tspan className="svsch-svg-array-index"> [0]</tspan>}
      </text>
      {symbolicLabel && expression && (
        <line
          className="svsch-svg-link-underline svsch-repeat-label-underline"
          x1={Math.round(width / 2 + contentShiftX + charW * (2 - expression.length) / 2)}
          x2={Math.round(width / 2 + contentShiftX + charW * (2 + expression.length) / 2)}
          y1={Math.round(height / 2 + contentShiftY + fontSize * 0.62)}
          y2={Math.round(height / 2 + contentShiftY + fontSize * 0.62)}
        />
      )}
      {isArray && arrayDim && (
        <text className="svsch-node-kind svsch-array-badge" x={Math.round(width + 3)} y={-4} textAnchor="start">
          {arrayDim}
        </text>
      )}

      {/* Array stack leads */}
      {isArray && outputs.map((port: DiagramPort) =>
        hasArrayConnection(port.id, 'source') ? (
          <SvgArrayStackLeads wide={stackWide} key={port.id} side="right" width={width} y={height / 2} />
        ) : null
      )}
    </>
  );
}
