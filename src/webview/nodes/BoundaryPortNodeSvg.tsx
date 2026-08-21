import React from 'react';
import type { NodeSvgProps } from './shared/NodeSvgProps';
import { boundaryPortLeadClassName } from './BoundaryPortNode';

const FONT_SIZE = 11;
const OUTER_PAD = 12;
const LEAD_GAP = 4;

function monoTextWidth(text: string): number {
  return text.length * FONT_SIZE * 0.62;
}

/**
 * SVG-export counterpart of BoundaryPortNode.tsx — same label-flush-to-border
 * plus inner lead-stub visual, redrawn with fixed SVG coordinates since the
 * DOM version's `.hdl-boundary-port` rules are a flexbox layout (no `<div>`
 * tree exists in the exported SVG). See splice.ts's SpliceResult doc for why
 * no wire segment is ever drawn across the label text.
 */
export function BoundaryPortNodeSvg({ node, width, height }: NodeSvgProps): React.ReactElement {
  const boundary = node.metadata?.boundaryPort;
  const outerSide = boundary?.outerSide ?? 'left';
  const midY = height / 2;
  const labelWidth = monoTextWidth(node.label);
  const leadClass = boundaryPortLeadClassName(boundary?.edgeStyle)
    .split(' ')
    .map((cls) => (cls === 'hdl-boundary-port-lead' ? 'svsch-boundary-port-lead' : cls))
    .map((cls) => cls.replace('hdl-boundary-port-lead-', 'svsch-boundary-port-lead-'))
    .join(' ');

  const labelX = outerSide === 'left' ? OUTER_PAD : width - OUTER_PAD;
  const textAnchor = outerSide === 'left' ? 'start' : 'end';
  const leadX1 = outerSide === 'left' ? OUTER_PAD + labelWidth + LEAD_GAP : 0;
  const leadX2 = outerSide === 'left' ? width : width - OUTER_PAD - labelWidth - LEAD_GAP;

  return (
    <g>
      <line className={leadClass} x1={leadX1} x2={Math.max(leadX1, leadX2)} y1={midY} y2={midY} />
      <text
        className="svsch-boundary-port-text"
        x={labelX}
        y={midY}
        textAnchor={textAnchor}
        dominantBaseline="middle"
      >
        {node.label}
      </text>
    </g>
  );
}
