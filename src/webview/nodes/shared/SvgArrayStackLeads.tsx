import React from 'react';
import { ARRAY_STACK_LAYERS, ARRAY_STACK_LEAD_EDGE_GAP, ARRAY_STACK_LEAD_LAYERS, arrayStackLayerTrim } from '../../arrayStackGeometry';

export function SvgArrayStackLeads({
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
    <g
      className={`svsch-array-stack-leads svsch-array-stack-leads-${trimSink ? 'target' : 'source'} svsch-array-stack-leads-${side}`}
      aria-hidden="true"
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
    </g>
  );
}
