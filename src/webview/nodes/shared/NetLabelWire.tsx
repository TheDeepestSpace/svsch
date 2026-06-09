import React from 'react';
import { Position } from '@xyflow/react';
import { diagramSizing } from '../../../diagram/constants';
import { diagramNodeDimensions } from '../../../diagram/nodeSizing';
import { ARRAY_STACK_LAYERS, ARRAY_STACK_LEAD_EDGE_GAP, ARRAY_STACK_LEAD_LAYERS, arrayStackLayerTrim } from '../../arrayStackGeometry';
import type { PositionedNode } from '../../../ir/types';

export function ArrayStackLeads({
  side,
  width,
  y,
  x,
  trimSink = false
}: {
  side: 'left' | 'right' | 'top' | 'bottom';
  width: number;
  y: number;
  x?: number;
  trimSink?: boolean;
}): React.ReactElement {
  return (
    <svg
      className={`svsch-array-stack-leads svsch-array-stack-leads-${trimSink ? 'target' : 'source'} svsch-array-stack-leads-${side}`}
      aria-hidden="true"
      focusable="false"
    >
      {ARRAY_STACK_LEAD_LAYERS.map((layer) => {
        const trim = arrayStackLayerTrim(layer.id);
        const shapeX = (side === 'top' || side === 'bottom')
          ? (x ?? width / 2) + layer.dx
          : side === 'left'
            ? layer.dx
            : width + layer.dx;
        const shapeY = y + layer.dy;
        const endY = side === 'top' && trimSink
          ? shapeY - ARRAY_STACK_LEAD_EDGE_GAP
          : shapeY;
        const sourceRightExitX = width + ARRAY_STACK_LAYERS.back.dx + ARRAY_STACK_LEAD_EDGE_GAP;
        const bottomExitY = y + ARRAY_STACK_LAYERS.back.dy + ARRAY_STACK_LEAD_EDGE_GAP;
        const leadX = (side === 'top' || side === 'bottom')
          ? shapeX
          : side === 'left'
            ? shapeX - trim
            : trimSink
              ? shapeX + trim
              : Math.max(shapeX + trim, sourceRightExitX);
        const leadY = side === 'top'
          ? endY - trim
          : side === 'bottom'
            ? Math.max(endY + trim, bottomExitY)
            : shapeY;
        return (
          <path
            key={layer.id}
            className={`svsch-array-stack-lead svsch-array-stack-lead-${layer.id} svsch-array-stack-lead-${trimSink ? 'target' : 'source'}-${side}`}
            d={`M ${leadX} ${leadY} L ${shapeX} ${endY}`}
          />
        );
      })}
    </svg>
  );
}

export function handlePositionForSide(side: 'left' | 'right' | 'top' | 'bottom'): Position {
  if (side === 'left') return Position.Left;
  if (side === 'right') return Position.Right;
  if (side === 'top') return Position.Top;
  return Position.Bottom;
}

export function NetLabelWirePaths({
  handleSide,
  edgeStyle,
  align,
  isSourceStacked = false,
  width,
  height
}: {
  handleSide: 'left' | 'right' | 'top' | 'bottom';
  edgeStyle?: { aggregate?: 'struct' | 'interface' | string; isStacked?: boolean };
  align?: 'start' | 'end';
  isSourceStacked?: boolean;
  width: number;
  height: number;
}): React.ReactElement {
  const isInterface = edgeStyle?.aggregate === 'interface';
  const isStruct = edgeStyle?.aggregate === 'struct';
  const isStacked = isSourceStacked;

  const horizontalPath = (handleSide === 'top' || handleSide === 'bottom')
    ? (align === 'end' ? `M ${width / 2} ${height / 2} H ${width}` : `M 0 ${height / 2} H ${width / 2}`)
    : `M 0 ${height / 2} H ${width}`;
  const verticalPath = handleSide === 'top'
    ? `M ${width / 2} ${height / 2} V 0`
    : handleSide === 'bottom'
      ? `M ${width / 2} ${height / 2} V ${height}`
      : '';

  const renderPath = (className: string, transform?: string) => (
    <g transform={transform}>
      <path className={className} d={horizontalPath} />
      {verticalPath && <path className={className} d={verticalPath} />}
    </g>
  );

  return (
    <>
      {isInterface && <path className="svsch-edge svsch-edge-interface-bg" d={horizontalPath + verticalPath} />}
      {isStacked ? (
        <>
          {renderPath('svsch-edge svsch-edge-stacked-back', 'translate(4, 4)')}
          {renderPath('svsch-edge svsch-edge-stacked')}
          {renderPath('svsch-edge svsch-edge-stacked-front', 'translate(-4, -4)')}
        </>
      ) : (
        <path className={`svsch-edge${isInterface ? ' svsch-edge-interface' : isStruct ? ' svsch-edge-struct' : ''}`} d={horizontalPath + verticalPath} />
      )}
    </>
  );
}

export function NetLabelWire({
  node,
  handleSide,
  edgeStyle,
  align,
  isSourceStacked = false
}: {
  node: PositionedNode;
  handleSide: 'left' | 'right' | 'top' | 'bottom';
  edgeStyle?: { aggregate?: 'struct' | 'interface' | string; isStacked?: boolean };
  align?: 'start' | 'end';
  isSourceStacked?: boolean;
}): React.ReactElement {
  const isInterface = edgeStyle?.aggregate === 'interface';
  const isStruct = edgeStyle?.aggregate === 'struct';
  const isStacked = isSourceStacked;

  const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);

  const classes = [
    'hdl-net-label-wire-svg',
    isInterface ? 'svsch-edge-interface' : '',
    isStruct ? 'svsch-edge-struct' : '',
    isStacked ? 'svsch-edge-stacked' : ''
  ].filter(Boolean).join(' ');

  return (
    <svg className={classes} viewBox={`0 0 ${nodeWidth} ${nodeHeight}`} style={{ overflow: 'visible' }}>
      <NetLabelWirePaths
        handleSide={handleSide}
        edgeStyle={edgeStyle}
        align={align}
        isSourceStacked={isSourceStacked}
        width={nodeWidth}
        height={nodeHeight}
      />
    </svg>
  );
}
