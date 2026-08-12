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
import { InputPortHandles } from '../shared/InputPortHandles';
import { handleNodeDoubleClick, navigateToSource } from '../shared/navigation';
import type { HdlNodeData } from '../types';
import { ReplicateNodeSvg } from './ReplicateNodeSvg';

export function ReplicateNode({ data }: { data: HdlNodeData }): React.ReactElement {
  const node = data.node as PositionedNode & { kind: 'replicate' };
  const arrayConnections = data.arrayConnections ?? [];
  const isArray = nodeIsArrayNode(node);
  const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);
  const nodeStyle = {
    '--svsch-node-width': `${nodeWidth}px`,
    '--svsch-node-height': `${nodeHeight}px`,
    '--svsch-port-width': `${diagramSizing.portWidth}px`
  } as React.CSSProperties;

  const sideInputs = node.ports.filter((port: DiagramPort) => port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown');
  const outputs = node.ports.filter((port: DiagramPort) => port.direction === 'output');

  return (
    <HdlNodeBase
      node={node}
      width={nodeWidth}
      height={nodeHeight}
      style={nodeStyle}
      className={`hdl-node hdl-node-replicate${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
      title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
      onDoubleClick={() => handleNodeDoubleClick(node)}
      svg={
        <ReplicateNodeSvg
          node={node}
          width={nodeWidth}
          height={nodeHeight}
          arrayConnections={arrayConnections}
          onNavigateToSource={navigateToSource}
        />
      }
      handles={
        <>
          {sideInputs.map((port: DiagramPort) => (
            <InputPortHandles key={port.id} port={port} position={Position.Left} />
          ))}
          {outputs.map((port: DiagramPort) => (
            <Handle key={port.id} type="source" id={port.id} position={Position.Right} />
          ))}
        </>
      }
      selection={
        isArray
          ? <ArrayStackSelection kind="rect" width={nodeWidth} height={nodeHeight} wide={nodeStackIsWide(node)} />
          : <div className="hdl-node-selection-rect" aria-hidden="true" />
      }
      warningIcon={<NodeWarningIcon node={node} width={nodeWidth} height={nodeHeight} />}
    />
  );
}
