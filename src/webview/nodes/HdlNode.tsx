import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getVscodeApi } from '../vscodeApi';
import { diagramSizing, nodePortCenterOffset } from '../../diagram/constants';
import { diagramNodeDimensions, instanceParameterRows, inverterGeometryWidth, nodeOutlineTopRightVertex } from '../../diagram/nodeSizing';
import {
  distributedInterfaceSideCenters,
  interfaceTopHatHeight,
  interfaceTopPortX,
  orderedInterfaceSidePorts
} from '../../diagram/interfaceGeometry';
import { registerPortTop, registerExtraInputPortTop } from '../../diagram/registerGeometry';
import { muxInputPortCenterY } from '../../diagram/muxGeometry';
import { busTapPortCenterY } from '../../diagram/busGeometry';
import { interfaceInstanceTopHatY, visualHandleGeometry } from '../../diagram/visualHandleGeometry';
import {
  nodeModportName,
  nodeModportSource,
  nodeTypeName,
  registerClockSignal,
  registerResetSignal,
  nodeIsArrayNode,
  structRole
} from '../../ir/nodeMetadata';
import type { DiagramPort, SourceRange } from '../../ir/types';
import {
  InstanceParameterList,
} from './shared/labels';
import { ArrayStackSelection } from './shared/skins';
import { nodeStackIsWide } from '../../ir/edgeStyle';
import { NetLabelNode } from './NetLabelNode';
import type { HdlFlowNode } from './types';
import { RegisterNodeSvg } from './register/RegisterNodeSvg';
import { LatchNodeSvg } from './latch/LatchNodeSvg';
import { LiteralNodeSvg } from './literal/LiteralNodeSvg';
import { ReplicateNodeSvg } from './replicate/ReplicateNodeSvg';
import { InverterNodeSvg } from './inverter/InverterNodeSvg';
import { PortNodeSvg } from './port/PortNodeSvg';
import { CombNodeSvg } from './comb/CombNodeSvg';
import { LoopNodeSvg } from './loop/LoopNodeSvg';
import { MuxNodeSvg } from './mux/MuxNodeSvg';
import { SelectNodeSvg } from './mux/SelectNodeSvg';
import { AluNodeSvg } from './alu/AluNodeSvg';
import { BusNodeSvg } from './bus/BusNodeSvg';
import { InstanceNodeSvg } from './instance/InstanceNodeSvg';
import { Tooltip } from '../Tooltip';

const vscode = getVscodeApi();

export function HdlNode({ data, selected }: NodeProps<HdlFlowNode>): React.ReactElement {
  const node = data.node;
  const arrayConnections = data.arrayConnections ?? [];
  const isArray = nodeIsArrayNode(node);
  const typeName = nodeTypeName(node)
    ?? (node.kind === 'port' ? node.ports[0]?.typeName : undefined);
  const modportName = nodeModportName(node) ?? (node.kind === 'port' ? node.ports[0]?.modportName : undefined);
  const modportSource = nodeModportSource(node) ?? (node.kind === 'port' ? node.ports[0]?.modportSource : undefined);
  const nodeRole = structRole(node);
  const instanceParameters = node.kind === 'instance' ? (node.instanceParameters ?? node.metadata?.instanceParameters ?? []) : [];

  const inputs = node.ports.filter((port: DiagramPort) => port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown');
  const outputs = node.ports.filter((port: DiagramPort) => port.direction === 'output');
  const muxTopPorts = node.kind === 'select'
    ? inputs.filter((port: DiagramPort) => port.name === 's' || port.name === 'sel' || port.name === 'width')
    : (node.kind === 'mux'
      ? (inputs.some((port: DiagramPort) => port.name === 'sel') ? inputs.filter((port: DiagramPort) => port.name === 'sel').slice(0, 1) : inputs.slice(0, 1))
      : []);
  const sideInputs = muxTopPorts.length > 0 ? inputs.filter((port: DiagramPort) => !muxTopPorts.some((topPort) => topPort.id === port.id)) : inputs;
  const portDirection = node.kind === 'port' ? node.ports[0]?.direction ?? 'unknown' : undefined;
  const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);
  const parameterRows = instanceParameterRows(node);
  const isInterfacePortNode = node.kind === 'interface' && nodeRole === 'port';
  const nodeStyle = {
    '--svsch-node-width': `${nodeWidth}px`,
    '--svsch-node-height': `${nodeHeight}px`,
    '--svsch-port-width': `${node.kind === 'port' || isInterfacePortNode ? nodeWidth : diagramSizing.portWidth}px`,
  } as React.CSSProperties;
  const warningVertex = nodeOutlineTopRightVertex(node, nodeWidth, nodeHeight);
  const warningIcon = <NodeWarningIcon message={node.warningNote} vertex={warningVertex} />;

  if (node.kind === 'netLabel') {
    return (
      <NetLabelNode
        node={node}
        moduleName={data.moduleName ?? node.parentModule ?? ''}
        selected={selected}
        style={{
          '--svsch-node-width': `${nodeWidth}px`,
          '--svsch-node-height': `${nodeHeight}px`,
          '--svsch-instance-param-height': `${diagramSizing.gridSize * parameterRows}px`,
          '--svsch-port-width': `${diagramSizing.portWidth}px`
        } as React.CSSProperties}
      />
    );
  }

  const navigateToSource = (source: SourceRange) => {
    const msg = { type: 'navigateToSource', source };
    console.log('NAVIGATE:', JSON.stringify(msg));
    vscode.postMessage(msg);
  };

  const handleDoubleClick = () => {
    let msg: any = null;
    const isInterface = node.kind === 'interface' || (node.kind === 'port' && Boolean(typeName && (modportName !== undefined || typeName.endsWith('_if') || typeName.endsWith('if'))));

    if (isInterface && typeName && nodeRole !== 'modport') {
      msg = { type: 'openModule', moduleName: `interface ${typeName}` };
    } else if (node.kind === 'instance' && node.moduleName) {
      msg = { type: 'openModule', moduleName: node.moduleName };
    } else if (node.source) {
      msg = { type: 'navigateToSource', source: node.source };
    }
    if (msg) {
      console.log('NAVIGATE:', JSON.stringify(msg));
      vscode.postMessage(msg);
    }
  };

  if (node.kind === 'port') {
    const isOutput = portDirection === 'output';
    const isInput = portDirection === 'input';
    const isInterfacePort = Boolean(node.ports[0]?.typeName && node.ports[0]?.modportName !== undefined || node.ports[0]?.typeName?.endsWith('_if') || node.ports[0]?.typeName?.endsWith('if'));
    const isSkinnedPort = isInput || isOutput || isInterfacePort;
    const handlePositionOverride = node.metadata?.handlePosition as Position | undefined;

    return (
      <button
        className={`hdl-node hdl-node-port hdl-port-${portDirection}${isSkinnedPort ? ' hdl-port-skinned' : ''}${isInterfacePort ? ' hdl-port-interface' : ''}${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : 'port'}
        onDoubleClick={(event) => {
          console.log('HdlNode.tsx onDoubleClick target class:', (event.target as Element).className);
          if (event.target instanceof Element && event.target.closest('.bus-tap, .svsch-bus-tap-label, .svsch-interface-field-label, .svsch-interface-side-label')) {
            return;
          }
          handleDoubleClick();
        }}
      >
        <svg className="hdl-node-svg" width={nodeWidth} height={nodeHeight} aria-hidden="true">
          <PortNodeSvg
            node={node}
            width={nodeWidth}
            height={nodeHeight}
            arrayConnections={arrayConnections}
            onNavigateToSource={navigateToSource}
          />
        </svg>
        {isOutput && <Handle type="target" id={node.ports[0]?.id} position={handlePositionOverride ?? Position.Left} />}
        {isOutput && <Handle type="source" id={node.ports[0]?.id} position={handlePositionOverride ?? Position.Left} />}
        {!isOutput && <Handle type="source" id={node.ports[0]?.id} position={handlePositionOverride ?? Position.Right} />}
        {isArray && isSkinnedPort
          ? <ArrayStackSelection kind={isOutput ? 'output' : 'input'} width={nodeWidth} height={nodeHeight} wide={nodeStackIsWide(node)} />
          : isSkinnedPort
            ? null
            : <div className="hdl-node-selection-rect" aria-hidden="true" />}
        {warningIcon}
      </button>
    );
  }

  if (isInterfacePortNode) {
    const port = node.ports[0];
    const handlePosition = port?.preferredSide === 'left'
      ? Position.Left
      : port?.preferredSide === 'right'
        ? Position.Right
        : port?.direction === 'output'
          ? Position.Right
          : Position.Left;

    return (
      <button
        className={`hdl-node hdl-node-port hdl-port-${port?.direction ?? 'unknown'} hdl-port-skinned hdl-port-interface hdl-interface-node`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : 'interface port'}
        onDoubleClick={(event) => {
          console.log('HdlNode.tsx onDoubleClick target class:', (event.target as Element).className);
          if (event.target instanceof Element && event.target.closest('.bus-tap, .svsch-bus-tap-label, .svsch-interface-field-label, .svsch-interface-side-label')) {
            return;
          }
          handleDoubleClick();
        }}
      >
        <svg className="hdl-node-svg" width={nodeWidth} height={nodeHeight} aria-hidden="true">
          <PortNodeSvg
            node={node}
            width={nodeWidth}
            height={nodeHeight}
            arrayConnections={arrayConnections}
            onNavigateToSource={navigateToSource}
          />
        </svg>
        <Handle type="target" id={port?.id} position={handlePosition} />
        <Handle type="source" id={port?.id} position={handlePosition} />
        <div className="hdl-node-selection-rect" aria-hidden="true" />
        {warningIcon}
      </button>
    );
  }

  if (node.kind === 'bus' || node.kind === 'struct' || node.kind === 'interface') {
    const role = nodeRole;
    const isInterface = node.kind === 'interface';
    const isInterfaceModport = isInterface && role === 'modport';
    const isModuleInterfaceModport = isInterfaceModport && node.label !== typeName;
    const isInterfaceInstance = isInterface && role !== 'modport' && role !== 'port' && !node.id.startsWith('interface_type:');
    const interfaceBundlePorts = isInterfaceModport ? node.ports.filter((port) => port.width === 'interface') : [];
    const aggregatePorts = isInterface ? node.ports.filter((port) => port.width !== 'interface' || port.preferredSide) : node.ports;

    const topPorts = isInterfaceInstance ? aggregatePorts.filter(p => p.direction === 'input' && p.width !== 'interface') : [];
    const bottomPorts = isInterfaceInstance ? aggregatePorts.filter(p => p.direction === 'output' && p.width !== 'interface') : [];
    const sidePorts = isInterfaceInstance
      ? aggregatePorts.filter(p => p.width === 'interface' || (p.direction !== 'input' && p.direction !== 'output'))
      : aggregatePorts;
    const orderedSidePorts = orderedInterfaceSidePorts(sidePorts);
    const leftSidePorts = isInterfaceInstance ? orderedSidePorts.left : [];
    const rightSidePorts = isInterfaceInstance ? orderedSidePorts.right : [];
    const capPortCount = Math.max(topPorts.length, bottomPorts.length);
    const topHatHeight = isInterfaceInstance ? interfaceTopHatHeight(topPorts.length > 0) : 0;
    const bottomHatHeight = isInterfaceInstance ? interfaceTopHatHeight(bottomPorts.length > 0) : 0;
    const shiftY = isInterfaceInstance ? diagramSizing.interfaceInstanceShiftY : 0;
    const unshiftedHeight = Math.max(diagramSizing.gridSize, nodeHeight - shiftY);
    const leftInterfaceCenters = distributedInterfaceSideCenters(leftSidePorts.length, unshiftedHeight, topHatHeight, bottomHatHeight).map(c => c + shiftY);
    const rightInterfaceCenters = distributedInterfaceSideCenters(rightSidePorts.length, unshiftedHeight, topHatHeight, bottomHatHeight).map(c => c + shiftY);
    const interfaceTopHatY = interfaceInstanceTopHatY(node, nodeHeight);
    const interfaceTapCenterById = new Map<string, number>();
    leftSidePorts.forEach((port, index) => interfaceTapCenterById.set(port.id, leftInterfaceCenters[index]));
    rightSidePorts.forEach((port, index) => interfaceTapCenterById.set(port.id, rightInterfaceCenters[index]));

    const aggregateInputs = sidePorts.filter((port: DiagramPort) => port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown');
    const aggregateOutputs = sidePorts.filter((port: DiagramPort) => port.direction === 'output');

    const isComposition = node.kind === 'struct'
      ? role === 'composition'
      : node.kind === 'interface'
        ? false
        : aggregateInputs.length > 1;
    const isArrayComposition = node.kind === 'bus' && isComposition && node.metadata?.aggregateKind === 'array';
    const isArrayBreakout = node.kind === 'bus' && !isComposition && node.metadata?.aggregateKind === 'array';

    const taps = isInterfaceModport ? [...sidePorts] : isInterfaceInstance ? [...leftSidePorts, ...rightSidePorts] : isInterface ? [...aggregateInputs, ...aggregateOutputs] : isComposition ? aggregateInputs : aggregateOutputs;
    const singlePort = isComposition ? aggregateOutputs[0] : aggregateInputs[0];

    const tapCenters = taps.map((_: DiagramPort, index: number) => (
      isInterfaceInstance
        ? interfaceTapCenterById.get(taps[index].id) ?? nodeHeight / 2
        : busTapPortCenterY(index, isInterfaceModport ? 2 : 1)
    ));
    const firstTapCenter = tapCenters[0] ?? nodeHeight / 2;
    const lastTapCenter = tapCenters[tapCenters.length - 1] ?? nodeHeight / 2;
    const singlePortHandle = singlePort ? visualHandleGeometry(node, singlePort.id) : undefined;
    const singlePortHandleStyle = singlePortHandle
      ? ({
        top: singlePortHandle.offset.y,
        ...(singlePortHandle.side === 'EAST'
          ? { right: nodeWidth - singlePortHandle.offset.x }
          : { left: singlePortHandle.offset.x })
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
      const targetClass = typeof event.target.className === 'string' ? event.target.className : (event.target.className as any)?.baseVal;
      const tap = event.target.closest('.bus-tap, .svsch-bus-tap, .svsch-interface-side-label');
      const portId = tap?.getAttribute('data-port-id') ?? (tap as HTMLElement)?.dataset?.portId;
      const port = portId ? taps.find((candidate) => candidate.id === portId) : undefined;
      console.log('navigateTapFromEvent targetClass:', targetClass, 'tap:', !!tap, 'portId:', portId, 'port:', !!port, 'port.source:', port?.source);
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
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
        onClickCapture={navigateTapFromEvent}
        onDoubleClickCapture={navigateTapFromEvent}
        onDoubleClick={(event) => {
          console.log('HdlNode.tsx onDoubleClick target class:', (event.target as Element).className);
          if (event.target instanceof Element && event.target.closest('.bus-tap, .svsch-bus-tap-label, .svsch-interface-field-label, .svsch-interface-side-label')) {
            return;
          }
          handleDoubleClick();
        }}
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
          <Handle type="source" id={singlePort?.id} position={Position.Right} style={singlePortHandleStyle} />
        ) : !isInterfaceModport && !isInterfaceInstance && singlePort ? (
          <Handle type="target" id={singlePort?.id} position={Position.Left} style={singlePortHandleStyle} />
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
                top: `${handleGeometry?.offset.y ?? interfaceTopHatY}px`
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
            style={{ left: `${interfaceTopPortX(nodeWidth, bottomPorts.length, index, capPortCount)}px`, top: `${nodeHeight}px` }}
          >
            <Handle type="target" id={port.id} position={Position.Bottom} />
            <Handle type="source" id={port.id} position={Position.Bottom} />
          </div>
        ))}
        {interfaceBundlePorts.map((port) => {
          const position = isModuleInterfaceModport ? Position.Top : (port.direction === 'output' ? Position.Right : Position.Left);
          return (
            <div
              key={port.id}
              className="interface-bundle-port"
              style={{
                ...(position === Position.Top
                  ? { left: `${nodeWidth / 2 - diagramSizing.gridSize / 2}px`, top: `${shiftY}px` }
                  : {
                    top: `${nodeHeight / 2 - diagramSizing.gridSize / 2}px`,
                    ...(position === Position.Right ? { right: 0 } : { left: 0 })
                  })
              }}
            >
              <Handle type="target" id={port.id} position={position} />
              <Handle type="source" id={port.id} position={position} />
            </div>
          );
        })}
        <div className="bus-taps">
          {taps.map((port: DiagramPort, index: number) => (
            <div
              className={`bus-tap ${isInterfaceModport || isInterfaceInstance ? (port.preferredSide === 'right' || port.direction === 'output' ? 'bus-tap-right' : 'bus-tap-left') : ''}`}
              data-port-id={port.id}
              key={port.id}
              style={{ top: `${tapCenters[index] - diagramSizing.gridSize / 2}px` }}
              onDoubleClick={(event) => navigatePortSource(event, port)}
            >
              {isInterfaceModport ? (
                <>
                  <Handle type="source" id={port.id} position={port.direction === 'output' ? Position.Right : Position.Left} />
                  <Handle type="target" id={port.id} position={port.direction === 'output' ? Position.Right : Position.Left} />
                </>
              ) : isInterfaceInstance && port.width === 'interface' ? (
                <>
                  <Handle type="source" id={port.direction === 'input' ? `in:${port.name}` : `out:${port.name}`} position={port.preferredSide === 'left' ? Position.Left : Position.Right} />
                  <Handle type="target" id={port.direction === 'input' ? `in:${port.name}` : `out:${port.name}`} position={port.preferredSide === 'left' ? Position.Left : Position.Right} />
                </>
              ) : isInterfaceInstance ? null : isComposition ? (
                <Handle type="target" id={port.id} position={Position.Left} />
              ) : (
                <Handle type="source" id={port.id} position={Position.Right} />
              )}
            </div>
          ))}
        </div>
        {isInterfaceInstance ? null : <div className="hdl-node-selection-rect" aria-hidden="true" />}
        {warningIcon}
      </button>
    );
  }

  if (node.kind === 'register' || node.kind === 'latch') {
    const clockSignal = registerClockSignal(node);
    const resetSignal = registerResetSignal(node);
    const hasReset = Boolean(resetSignal);
    const dPort = inputs.find((port: DiagramPort) => port.name === 'D') ?? inputs[0];
    const qPort = outputs.find((port: DiagramPort) => port.name === 'Q') ?? outputs[0];
    const clockPort = inputs.find((port: DiagramPort) => port.name === clockSignal)
      ?? inputs.find((port: DiagramPort) => port.name !== 'D' && port.name !== resetSignal);
    const resetPort = resetSignal
      ? inputs.find((port: DiagramPort) => port.name === resetSignal)
      : undefined;
    const rvPort = inputs.find((port: DiagramPort) => port.name === 'RV');
    const hasRv = Boolean(rvPort);
    const renderedInputPortIds = new Set([dPort?.id, clockPort?.id, resetPort?.id, rvPort?.id].filter(Boolean));
    const extraInputPorts = inputs.filter((port: DiagramPort) => !renderedInputPortIds.has(port.id));
    const SvgComp = node.kind === 'register' ? RegisterNodeSvg : LatchNodeSvg;

    return (
      <button
        className={`hdl-node hdl-node-${node.kind} hdl-register-node${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
        onDoubleClick={handleDoubleClick}
      >
        <svg className="hdl-node-svg" width={nodeWidth} height={nodeHeight} aria-hidden="true">
          <SvgComp
            node={node}
            width={nodeWidth}
            height={nodeHeight}
            arrayConnections={arrayConnections}
            onNavigateToSource={navigateToSource}
          />
        </svg>
        {dPort && <Handle type="target" id={dPort.id} position={Position.Left}
          style={{ top: registerPortTop('d', nodeHeight, hasReset, hasRv) + diagramSizing.gridSize / 2 }} />}
        {qPort && <Handle type="source" id={qPort.id} position={Position.Right}
          style={{ top: registerPortTop('q', nodeHeight, hasReset, hasRv) + diagramSizing.gridSize / 2 }} />}
        {clockPort && <Handle type="target" id={clockPort.id} position={Position.Left}
          style={{ top: registerPortTop('clock', nodeHeight, hasReset, hasRv) + diagramSizing.gridSize / 2 }} />}
        {resetPort && <Handle type="target" id={resetPort.id} position={Position.Bottom}
          style={{ left: nodeWidth / 2, bottom: 0, transform: 'translate(-50%, 0)' }} />}
        {rvPort && <Handle type="target" id={rvPort.id} position={Position.Left}
          style={{ top: registerPortTop('rv', nodeHeight, hasReset, hasRv) + diagramSizing.gridSize / 2 }} />}
        {extraInputPorts.map((port, index) => (
          <Handle key={port.id} type="target" id={port.id} position={Position.Left}
            style={{ top: registerExtraInputPortTop(index, nodeHeight, hasRv) + diagramSizing.gridSize / 2 }} />
        ))}
        {isArray
          ? <ArrayStackSelection kind="rect" width={nodeWidth} height={nodeHeight} wide={nodeStackIsWide(node)} />
          : <div className="hdl-node-selection-rect" aria-hidden="true" />}
        {warningIcon}
      </button>
    );
  }

  if (node.kind === 'replicate') {
    return (
      <button
        className={`hdl-node hdl-node-replicate${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
        onDoubleClick={handleDoubleClick}
      >
        <svg className="hdl-node-svg" width={nodeWidth} height={nodeHeight} aria-hidden="true">
          <ReplicateNodeSvg
            node={node}
            width={nodeWidth}
            height={nodeHeight}
            arrayConnections={arrayConnections}
            onNavigateToSource={navigateToSource}
          />
        </svg>
        {sideInputs.map((port: DiagramPort) => (
          <Handle key={port.id} type="target" id={port.id} position={Position.Left} />
        ))}
        {outputs.map((port: DiagramPort) => (
          <Handle key={port.id} type="source" id={port.id} position={Position.Right} />
        ))}
        {isArray
          ? <ArrayStackSelection kind="rect" width={nodeWidth} height={nodeHeight} wide={nodeStackIsWide(node)} />
          : <div className="hdl-node-selection-rect" aria-hidden="true" />}
        {warningIcon}
      </button>
    );
  }

  if (node.kind === 'literal') {
    return (
      <button
        className={`hdl-node hdl-node-literal${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
        onDoubleClick={handleDoubleClick}
      >
        <svg className="hdl-node-svg" width={nodeWidth} height={nodeHeight} aria-hidden="true">
          <LiteralNodeSvg
            node={node}
            width={nodeWidth}
            height={nodeHeight}
            arrayConnections={arrayConnections}
            onNavigateToSource={navigateToSource}
          />
        </svg>
        {outputs.map((port: DiagramPort) => (
          <Handle key={port.id} type="source" id={port.id} position={Position.Right} />
        ))}
        {isArray
          ? <ArrayStackSelection kind="rect" width={nodeWidth} height={nodeHeight} wide={nodeStackIsWide(node)} />
          : <div className="hdl-node-selection-rect" aria-hidden="true" />}
        {warningIcon}
      </button>
    );
  }

  if (node.kind === 'inverter') {
    const invOutputOffset = nodeWidth - inverterGeometryWidth();
    return (
      <button
        className="hdl-node hdl-node-inverter"
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
        onDoubleClick={handleDoubleClick}
      >
        <svg className="hdl-node-svg inverter-skin" width={nodeWidth} height={nodeHeight} aria-hidden="true">
          <InverterNodeSvg node={node} width={nodeWidth} height={nodeHeight} arrayConnections={arrayConnections} />
        </svg>
        {sideInputs.slice(0, 1).map((port: DiagramPort) => (
          <Handle key={port.id} type="target" id={port.id} position={Position.Left} />
        ))}
        {outputs.slice(0, 1).map((port: DiagramPort) => (
          <Handle key={port.id} type="source" id={port.id} position={Position.Right}
            style={invOutputOffset > 0 ? { right: `${invOutputOffset}px` } : undefined} />
        ))}
        {warningIcon}
      </button>
    );
  }

  if (node.kind === 'mux' || node.kind === 'select') {
    const SvgComp = node.kind === 'mux' ? MuxNodeSvg : SelectNodeSvg;
    return (
      <button
        className={`hdl-node hdl-node-${node.kind}${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        onDoubleClick={handleDoubleClick}
      >
        <svg className="hdl-node-svg mux-skin" width={nodeWidth} height={nodeHeight} aria-hidden="true">
          <SvgComp node={node} width={nodeWidth} height={nodeHeight} arrayConnections={arrayConnections} />
        </svg>
        {/* Hidden label for test findNodeIdByLabel compatibility */}
        <div className="node-title" style={{ display: 'none' }}>{node.label}</div>
        {muxTopPorts.map((port: DiagramPort, index: number) => (
          <Handle key={port.id} type="target" id={port.id} position={Position.Top}
            style={{
              left: `${((index + 1) / (muxTopPorts.length + 1)) * nodeWidth}px`,
              top: diagramSizing.gridSize,  // matches original .mux-select-port { top: var(--svsch-grid) }
              transform: 'translateX(-50%)',
            }} />
        ))}
        {sideInputs.map((port: DiagramPort, index: number) => (
          <Handle key={port.id} type="target" id={port.id} position={Position.Left}
            style={{ top: muxInputPortCenterY(index, sideInputs.length, nodeHeight) }} />
        ))}
        {outputs.slice(0, 1).map((port: DiagramPort) => (
          <Handle key={port.id} type="source" id={port.id} position={Position.Right}
            style={{ top: nodeHeight / 2 }} />
        ))}
        {isArray && <ArrayStackSelection kind="mux" width={nodeWidth} height={nodeHeight} wide={nodeStackIsWide(node)} />}
        {warningIcon}
      </button>
    );
  }

  if (node.kind === 'alu') {
    const g = diagramSizing.gridSize;
    return (
      <button
        className={`hdl-node hdl-node-alu${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        onDoubleClick={handleDoubleClick}
      >
        <svg className="hdl-node-svg" width={nodeWidth} height={nodeHeight} aria-hidden="true">
          <AluNodeSvg node={node} width={nodeWidth} height={nodeHeight} arrayConnections={arrayConnections} />
        </svg>
        {sideInputs.slice(0, 2).map((port: DiagramPort, index: number) => (
          <Handle key={port.id} type="target" id={port.id} position={Position.Left}
            style={{ top: (index === 0 ? g : g * 3) }} />
        ))}
        {outputs.slice(0, 1).map((port: DiagramPort) => (
          <Handle key={port.id} type="source" id={port.id} position={Position.Right}
            style={{ top: nodeHeight / 2 }} />
        ))}
        {isArray && <ArrayStackSelection kind="rect" width={nodeWidth} height={nodeHeight} wide={nodeStackIsWide(node)} />}
        {warningIcon}
      </button>
    );
  }

  if (node.kind === 'comb' || node.kind === 'loop') {
    const SvgComp = node.kind === 'comb' ? CombNodeSvg : LoopNodeSvg;
    return (
      <button
        className={`hdl-node hdl-node-${node.kind}${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        onDoubleClick={handleDoubleClick}
      >
        <svg className="hdl-node-svg" width={nodeWidth} height={nodeHeight} aria-hidden="true">
          <SvgComp node={node} width={nodeWidth} height={nodeHeight} arrayConnections={arrayConnections} />
        </svg>
        {sideInputs.map((port: DiagramPort, i: number) => (
          <Handle key={port.id} type="target" id={port.id} position={Position.Left}
            style={{ top: nodePortCenterOffset(i) }} />
        ))}
        {outputs.map((port: DiagramPort, i: number) => (
          <Handle key={port.id} type="source" id={port.id} position={Position.Right}
            style={{ top: nodePortCenterOffset(i) }} />
        ))}
        {isArray
          ? <ArrayStackSelection kind="rect" width={nodeWidth} height={nodeHeight} wide={nodeStackIsWide(node)} />
          : <div className="hdl-node-selection-rect" aria-hidden="true" />}
        {warningIcon}
      </button>
    );
  }

  // Catch-all: instance and unknown kinds
  return (
    <button
      className={`hdl-node hdl-node-${node.kind}${instanceParameters.length > 0 ? ' hdl-node-has-params' : ''}${isArray ? ` hdl-node-array${nodeStackIsWide(node) ? ' hdl-node-array-wide' : ''}` : ''}`}
      data-node-id={node.id}
      data-node-kind={node.kind}
      style={nodeStyle}
      title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
      onDoubleClick={handleDoubleClick}
    >
      <svg className="hdl-node-svg" width={nodeWidth} height={nodeHeight} aria-hidden="true">
        <InstanceNodeSvg
          node={node}
          width={nodeWidth}
          height={nodeHeight}
          arrayConnections={arrayConnections}
          onNavigateToSource={navigateToSource}
        />
      </svg>
      {/* HTML instance parameter chips — needed for test ".instance-parameter-chip" selectors */}
      {instanceParameters.length > 0 && (
        <div style={{
          position: 'absolute',
          top: `${16 + Math.max(0, (parameterRows * diagramSizing.gridSize - (instanceParameters.length * 16 + Math.max(0, instanceParameters.length - 1) * 2)) / 2)}px`,
          left: 0,
          right: 0
        }}>
          <InstanceParameterList parameters={instanceParameters} />
        </div>
      )}
      {sideInputs.map((port: DiagramPort, i: number) => (
        <Handle key={port.id} type="target" id={port.id} position={Position.Left}
          style={{ top: nodePortCenterOffset(i + parameterRows) }} />
      ))}
      {sideInputs.filter((p: DiagramPort) => p.direction === 'inout').map((port: DiagramPort) => (
        <Handle key={`inout-${port.id}`} type="source" id={port.id} position={Position.Right}
          style={{ top: nodePortCenterOffset(sideInputs.indexOf(port) + parameterRows) }} />
      ))}
      {outputs.map((port: DiagramPort, i: number) => (
        <Handle key={port.id} type="source" id={port.id} position={Position.Right}
          style={{ top: nodePortCenterOffset(i + parameterRows) }} />
      ))}
      {isArray
        ? <ArrayStackSelection kind="rect" width={nodeWidth} height={nodeHeight} wide={nodeStackIsWide(node)} />
        : <div className="hdl-node-selection-rect" aria-hidden="true" />}
      {warningIcon}
    </button>
  );
}

function NodeWarningIcon({ message, vertex }: { message?: string; vertex: { x: number; y: number } }): React.ReactElement | null {
  if (!message) return null;

  const halfGrid = diagramSizing.gridSize / 2;
  const style: React.CSSProperties = {
    left: vertex.x + halfGrid,
    top: vertex.y - halfGrid,
    transform: 'translate(-50%, -50%)'
  };

  return (
    <Tooltip content={message}>
      {(trigger) => (
        <span
          {...trigger}
          className="node-warning"
          role="img"
          aria-label={message}
          style={style}
        >
          ⚠
        </span>
      )}
    </Tooltip>
  );
}
