import React from 'react';
import { arrayStackLayer, ARRAY_STACK_LEAD_EDGE_GAP, arrayStackLeadLayersFor, arrayStackLayerTrim } from '../../arrayStackGeometry';

export function SvgArrayStackLeads({
  side,
  width,
  y,
  x,
  trimSink = false,
  wide = false
}: {
  side: 'left' | 'right' | 'top' | 'bottom';
  width: number;
  y: number;
  x?: number;
  trimSink?: boolean;
  wide?: boolean;
}): React.ReactElement {
  return (
    <g
      className={`svsch-array-stack-leads svsch-array-stack-leads-${trimSink ? 'target' : 'source'} svsch-array-stack-leads-${side}`}
      aria-hidden="true"
    >
      {arrayStackLeadLayersFor(wide).map((layer) => {
        const trim = arrayStackLayerTrim(layer.id, wide);
        const shapeX = (side === 'top' || side === 'bottom')
          ? Math.round((x ?? width / 2) + layer.dx)
          : side === 'left'
            ? Math.round(layer.dx)
            : Math.round(width + layer.dx);
        const shapeY = Math.round(y + layer.dy);
        const endY = Math.round(side === 'top' && trimSink
          ? shapeY - ARRAY_STACK_LEAD_EDGE_GAP
          : shapeY);
        const sourceRightExitX = Math.round(width + arrayStackLayer('back', wide).dx + ARRAY_STACK_LEAD_EDGE_GAP);
        const bottomExitY = Math.round(y + arrayStackLayer('back', wide).dy + ARRAY_STACK_LEAD_EDGE_GAP);
        const leadX = Math.round((side === 'top' || side === 'bottom')
          ? shapeX
          : side === 'left'
            ? shapeX - trim
            : trimSink
              ? shapeX + trim
              : Math.max(shapeX + trim, sourceRightExitX));
        const leadY = Math.round(side === 'top'
          ? endY - trim
          : side === 'bottom'
            ? Math.max(endY + trim, bottomExitY)
            : shapeY);
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
