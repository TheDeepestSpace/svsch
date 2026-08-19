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
import { ArrayStackSkinRect } from '../shared/ArrayStackSkinRect';
import {
  hasArrayConnection as sharedHasArrayConnection,
  arrayConnectionThick as sharedArrayConnectionThick,
} from '../shared/arrayConnections';
import type { DiagramPort } from '../../../ir/types';

export function ReplicateNodeSvg({
  node,
  width,
  height,
  arrayConnections,
  onNavigateToSource,
}: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const stackWide = isArray && nodeStackIsWide(node);
  const stackLayers = arrayStackLayersFor(stackWide);
  const skinLayers = arrayStackSkinLayersFor(stackWide);
  const arrayDim = nodeArrayDimension(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    sharedHasArrayConnection(arrayConnections, portId, role);
  const arrayConnectionThick = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    sharedArrayConnectionThick(arrayConnections, portId, role);
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
      <ArrayStackSkinRect
        isArray={isArray}
        skinLayers={skinLayers}
        shapeTransform={shapeTransform}
        width={width}
        height={height}
      />
      <text
        className="svsch-literal-content svsch-repeat-label"
        x={Math.round(width / 2 + contentShiftX)}
        y={Math.round(height / 2 + contentShiftY)}
        textAnchor="middle"
        dominantBaseline="middle"
      >
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
        ) : (
          node.label
        )}
        {isArray && <tspan className="svsch-svg-array-index"> [0]</tspan>}
      </text>
      {symbolicLabel && expression && (
        <line
          className="svsch-svg-link-underline svsch-repeat-label-underline"
          x1={Math.round(width / 2 + contentShiftX + (charW * (2 - expression.length)) / 2)}
          x2={Math.round(width / 2 + contentShiftX + (charW * (2 + expression.length)) / 2)}
          y1={Math.round(height / 2 + contentShiftY + fontSize * 0.62)}
          y2={Math.round(height / 2 + contentShiftY + fontSize * 0.62)}
        />
      )}
      {isArray && arrayDim && (
        <text
          className="svsch-node-kind svsch-array-badge"
          x={Math.round(width + 3)}
          y={-4}
          textAnchor="start"
        >
          {arrayDim}
        </text>
      )}

      {/* Array stack leads */}
      {isArray &&
        outputs.map((port: DiagramPort) =>
          hasArrayConnection(port.id, 'source') ? (
            <SvgArrayStackLeads
              wide={stackWide}
              thick={arrayConnectionThick(port.id, 'source')}
              key={port.id}
              side="right"
              width={width}
              y={height / 2}
            />
          ) : null,
        )}
    </>
  );
}
