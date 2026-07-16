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
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import { arrayStackLayersFor, arrayStackSkinLayersFor } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import type { DiagramPort } from '../../../ir/types';

export function SelectNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const stackWide = isArray && nodeStackIsWide(node);
  const stackLayers = arrayStackLayersFor(stackWide);
  const skinLayers = arrayStackSkinLayersFor(stackWide);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const arrayConnectionThick = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).find(c => c.portId === portId && c.role === role)?.thick ?? false;
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
  const contentShiftX = isArray ? stackLayers.front.dx : 0;
  const contentShiftY = isArray ? stackLayers.front.dy : 0;
  const bodyTransform = isArray
    ? `translate(${stackLayers.front.dx}, ${stackLayers.front.dy})`
    : undefined;
  const targetLeads = (
    <>
      {muxTopPorts.map((port: DiagramPort, index: number) =>
        hasArrayConnection(port.id, 'target') ? (
          <SvgArrayStackLeads
            wide={stackWide}
            thick={arrayConnectionThick(port.id, 'target')}
            key={`lead-top-${port.id}`}
            side="top"
            width={width}
            x={width * (index + 1) / (muxTopPorts.length + 1)}
            y={muxTopPortSkinEdgeY(index, muxTopPorts.length, height)}
            trimSink
          />
        ) : null
      )}
      {sideInputs.map((port: DiagramPort, index: number) =>
        hasArrayConnection(port.id, 'target') ? (
          <SvgArrayStackLeads
            wide={stackWide}
            thick={arrayConnectionThick(port.id, 'target')}
            key={`lead-left-${port.id}`}
            side="left"
            width={width}
            y={muxInputPortCenterY(index, sideInputs.length, height)}
            trimSink
          />
        ) : null
      )}
    </>
  );

  return (
    <>
      {targetLeads}
      {isArray && skinLayers.filter(layer => layer.id !== 'front').map(layer => (
        <path
          key={layer.id}
          className={`svsch-node-shape hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          d={trapPath}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}
      <path
        className={`svsch-node-shape hdl-node-select node-skin-body${isArray ? ' hdl-node-array-layer hdl-node-array-front svsch-array-layer-front' : ''}`}
        transform={bodyTransform}
        d={trapPath}
      />

      {muxTopPorts.map((port: DiagramPort, index: number) => {
        const portX = Math.round(width * (index + 1) / (muxTopPorts.length + 1));
        const leadLen = (normalizeWidth(port.width) || (port.connectedSignal?.length ?? 0) > 24)
          ? muxTopPortLeadLengthY(index, muxTopPorts.length, height)
          : 0;
        const skinEdgeY = muxTopPortSkinEdgeY(index, muxTopPorts.length, height);
        // Lead: from handle (y=g) to slope (y=skinEdgeY). Label just inside slope.
        const labelY = Math.round(leadLen > 0
          ? skinEdgeY + 8
          : skinEdgeY + g / 2);
        const label = selectPortLabel(node, port.name === 'width' ? 'w' : 's');
        return (
          <g key={port.id} className="svsch-mux-select-port">
            {leadLen > 0 && (
              <line className="svsch-mux-select-lead" x1={Math.round(portX + contentShiftX)} y1={Math.round(g + contentShiftY)} x2={Math.round(portX + contentShiftX)} y2={Math.round(skinEdgeY + contentShiftY)} />
            )}
            <text
              className="svsch-port-label"
              x={Math.round(portX + contentShiftX)}
              y={Math.round(labelY + contentShiftY)}
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
          className="svsch-port-label svsch-mux-side-port"
          x={Math.round(g / 2 + contentShiftX)}
          y={Math.round(muxInputPortCenterY(index, sideInputs.length, height) + contentShiftY)}
          dominantBaseline="middle"
        >
          {selectPortLabel(node, port)}
        </text>
      ))}

      {outputs[0] && (
        <text
          className="svsch-port-label svsch-mux-output-port"
          x={Math.round(width - g / 2 + contentShiftX)}
          y={Math.round(height / 2 + contentShiftY)}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {selectPortLabel(node, outputs[0])}
        </text>
      )}

      {/* Array stack leads */}
      {outputs[0] && hasArrayConnection(outputs[0].id, 'source') && (
        <SvgArrayStackLeads wide={stackWide} thick={arrayConnectionThick(outputs[0].id, 'source')} side="right" width={width} y={Math.round(height / 2)} />
      )}
      {!isArray && <path className="node-skin-selection" d={trapPath} style={{ strokeLinejoin: 'round' }} />}
    </>
  );
}
