import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { diagramNodeDimensions } from '../../../diagram/nodeSizing';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import type { PositionedNode } from '../../../ir/types';
import { ArrayStackSelection } from '../shared/skins';
import { HdlNodeBase } from '../shared/HdlNodeBase';
import { NodeWarningIcon } from '../shared/NodeWarningIcon';
import {
  handleNodeDoubleClick,
  navigateToSource,
  stopIfBusTapDescendant,
  isInterfacePortLike,
} from '../shared/navigation';
import type { HdlNodeData } from '../types';
import { PortNodeSvg } from './PortNodeSvg';

export function PortNode({ data }: { data: HdlNodeData }): React.ReactElement {
  const node = data.node as PositionedNode & { kind: 'port' };
  const arrayConnections = data.arrayConnections ?? [];
  const isArray = nodeIsArrayNode(node);
  const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);
  const nodeStyle = {
    '--svsch-node-width': `${nodeWidth}px`,
    '--svsch-node-height': `${nodeHeight}px`,
    '--svsch-port-width': `${nodeWidth}px`,
  } as React.CSSProperties;

  const portDirection = node.ports[0]?.direction ?? 'unknown';
  const isOutput = portDirection === 'output';
  const isInput = portDirection === 'input';
  const isInout = portDirection === 'inout';
  const isInterfacePort = isInterfacePortLike(node.ports[0]);
  const isSkinnedPort = isInput || isOutput || isInout || isInterfacePort;
  const handlePositionOverride = node.metadata?.handlePosition as Position | undefined;

  return (
    <HdlNodeBase
      node={node}
      width={nodeWidth}
      height={nodeHeight}
      style={nodeStyle}
      className={`hdl-node hdl-node-port hdl-port-${portDirection}${isSkinnedPort ? ' hdl-port-skinned' : ''}${isInterfacePort ? ' hdl-port-interface' : ''}${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
      title={
        node.source
          ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}`
          : 'port'
      }
      onDoubleClick={(event) => stopIfBusTapDescendant(event, () => handleNodeDoubleClick(node))}
      svg={
        <PortNodeSvg
          node={node}
          width={nodeWidth}
          height={nodeHeight}
          arrayConnections={arrayConnections}
          onNavigateToSource={navigateToSource}
        />
      }
      handles={
        <>
          {(isOutput || isInout) && (
            <Handle
              type="target"
              id={node.ports[0]?.id}
              position={handlePositionOverride ?? Position.Left}
            />
          )}
          <Handle
            type="source"
            id={node.ports[0]?.id}
            position={handlePositionOverride ?? (isOutput ? Position.Left : Position.Right)}
          />
        </>
      }
      selection={
        isArray && isSkinnedPort ? (
          <ArrayStackSelection
            kind={isOutput ? 'output' : isInout ? 'inout' : 'input'}
            width={nodeWidth}
            height={nodeHeight}
            wide={nodeStackIsWide(node)}
          />
        ) : isSkinnedPort ? null : (
          <div className="hdl-node-selection-rect" aria-hidden="true" />
        )
      }
      warningIcon={<NodeWarningIcon node={node} width={nodeWidth} height={nodeHeight} />}
    />
  );
}

export function InterfacePortNode({ data }: { data: HdlNodeData }): React.ReactElement {
  const node = data.node as PositionedNode;
  const arrayConnections = data.arrayConnections ?? [];
  const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);
  const nodeStyle = {
    '--svsch-node-width': `${nodeWidth}px`,
    '--svsch-node-height': `${nodeHeight}px`,
    '--svsch-port-width': `${nodeWidth}px`,
  } as React.CSSProperties;

  const port = node.ports[0];
  const handlePosition =
    port?.preferredSide === 'left'
      ? Position.Left
      : port?.preferredSide === 'right'
        ? Position.Right
        : port?.direction === 'output'
          ? Position.Right
          : Position.Left;

  return (
    <HdlNodeBase
      node={node}
      width={nodeWidth}
      height={nodeHeight}
      style={nodeStyle}
      className={`hdl-node hdl-node-port hdl-port-${port?.direction ?? 'unknown'} hdl-port-skinned hdl-port-interface hdl-interface-node`}
      title={
        node.source
          ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}`
          : 'interface port'
      }
      onDoubleClick={(event) => stopIfBusTapDescendant(event, () => handleNodeDoubleClick(node))}
      svg={
        <PortNodeSvg
          node={node}
          width={nodeWidth}
          height={nodeHeight}
          arrayConnections={arrayConnections}
          onNavigateToSource={navigateToSource}
        />
      }
      handles={
        <>
          <Handle type="target" id={port?.id} position={handlePosition} />
          <Handle type="source" id={port?.id} position={handlePosition} />
        </>
      }
      selection={<div className="hdl-node-selection-rect" aria-hidden="true" />}
      warningIcon={<NodeWarningIcon node={node} width={nodeWidth} height={nodeHeight} />}
    />
  );
}
