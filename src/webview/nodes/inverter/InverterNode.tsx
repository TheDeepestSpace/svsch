import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { diagramSizing } from '../../../diagram/constants';
import { diagramNodeDimensions, inverterGeometryWidth } from '../../../diagram/nodeSizing';
import type { DiagramPort, PositionedNode } from '../../../ir/types';
import { HdlNodeBase } from '../shared/HdlNodeBase';
import { NodeWarningIcon } from '../shared/NodeWarningIcon';
import { InputPortHandles } from '../shared/InputPortHandles';
import { handleNodeDoubleClick } from '../shared/navigation';
import type { HdlNodeData } from '../types';
import { InverterNodeSvg } from './InverterNodeSvg';

export function InverterNode({ data }: { data: HdlNodeData }): React.ReactElement {
  const node = data.node as PositionedNode & { kind: 'inverter' };
  const arrayConnections = data.arrayConnections ?? [];
  const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);
  const nodeStyle = {
    '--svsch-node-width': `${nodeWidth}px`,
    '--svsch-node-height': `${nodeHeight}px`,
    '--svsch-port-width': `${diagramSizing.portWidth}px`,
  } as React.CSSProperties;

  const sideInputs = node.ports.filter(
    (port: DiagramPort) =>
      port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown',
  );
  const outputs = node.ports.filter((port: DiagramPort) => port.direction === 'output');
  const invOutputOffset = nodeWidth - inverterGeometryWidth();

  return (
    <HdlNodeBase
      node={node}
      width={nodeWidth}
      height={nodeHeight}
      style={nodeStyle}
      className="hdl-node hdl-node-inverter"
      svgClassName="inverter-skin"
      title={
        node.source
          ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}`
          : node.kind
      }
      onDoubleClick={() => handleNodeDoubleClick(node)}
      svg={
        <InverterNodeSvg
          node={node}
          width={nodeWidth}
          height={nodeHeight}
          arrayConnections={arrayConnections}
        />
      }
      handles={
        <>
          {sideInputs.slice(0, 1).map((port: DiagramPort) => (
            <InputPortHandles key={port.id} port={port} position={Position.Left} />
          ))}
          {outputs.slice(0, 1).map((port: DiagramPort) => (
            <Handle
              key={port.id}
              type="source"
              id={port.id}
              position={Position.Right}
              style={invOutputOffset > 0 ? { right: `${invOutputOffset}px` } : undefined}
            />
          ))}
        </>
      }
      warningIcon={<NodeWarningIcon node={node} width={nodeWidth} height={nodeHeight} />}
    />
  );
}
