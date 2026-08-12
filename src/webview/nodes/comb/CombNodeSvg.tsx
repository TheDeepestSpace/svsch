import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { nodePortCenterOffset } from '../../../diagram/constants';
import { instanceParameterRows } from '../../../diagram/nodeSizing';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import { arrayStackLayersFor, arrayStackSkinLayersFor } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import { ArrayStackSkinRect } from '../shared/ArrayStackSkinRect';
import { hasArrayConnection as sharedHasArrayConnection, arrayConnectionThick as sharedArrayConnectionThick } from '../shared/arrayConnections';
import type { DiagramPort } from '../../../ir/types';
import { isInoutPort, isInputSidePort } from '../../../diagram/portDirection';

export function CombNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
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
  const inputs: DiagramPort[] = node.ports.filter(isInputSidePort);
  const outputs: DiagramPort[] = node.ports.filter((p: DiagramPort) => p.direction === 'output');
  const paramRows = instanceParameterRows(node);
  const contentShiftX = isArray ? stackLayers.front.dx : 0;
  const contentShiftY = isArray ? stackLayers.front.dy : 0;
  const shapeTransform = isArray
    ? `translate(${stackLayers.front.dx}, ${stackLayers.front.dy})`
    : undefined;

  return (
    <>
      <ArrayStackSkinRect isArray={isArray} skinLayers={skinLayers} shapeTransform={shapeTransform} width={width} height={height} />
      <text className="svsch-node-kind" x={Math.round(12 + contentShiftX)} y={Math.round(14 + contentShiftY)} textAnchor="start" dominantBaseline="middle">
        COMBINATIONAL
      </text>

      {/* Array stack leads */}
      {isArray && inputs.map((port: DiagramPort, i: number) =>
        hasInputSideConnection(port) ? (
          <SvgArrayStackLeads
            wide={stackWide}
            thick={arrayConnectionThick(port.id, inputSideRole(port))}
            key={`lead-${port.id}`}
            side="left"
            width={width}
            y={Math.round(nodePortCenterOffset(i + paramRows))}
            trimSink
          />
        ) : null
      )}
      {isArray && outputs.map((port: DiagramPort, i: number) =>
        hasArrayConnection(port.id, 'source') ? (
          <SvgArrayStackLeads
            wide={stackWide}
            thick={arrayConnectionThick(port.id, 'source')}
            key={`lead-${port.id}`}
            side="right"
            width={width}
            y={Math.round(nodePortCenterOffset(i + paramRows))}
          />
        ) : null
      )}
    </>
  );
}
