import React from 'react';
import { arrayStackLeadLayersFor, arrayStackLayerTrim } from '../../arrayStackGeometry';

export function SvgArrayStackLeads({
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
        const trim = arrayStackLayerTrim(layer.id, wide);
        // Deliberately unrounded — this must land exactly where the routed
        // wire's own layer begins (computeStackedEdgeLayerPoints in
        // stackedEdgeGeometry.ts uses the same unrounded arrayStackLayerTrim).
        // Rounding either side independently reintroduces the sub-pixel
        // overlap/gap this geometry exists to avoid, since `wide` mode's 1.5x
        // lane scale makes trims fractional (e.g. 4.5, 13.5).
        const shapeX = (side === 'top' || side === 'bottom')
          ? (x ?? width / 2) + layer.dx
          : side === 'left'
            ? layer.dx
            : width + layer.dx;
        const shapeY = y + layer.dy;
        const leadX = (side === 'top' || side === 'bottom')
          ? shapeX
          : side === 'left'
            ? shapeX - trim
            : shapeX + trim;
        const leadY = side === 'top'
          ? shapeY - trim
          : side === 'bottom'
            ? shapeY + trim
            : shapeY;
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
