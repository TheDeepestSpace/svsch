import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import {
  muxInputPortCenterY,
  muxTopPortSkinEdgeY,
  muxTopPortLabelOffsetY,
  muxTopPortLeadLengthY,
} from '../../../diagram/muxGeometry';
import { diagramSizing, normalizeWidth } from '../../../diagram/constants';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { ARRAY_STACK_SKIN_LAYERS } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import type { DiagramPort } from '../../../ir/types';

export function MuxNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const g = diagramSizing.gridSize;
  const inputs: DiagramPort[] = node.ports.filter(
    (p: DiagramPort) => p.direction === 'input' || p.direction === 'inout' || p.direction === 'unknown'
  );
  const outputs: DiagramPort[] = node.ports.filter((p: DiagramPort) => p.direction === 'output');

  const muxTopPorts: DiagramPort[] = inputs.some((p: DiagramPort) => p.name === 'sel')
    ? inputs.filter((p: DiagramPort) => p.name === 'sel').slice(0, 1)
    : inputs.slice(0, 1);
  const sideInputs: DiagramPort[] = inputs.filter(
    (p: DiagramPort) => !muxTopPorts.some((tp: DiagramPort) => tp.id === p.id)
  );

  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = (height - rightSideHeight) / 2;
  const rightBottom = rightTop + rightSideHeight;
  const trapPath = `M 0 0 L ${width} ${rightTop} V ${rightBottom} L 0 ${height} Z`;

  return (
    <>
      {isArray && ARRAY_STACK_SKIN_LAYERS.map(layer => (
        <path
          key={layer.id}
          className={`svsch-node-shape hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          d={trapPath}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}
      <path className="svsch-node-shape hdl-node-mux node-skin-body" d={trapPath} />

      {muxTopPorts.map((port: DiagramPort, index: number) => {
        const portX = width * (index + 1) / (muxTopPorts.length + 1);
        const leadLen = (normalizeWidth(port.width) || (port.connectedSignal?.length ?? 0) > 24)
          ? muxTopPortLeadLengthY(index, muxTopPorts.length, height)
          : 0;
        const skinEdgeY = muxTopPortSkinEdgeY(index, muxTopPorts.length, height);
        const labelY = leadLen > 0
          ? muxTopPortLabelOffsetY(index, muxTopPorts.length, height)
          : skinEdgeY - 4;
        return (
          <g key={port.id} className="svsch-mux-select-port">
            {leadLen > 0 && (
              <line className="svsch-mux-select-lead" x1={portX} y1={0} x2={portX} y2={leadLen} />
            )}
            <text
              className="svsch-port-label"
              x={portX}
              y={labelY}
              textAnchor="middle"
              dominantBaseline={leadLen > 0 ? 'middle' : 'auto'}
            >
              {port.label ?? 's'}
            </text>
          </g>
        );
      })}

      {sideInputs.map((port: DiagramPort, index: number) => (
        <text
          key={port.id}
          className="svsch-port-label svsch-mux-side-port"
          x={g * 0.75}
          y={muxInputPortCenterY(index, sideInputs.length, height)}
          dominantBaseline="middle"
        >
          {port.label ?? port.name}
        </text>
      ))}

      {outputs[0] && (
        <text
          className="svsch-port-label svsch-mux-output-port"
          x={width - g * 0.75}
          y={height / 2}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {outputs[0].label ?? outputs[0].name}
        </text>
      )}

      {/* Array stack leads */}
      {isArray && muxTopPorts.map((port: DiagramPort, index: number) =>
        hasArrayConnection(port.id, 'target') ? (
          <SvgArrayStackLeads
            key={`lead-top-${port.id}`}
            side="top"
            width={width}
            x={width * (index + 1) / (muxTopPorts.length + 1)}
            y={muxTopPortSkinEdgeY(index, muxTopPorts.length, height)}
            trimSink
          />
        ) : null
      )}
      {isArray && sideInputs.map((port: DiagramPort, index: number) =>
        hasArrayConnection(port.id, 'target') ? (
          <SvgArrayStackLeads
            key={`lead-left-${port.id}`}
            side="left"
            width={width}
            y={muxInputPortCenterY(index, sideInputs.length, height)}
            trimSink
          />
        ) : null
      )}
      {isArray && outputs[0] && hasArrayConnection(outputs[0].id, 'source') && (
        <SvgArrayStackLeads side="right" width={width} y={height / 2} />
      )}
      <path className="node-skin-selection" d={trapPath} style={{ strokeLinejoin: 'round' }} />
    </>
  );
}
