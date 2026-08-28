import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { diagramSizing } from '../../../diagram/constants';
import { diagramNodeDimensions } from '../../../diagram/nodeSizing';
import { aluInputPortTops } from '../../../diagram/aluGeometry';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import type { DiagramPort, PositionedNode } from '../../../ir/types';
import { ArrayStackSelection } from '../shared/skins';
import { HdlNodeBase } from '../shared/HdlNodeBase';
import { NodeWarningIcon } from '../shared/NodeWarningIcon';
import { InputPortHandles } from '../shared/InputPortHandles';
import { handleNodeDoubleClick } from '../shared/navigation';
import type { HdlNodeData } from '../types';
import { AluNodeSvg } from './AluNodeSvg';

export function AluNode({ data }: { data: HdlNodeData }): React.ReactElement {
  const node = data.node as PositionedNode & { kind: 'alu' };
  const arrayConnections = data.arrayConnections ?? [];
  const isArray = nodeIsArrayNode(node);
  const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);
  const nodeStyle = {
    '--svsch-node-width': `${nodeWidth}px`,
    '--svsch-node-height': `${nodeHeight}px`,
    '--svsch-port-width': `${diagramSizing.portWidth}px`,
  } as React.CSSProperties;
  const g = diagramSizing.gridSize;
  const inputTops = aluInputPortTops(g);

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
      className={`hdl-node hdl-node-alu${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
      onDoubleClick={() => handleNodeDoubleClick(node)}
      svg={
        <AluNodeSvg
          node={node}
          width={nodeWidth}
          height={nodeHeight}
          arrayConnections={arrayConnections}
        />
      }
      handles={
        <>
          {sideInputs.slice(0, 2).map((port: DiagramPort, index: number) => (
            <InputPortHandles
              key={port.id}
              port={port}
              position={Position.Left}
              style={{ top: inputTops[index] }}
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
      // Non-array ALUs get their selection outline from AluNodeSvg's own
      // node-skin-selection path; only the array-stack case needs this overlay.
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
