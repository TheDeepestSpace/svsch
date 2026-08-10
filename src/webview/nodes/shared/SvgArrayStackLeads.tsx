import React from 'react';
import { arrayStackLeadSegments } from '../../arrayStackGeometry';

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
      {arrayStackLeadSegments({ side, width, y, x, wide }).map((segment) => (
        <path
          key={segment.id}
          className={`svsch-array-stack-lead svsch-array-stack-lead-${segment.id} svsch-array-stack-lead-${trimSink ? 'target' : 'source'}-${side}${thick ? ' svsch-array-stack-lead-thick' : ''}`}
          d={segment.d}
        />
      ))}
    </g>
  );
}
