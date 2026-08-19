import React from 'react';
import { arrayStackLeadLayersFor, arrayStackLayerSideTrim } from '../../arrayStackGeometry';

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
  return (
    <g
      className={`svsch-array-stack-leads svsch-array-stack-leads-${trimSink ? 'target' : 'source'} svsch-array-stack-leads-${side}`}
      aria-hidden="true"
    >
      {arrayStackLeadLayersFor(wide).map((layer) => {
        const trim = arrayStackLayerSideTrim(layer.id, side, wide);
        // Rounded to whole pixels deliberately. `wide` mode's 1.5x lane scale
        // makes trims fractional (e.g. 4.5, 13.5), and computeStackedEdgeLayerPoints
        // (the routed wire's own trim math) never rounds — so a lead that matched
        // it exactly would land on a fractional coordinate. That looks correct on
        // paper, but two separately-anti-aliased <path> elements meeting at a
        // fractional pixel render as a visible blended seam (a thin gap or
        // discoloration), which reads worse than the sub-pixel overlap rounding
        // produces here. Round each endpoint so the lead's stroke fully covers up
        // to the wire's start — a solid, if not mathematically exact, join.
        const shapeX =
          side === 'top' || side === 'bottom'
            ? Math.round((x ?? width / 2) + layer.dx)
            : side === 'left'
              ? Math.round(layer.dx)
              : Math.round(width + layer.dx);
        const shapeY = Math.round(y + layer.dy);
        const leadX = Math.round(
          side === 'top' || side === 'bottom'
            ? shapeX
            : side === 'left'
              ? shapeX - trim
              : shapeX + trim,
        );
        const leadY = Math.round(
          side === 'top' ? shapeY - trim : side === 'bottom' ? shapeY + trim : shapeY,
        );
        return (
          <path
            key={layer.id}
            className={`svsch-array-stack-lead svsch-array-stack-lead-${layer.id} svsch-array-stack-lead-${trimSink ? 'target' : 'source'}-${side}${thick ? ' svsch-array-stack-lead-thick' : ''}`}
            d={`M ${leadX} ${leadY} L ${shapeX} ${shapeY}`}
          />
        );
      })}
    </g>
  );
}
