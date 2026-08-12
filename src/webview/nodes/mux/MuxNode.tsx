import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { diagramSizing } from '../../../diagram/constants';
import { diagramNodeDimensions } from '../../../diagram/nodeSizing';
import { muxInputPortCenterY } from '../../../diagram/muxGeometry';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import type { DiagramPort, PositionedNode } from '../../../ir/types';
import { ArrayStackSelection } from '../shared/skins';
import { HdlNodeBase } from '../shared/HdlNodeBase';
import { NodeWarningIcon } from '../shared/NodeWarningIcon';
import { InputPortHandles } from '../shared/InputPortHandles';
import { handleNodeDoubleClick } from '../shared/navigation';
import type { HdlNodeData } from '../types';
import { MuxNodeSvg } from './MuxNodeSvg';
import { SelectNodeSvg } from './SelectNodeSvg';

export function MuxNode({ data }: { data: HdlNodeData }): React.ReactElement {
  const node = data.node as PositionedNode & { kind: 'mux' | 'select' };
  const arrayConnections = data.arrayConnections ?? [];
  const isArray = nodeIsArrayNode(node);
  const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);
  const nodeStyle = {
    '--svsch-node-width': `${nodeWidth}px`,
    '--svsch-node-height': `${nodeHeight}px`,
    '--svsch-port-width': `${diagramSizing.portWidth}px`
  } as React.CSSProperties;

  const inputs = node.ports.filter((port: DiagramPort) => port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown');
  const outputs = node.ports.filter((port: DiagramPort) => port.direction === 'output');
  const muxTopPorts = node.kind === 'select'
    ? inputs.filter((port: DiagramPort) => port.name === 's' || port.name === 'sel' || port.name === 'width')
    : (inputs.some((port: DiagramPort) => port.name === 'sel') ? inputs.filter((port: DiagramPort) => port.name === 'sel').slice(0, 1) : inputs.slice(0, 1));
  const sideInputs = muxTopPorts.length > 0 ? inputs.filter((port: DiagramPort) => !muxTopPorts.some((topPort) => topPort.id === port.id)) : inputs;
  const SvgComp = node.kind === 'mux' ? MuxNodeSvg : SelectNodeSvg;

  return (
    <HdlNodeBase
      node={node}
      width={nodeWidth}
      height={nodeHeight}
      style={nodeStyle}
      className={`hdl-node hdl-node-${node.kind}${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
      svgClassName="mux-skin"
      onDoubleClick={() => handleNodeDoubleClick(node)}
      svg={<SvgComp node={node} width={nodeWidth} height={nodeHeight} arrayConnections={arrayConnections} />}
      extraContent={
        // Hidden label for test findNodeIdByLabel compatibility
        <div className="node-title" style={{ display: 'none' }}>{node.label}</div>
      }
      handles={
        <>
          {muxTopPorts.map((port: DiagramPort, index: number) => (
            <InputPortHandles key={port.id} port={port} position={Position.Top}
              style={{
                left: `${((index + 1) / (muxTopPorts.length + 1)) * nodeWidth}px`,
                top: diagramSizing.gridSize,  // matches original .mux-select-port { top: var(--svsch-grid) }
                transform: 'translateX(-50%)',
              }} />
          ))}
          {sideInputs.map((port: DiagramPort, index: number) => (
            <InputPortHandles key={port.id} port={port} position={Position.Left}
              style={{ top: muxInputPortCenterY(index, sideInputs.length, nodeHeight) }} />
          ))}
          {outputs.slice(0, 1).map((port: DiagramPort) => (
            <Handle key={port.id} type="source" id={port.id} position={Position.Right}
              style={{ top: nodeHeight / 2 }} />
          ))}
        </>
      }
      selection={isArray && <ArrayStackSelection kind="mux" width={nodeWidth} height={nodeHeight} wide={nodeStackIsWide(node)} />}
      warningIcon={<NodeWarningIcon node={node} width={nodeWidth} height={nodeHeight} />}
    />
  );
}
