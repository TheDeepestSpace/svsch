import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { diagramSizing } from '../../../diagram/constants';
import { diagramNodeDimensions, resolvedNodeDimensions } from '../../../diagram/nodeSizing';
import { registerPortTop, registerExtraInputPortTop } from '../../../diagram/registerGeometry';
import {
  registerClockSignal,
  registerResetSignal,
  nodeIsArrayNode,
} from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import type { DiagramPort, PositionedNode } from '../../../ir/types';
import { ArrayStackSelection } from '../shared/skins';
import { HdlNodeBase } from '../shared/HdlNodeBase';
import { NodeWarningIcon } from '../shared/NodeWarningIcon';
import { InputPortHandles } from '../shared/InputPortHandles';
import { NodeResizeControls } from '../shared/NodeResizeControls';
import { handleNodeDoubleClick, navigateToSource } from '../shared/navigation';
import type { HdlNodeData } from '../types';
import { RegisterNodeSvg } from './RegisterNodeSvg';
import { LatchNodeSvg } from '../latch/LatchNodeSvg';

export function RegisterNode({ id, data }: { id: string; data: HdlNodeData }): React.ReactElement {
  const node = data.node as PositionedNode & { kind: 'register' | 'latch' };
  const arrayConnections = data.arrayConnections ?? [];
  const isArray = nodeIsArrayNode(node);
  // Register (not latch) can render larger than its canonical auto-fit box
  // when a manual resize override is saved. Content rows that must not
  // reflow as the box grows (the extra-input-port ladder) use this canonical
  // size instead of nodeWidth/nodeHeight; edge-anchored ports use the
  // resolved size.
  const isResizable = node.kind === 'register';
  const { width: nodeWidth, height: nodeHeight } = resolvedNodeDimensions(node);
  const canonicalSize = isResizable
    ? diagramNodeDimensions(node)
    : { width: nodeWidth, height: nodeHeight };
  const nodeStyle = {
    '--svsch-node-width': `${nodeWidth}px`,
    '--svsch-node-height': `${nodeHeight}px`,
    '--svsch-port-width': `${diagramSizing.portWidth}px`,
  } as React.CSSProperties;

  const inputs = node.ports.filter(
    (port: DiagramPort) =>
      port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown',
  );
  const outputs = node.ports.filter((port: DiagramPort) => port.direction === 'output');

  const clockSignal = registerClockSignal(node);
  const resetSignal = registerResetSignal(node);
  const hasReset = Boolean(resetSignal);
  const dPort = inputs.find((port: DiagramPort) => port.name === 'D') ?? inputs[0];
  const qPort = outputs.find((port: DiagramPort) => port.name === 'Q') ?? outputs[0];
  const clockPort =
    inputs.find((port: DiagramPort) => port.name === clockSignal) ??
    inputs.find((port: DiagramPort) => port.name !== 'D' && port.name !== resetSignal);
  const resetPort = resetSignal
    ? inputs.find((port: DiagramPort) => port.name === resetSignal)
    : undefined;
  const rvPort = inputs.find((port: DiagramPort) => port.name === 'RV');
  const hasRv = Boolean(rvPort);
  const renderedInputPortIds = new Set(
    [dPort?.id, clockPort?.id, resetPort?.id, rvPort?.id].filter(Boolean),
  );
  const extraInputPorts = inputs.filter((port: DiagramPort) => !renderedInputPortIds.has(port.id));
  const SvgComp = node.kind === 'register' ? RegisterNodeSvg : LatchNodeSvg;

  return (
    <HdlNodeBase
      node={node}
      width={nodeWidth}
      height={nodeHeight}
      style={nodeStyle}
      className={`hdl-node hdl-node-${node.kind} hdl-register-node${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
      title={
        node.source
          ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}`
          : node.kind
      }
      onDoubleClick={() => handleNodeDoubleClick(node)}
      svg={
        <SvgComp
          node={node}
          width={nodeWidth}
          height={nodeHeight}
          arrayConnections={arrayConnections}
          onNavigateToSource={navigateToSource}
        />
      }
      handles={
        <>
          {dPort && (
            <InputPortHandles
              port={dPort}
              position={Position.Left}
              style={{
                top: registerPortTop('d', nodeHeight, hasReset, hasRv) + diagramSizing.gridSize / 2,
              }}
            />
          )}
          {qPort && (
            <Handle
              type="source"
              id={qPort.id}
              position={Position.Right}
              style={{
                top: registerPortTop('q', nodeHeight, hasReset, hasRv) + diagramSizing.gridSize / 2,
              }}
            />
          )}
          {clockPort && (
            <InputPortHandles
              port={clockPort}
              position={Position.Left}
              style={{
                top:
                  registerPortTop('clock', nodeHeight, hasReset, hasRv) +
                  diagramSizing.gridSize / 2,
              }}
            />
          )}
          {resetPort && (
            <InputPortHandles
              port={resetPort}
              position={Position.Bottom}
              style={{ left: nodeWidth / 2, bottom: 0, transform: 'translate(-50%, 0)' }}
            />
          )}
          {rvPort && (
            <InputPortHandles
              port={rvPort}
              position={Position.Left}
              style={{
                top:
                  registerPortTop('rv', nodeHeight, hasReset, hasRv) + diagramSizing.gridSize / 2,
              }}
            />
          )}
          {extraInputPorts.map((port, index) => (
            <InputPortHandles
              key={port.id}
              port={port}
              position={Position.Left}
              style={{
                top:
                  registerExtraInputPortTop(index, canonicalSize.height, hasRv) +
                  diagramSizing.gridSize / 2,
              }}
            />
          ))}
        </>
      }
      selection={
        isArray ? (
          <ArrayStackSelection
            kind="rect"
            width={nodeWidth}
            height={nodeHeight}
            wide={nodeStackIsWide(node)}
          />
        ) : (
          <div className="hdl-node-selection-rect" aria-hidden="true" />
        )
      }
      resizeControls={node.kind === 'register' && <NodeResizeControls nodeId={id} />}
      warningIcon={<NodeWarningIcon node={node} width={nodeWidth} height={nodeHeight} />}
    />
  );
}
