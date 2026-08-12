import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import {
  muxInputPortCenterY,
  muxRightTopY,
  muxTopPortSkinEdgeY,
  muxTopPortLabelOffsetY,
  muxTopPortLeadLengthY,
} from '../../../diagram/muxGeometry';
import { diagramSizing, normalizeWidth } from '../../../diagram/constants';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { nodeStackIsWide, portSuggestsThickWire } from '../../../ir/edgeStyle';
import { arrayStackLayersFor, arrayStackSkinLayersFor } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import { SvgPortLabel } from '../shared/labels';
import { hasArrayConnection as sharedHasArrayConnection, arrayConnectionThick as sharedArrayConnectionThick } from '../shared/arrayConnections';
import type { DiagramPort } from '../../../ir/types';
import { isInoutPort, isInputSidePort } from '../../../diagram/portDirection';

export function MuxNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const stackWide = isArray && nodeStackIsWide(node);
  const stackLayers = arrayStackLayersFor(stackWide);
  const skinLayers = arrayStackSkinLayersFor(stackWide);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    sharedHasArrayConnection(arrayConnections, portId, role);
  const arrayConnectionThick = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    sharedArrayConnectionThick(arrayConnections, portId, role);
  const hasInputSideConnection = (port: DiagramPort): boolean =>
    hasArrayConnection(port.id, 'target') || (isInoutPort(port) && hasArrayConnection(port.id, 'source'));
  const inputSideRole = (port: DiagramPort): 'source' | 'target' =>
    hasArrayConnection(port.id, 'target') ? 'target' : 'source';
  const g = diagramSizing.gridSize;
  const inputs: DiagramPort[] = node.ports.filter(isInputSidePort);
  const outputs: DiagramPort[] = node.ports.filter((p: DiagramPort) => p.direction === 'output');

  const muxTopPorts: DiagramPort[] = inputs.some((p: DiagramPort) => p.name === 'sel')
    ? inputs.filter((p: DiagramPort) => p.name === 'sel').slice(0, 1)
    : inputs.slice(0, 1);
  const sideInputs: DiagramPort[] = inputs.filter(
    (p: DiagramPort) => !muxTopPorts.some((tp: DiagramPort) => tp.id === p.id)
  );

  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = muxRightTopY(height);
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
        hasInputSideConnection(port) ? (
          <SvgArrayStackLeads
            wide={stackWide}
            thick={arrayConnectionThick(port.id, inputSideRole(port))}
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
        hasInputSideConnection(port) ? (
          <SvgArrayStackLeads
            wide={stackWide}
            thick={arrayConnectionThick(port.id, inputSideRole(port))}
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
        className={`svsch-node-shape hdl-node-mux node-skin-body${isArray ? ' hdl-node-array-layer hdl-node-array-front svsch-array-layer-front' : ''}`}
        transform={bodyTransform}
        d={trapPath}
      />

      {muxTopPorts.map((port: DiagramPort, index: number) => {
        const portX = Math.round(width * (index + 1) / (muxTopPorts.length + 1));
        const leadLen = (normalizeWidth(port.width) || (port.connectedSignal?.length ?? 0) > 24)
          ? muxTopPortLeadLengthY(index, muxTopPorts.length, height)
          : 0;
        const skinEdgeY = muxTopPortSkinEdgeY(index, muxTopPorts.length, height);
        // Label is always one grid unit below the slope at portX (skinEdgeY + g),
        // keeping a consistent visual gap from the trapezoid edge regardless of size.
        const labelY = Math.round(skinEdgeY + g);
        return (
          <g key={port.id} className="svsch-mux-select-port">
            {leadLen > 0 && (
              <line className={`svsch-mux-select-lead${portSuggestsThickWire(port) ? ' svsch-mux-select-lead-thick' : ''}`} x1={Math.round(portX + contentShiftX)} y1={Math.round(g + contentShiftY)} x2={Math.round(portX + contentShiftX)} y2={Math.round(skinEdgeY + contentShiftY)} />
            )}
            <text
              className="svsch-port-label"
              x={Math.round(portX + contentShiftX)}
              y={Math.round(labelY + contentShiftY)}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              <SvgPortLabel port={port} label={'s'} showWidth collapseWidth />
            </text>
          </g>
        );
      })}

      {sideInputs.map((port: DiagramPort, index: number) => (
        <text
          key={port.id}
          className="svsch-port-label svsch-mux-side-port"
          x={g / 2 + contentShiftX}
          y={muxInputPortCenterY(index, sideInputs.length, height) + contentShiftY}
          dominantBaseline="middle"
        >
          <SvgPortLabel port={port} showWidth collapseWidth />
        </text>
      ))}

      {outputs[0] && (
        <text
          className="svsch-port-label svsch-mux-output-port"
          x={width - g / 2 + contentShiftX}
          y={height / 2 + contentShiftY}
          textAnchor="end"
          dominantBaseline="middle"
        >
          <SvgPortLabel port={outputs[0]} showWidth collapseWidth />
        </text>
      )}

      {/* Array stack leads */}
      {outputs[0] && hasArrayConnection(outputs[0].id, 'source') && (
        <SvgArrayStackLeads wide={stackWide} thick={arrayConnectionThick(outputs[0].id, 'source')} side="right" width={width} y={height / 2} />
      )}
      {!isArray && <path className="node-skin-selection" d={trapPath} style={{ strokeLinejoin: 'round' }} />}
    </>
  );
}
