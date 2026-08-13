import React from 'react';
import {
  arrayStackLayer,
  ARRAY_STACK_LEAD_EDGE_GAP,
  arrayStackLeadLayersFor,
  arrayStackLayerTrim,
} from '../../arrayStackGeometry';

export function SvgArrayStackLeads({
  side,
  width,
  y,
  x,
  trimSink = false,
  wide = false,
  thick = false,
}: {
  side: 'left' | 'right' | 'top' | 'bottom';
  width: number;
  y: number;
  x?: number;
  trimSink?: boolean;
  /** Lane spread: tracks the node's own card layout (nodeStackIsWide). */
  wide?: boolean;
  /**
   * Stroke weight: tracks THIS port's own connected wire (portSuggestsThickWire
   * or the specific edge's thickness) — independent of `wide`. A node can be
   * wide overall (its data path is thick) while a scalar control port on the
   * same node (clk, rst) stays thin.
   */
  thick?: boolean;
}): React.ReactElement {
  const leadsRole = trimSink ? 'target' : 'source';
  const groupClassName =
    `svsch-array-stack-leads svsch-array-stack-leads-${leadsRole} ` +
    `svsch-array-stack-leads-${side}`;

  return (
    <g className={groupClassName} aria-hidden="true">
      {arrayStackLeadLayersFor(wide).map((layer) => {
        const trim = arrayStackLayerTrim(layer.id, wide);
        const shapeX =
          side === 'top' || side === 'bottom'
            ? Math.round((x ?? width / 2) + layer.dx)
            : side === 'left'
              ? Math.round(layer.dx)
              : Math.round(width + layer.dx);
        const shapeY = Math.round(y + layer.dy);
        const endY = Math.round(
          side === 'top' && trimSink ? shapeY - ARRAY_STACK_LEAD_EDGE_GAP : shapeY,
        );
        const sourceRightExitX = Math.round(
          width + arrayStackLayer('back', wide).dx + ARRAY_STACK_LEAD_EDGE_GAP,
        );
        const bottomExitY = Math.round(
          y + arrayStackLayer('back', wide).dy + ARRAY_STACK_LEAD_EDGE_GAP,
        );
        const leadX = Math.round(
          side === 'top' || side === 'bottom'
            ? shapeX
            : side === 'left'
              ? shapeX - trim
              : trimSink
                ? shapeX + trim
                : Math.max(shapeX + trim, sourceRightExitX),
        );
        const leadY = Math.round(
          side === 'top'
            ? endY - trim
            : side === 'bottom'
              ? Math.max(endY + trim, bottomExitY)
              : shapeY,
        );
        return (
          <path
            key={layer.id}
            className={
              `svsch-array-stack-lead svsch-array-stack-lead-${layer.id} ` +
              `svsch-array-stack-lead-${leadsRole}-${side}` +
              `${thick ? ' svsch-array-stack-lead-thick' : ''}`
            }
            d={`M ${leadX} ${leadY} L ${shapeX} ${endY}`}
          />
        );
      })}
    </g>
  );
}
