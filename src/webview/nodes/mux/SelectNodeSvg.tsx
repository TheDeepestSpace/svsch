import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import {
  muxInputPortCenterY,
  muxTopPortSkinEdgeY,
  muxTopPortLabelOffsetY,
  muxTopPortLeadLengthY,
} from '../../../diagram/muxGeometry';
import { diagramSizing, normalizeWidth } from '../../../diagram/constants';
import { selectPortLabel } from '../../../diagram/selectLabels';
import type { DiagramPort } from '../../../ir/types';

export function SelectNodeSvg({ node, width, height }: NodeSvgProps): React.ReactElement {
  const g = diagramSizing.gridSize;
  const inputs: DiagramPort[] = node.ports.filter(
    (p: DiagramPort) => p.direction === 'input' || p.direction === 'inout' || p.direction === 'unknown'
  );
  const outputs: DiagramPort[] = node.ports.filter((p: DiagramPort) => p.direction === 'output');

  const muxTopPorts: DiagramPort[] = inputs.filter(
    (p: DiagramPort) => p.name === 's' || p.name === 'sel' || p.name === 'width'
  );
  const sideInputs: DiagramPort[] = inputs.filter(
    (p: DiagramPort) => !muxTopPorts.some((tp: DiagramPort) => tp.id === p.id)
  );

  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = (height - rightSideHeight) / 2;
  const rightBottom = rightTop + rightSideHeight;
  const trapPath = `M 0 0 L ${width} ${rightTop} V ${rightBottom} L 0 ${height} Z`;

  return (
    <>
      <path className="svsch-node-shape hdl-node-select node-skin-body" d={trapPath} />

      {muxTopPorts.map((port: DiagramPort, index: number) => {
        const portX = width * (index + 1) / (muxTopPorts.length + 1);
        const leadLen = (normalizeWidth(port.width) || (port.connectedSignal?.length ?? 0) > 24)
          ? muxTopPortLeadLengthY(index, muxTopPorts.length, height)
          : 0;
        const skinEdgeY = muxTopPortSkinEdgeY(index, muxTopPorts.length, height);
        const labelY = leadLen > 0
          ? muxTopPortLabelOffsetY(index, muxTopPorts.length, height)
          : skinEdgeY + g / 2;
        const label = selectPortLabel(node, port.name === 'width' ? 'w' : 's');
        return (
          <g key={port.id}>
            {leadLen > 0 && (
              <line className="svsch-mux-select-lead" x1={portX} y1={0} x2={portX} y2={leadLen} />
            )}
            <text
              className="svsch-port-label"
              x={portX}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {label}
            </text>
          </g>
        );
      })}

      {sideInputs.map((port: DiagramPort, index: number) => (
        <text
          key={port.id}
          className="svsch-port-label"
          x={g * 0.75}
          y={muxInputPortCenterY(index, sideInputs.length, height)}
          dominantBaseline="middle"
        >
          {selectPortLabel(node, port)}
        </text>
      ))}

      {outputs[0] && (
        <text
          className="svsch-port-label"
          x={width - g * 0.75}
          y={height / 2}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {selectPortLabel(node, outputs[0])}
        </text>
      )}
    </>
  );
}
