import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing } from '../../../diagram/constants';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import { arrayStackSkinLayersFor } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import { hasArrayConnection as sharedHasArrayConnection, arrayConnectionThick as sharedArrayConnectionThick } from '../shared/arrayConnections';
import type { DiagramPort } from '../../../ir/types';
import { isInoutPort, isInputSidePort } from '../../../diagram/portDirection';

export function InverterNodeSvg({ node, width: _width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const stackWide = isArray && nodeStackIsWide(node);
  const skinLayers = arrayStackSkinLayersFor(stackWide);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    sharedHasArrayConnection(arrayConnections, portId, role);
  const arrayConnectionThick = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    sharedArrayConnectionThick(arrayConnections, portId, role);
  const hasInputSideConnection = (port: DiagramPort): boolean =>
    hasArrayConnection(port.id, 'target') || (isInoutPort(port) && hasArrayConnection(port.id, 'source'));
  const inputSideRole = (port: DiagramPort): 'source' | 'target' =>
    hasArrayConnection(port.id, 'target') ? 'target' : 'source';
  const inputs = node.ports.filter(isInputSidePort);
  const outputs = node.ports.filter((p: DiagramPort) => p.direction === 'output');
  const g = diagramSizing.gridSize;
  const side = g;
  const bubbleRadius = Math.min(g / 4, side / 6);
  const bubbleGap = 2;
  const bodyRight = side * Math.sqrt(3) / 2;
  const midY = height / 2;
  const triTop = midY - side / 2;
  const triBottom = midY + side / 2;
  const path = `M 0 ${triTop} L ${bodyRight} ${midY} L 0 ${triBottom} Z`;
  const bubbleCx = bodyRight + bubbleGap + bubbleRadius;

  return (
    <>
      {isArray && skinLayers.map(layer => (
        <g key={layer.id}
           className={`hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
           transform={`translate(${layer.dx}, ${layer.dy})`}
           opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}>
          <path className="svsch-node-shape" d={path} />
          <circle className="svsch-node-shape" cx={bubbleCx} cy={midY} r={bubbleRadius} />
        </g>
      ))}
      <path className="svsch-node-shape hdl-node-inverter node-skin-body" d={path} />
      <circle className="svsch-node-shape hdl-node-inverter node-skin-body inverter-bubble" cx={bubbleCx} cy={midY} r={bubbleRadius} />

      {/* Array stack leads */}
      {isArray && inputs[0] && hasInputSideConnection(inputs[0]) && (
        <SvgArrayStackLeads wide={stackWide} thick={arrayConnectionThick(inputs[0].id, inputSideRole(inputs[0]))} side="left" width={_width} y={height / 2} trimSink />
      )}
      {isArray && outputs[0] && hasArrayConnection(outputs[0].id, 'source') && (
        <SvgArrayStackLeads wide={stackWide} thick={arrayConnectionThick(outputs[0].id, 'source')} side="right" width={_width} y={height / 2} />
      )}
      <path className="node-skin-selection" d={path} />
      <circle className="node-skin-selection inverter-bubble-selection" cx={bubbleCx} cy={midY} r={bubbleRadius} />
    </>
  );
}
