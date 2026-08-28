import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { diagramSizing } from '../../../diagram/constants';
import { diagramNodeDimensions } from '../../../diagram/nodeSizing';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import type { DiagramPort, PositionedNode } from '../../../ir/types';
import { ArrayStackSelection } from '../shared/skins';
import { HdlNodeBase } from '../shared/HdlNodeBase';
import { NodeWarningIcon } from '../shared/NodeWarningIcon';
import { handleNodeDoubleClick } from '../shared/navigation';
import type { HdlNodeData } from '../types';
import { ComparatorNodeSvg } from './ComparatorNodeSvg';

export function ComparatorNode({ data }: { data: HdlNodeData }): React.ReactElement {
  const node = data.node as PositionedNode & { kind: 'comparator' };
  const arrayConnections = data.arrayConnections ?? [];
  const isArray = nodeIsArrayNode(node);
  const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);
  const nodeStyle = {
    '--svsch-node-width': `${nodeWidth}px`,
    '--svsch-node-height': `${nodeHeight}px`,
    '--svsch-port-width': `${diagramSizing.portWidth}px`,
  } as React.CSSProperties;
  const g = diagramSizing.gridSize;

  const sideInputs = node.ports.filter(
    (port: DiagramPort) =>
      port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown',
  );
  const outputs = node.ports.filter((port: DiagramPort) => port.direction === 'output');

  return (
    <HdlNodeBase
      node={node}
      width={nodeWidth}
      height={nodeHeight}
      style={nodeStyle}
      className={`hdl-node hdl-node-${node.kind}${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
      onDoubleClick={() => handleNodeDoubleClick(node)}
      svg={
        <ComparatorNodeSvg
          node={node}
          width={nodeWidth}
          height={nodeHeight}
          arrayConnections={arrayConnections}
        />
      }
      handles={
        <>
          {sideInputs.slice(0, 2).map((port: DiagramPort, index: number) => (
            <Handle
              key={port.id}
              type="target"
              id={port.id}
              position={Position.Left}
              style={{ top: index === 0 ? g : g * 3 }}
            />
          ))}
          {outputs.slice(0, 1).map((port: DiagramPort) => (
            <Handle
              key={port.id}
              type="source"
              id={port.id}
              position={Position.Right}
              style={{ top: nodeHeight / 2 }}
            />
          ))}
        </>
      }
      selection={
        isArray && (
          <ArrayStackSelection
            kind="rect"
            width={nodeWidth}
            height={nodeHeight}
            wide={nodeStackIsWide(node)}
          />
        )
      }
      warningIcon={<NodeWarningIcon node={node} width={nodeWidth} height={nodeHeight} />}
    />
  );
}
