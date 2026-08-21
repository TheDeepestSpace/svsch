import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { diagramSizing } from '../../diagram/constants';
import { diagramNodeDimensions, instanceParameterRows } from '../../diagram/nodeSizing';
import {
  distributedInterfaceSideCenters,
  interfaceTopHatHeight,
  interfaceTopPortX,
  orderedInterfaceSidePorts,
} from '../../diagram/interfaceGeometry';
import { gateInputPortCenterY } from '../../diagram/muxGeometry';
import { busTapPortCenterY, isBusComposition } from '../../diagram/busGeometry';
import { interfaceInstanceTopHatY, visualHandleGeometry } from '../../diagram/visualHandleGeometry';
import { isInputSidePort, isInoutPort } from '../../diagram/portDirection';
import { nodeTypeName, nodeIsArrayNode, structRole } from '../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../ir/edgeStyle';
import type { DiagramPort } from '../../ir/types';
import { NetLabelNode } from './NetLabelNode';
import type { HdlFlowNode } from './types';
import { BusNodeSvg } from './bus/BusNodeSvg';
import { GateNodeSvg } from './gate/GateNodeSvg';
import { RegisterNode } from './register/RegisterNode';
import { ReplicateNode } from './replicate/ReplicateNode';
import { LiteralNode } from './literal/LiteralNode';
import { InverterNode } from './inverter/InverterNode';
import { PortNode, InterfacePortNode } from './port/PortNode';
import { MuxNode } from './mux/MuxNode';
import { AluNode } from './alu/AluNode';
import { ComparatorNode } from './comparator/ComparatorNode';
import { ZextNode } from './zext/ZextNode';
import { CombNode } from './comb/CombNode';
import { InstanceNode } from './instance/InstanceNode';
import { ArrayStackSelection } from './shared/skins';
import { NodeWarningIcon } from './shared/NodeWarningIcon';
import { InputPortHandles } from './shared/InputPortHandles';
import {
  handleNodeDoubleClick,
  navigateToSource,
  stopIfBusTapDescendant,
} from './shared/navigation';

// Bus/struct/interface rendering (below) is intentionally not yet split into
// self-contained per-kind components — see issue #172's "Shape A/B" writeup
// for why bus/struct/interface don't split cleanly into symmetric per-kind
// entries the way the other node kinds do. Gate nodes are unsplit for the
// same reason as of this writing. Left as a follow-up.
export function HdlNode({ id, data, selected }: NodeProps<HdlFlowNode>): React.ReactElement {
  const node = data.node;
  const arrayConnections = data.arrayConnections ?? [];
  const nodeRole = structRole(node);
  const isInterfacePortNode = node.kind === 'interface' && nodeRole === 'port';

  if (node.kind === 'netLabel') {
    const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);
    const parameterRows = instanceParameterRows(node);
    return (
      <NetLabelNode
        node={node}
        moduleName={data.moduleName ?? node.parentModule ?? ''}
        selected={selected}
        style={
          {
            '--svsch-node-width': `${nodeWidth}px`,
            '--svsch-node-height': `${nodeHeight}px`,
            '--svsch-instance-param-height': `${diagramSizing.gridSize * parameterRows}px`,
            '--svsch-port-width': `${diagramSizing.portWidth}px`,
          } as React.CSSProperties
        }
      />
    );
  }

  if (node.kind === 'port') {
    return <PortNode data={data} />;
  }

  if (isInterfacePortNode) {
    return <InterfacePortNode data={data} />;
  }

  if (node.kind === 'bus' || node.kind === 'struct' || node.kind === 'interface') {
    const role = nodeRole;
    const typeName = nodeTypeName(node);
    const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);
    const nodeStyle = {
      '--svsch-node-width': `${nodeWidth}px`,
      '--svsch-node-height': `${nodeHeight}px`,
      '--svsch-port-width': `${diagramSizing.portWidth}px`,
    } as React.CSSProperties;
    const warningIcon = <NodeWarningIcon node={node} width={nodeWidth} height={nodeHeight} />;
    const isInterface = node.kind === 'interface';
    const isInterfaceModport = isInterface && role === 'modport';
    const isModuleInterfaceModport = isInterfaceModport && node.label !== typeName;
    const isInterfaceInstance =
      isInterface &&
      role !== 'modport' &&
      role !== 'port' &&
      !node.id.startsWith('interface_type:');
    const interfaceBundlePorts = isInterfaceModport
      ? node.ports.filter((port) => port.width === 'interface')
      : [];
    const aggregatePorts = isInterface
      ? node.ports.filter((port) => port.width !== 'interface' || port.preferredSide)
      : node.ports;

    const topPorts = isInterfaceInstance
      ? aggregatePorts.filter((p) => p.direction === 'input' && p.width !== 'interface')
      : [];
    const bottomPorts = isInterfaceInstance
      ? aggregatePorts.filter((p) => p.direction === 'output' && p.width !== 'interface')
      : [];
    const sidePorts = isInterfaceInstance
      ? aggregatePorts.filter(
          (p) => p.width === 'interface' || (p.direction !== 'input' && p.direction !== 'output'),
        )
      : aggregatePorts;
    const orderedSidePorts = orderedInterfaceSidePorts(sidePorts);
    const leftSidePorts = isInterfaceInstance ? orderedSidePorts.left : [];
    const rightSidePorts = isInterfaceInstance ? orderedSidePorts.right : [];
    const capPortCount = Math.max(topPorts.length, bottomPorts.length);
    const topHatHeight = isInterfaceInstance ? interfaceTopHatHeight(topPorts.length > 0) : 0;
    const bottomHatHeight = isInterfaceInstance ? interfaceTopHatHeight(bottomPorts.length > 0) : 0;
    const shiftY = isInterfaceInstance ? diagramSizing.interfaceInstanceShiftY : 0;
    const unshiftedHeight = Math.max(diagramSizing.gridSize, nodeHeight - shiftY);
    const leftInterfaceCenters = distributedInterfaceSideCenters(
      leftSidePorts.length,
      unshiftedHeight,
      topHatHeight,
      bottomHatHeight,
    ).map((c) => c + shiftY);
    const rightInterfaceCenters = distributedInterfaceSideCenters(
      rightSidePorts.length,
      unshiftedHeight,
      topHatHeight,
      bottomHatHeight,
    ).map((c) => c + shiftY);
    const interfaceTopHatY = interfaceInstanceTopHatY(node, nodeHeight);
    const interfaceTapCenterById = new Map<string, number>();
    leftSidePorts.forEach((port, index) =>
      interfaceTapCenterById.set(port.id, leftInterfaceCenters[index]),
    );
    rightSidePorts.forEach((port, index) =>
      interfaceTapCenterById.set(port.id, rightInterfaceCenters[index]),
    );

    const aggregateInputs = sidePorts.filter(isInputSidePort);
    const aggregateOutputs = sidePorts.filter((port: DiagramPort) => port.direction === 'output');

    const isComposition = isBusComposition(node, role);
    const isArrayComposition =
      node.kind === 'bus' && isComposition && node.metadata?.aggregateKind === 'array';
    const isArrayBreakout =
      node.kind === 'bus' && !isComposition && node.metadata?.aggregateKind === 'array';

    const taps = isInterfaceModport
      ? [...sidePorts]
      : isInterfaceInstance
        ? [...leftSidePorts, ...rightSidePorts]
        : isInterface
          ? [...aggregateInputs, ...aggregateOutputs]
          : isComposition
            ? aggregateInputs
            : aggregateOutputs;
    const singlePort = isComposition ? aggregateOutputs[0] : aggregateInputs[0];

    const tapCenters = taps.map((_: DiagramPort, index: number) =>
      isInterfaceInstance
        ? (interfaceTapCenterById.get(taps[index].id) ?? nodeHeight / 2)
        : busTapPortCenterY(index, isInterfaceModport ? 2 : 1),
    );
    const singlePortHandle = singlePort ? visualHandleGeometry(node, singlePort.id) : undefined;
    const singlePortHandleStyle = singlePortHandle
      ? ({
          top: singlePortHandle.offset.y,
          ...(singlePortHandle.side === 'EAST'
            ? { right: nodeWidth - singlePortHandle.offset.x }
            : { left: singlePortHandle.offset.x }),
        } as React.CSSProperties)
      : undefined;
    const busStyle = { ...nodeStyle } as React.CSSProperties;
    const navigatePortSource = (event: React.MouseEvent, port: DiagramPort) => {
      if (port.source) {
        event.stopPropagation();
        navigateToSource(port.source);
      }
    };
    const navigateTapFromEvent = (event: React.MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const targetClass =
        typeof event.target.className === 'string'
          ? event.target.className
          : (event.target.className as any)?.baseVal;
      const tap = event.target.closest('.bus-tap, .svsch-bus-tap, .svsch-interface-side-label');
      const portId = tap?.getAttribute('data-port-id') ?? (tap as HTMLElement)?.dataset?.portId;
      const port = portId ? taps.find((candidate) => candidate.id === portId) : undefined;
      console.log(
        'navigateTapFromEvent targetClass:',
        targetClass,
        'tap:',
        !!tap,
        'portId:',
        portId,
        'port:',
        !!port,
        'port.source:',
        port?.source,
      );
      if (port?.source) {
        event.stopPropagation();
        navigateToSource(port.source);
      }
    };

    return (
      <button
        className={`hdl-bus-node ${node.kind === 'struct' ? 'hdl-struct-node' : ''} ${isInterface ? 'hdl-interface-node' : ''} ${isInterfaceModport ? 'hdl-interface-modport' : ''} ${isInterfaceInstance ? 'hdl-interface-instance' : ''} ${isComposition ? 'hdl-bus-composition' : 'hdl-bus-breakout'} ${isArrayComposition ? 'hdl-bus-array-composition' : ''} ${isArrayBreakout ? 'hdl-bus-array-breakout' : ''}`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={busStyle}
        title={
          node.source
            ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}`
            : node.kind
        }
        onClickCapture={navigateTapFromEvent}
        onDoubleClickCapture={navigateTapFromEvent}
        onDoubleClick={(event) => stopIfBusTapDescendant(event, () => handleNodeDoubleClick(node))}
      >
        <svg className="hdl-node-svg" width={nodeWidth} height={nodeHeight} aria-hidden="true">
          <BusNodeSvg
            node={node}
            width={nodeWidth}
            height={nodeHeight}
            arrayConnections={arrayConnections}
            onNavigateToSource={navigateToSource}
          />
        </svg>
        {!isInterfaceModport && !isInterfaceInstance && isComposition && singlePort ? (
          <Handle
            type="source"
            id={singlePort?.id}
            position={Position.Right}
            style={singlePortHandleStyle}
          />
        ) : !isInterfaceModport && !isInterfaceInstance && singlePort ? (
          <InputPortHandles
            port={singlePort}
            position={Position.Left}
            style={singlePortHandleStyle}
          />
        ) : null}
        {topPorts.map((port, index) => {
          const handleGeometry = visualHandleGeometry(node, port.id);
          return (
            <div
              key={port.id}
              className="interface-top-port"
              data-port-id={port.id}
              style={{
                left: `${handleGeometry?.offset.x ?? interfaceTopPortX(nodeWidth, topPorts.length, index, capPortCount)}px`,
                top: `${handleGeometry?.offset.y ?? interfaceTopHatY}px`,
              }}
            >
              <Handle type="target" id={port.id} position={Position.Top} />
              <Handle type="source" id={port.id} position={Position.Top} />
            </div>
          );
        })}
        {bottomPorts.map((port, index) => (
          <div
            key={port.id}
            className="interface-bottom-port"
            data-port-id={port.id}
            style={{
              left: `${interfaceTopPortX(nodeWidth, bottomPorts.length, index, capPortCount)}px`,
              top: `${nodeHeight}px`,
            }}
          >
            <Handle type="target" id={port.id} position={Position.Bottom} />
            <Handle type="source" id={port.id} position={Position.Bottom} />
          </div>
        ))}
        {interfaceBundlePorts.map((port) => {
          const position = isModuleInterfaceModport
            ? Position.Top
            : port.direction === 'output'
              ? Position.Right
              : Position.Left;
          return (
            <div
              key={port.id}
              className="interface-bundle-port"
              style={{
                ...(position === Position.Top
                  ? { left: `${nodeWidth / 2 - diagramSizing.gridSize / 2}px`, top: `${shiftY}px` }
                  : {
                      top: `${nodeHeight / 2 - diagramSizing.gridSize / 2}px`,
                      ...(position === Position.Right ? { right: 0 } : { left: 0 }),
                    }),
              }}
            >
              <Handle type="target" id={port.id} position={position} />
              <Handle type="source" id={port.id} position={position} />
            </div>
          );
        })}
        <div className="bus-taps">
          {taps.map((port: DiagramPort, index: number) => {
            const tapPosition =
              port.preferredSide === 'right' || port.direction === 'output'
                ? Position.Right
                : Position.Left;
            return (
              <div
                className={`bus-tap ${isInterfaceModport || isInterfaceInstance ? (port.preferredSide === 'right' || port.direction === 'output' ? 'bus-tap-right' : 'bus-tap-left') : ''}`}
                data-port-id={port.id}
                key={port.id}
                style={{ top: `${tapCenters[index] - diagramSizing.gridSize / 2}px` }}
                onDoubleClick={(event) => navigatePortSource(event, port)}
              >
                {isInterfaceModport ? (
                  <>
                    <Handle type="source" id={port.id} position={tapPosition} />
                    <Handle type="target" id={port.id} position={tapPosition} />
                  </>
                ) : isInterfaceInstance && port.width === 'interface' ? (
                  <>
                    <Handle
                      type="source"
                      id={port.direction === 'input' ? `in:${port.name}` : `out:${port.name}`}
                      position={port.preferredSide === 'left' ? Position.Left : Position.Right}
                    />
                    <Handle
                      type="target"
                      id={port.direction === 'input' ? `in:${port.name}` : `out:${port.name}`}
                      position={port.preferredSide === 'left' ? Position.Left : Position.Right}
                    />
                  </>
                ) : isInterfaceInstance && isInoutPort(port) ? (
                  <InputPortHandles port={port} position={tapPosition} />
                ) : isInterfaceInstance ? null : isComposition ? (
                  <InputPortHandles port={port} position={Position.Left} />
                ) : (
                  <Handle type="source" id={port.id} position={Position.Right} />
                )}
              </div>
            );
          })}
        </div>
        {isInterfaceInstance ? null : (
          <div className="hdl-node-selection-rect" aria-hidden="true" />
        )}
        {warningIcon}
      </button>
    );
  }

  if (node.kind === 'register' || node.kind === 'latch') {
    return <RegisterNode id={id} data={data} />;
  }

  if (node.kind === 'replicate') {
    return <ReplicateNode data={data} />;
  }

  if (node.kind === 'literal') {
    return <LiteralNode data={data} />;
  }

  if (node.kind === 'inverter') {
    return <InverterNode data={data} />;
  }

  if (node.kind === 'gate') {
    const isArray = nodeIsArrayNode(node);
    const inputs = node.ports.filter(isInputSidePort);
    const outputs = node.ports.filter((port: DiagramPort) => port.direction === 'output');
    const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);
    const nodeStyle = {
      '--svsch-node-width': `${nodeWidth}px`,
      '--svsch-node-height': `${nodeHeight}px`,
      '--svsch-port-width': `${diagramSizing.portWidth}px`,
    } as React.CSSProperties;
    const warningIcon = <NodeWarningIcon node={node} width={nodeWidth} height={nodeHeight} />;
    return (
      <button
        className={`hdl-node hdl-node-gate${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        title={
          node.source
            ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}`
            : node.kind
        }
        onDoubleClick={() => handleNodeDoubleClick(node)}
      >
        <svg
          className="hdl-node-svg gate-skin"
          width={nodeWidth}
          height={nodeHeight}
          aria-hidden="true"
        >
          <GateNodeSvg
            node={node}
            width={nodeWidth}
            height={nodeHeight}
            arrayConnections={arrayConnections}
          />
        </svg>
        {inputs.map((port: DiagramPort, index: number) => (
          <Handle
            key={port.id}
            type="target"
            id={port.id}
            position={Position.Left}
            style={{ top: gateInputPortCenterY(index, inputs.length, nodeHeight) }}
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
        {isArray && (
          <ArrayStackSelection
            kind="rect"
            width={nodeWidth}
            height={nodeHeight}
            wide={nodeStackIsWide(node)}
          />
        )}
        {warningIcon}
      </button>
    );
  }

  if (node.kind === 'mux' || node.kind === 'select') {
    return <MuxNode data={data} />;
  }

  if (node.kind === 'alu') {
    return <AluNode data={data} />;
  }

  if (node.kind === 'comparator') {
    return <ComparatorNode data={data} />;
  }

  if (node.kind === 'zext') {
    return <ZextNode data={data} />;
  }

  if (node.kind === 'comb' || node.kind === 'loop') {
    return <CombNode data={data} />;
  }

  // Catch-all: instance and unknown kinds
  return <InstanceNode id={id} data={data} />;
}
