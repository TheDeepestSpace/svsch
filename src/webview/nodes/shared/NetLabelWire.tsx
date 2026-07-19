import React from 'react';
import { Position } from '@xyflow/react';
import { diagramSizing } from '../../../diagram/constants';
import { diagramNodeDimensions } from '../../../diagram/nodeSizing';
import { arrayStackLayer, ARRAY_STACK_LEAD_EDGE_GAP, arrayStackLeadLayersFor, arrayStackLayerTrim } from '../../arrayStackGeometry';
import type { PositionedNode } from '../../../ir/types';

export function ArrayStackLeads({
  side,
  width,
  y,
  x,
  trimSink = false,
  wide = false,
  thick = false
}: {
  side: 'left' | 'right' | 'top' | 'bottom';
  width: number;
  y: number;
  x?: number;
  trimSink?: boolean;
  /** Lane spread: tracks the node's own card layout. */
  wide?: boolean;
  /** Stroke weight: tracks this specific connection's own thickness. */
  thick?: boolean;
}): React.ReactElement {
  return (
    <svg
      className={`svsch-array-stack-leads svsch-array-stack-leads-${trimSink ? 'target' : 'source'} svsch-array-stack-leads-${side}`}
      aria-hidden="true"
      focusable="false"
    >
      {arrayStackLeadLayersFor(wide).map((layer) => {
        const trim = arrayStackLayerTrim(layer.id, wide);
        const shapeX = (side === 'top' || side === 'bottom')
          ? (x ?? width / 2) + layer.dx
          : side === 'left'
            ? layer.dx
            : width + layer.dx;
        const shapeY = y + layer.dy;
        const endY = side === 'top' && trimSink
          ? shapeY - ARRAY_STACK_LEAD_EDGE_GAP
          : shapeY;
        const sourceRightExitX = width + arrayStackLayer('back', wide).dx + ARRAY_STACK_LEAD_EDGE_GAP;
        const bottomExitY = y + arrayStackLayer('back', wide).dy + ARRAY_STACK_LEAD_EDGE_GAP;
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
            className={`svsch-array-stack-lead svsch-array-stack-lead-${layer.id} svsch-array-stack-lead-${trimSink ? 'target' : 'source'}-${side}${thick ? ' svsch-array-stack-lead-thick' : ''}`}
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
  edgeStyle?: { aggregate?: 'struct' | 'interface' | string; isStacked?: boolean; thick?: boolean };
  align?: 'start' | 'end';
  isSourceStacked?: boolean;
  width: number;
  height: number;
}): React.ReactElement {
  const isInterface = edgeStyle?.aggregate === 'interface';
  const isStruct = edgeStyle?.aggregate === 'struct';
  const isThick = !isInterface && !isStruct && edgeStyle?.thick === true;
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
      {isStruct && <path className="svsch-edge svsch-edge-struct-bg" d={horizontalPath + verticalPath} />}
      {isStacked ? (
        <>
          {renderPath(`svsch-edge svsch-edge-stacked-back${isThick ? ' svsch-edge-thick' : ''}`, `translate(${arrayStackLayer('back', isThick).dx}, ${arrayStackLayer('back', isThick).dy})`)}
          {renderPath(`svsch-edge svsch-edge-stacked${isThick ? ' svsch-edge-thick' : ''}`)}
          {renderPath(`svsch-edge svsch-edge-stacked-front${isThick ? ' svsch-edge-thick' : ''}`, `translate(${arrayStackLayer('front', isThick).dx}, ${arrayStackLayer('front', isThick).dy})`)}
        </>
      ) : (
        <path className={`svsch-edge${isInterface ? ' svsch-edge-interface' : isStruct ? ' svsch-edge-struct' : isThick ? ' svsch-edge-thick' : ''}`} d={horizontalPath + verticalPath} />
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
  edgeStyle?: { aggregate?: 'struct' | 'interface' | string; isStacked?: boolean; thick?: boolean };
  align?: 'start' | 'end';
  isSourceStacked?: boolean;
}): React.ReactElement {
  const isInterface = edgeStyle?.aggregate === 'interface';
  const isStruct = edgeStyle?.aggregate === 'struct';
  const isThick = !isInterface && !isStruct && edgeStyle?.thick === true;
  const isStacked = isSourceStacked;

  const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);

  const classes = [
    'hdl-net-label-wire-svg',
    isInterface ? 'svsch-edge-interface' : '',
    isStruct ? 'svsch-edge-struct' : '',
    isThick ? 'svsch-edge-thick' : '',
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
